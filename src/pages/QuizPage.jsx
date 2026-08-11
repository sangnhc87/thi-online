import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, setDoc, updateDoc, Timestamp, query, where, arrayUnion, onSnapshot } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, functions, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, getTodayKey } from '../utils/formatters';
import { calculateStreak } from '../utils/scoring';
import { checkAchievements } from '../utils/achievements';
import { AchievementPopup } from '../components/AchievementBadge';
import ConfettiEffect from '../components/ConfettiEffect';
import Swal from 'sweetalert2';
import 'katex/dist/katex.min.css';
import { playCorrect, playWrong, playCombo, playAlarm, playVictory, playPerfect, playCountdown, playStart } from '../utils/sounds';
import Certificate from '../components/Certificate';
import { CERTIFICATE_DOCUMENT_TYPES } from '../utils/certificateExport';
import { DEFAULT_MATH_WRAP, MATH_GROUPS, MATH_WRAP_OPTIONS, wrapMathExpression, renderLatexContent as renderLatex } from '../utils/math';
import { getStorageSafeImageName, optimizeImageFile } from '../utils/image';
import { normalizeAntiCheatSettings } from '../utils/examSecurity';
import { computeGameSummary, getGamificationPresetLabel, normalizeGamificationSettings } from '../utils/gamification';
import { getChoiceDisplayContent, orderQuestionsForDelivery, stripQuestionNumberPrefix } from '../utils/examSections';
import { getQuestionOptionLayout, stripOptionLayoutHints } from '../utils/questionLayout';
import {
    DEFAULT_QUESTION_SCORING,
    DEFAULT_TF_SCORING,
    evaluateQuestionAnswer,
    getQuestionMaxPoints,
    isQuestionAnswered,
    normalizeEssayAnswer,
} from '../utils/examScoring';
import { getStudentAccessState } from '../utils/studentAccess';
import { clearQuizAttemptState, loadQuizAttemptState, markQuizAttemptReloadPending, saveQuizAttemptState } from '../utils/quizAttemptPersistence';

function getFullscreenElement() {
    if (typeof document === 'undefined') return null;
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function requestFullscreenMode() {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) return false;
    await request.call(root);
    return true;
}

function rankLeaderboardEntries(entries) {
    return [...entries]
        .filter((entry) => entry.totalQuestions > 0)
        .sort((a, b) => {
            const pctA = a.totalQuestions ? a.totalScore / a.totalQuestions : 0;
            const pctB = b.totalQuestions ? b.totalScore / b.totalQuestions : 0;
            return pctB - pctA || b.totalQuizzes - a.totalQuizzes;
        });
}

function getChoiceTextMetrics(choice = {}) {
    const source = stripOptionLayoutHints(choice.text || choice.html || '');
    const plainText = source
        .replace(/<img[^>]*>/gi, ' [image] ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        length: plainText.length,
        words: plainText ? plainText.split(' ').length : 0,
        hasImage: /<img\b/i.test(choice.html || ''),
        hasFormula: /\\\(|\\\[|\$\$?/.test(choice.text || choice.html || ''),
    };
}

function getMcqLayoutClass(question = {}) {
    const explicitLayout = getQuestionOptionLayout(question);
    if (explicitLayout) return `mc-layout-${explicitLayout}`;

    const choices = Array.isArray(question.choices) ? question.choices : [];
    if (choices.length <= 1) return 'mc-layout-1x4';
    if (choices.length === 2) return 'mc-layout-2x2';

    const metrics = choices.map(getChoiceTextMetrics);
    const maxLength = Math.max(...metrics.map((item) => item.length), 0);
    const avgLength = metrics.reduce((sum, item) => sum + item.length, 0) / Math.max(metrics.length, 1);
    const maxWords = Math.max(...metrics.map((item) => item.words), 0);
    const hasImage = metrics.some((item) => item.hasImage);
    const hasFormula = metrics.some((item) => item.hasFormula);

    if (hasImage) return 'mc-layout-1x4';
    if (choices.length >= 4 && maxLength <= 16 && avgLength <= 10 && maxWords <= 3 && !hasFormula) return 'mc-layout-4x1';
    if (maxLength > 78 || avgLength > 46 || maxWords > 10) return 'mc-layout-1x4';
    return 'mc-layout-2x2';
}

function getQuestionTypeLabel(type = 'mcq') {
    switch (type) {
        case 'tf':
            return 'Dung / Sai';
        case 'short_answer':
            return 'Tra loi ngan';
        case 'essay':
            return 'Tu luan';
        default:
            return 'Trac nghiem';
    }
}

function formatPointValue(value = 0) {
    const numeric = Number(value) || 0;
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(numeric);
}

function getQuizAccessErrorMessage(error) {
    if (error?.code === 'permission-denied' || error?.code === 'functions/permission-denied') {
        return 'Tài khoản của bạn hiện chưa được phép mở đề này. Nếu giáo viên vừa cập nhật lớp hoặc hạn sử dụng, hãy đăng xuất đăng nhập lại rồi thử lại.';
    }

    if (error?.code === 'functions/failed-precondition' || error?.code === 'failed-precondition') {
        return error?.message || 'Điều kiện vào thi hiện chưa thỏa mãn.';
    }

    if (error?.code === 'functions/not-found' || error?.code === 'not-found') {
        return error?.message || 'Không tìm thấy đề thi hoặc dữ liệu bài thi.';
    }

    return error?.message || 'Không thể mở đề thi lúc này.';
}

const ESSAY_ATTACHMENT_LIMITS = {
    perQuestion: 4,
    perQuiz: 12,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 6 * 1024 * 1024,
};

const SESSION_RETENTION_MILLISECONDS = 3 * 365 * 24 * 60 * 60 * 1000;

function buildPersistableQuizAnswers(answers = {}, questions = []) {
    const essayQuestionIds = new Set(
        questions.filter((question) => question.type === 'essay').map((question) => question.id),
    );

    return Object.fromEntries(Object.entries(answers).map(([questionId, answer]) => {
        if (!essayQuestionIds.has(questionId)) return [questionId, answer];

        const normalizedEssay = normalizeEssayAnswer(answer);
        return [questionId, {
            text: normalizedEssay.text,
            attachments: [],
        }];
    }));
}

function summarizeEssayDraft(answer) {
    const normalizedEssay = normalizeEssayAnswer(answer);
    const parts = [];

    if (normalizedEssay.text) parts.push(`${normalizedEssay.text.length} ký tự`);
    if (normalizedEssay.attachments.length > 0) {
        parts.push(`${normalizedEssay.attachments.length} ảnh`);
    }

    return parts.join(' · ') || null;
}

export default function QuizPage() {
    const { examId, studentId: previewStudentId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const isPreviewMode = Boolean(previewStudentId);
    const returnPath = isPreviewMode ? `/teacher/student/${previewStudentId}/preview` : '/student';

    const [phase, setPhase] = useState('loading'); // loading, countdown, quiz, result
    const [exam, setExam] = useState(null);
    const [previewStudent, setPreviewStudent] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [answers, setAnswers] = useState({});
    const [currentIdx, setCurrentIdx] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0);
    const [submitted, setSubmitted] = useState(false);
    const [score, setScore] = useState(0);
    const [quizStreak, setQuizStreak] = useState(0); // consecutive correct in this quiz
    const [maxQuizStreak, setMaxQuizStreak] = useState(0);
    const [showConfetti, setShowConfetti] = useState(false);
    const [newAchievement, setNewAchievement] = useState(null);
    const [answerFeedback, setAnswerFeedback] = useState(null); // 'correct' | 'wrong' | null
    const [countdownValue, setCountdownValue] = useState(3);
    const [showCert, setShowCert] = useState(false);
    const [antiCheatViolations, setAntiCheatViolations] = useState(0);
    const [antiCheatNotice, setAntiCheatNotice] = useState('');
    const [isFullscreenActive, setIsFullscreenActive] = useState(Boolean(getFullscreenElement()));
    const [classLeaderboard, setClassLeaderboard] = useState([]);
    const [flaggedQuestions, setFlaggedQuestions] = useState({});
    const [fullscreenSupported, setFullscreenSupported] = useState(false);
    const [attemptStartedAt, setAttemptStartedAt] = useState(null);
    const [essayMathOpen, setEssayMathOpen] = useState(false);
    const [essayMathLatex, setEssayMathLatex] = useState('');
    const [essayMathPaletteGroup, setEssayMathPaletteGroup] = useState(0);
    const [essayMathWrapMode, setEssayMathWrapMode] = useState(DEFAULT_MATH_WRAP);
    const timerRef = useRef(null);
    const countdownRef = useRef(null);
    const startTimeRef = useRef(null);
    const submitRef = useRef(null);
    const antiCheatViolationsRef = useRef(0);
    const antiCheatEventRef = useRef({ reason: '', timestamp: 0 });
    const navigationAwayRef = useRef(false);
    const fullscreenStateRef = useRef(Boolean(getFullscreenElement()));
    const leaderboardUnsubscribeRef = useRef(null);
    const answersRef = useRef({});
    const essayAttachmentFilesRef = useRef({});
    const essayGalleryInputRef = useRef(null);
    const essayCameraInputRef = useRef(null);
    const essayAnswerInputRef = useRef(null);
    const antiCheatSettings = useMemo(() => normalizeAntiCheatSettings(exam?.antiCheat), [exam?.antiCheat]);
    const gamification = useMemo(() => normalizeGamificationSettings(exam?.gamification), [exam?.gamification]);
    const antiCheatUiEnabled = antiCheatSettings.enabled;
    const antiCheatEnforced = antiCheatUiEnabled && !isPreviewMode;
    const antiCheatRequireFullscreen = antiCheatSettings.requireFullscreen;
    const antiCheatMaxWarnings = antiCheatSettings.maxWarnings;
    const activeStudentName = isPreviewMode
        ? (previewStudent?.displayName || previewStudent?.email || 'Học sinh')
        : (user?.displayName || user?.email || 'Học sinh');
    const activeStudentProfile = isPreviewMode ? previewStudent : userProfile;
    const gameSummary = useMemo(() => computeGameSummary({
        questions,
        answers,
        timeLeft,
        durationMinutes: exam?.duration,
        settings: gamification,
        maxQuizStreak,
    }), [answers, exam?.duration, gamification, maxQuizStreak, questions, timeLeft]);
    const currentAttemptSummary = useMemo(() => questions.reduce((summary, question) => {
        const answer = answers[question.id];
        if (isQuestionAnswered(question, answer)) summary.answeredCount += 1;

        const evaluated = evaluateQuestionAnswer(question, answer, exam || {
            questionScoring: DEFAULT_QUESTION_SCORING,
            tfScoring: DEFAULT_TF_SCORING,
        });

        if (question.type === 'essay') {
            summary.manualTotalPoints += evaluated.maxPoints;
            if (evaluated.textAnswer || (evaluated.attachments || []).length > 0) summary.manualAnsweredCount += 1;
            return summary;
        }

        summary.autoTotalPoints += evaluated.maxPoints;
        summary.earnedScore += evaluated.earnedPoints;
        if (evaluated.isCorrect) summary.correctCount += 1;
        return summary;
    }, {
        answeredCount: 0,
        autoTotalPoints: 0,
        manualTotalPoints: 0,
        manualAnsweredCount: 0,
        earnedScore: 0,
        correctCount: 0,
    }), [answers, exam, questions]);
    const projectedLeaderboard = useMemo(() => {
        if (!activeStudentProfile?.uid && !user?.uid) return [];

        const projectedEntry = {
            uid: activeStudentProfile?.uid || user?.uid,
            displayName: activeStudentName,
            photoURL: activeStudentProfile?.photoURL || user?.photoURL || null,
            streak: activeStudentProfile?.streak || 0,
            totalScore: (activeStudentProfile?.totalScore || 0) + currentAttemptSummary.earnedScore,
            totalQuestions: (activeStudentProfile?.totalQuestions || 0) + currentAttemptSummary.autoTotalPoints,
            totalQuizzes: (activeStudentProfile?.totalQuizzes || 0) + (currentAttemptSummary.answeredCount > 0 ? 1 : 0),
            projected: true,
        };

        const rest = classLeaderboard.filter((entry) => entry.uid !== projectedEntry.uid);
        return rankLeaderboardEntries([...rest, projectedEntry]);
    }, [activeStudentName, activeStudentProfile, classLeaderboard, currentAttemptSummary, user?.photoURL, user?.uid]);
    const projectedRank = projectedLeaderboard.findIndex((entry) => entry.uid === (activeStudentProfile?.uid || user?.uid)) + 1;
    const currentQuestionId = questions[currentIdx]?.id || null;

    useEffect(() => {
        antiCheatViolationsRef.current = antiCheatViolations;
    }, [antiCheatViolations]);

    useEffect(() => {
        answersRef.current = answers;
    }, [answers]);

    useEffect(() => {
        fullscreenStateRef.current = isFullscreenActive;
    }, [isFullscreenActive]);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        setFullscreenSupported(Boolean(root.requestFullscreen || root.webkitRequestFullscreen));
        setIsFullscreenActive(Boolean(getFullscreenElement()));
    }, []);

    const revokeEssayAttachmentPreview = useCallback((attachment) => {
        if (attachment?.previewUrl && attachment.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.previewUrl);
        }
    }, []);

    const clearLocalEssayAttachments = useCallback(() => {
        Object.values(answersRef.current || {}).forEach((answer) => {
            normalizeEssayAnswer(answer).attachments.forEach(revokeEssayAttachmentPreview);
        });
        essayAttachmentFilesRef.current = {};
    }, [revokeEssayAttachmentPreview]);

    useEffect(() => () => {
        clearLocalEssayAttachments();
    }, [clearLocalEssayAttachments]);

    const startTimer = useCallback((startedAtMs, durationSeconds, submitReason = 'timeout') => {
        if (timerRef.current) clearInterval(timerRef.current);
        const totalDuration = Math.max(0, Number(durationSeconds) || 0);

        const tick = () => {
            const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
            const remainingSeconds = Math.max(0, totalDuration - elapsedSeconds);
            setTimeLeft(remainingSeconds);

            if (remainingSeconds <= 0) {
                clearInterval(timerRef.current);
                playAlarm();
                submitRef.current?.(true, submitReason);
                return;
            }

            if (remainingSeconds === 60 || remainingSeconds === 30 || remainingSeconds === 10) playAlarm();
        };

        tick();
        timerRef.current = setInterval(() => {
            tick();
        }, 1000);
    }, []);

    const startQuizCountdown = useCallback((durationMinutes, requireFullscreenBeforeStart = false) => {
        if (countdownRef.current) return;

        const durationSeconds = Math.max(0, (Number(durationMinutes) || 0) * 60);
        let count = 3;
        setCountdownValue(count);
        playCountdown();

        countdownRef.current = setInterval(() => {
            if (requireFullscreenBeforeStart && fullscreenSupported && !getFullscreenElement()) {
                clearInterval(countdownRef.current);
                countdownRef.current = null;
                setCountdownValue(3);
                setAntiCheatNotice('Bài thi chỉ bắt đầu khi bạn đang ở chế độ toàn màn hình.');
                return;
            }

            count -= 1;
            if (count <= 0) {
                clearInterval(countdownRef.current);
                countdownRef.current = null;
                setPhase('quiz');
                const startedAtMs = Date.now();
                startTimeRef.current = startedAtMs;
                setAttemptStartedAt(startedAtMs);
                startTimer(startedAtMs, durationSeconds);
                playStart();
                return;
            }

            setCountdownValue(count);
            playCountdown();
        }, 1000);
    }, [fullscreenSupported, startTimer]);

    const resetEssayPickers = useCallback(() => {
        if (essayGalleryInputRef.current) essayGalleryInputRef.current.value = '';
        if (essayCameraInputRef.current) essayCameraInputRef.current.value = '';
    }, []);

    const insertIntoCurrentEssayText = useCallback((insertionText) => {
        if (!currentQuestionId) return;

        const textarea = essayAnswerInputRef.current;
        const currentEssay = normalizeEssayAnswer(answersRef.current?.[currentQuestionId]);
        const sourceText = currentEssay.text;
        const start = textarea?.selectionStart ?? sourceText.length;
        const end = textarea?.selectionEnd ?? sourceText.length;
        const nextText = `${sourceText.slice(0, start)}${insertionText}${sourceText.slice(end)}`;

        setAnswers((prev) => ({
            ...prev,
            [currentQuestionId]: {
                ...normalizeEssayAnswer(prev[currentQuestionId]),
                text: nextText,
            },
        }));

        setTimeout(() => {
            if (!textarea) return;
            const cursor = start + insertionText.length;
            textarea.focus();
            textarea.setSelectionRange(cursor, cursor);
        }, 0);
    }, [currentQuestionId]);

    const insertEssayMathSymbol = useCallback((latex) => {
        setEssayMathLatex((prev) => {
            const placeholder = '\u25AB';
            const placeholderIndex = prev.indexOf(placeholder);
            if (placeholderIndex >= 0) {
                return `${prev.slice(0, placeholderIndex)}${latex}${prev.slice(placeholderIndex + 1)}`;
            }
            return `${prev}${latex}`;
        });
    }, []);

    const applyEssayMathSnippet = useCallback(() => {
        if (!essayMathLatex.trim()) return;
        insertIntoCurrentEssayText(wrapMathExpression(essayMathLatex, essayMathWrapMode));
        setEssayMathLatex('');
    }, [essayMathLatex, essayMathWrapMode, insertIntoCurrentEssayText]);

    const removeEssayAttachment = useCallback((questionId, attachmentId) => {
        if (submitted) return;

        setAnswers((prev) => {
            const currentEssay = normalizeEssayAnswer(prev[questionId]);
            const attachment = currentEssay.attachments.find((item) => item.id === attachmentId);
            if (attachment) revokeEssayAttachmentPreview(attachment);
            delete essayAttachmentFilesRef.current[attachmentId];

            return {
                ...prev,
                [questionId]: {
                    ...currentEssay,
                    attachments: currentEssay.attachments.filter((item) => item.id !== attachmentId),
                },
            };
        });
    }, [revokeEssayAttachmentPreview, submitted]);

    const handleEssayAttachmentSelection = useCallback(async (questionId, selectedFiles) => {
        if (submitted || !questionId) {
            resetEssayPickers();
            return;
        }

        const files = Array.from(selectedFiles || []);
        if (files.length === 0) {
            resetEssayPickers();
            return;
        }

        try {
            const currentEssay = normalizeEssayAnswer(answersRef.current?.[questionId]);
            const existingQuestionCount = currentEssay.attachments.length;
            const existingQuizCount = questions.reduce((sum, question) => (
                question.type === 'essay'
                    ? sum + normalizeEssayAnswer(answersRef.current?.[question.id]).attachments.length
                    : sum
            ), 0);
            const existingQuizBytes = questions.reduce((sum, question) => (
                question.type === 'essay'
                    ? sum + normalizeEssayAnswer(answersRef.current?.[question.id]).attachments.reduce((attachmentSum, attachment) => attachmentSum + (Number(attachment.size) || 0), 0)
                    : sum
            ), 0);

            let questionCount = existingQuestionCount;
            let quizCount = existingQuizCount;
            let quizBytes = existingQuizBytes;
            const acceptedAttachments = [];
            let skippedCount = 0;
            let skippedByLimit = false;

            for (const file of files) {
                if (!file.type.startsWith('image/')) {
                    skippedCount += 1;
                    continue;
                }

                if (questionCount >= ESSAY_ATTACHMENT_LIMITS.perQuestion || quizCount >= ESSAY_ATTACHMENT_LIMITS.perQuiz) {
                    skippedCount += 1;
                    skippedByLimit = true;
                    continue;
                }

                const optimized = await optimizeImageFile(file, {
                    fileName: file.name,
                    maxWidth: 1280,
                    maxHeight: 1600,
                    quality: 0.74,
                });

                if (!optimized?.blob || optimized.blob.size > ESSAY_ATTACHMENT_LIMITS.maxFileBytes) {
                    skippedCount += 1;
                    skippedByLimit = true;
                    continue;
                }

                if (quizBytes + optimized.blob.size > ESSAY_ATTACHMENT_LIMITS.maxTotalBytes) {
                    skippedCount += 1;
                    skippedByLimit = true;
                    continue;
                }

                const attachmentId = `essay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const previewUrl = URL.createObjectURL(optimized.blob);
                essayAttachmentFilesRef.current[attachmentId] = {
                    blob: optimized.blob,
                    name: optimized.name,
                    mime: optimized.mime,
                };

                acceptedAttachments.push({
                    id: attachmentId,
                    name: optimized.name,
                    mime: optimized.mime,
                    size: optimized.blob.size,
                    previewUrl,
                });

                questionCount += 1;
                quizCount += 1;
                quizBytes += optimized.blob.size;
            }

            if (acceptedAttachments.length > 0) {
                setAnswers((prev) => {
                    const nextEssay = normalizeEssayAnswer(prev[questionId]);
                    return {
                        ...prev,
                        [questionId]: {
                            ...nextEssay,
                            attachments: [...nextEssay.attachments, ...acceptedAttachments],
                        },
                    };
                });
            }

            if (skippedCount > 0) {
                const reason = skippedByLimit
                    ? `Ảnh sẽ được tự nén và chỉ nhận tối đa ${ESSAY_ATTACHMENT_LIMITS.perQuestion} ảnh mỗi câu, ${ESSAY_ATTACHMENT_LIMITS.perQuiz} ảnh cho cả bài, dưới 2MB mỗi ảnh.`
                    : 'Chỉ chấp nhận tệp hình ảnh.';
                Swal.fire('Một số ảnh chưa được nhận', `${skippedCount} tệp đã bị bỏ qua. ${reason}`, 'info');
            }
        } catch (error) {
            console.error('essay attachment selection failed', error);
            Swal.fire('Không thể xử lý ảnh', error.message || 'Hệ thống không đọc được một trong các ảnh bạn vừa chọn.', 'error');
        } finally {
            resetEssayPickers();
        }
    }, [questions, resetEssayPickers, submitted]);

    useEffect(() => {
        if (phase !== 'countdown' || !exam?.duration) return;

        const mustWaitForFullscreen = antiCheatEnforced && antiCheatRequireFullscreen && fullscreenSupported;
        if (mustWaitForFullscreen && !getFullscreenElement()) {
            if (countdownRef.current) {
                clearInterval(countdownRef.current);
                countdownRef.current = null;
            }
            if (countdownValue !== 3) setCountdownValue(3);
            return;
        }

        startQuizCountdown(exam.duration, mustWaitForFullscreen);
    }, [antiCheatEnforced, antiCheatRequireFullscreen, countdownValue, exam?.duration, fullscreenSupported, isFullscreenActive, phase, startQuizCountdown]);

    const saveAttemptSnapshot = useCallback((overrides = {}) => {
        if (isPreviewMode || !user?.uid || !examId || !attemptStartedAt || submitted || questions.length === 0) return null;

        return saveQuizAttemptState(user.uid, examId, {
            startedAtMs: attemptStartedAt,
            answers: buildPersistableQuizAnswers(answers, questions),
            currentIdx,
            flaggedQuestions,
            antiCheatViolations: antiCheatViolationsRef.current,
            questionsSnapshot: questions,
            pendingReloadViolation: false,
            ...overrides,
        });
    }, [answers, attemptStartedAt, currentIdx, examId, flaggedQuestions, isPreviewMode, questions, submitted, user?.uid]);

    useEffect(() => {
        if (phase !== 'quiz' || submitted || isPreviewMode || !attemptStartedAt) return;
        saveAttemptSnapshot();
    }, [answers, antiCheatViolations, attemptStartedAt, currentIdx, flaggedQuestions, isPreviewMode, phase, questions, saveAttemptSnapshot, submitted]);

    useEffect(() => {
        if (isPreviewMode || !user?.uid || !examId) return;
        if (phase === 'result') {
            clearQuizAttemptState(user.uid, examId);
        }
    }, [examId, isPreviewMode, phase, user?.uid]);

    const loadExam = useCallback(async () => {
        if (!user || !userProfile) return;
        let targetStudent = userProfile;
        const savedAttempt = !isPreviewMode ? loadQuizAttemptState(user.uid, examId) : null;

        clearLocalEssayAttachments();
        resetEssayPickers();

        if (timerRef.current) clearInterval(timerRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (leaderboardUnsubscribeRef.current) leaderboardUnsubscribeRef.current();
        leaderboardUnsubscribeRef.current = null;
        setPhase('loading');
        setExam(null);
        setQuestions([]);
        setClassLeaderboard([]);
        setCurrentIdx(0);
        setFlaggedQuestions({});
        setAnswers({});
        setQuizStreak(0);
        setMaxQuizStreak(0);
        setScore(0);
        setSubmitted(false);
        setAttemptStartedAt(null);
        startTimeRef.current = null;

        try {
            if (isPreviewMode) {
                if (userProfile?.role !== 'teacher') {
                    Swal.fire('Không khả dụng', 'Chỉ giáo viên mới được xem preview học sinh.', 'info');
                    navigate('/teacher');
                    return;
                }

                const previewSnap = await getDoc(doc(db, 'users', previewStudentId));
                if (!previewSnap.exists()) {
                    Swal.fire('Không tìm thấy', 'Học sinh preview không tồn tại.', 'error');
                    navigate('/teacher');
                    return;
                }

                const previewData = { uid: previewSnap.id, ...previewSnap.data() };
                if (previewData.role !== 'student' || previewData.teacherId !== user.uid) {
                    Swal.fire('Không có quyền', 'Bạn không được preview học sinh này.', 'error');
                    navigate('/teacher');
                    return;
                }

                targetStudent = previewData;
                setPreviewStudent(previewData);
            } else {
                setPreviewStudent(null);
            }

            const examDoc = await getDoc(doc(db, 'exams', examId));
            if (!examDoc.exists()) {
                Swal.fire('Không tìm thấy', 'Đề thi không tồn tại.', 'error');
                navigate(returnPath);
                return;
            }
            const examData = { id: examDoc.id, ...examDoc.data() };
            if (!isPreviewMode && userProfile?.role !== 'student') {
                Swal.fire('Không khả dụng', 'Chỉ tài khoản học sinh mới có thể làm bài thi.', 'info');
                navigate(userProfile?.role === 'admin' ? '/admin' : '/teacher');
                return;
            }
            const studentAccessState = getStudentAccessState(targetStudent);
            if (!isPreviewMode && studentAccessState.code === 'blocked') {
                Swal.fire(studentAccessState.title, studentAccessState.description, 'error');
                navigate(returnPath);
                return;
            }
            if (!isPreviewMode && studentAccessState.code === 'expired') {
                Swal.fire(studentAccessState.title, studentAccessState.description, 'error');
                navigate(returnPath);
                return;
            }
            if (examData.status !== 'active') {
                Swal.fire('Đề chưa mở', 'Đề thi này hiện chưa được mở cho học sinh.', 'info');
                navigate(returnPath);
                return;
            }
            if (examData.teacherId !== targetStudent?.teacherId) {
                Swal.fire('Không có quyền', 'Đề thi này không thuộc lớp của bạn.', 'error');
                navigate(returnPath);
                return;
            }

            if (!isPreviewMode) {
                const getQuizLaunchData = httpsCallable(functions, 'getQuizLaunchData');
                const launchResponse = await getQuizLaunchData({ examId });
                const launchPayload = launchResponse.data || {};
                const maxAttempts = examData.maxAttempts || 1;
                const attemptsForExam = Number(launchPayload.attemptCount) || 0;

                if (attemptsForExam >= maxAttempts) {
                    clearQuizAttemptState(user.uid, examId);
                    Swal.fire('Hết lượt', `Bạn đã thi ${attemptsForExam}/${maxAttempts} lần cho đề này.`, 'info');
                    navigate(returnPath);
                    return;
                }

                const restorableQuestions = Array.isArray(savedAttempt?.questionsSnapshot) && savedAttempt.questionsSnapshot.length > 0
                    ? savedAttempt.questionsSnapshot
                    : null;
                const deliveredQuestions = restorableQuestions || orderQuestionsForDelivery(launchPayload.questions || [], {
                    shuffleQuestions: examData.shuffleQuestions !== false,
                    shuffleChoices: examData.shuffleChoices !== false,
                });
                setQuestions(deliveredQuestions);

                const durationSeconds = Math.max(0, (Number(examData.duration) || 0) * 60);
                const antiCheatConfig = normalizeAntiCheatSettings(examData.antiCheat);
                const shouldResumeAttempt = Boolean(savedAttempt && restorableQuestions && Number(savedAttempt.startedAtMs));

                setExam(examData);
                setTimeLeft(durationSeconds);
                setAntiCheatNotice('');

                if (shouldResumeAttempt) {
                    const startedAtMs = Number(savedAttempt.startedAtMs);
                    const restoredAnswers = savedAttempt?.answers && typeof savedAttempt.answers === 'object' ? savedAttempt.answers : {};
                    const restoredFlags = savedAttempt?.flaggedQuestions && typeof savedAttempt.flaggedQuestions === 'object' ? savedAttempt.flaggedQuestions : {};
                    const restoredCurrentIdx = Math.min(
                        Math.max(Number(savedAttempt?.currentIdx) || 0, 0),
                        Math.max(deliveredQuestions.length - 1, 0),
                    );
                    const reloadTriggered = Boolean(savedAttempt?.pendingReloadViolation);
                    const resumedViolations = reloadTriggered && antiCheatConfig.enabled
                        ? (Number(savedAttempt?.antiCheatViolations) || 0) + 1
                        : (Number(savedAttempt?.antiCheatViolations) || 0);
                    const remainingSeconds = Math.max(0, durationSeconds - Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));

                    setAnswers(restoredAnswers);
                    setFlaggedQuestions(restoredFlags);
                    setCurrentIdx(restoredCurrentIdx);
                    setAttemptStartedAt(startedAtMs);
                    startTimeRef.current = startedAtMs;
                    antiCheatViolationsRef.current = resumedViolations;
                    setAntiCheatViolations(resumedViolations);
                    setTimeLeft(remainingSeconds);
                    setAntiCheatNotice(
                        reloadTriggered
                            ? 'Bạn vừa tải lại hoặc rời khỏi trang làm bài. Đồng hồ vẫn tiếp tục chạy.'
                            : 'Đã khôi phục bài làm dang dở. Đồng hồ vẫn tiếp tục chạy.',
                    );
                    setPhase('quiz');
                    startTimer(startedAtMs, durationSeconds);

                    if (reloadTriggered && antiCheatConfig.enabled) {
                        if (resumedViolations >= antiCheatConfig.maxWarnings) {
                            setTimeout(() => {
                                Swal.fire({
                                    title: 'Tự động nộp bài',
                                    text: 'Bạn đã tải lại trang quá số cảnh cáo cho phép. Hệ thống sẽ nộp bài hiện tại.',
                                    icon: 'warning',
                                    confirmButtonText: 'Đã hiểu',
                                }).then(() => submitRef.current?.(true, 'anti-cheat:reload'));
                            }, 0);
                        } else {
                            setTimeout(() => {
                                Swal.fire({
                                    toast: true,
                                    position: 'top',
                                    icon: 'warning',
                                    title: `Bạn vừa tải lại trang. Đồng hồ vẫn chạy và bị tính 1 cảnh cáo (${resumedViolations}/${antiCheatConfig.maxWarnings}).`,
                                    showConfirmButton: false,
                                    timer: 2600,
                                    timerProgressBar: true,
                                });
                            }, 0);
                        }
                    }

                    return;
                }
            } else {
                const getQuizLaunchData = httpsCallable(functions, 'getQuizLaunchData');
                const launchResponse = await getQuizLaunchData({ examId, previewStudentId });
                const launchPayload = launchResponse.data || {};
                setQuestions(orderQuestionsForDelivery(launchPayload.questions || [], {
                    shuffleQuestions: examData.shuffleQuestions !== false,
                    shuffleChoices: examData.shuffleChoices !== false,
                }));
            }

            const quizGamification = normalizeGamificationSettings(examData.gamification);
            if (quizGamification.liveLeaderboard) {
                leaderboardUnsubscribeRef.current = onSnapshot(
                    query(collection(db, 'users'), where('teacherId', '==', targetStudent.teacherId), where('role', '==', 'student')),
                    (snapshot) => {
                        const entries = snapshot.docs.map((item) => ({
                            uid: item.id,
                            ...item.data(),
                            totalScore: item.data().totalScore || 0,
                            totalQuestions: item.data().totalQuestions || 0,
                            totalQuizzes: item.data().totalQuizzes || 0,
                            streak: item.data().streak || 0,
                        }));
                        setClassLeaderboard(entries);
                    },
                    (error) => console.error('live leaderboard subscribe failed', error),
                );
            }

            setExam(examData);
            setTimeLeft(examData.duration * 60);
            setAntiCheatViolations(0);
            antiCheatViolationsRef.current = 0;
            setAntiCheatNotice('');
            setPhase('countdown');
            setCountdownValue(3);
        } catch (error) {
            console.error('load exam failed', error);
            Swal.fire('Không thể mở đề thi', getQuizAccessErrorMessage(error), 'error');
            navigate(returnPath);
        }
    }, [clearLocalEssayAttachments, examId, isPreviewMode, navigate, previewStudentId, resetEssayPickers, returnPath, startTimer, user, userProfile]);

    useEffect(() => {
        if (user && userProfile) loadExam();
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            if (leaderboardUnsubscribeRef.current) leaderboardUnsubscribeRef.current();
        };
    }, [loadExam, user, userProfile]);

    const handleAnswer = useCallback((questionId, choiceIdx) => {
        if (submitted) return;
        setAnswers(prev => ({ ...prev, [questionId]: choiceIdx }));

        // In-quiz streak feedback
        const q = questions.find(q => q.id === questionId);
        if (q) {
            const correctIdx = (q.choices || []).findIndex(c => c.isCorrect || (q.correct_answer && c.letter === q.correct_answer));
            if (choiceIdx === correctIdx) {
                setQuizStreak(prev => {
                    const newStreak = prev + 1;
                    setMaxQuizStreak(m => Math.max(m, newStreak));
                    if (newStreak >= 3) playCombo(newStreak);
                    else playCorrect();
                    return newStreak;
                });
                setAnswerFeedback('correct');
            } else {
                setQuizStreak(0);
                playWrong();
                setAnswerFeedback('wrong');
            }
            setTimeout(() => setAnswerFeedback(null), 600);
        }
    }, [submitted, questions]);

    const handleTfAnswer = (questionId, itemIdx, value, q) => {
        if (submitted) return;
        const numItems = (q?.choices || []).length || 4;
        const current = Array.isArray(answers[questionId]) ? [...answers[questionId]] : new Array(numItems).fill(null);
        current[itemIdx] = current[itemIdx] === value ? null : value; // toggle off if same
        setAnswers(prev => ({ ...prev, [questionId]: current }));
        const allAnswered = current.every(v => v === 'D' || v === 'S');
        if (allAnswered) {
            const correctAns = q.correct_answer || '';
            const allCorrect = correctAns.split('').every((ch, i) => current[i] === ch);
            if (allCorrect) {
                setQuizStreak(s => {
                    const next = s + 1;
                    setMaxQuizStreak(m => Math.max(m, next));
                    if (next >= 3) playCombo(next); else playCorrect();
                    return next;
                });
                setAnswerFeedback('correct');
            } else {
                setQuizStreak(0);
                playWrong();
                setAnswerFeedback('wrong');
            }
            setTimeout(() => setAnswerFeedback(null), 600);
        }
    };

    const handleTextAnswer = useCallback((questionId, value, questionType = 'short_answer') => {
        if (submitted) return;
        if (questionType === 'essay') {
            setAnswers((prev) => ({
                ...prev,
                [questionId]: {
                    ...normalizeEssayAnswer(prev[questionId]),
                    text: value,
                },
            }));
            return;
        }
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    }, [submitted]);

    const handleSubmit = useCallback(async (autoSubmit = false, submitReason = 'manual') => {
        if (submitted) return;

        if (!autoSubmit) {
            const unanswered = questions.filter((question) => !isQuestionAnswered(question, answers[question.id])).length;
            if (unanswered > 0) {
                const confirm = await Swal.fire({
                    title: 'Xác nhận nộp bài?',
                    html: `Bạn còn <b>${unanswered} câu</b> chưa trả lời.`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Nộp bài',
                    cancelButtonText: 'Tiếp tục làm',
                    confirmButtonColor: '#5b5ea6',
                });
                if (!confirm.isConfirmed) return;
            }
        }

        clearInterval(timerRef.current);
        setSubmitted(true);

        // Calculate score
        let finalScore = 0;
        let autoTotalPoints = 0;
        let manualTotalPoints = 0;
        const answerDetails = [];
        const essayUploadQueue = [];
        const sessionRef = !isPreviewMode ? doc(collection(db, 'sessions')) : null;
        for (const q of questions) {
            const evaluated = evaluateQuestionAnswer(q, answers[q.id], exam || {
                questionScoring: DEFAULT_QUESTION_SCORING,
                tfScoring: DEFAULT_TF_SCORING,
            });

            if (q.type === 'essay') {
                manualTotalPoints += evaluated.maxPoints;
                answerDetails.push({ questionId: q.id, ...evaluated, attachments: [] });
                if ((evaluated.attachments || []).length > 0) {
                    essayUploadQueue.push({
                        questionId: q.id,
                        answerIndex: answerDetails.length - 1,
                        attachments: evaluated.attachments,
                    });
                }
                continue;
            }

            autoTotalPoints += evaluated.maxPoints;
            finalScore += evaluated.earnedPoints;

            if (q.type === 'mcq') {
                answerDetails.push({
                    questionId: q.id,
                    ...evaluated,
                    choiceSnapshot: (q.choices || []).map((choice, index) => ({
                        letter: choice.displayLetter || choice.letter || String.fromCharCode(65 + index),
                        originLetter: choice.originLetter || choice.letter || null,
                        text: choice.text || '',
                        html: choice.html || '',
                    })),
                });
                continue;
            }

            answerDetails.push({ questionId: q.id, ...evaluated });
        }

        setScore(finalScore);
        const displayTotal = autoTotalPoints > 0 ? autoTotalPoints : manualTotalPoints;
        const manualReviewPending = manualTotalPoints > 0;
        const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000);
        const isPerfect = autoTotalPoints > 0 && finalScore === autoTotalPoints && !manualReviewPending;
        const isHighScore = autoTotalPoints > 0 && finalScore / autoTotalPoints >= 0.8;
        const finalGameSummary = computeGameSummary({
            questions,
            answers,
            timeLeft,
            durationMinutes: exam?.duration,
            settings: gamification,
            maxQuizStreak,
        });

        if (isPreviewMode) {
            if (isPerfect) { setShowConfetti(true); playPerfect(); }
            else if (isHighScore) { setShowConfetti(true); playVictory(); }
            setPhase('result');
            return;
        }

        // Save session
        const uploadedStoragePaths = [];
        try {
            for (const entry of essayUploadQueue) {
                const uploadedAttachments = [];

                for (const attachment of entry.attachments) {
                    const pendingFile = essayAttachmentFilesRef.current[attachment.id];
                    if (!pendingFile?.blob) continue;

                    const filePath = `submissions/${exam.teacherId}/${examId}/${user.uid}/${sessionRef.id}/${entry.questionId}_${Date.now()}_${getStorageSafeImageName(pendingFile.name)}`;
                    const attachmentRef = ref(storage, filePath);
                    await uploadBytes(attachmentRef, pendingFile.blob, {
                        contentType: pendingFile.mime || pendingFile.blob.type || 'image/webp',
                    });

                    const url = await getDownloadURL(attachmentRef);
                    uploadedStoragePaths.push(attachmentRef.fullPath);
                    uploadedAttachments.push({
                        id: attachment.id,
                        name: pendingFile.name,
                        mime: pendingFile.mime || pendingFile.blob.type || 'image/webp',
                        size: pendingFile.blob.size,
                        url,
                        path: attachmentRef.fullPath,
                        uploadedAt: Timestamp.now(),
                    });
                }

                answerDetails[entry.answerIndex] = {
                    ...answerDetails[entry.answerIndex],
                    attachments: uploadedAttachments,
                };
            }

            const completedAt = Timestamp.now();
            await setDoc(sessionRef, {
                examId,
                examTitle: exam.title,
                teacherId: exam.teacherId,
                teacherName: exam.teacherName || null,
                studentId: user.uid,
                studentName: user.displayName,
                studentEmail: user.email,
                score: finalScore,
                total: displayTotal,
                autoGradedScore: finalScore,
                autoGradedTotal: autoTotalPoints,
                totalPoints: autoTotalPoints + manualTotalPoints,
                manualTotalPoints,
                manualReviewPending,
                maxQuizStreak: maxQuizStreak,
                timeSpent,
                answers: answerDetails,
                submissionAssetRefs: uploadedStoragePaths,
                antiCheat: antiCheatUiEnabled ? {
                    enabled: true,
                    violations: antiCheatViolationsRef.current,
                    maxWarnings: antiCheatMaxWarnings,
                    requireFullscreen: antiCheatRequireFullscreen,
                } : null,
                gameMeta: {
                    mode: gamification.mode,
                    presetLabel: getGamificationPresetLabel(gamification),
                    liveLeaderboard: gamification.liveLeaderboard,
                    basePoints: finalGameSummary.basePoints,
                    streakBonusPoints: finalGameSummary.streakBonusPoints,
                    speedBonusPoints: finalGameSummary.speedBonusPoints,
                    totalGamePoints: finalGameSummary.totalGamePoints,
                    pointsPerCorrect: gamification.pointsPerCorrect,
                },
                submitReason,
                autoSubmitted: autoSubmit,
                startedAt: Timestamp.fromMillis(startTimeRef.current),
                completedAt,
                retentionCleanupAt: Timestamp.fromMillis(completedAt.toMillis() + SESSION_RETENTION_MILLISECONDS),
            });
            clearLocalEssayAttachments();
            resetEssayPickers();
        } catch (error) {
            await Promise.all(uploadedStoragePaths.map((path) => deleteObject(ref(storage, path)).catch(() => null)));
            console.error('submit session failed', error);
            setSubmitted(false);
            setPhase('quiz');
            if (timeLeft > 0 && attemptStartedAt && exam?.duration) {
                startTimer(attemptStartedAt, exam.duration * 60, submitReason);
            }
            Swal.fire('Không thể nộp bài', getQuizAccessErrorMessage(error), 'error');
            return;
        }

        // Update user stats: streak, achievements
        try {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            const userData = userSnap.data() || {};

            const today = getTodayKey();
            const currentStreak = calculateStreak(userData.lastActiveDate, userData.streak || 0);
            const totalQuizzes = (userData.totalQuizzes || 0) + 1;
            const totalScore = (userData.totalScore || 0) + finalScore;
            const totalQuestions = (userData.totalQuestions || 0) + autoTotalPoints;
            const perfectScores = (userData.perfectScores || 0) + (isPerfect ? 1 : 0);
            const maxStreak = Math.max(userData.maxStreak || 0, currentStreak);
            const avgPercent = totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0;
            const speedFinishes = (userData.speedFinishes || 0) + (timeSpent < (exam.duration * 60 * 0.5) ? 1 : 0);

            const stats = { totalQuizzes, totalScore, totalQuestions, perfectScores, maxStreak, avgPercent, speedFinishes };
            const newAchievements = checkAchievements(stats, userData.achievements || []);

            const updateData = {
                streak: currentStreak,
                maxStreak,
                lastActiveDate: today,
                totalQuizzes,
                totalScore,
                totalQuestions,
                perfectScores,
                speedFinishes,
            };

            if (newAchievements.length > 0) {
                updateData.achievements = arrayUnion(...newAchievements.map(a => a.id));
            }

            await updateDoc(userRef, updateData);

            // Show achievement popup
            if (newAchievements.length > 0) {
                setNewAchievement(newAchievements[0]);
            }
        } catch (err) {
            console.error('Stats update error:', err);
        }

        // Effects
        if (isPerfect) { setShowConfetti(true); playPerfect(); }
        else if (isHighScore) { setShowConfetti(true); playVictory(); }
        setPhase('result');
    }, [answers, antiCheatMaxWarnings, antiCheatRequireFullscreen, antiCheatUiEnabled, attemptStartedAt, clearLocalEssayAttachments, exam, examId, gamification, isPreviewMode, maxQuizStreak, questions, resetEssayPickers, startTimer, submitted, timeLeft, user]);

    useEffect(() => {
        submitRef.current = handleSubmit;
    }, [handleSubmit]);

    const enableFullscreen = useCallback(async () => {
        try {
            const ok = await requestFullscreenMode();
            if (!ok) {
                setAntiCheatNotice('Trình duyệt này chưa hỗ trợ toàn màn hình cho bài thi.');
                setIsFullscreenActive(false);
                fullscreenStateRef.current = false;
                return;
            }
            const active = Boolean(getFullscreenElement());
            setIsFullscreenActive(active);
            fullscreenStateRef.current = active;
            if (active) setAntiCheatNotice('');
        } catch {
            setAntiCheatNotice('Không thể bật toàn màn hình. Hãy thử lại hoặc dùng Chrome/Safari mới hơn.');
        }
    }, []);

    const registerViolation = useCallback((reason) => {
        if (!antiCheatEnforced || submitted || phase !== 'quiz') return;

        const now = Date.now();
        if (antiCheatEventRef.current.reason === reason && now - antiCheatEventRef.current.timestamp < 1500) return;
        antiCheatEventRef.current = { reason, timestamp: now };

        const nextViolations = antiCheatViolationsRef.current + 1;
        antiCheatViolationsRef.current = nextViolations;
        setAntiCheatViolations(nextViolations);
        setAntiCheatNotice(reason);

        if (nextViolations >= antiCheatMaxWarnings) {
            Swal.fire({
                title: 'Tự động nộp bài',
                text: `${reason}. Bạn đã vượt quá số cảnh cáo cho phép.`,
                icon: 'warning',
                confirmButtonText: 'Đã hiểu',
            }).then(() => handleSubmit(true, `anti-cheat:${reason}`));
            return;
        }

        Swal.fire({
            toast: true,
            position: 'top',
            icon: 'warning',
            title: `${reason}. Còn ${antiCheatMaxWarnings - nextViolations} cảnh cáo.`,
            showConfirmButton: false,
            timer: 2200,
            timerProgressBar: true,
        });
    }, [antiCheatEnforced, antiCheatMaxWarnings, handleSubmit, phase, submitted]);

    useEffect(() => {
        if (phase !== 'quiz' || isPreviewMode || !user?.uid || !examId || !attemptStartedAt) return;

        navigationAwayRef.current = false;

        const persistReloadMarker = () => {
            const persisted = saveAttemptSnapshot({ pendingReloadViolation: true });
            if (!persisted) markQuizAttemptReloadPending(user.uid, examId);
        };

        const pushQuizLock = () => {
            const currentState = window.history.state || {};
            if (!currentState.quizLock) {
                window.history.pushState({ ...currentState, quizLock: true }, '', window.location.href);
            }
        };

        const handleBeforeUnload = (event) => {
            navigationAwayRef.current = true;
            persistReloadMarker();
            event.preventDefault();
            event.returnValue = '';
            return '';
        };

        const handlePageHide = () => {
            navigationAwayRef.current = true;
            persistReloadMarker();
        };

        const handlePopState = () => {
            registerViolation('Bạn đã cố rời khỏi bài thi');
            persistReloadMarker();
            pushQuizLock();
        };

        pushQuizLock();
        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('popstate', handlePopState);
        };
    }, [attemptStartedAt, examId, isPreviewMode, phase, registerViolation, saveAttemptSnapshot, user?.uid]);

    useEffect(() => {
        if (phase !== 'quiz' || !antiCheatEnforced) return;

        const handleVisibilityChange = () => {
            if (document.hidden && !navigationAwayRef.current) registerViolation('Bạn đã rời khỏi màn hình làm bài');
        };

        const handleFullscreenChange = () => {
            const active = Boolean(getFullscreenElement());
            const wasActive = fullscreenStateRef.current;
            fullscreenStateRef.current = active;
            setIsFullscreenActive(active);
            if (antiCheatRequireFullscreen && wasActive && !active) {
                registerViolation('Bạn đã thoát toàn màn hình');
            }
        };

        const blockContextMenu = (event) => event.preventDefault();
        const blockClipboard = (event) => event.preventDefault();
        const blockShortcuts = (event) => {
            const key = event.key?.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === 'r') {
                event.preventDefault();
                setAntiCheatNotice('Tải lại trang đã bị khóa. Nếu bạn vẫn rời khỏi bài thi, hệ thống sẽ tiếp tục giờ và tính cảnh cáo.');
                return;
            }
            if (key === 'f5') {
                event.preventDefault();
                setAntiCheatNotice('Phím tải lại đã bị khóa trong chế độ chống gian lận.');
                return;
            }
            if ((event.ctrlKey || event.metaKey) && ['c', 'v', 'x', 'a', 'p'].includes(key)) {
                event.preventDefault();
                setAntiCheatNotice('Sao chép, dán và in đã bị khóa trong chế độ chống gian lận.');
            }
            if (key === 'f12' || ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j', 'c'].includes(key))) {
                event.preventDefault();
                setAntiCheatNotice('Một số phím tắt đã bị khóa trong chế độ chống gian lận.');
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('contextmenu', blockContextMenu);
        document.addEventListener('copy', blockClipboard);
        document.addEventListener('cut', blockClipboard);
        document.addEventListener('paste', blockClipboard);
        document.addEventListener('keydown', blockShortcuts);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('contextmenu', blockContextMenu);
            document.removeEventListener('copy', blockClipboard);
            document.removeEventListener('cut', blockClipboard);
            document.removeEventListener('paste', blockClipboard);
            document.removeEventListener('keydown', blockShortcuts);
        };
    }, [antiCheatEnforced, antiCheatRequireFullscreen, phase, registerViolation]);

    const goToNext = () => {
        if (currentIdx < questions.length - 1) setCurrentIdx(prev => prev + 1);
    };
    const goToPrev = () => {
        if (currentIdx > 0) setCurrentIdx(prev => prev - 1);
    };

    const toggleCurrentFlag = () => {
        if (!currentQ?.id) return;
        setFlaggedQuestions((prev) => {
            const next = { ...prev };
            if (next[currentQ.id]) delete next[currentQ.id];
            else next[currentQ.id] = true;
            return next;
        });
    };

    // Phase: Loading
    if (phase === 'loading') {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải đề thi...</p></div>;
    }

    // Phase: Countdown
    if (phase === 'countdown') {
        const waitingForFullscreenStart = antiCheatEnforced && antiCheatRequireFullscreen && fullscreenSupported && !getFullscreenElement();

        return (
            <div className="quiz-countdown-screen">
                <motion.div className="quiz-countdown-card" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    <h2>{exam?.title}</h2>
                    <p>{questions.length} câu hỏi · {exam?.duration} phút</p>
                    <div className="quiz-preset-badges">
                        <span className="quiz-preset-badge primary"><i className="bi bi-stars"></i> {getGamificationPresetLabel(gamification)}</span>
                        {gamification.liveLeaderboard && <span className="quiz-preset-badge"><i className="bi bi-broadcast"></i> BXH lớp tạm tính</span>}
                        {gamification.streakBonus && <span className="quiz-preset-badge"><i className="bi bi-lightning-charge"></i> Combo bonus</span>}
                        {gamification.speedBonus && <span className="quiz-preset-badge"><i className="bi bi-stopwatch"></i> Speed bonus</span>}
                    </div>
                    {waitingForFullscreenStart ? (
                        <div className="countdown-lock-state">
                            <div className="countdown-lock-icon"><i className="bi bi-arrows-fullscreen"></i></div>
                            <strong>Bật toàn màn hình để bắt đầu thi</strong>
                            <p>Countdown sẽ chỉ chạy sau khi bạn vào chế độ toàn màn hình.</p>
                        </div>
                    ) : (
                        <>
                            <motion.div
                                className="countdown-number"
                                key={countdownValue}
                                initial={{ scale: 2, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.5, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300 }}
                            >
                                {countdownValue}
                            </motion.div>
                            <p style={{ color: 'var(--text-muted)' }}>Chuẩn bị...</p>
                        </>
                    )}
                    {antiCheatUiEnabled && (
                        <div className="quiz-security-card">
                            <div className="quiz-security-title"><i className="bi bi-shield-lock"></i> Chế độ chống gian lận đang bật</div>
                            <div className="quiz-security-copy">
                                {isPreviewMode
                                    ? 'Đây là chế độ mô phỏng anti-cheat để giáo viên xem giao diện. Hệ thống sẽ không lưu cảnh cáo hay tự động nộp bài.'
                                    : antiCheatRequireFullscreen && waitingForFullscreenStart
                                        ? 'Bài thi chưa bắt đầu vì đề này đang yêu cầu toàn màn hình.'
                                        : `Rời tab sẽ bị cảnh cáo${antiCheatRequireFullscreen ? ' và thoát toàn màn hình cũng bị tính cảnh cáo' : ''}.`}
                            </div>
                            {antiCheatRequireFullscreen && fullscreenSupported && waitingForFullscreenStart && (
                                <button className="btn btn-primary btn-sm" onClick={enableFullscreen}>
                                    <i className="bi bi-arrows-fullscreen"></i> Vào thi toàn màn hình
                                </button>
                            )}
                        </div>
                    )}
                    {isPreviewMode && (
                        <div className="alert alert-info" style={{ marginTop: 16, textAlign: 'left' }}>
                            <i className="bi bi-display"></i> Đang xem thử giao diện làm bài của {activeStudentName}. Nộp bài chỉ chấm cục bộ, không tạo session mới.
                        </div>
                    )}
                </motion.div>
            </div>
        );
    }

    // Phase: Result
    if (phase === 'result') {
        const displayTotal = currentAttemptSummary.autoTotalPoints > 0 ? currentAttemptSummary.autoTotalPoints : currentAttemptSummary.manualTotalPoints;
        const pct = displayTotal > 0 ? Math.round((score / displayTotal) * 100) : 0;
        const resultTimeSpentSeconds = Math.max(0, (Number(exam?.duration) || 0) * 60 - timeLeft);
        const isPerfect = currentAttemptSummary.autoTotalPoints > 0 && score === currentAttemptSummary.autoTotalPoints && currentAttemptSummary.manualTotalPoints === 0;
        const canExportCertificate = displayTotal > 0 && currentAttemptSummary.manualTotalPoints === 0;
        const certificateDocumentType = pct >= 60
            ? CERTIFICATE_DOCUMENT_TYPES.COMMENDATION
            : CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION;
        const certificateTeacherName = exam?.teacherName || activeStudentProfile?.teacherName || userProfile?.displayName || 'Giáo viên phụ trách';
        const certificateSchoolName = isPreviewMode
            ? (userProfile?.schoolName || null)
            : (activeStudentProfile?.schoolName || null);
        const certificateClassroomName = activeStudentProfile?.classroomName || activeStudentProfile?.className || exam?.grade || null;
        const certificateTeacherSlug = isPreviewMode ? (userProfile?.teacherSlug || null) : null;

        return (
            <div className="quiz-result-screen">
                <ConfettiEffect active={showConfetti} />
                <AnimatePresence>
                    {newAchievement && <AchievementPopup achievement={newAchievement} onClose={() => setNewAchievement(null)} />}
                </AnimatePresence>

                {isPreviewMode && (
                    <div className="alert alert-info" style={{ marginBottom: 16, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
                        <i className="bi bi-display"></i> Đây là kết quả mô phỏng của {activeStudentName}. Dữ liệu này không được lưu vào hệ thống.
                    </div>
                )}

                <motion.div className="result-main-card" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }}>
                    <div className="result-emoji">
                        {isPerfect ? '🏆' : pct >= 80 ? '🌟' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚'}
                    </div>
                    <h2 className="result-title">{isPerfect ? 'Hoàn hảo!' : pct >= 80 ? 'Xuất sắc!' : pct >= 60 ? 'Tốt lắm!' : pct >= 40 ? 'Cố gắng hơn!' : 'Cần ôn tập!'}</h2>

                    <div className="result-score-circle">
                        <svg viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="#ede9fe" strokeWidth="8" />
                            <motion.circle
                                cx="60" cy="60" r="54" fill="none"
                                stroke={pct >= 80 ? '#10b981' : pct >= 60 ? '#5b5ea6' : pct >= 40 ? '#f59e0b' : '#ef4444'}
                                strokeWidth="8" strokeLinecap="round"
                                strokeDasharray={`${2 * Math.PI * 54}`}
                                initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
                                animate={{ strokeDashoffset: 2 * Math.PI * 54 * (1 - pct / 100) }}
                                transition={{ duration: 1.5, ease: 'easeOut' }}
                                transform="rotate(-90 60 60)"
                            />
                        </svg>
                        <div className="result-score-text">
                            <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.5 }}
                                style={{ fontSize: '2rem', fontWeight: 900 }}
                            >
                                {displayTotal > 0 ? `${score}/${displayTotal}` : 'Cho cham'}
                            </motion.span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{pct}%</span>
                        </div>
                    </div>

                    {currentAttemptSummary.manualTotalPoints > 0 && (
                        <div className="alert alert-info" style={{ marginTop: 16, textAlign: 'left' }}>
                            <i className="bi bi-journal-richtext"></i> Có phần tự luận cần chấm tay. Điểm hiện tại chỉ là phần hệ thống chấm tự động.
                        </div>
                    )}

                    <div className="result-stats-row">
                        <div className="result-stat">
                            <span className="result-stat-value">🔥 {maxQuizStreak}</span>
                            <span className="result-stat-label">Streak max</span>
                        </div>
                        <div className="result-stat">
                            <span className="result-stat-value">{formatDuration(resultTimeSpentSeconds)}</span>
                            <span className="result-stat-label">Thời gian</span>
                        </div>
                        <div className="result-stat">
                            <span className="result-stat-value">{questions.length - currentAttemptSummary.answeredCount}</span>
                            <span className="result-stat-label">Bỏ trống</span>
                        </div>
                    </div>

                    {(gamification.mode === 'arcade' || gameSummary.streakBonusPoints > 0 || gameSummary.speedBonusPoints > 0) && (
                        <div className="result-game-strip">
                            <div><span>Điểm game</span><strong>{gameSummary.totalGamePoints}</strong></div>
                            <div><span>Combo</span><strong>+{gameSummary.streakBonusPoints}</strong></div>
                            <div><span>Tốc độ</span><strong>+{gameSummary.speedBonusPoints}</strong></div>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={() => navigate(returnPath)}>
                            <i className="bi bi-house"></i> Về trang chủ
                        </button>
                        {!isPreviewMode && exam?.showResult !== false && (
                            <button className="btn btn-outline" onClick={() => navigate(`/student/result/${examId}`)}>
                                <i className="bi bi-eye"></i> Xem chi tiết
                            </button>
                        )}
                        {canExportCertificate && (
                            <button className="btn btn-outline" style={{ borderColor: '#1d4ed8', color: '#1d4ed8' }} onClick={() => setShowCert(true)}>
                                <i className="bi bi-award"></i> Xuất giấy
                            </button>
                        )}
                    </div>
                </motion.div>

                {showCert && (
                    <Certificate
                        studentName={activeStudentName}
                        examTitle={exam?.title}
                        score={score}
                        total={displayTotal || questions.length}
                        date={new Date()}
                        teacherName={certificateTeacherName}
                        schoolName={certificateSchoolName}
                        classroomName={certificateClassroomName}
                        teacherSlug={certificateTeacherSlug}
                        initialDocumentType={certificateDocumentType}
                        onClose={() => setShowCert(false)}
                    />
                )}
            </div>
        );
    }

    // Phase: Quiz
    const currentQ = questions[currentIdx];
    const answeredCount = questions.filter((question) => isQuestionAnswered(question, answers[question.id])).length;
    const remainingCount = Math.max(0, questions.length - answeredCount);
    const progress = (answeredCount / questions.length) * 100;
    const timePercent = exam ? (timeLeft / (exam.duration * 60)) * 100 : 100;
    const flaggedCount = Object.keys(flaggedQuestions).length;
    const currentQuestionTypeLabel = currentQ ? getQuestionTypeLabel(currentQ.type) : '';
    const currentQuestionPoints = currentQ ? getQuestionMaxPoints(currentQ, exam?.questionScoring, exam?.tfScoring) : 0;
    const currentQuestionPointsLabel = formatPointValue(currentQuestionPoints);
    const currentChoiceLayoutClass = currentQ?.type === 'mcq' ? getMcqLayoutClass(currentQ) : 'mc-layout-1x4';
    const currentChoiceDensityClass = currentChoiceLayoutClass === 'mc-layout-4x1'
        ? 'choice-list-compact'
        : currentChoiceLayoutClass === 'mc-layout-1x4'
            ? 'choice-list-relaxed'
            : 'choice-list-balanced';
    const currentChoiceCountClass = `choice-count-${Math.min((currentQ?.choices || []).length, 6)}`;
    const currentQuestionHtml = currentQ
        ? renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(currentQ?.content_html || currentQ?.content_text || ''), currentQ, currentIdx))
        : '';
    const currentEssayAnswer = currentQ?.type === 'essay'
        ? normalizeEssayAnswer(answers[currentQ.id])
        : { text: '', attachments: [] };
    const currentSelectedChoice = currentQ && (() => {
        if (currentQ.type === 'tf') {
            const tfAns = answers[currentQ.id];
            if (!Array.isArray(tfAns)) return null;
            const count = tfAns.filter(v => v === 'D' || v === 'S').length;
            return count > 0 ? `${count}/${(currentQ.choices || []).length} ý` : null;
        }
        if (currentQ.type === 'short_answer') {
            return answers[currentQ.id] ? 'Đã nhập đáp án' : null;
        }
        if (currentQ.type === 'essay') {
            return summarizeEssayDraft(answers[currentQ.id]);
        }
        return answers[currentQ.id] !== undefined
            ? currentQ.choices?.[answers[currentQ.id]]?.letter || String.fromCharCode(65 + answers[currentQ.id])
            : null;
    })();

    return (
        <div className={`quiz-container ${gamification.mode === 'arcade' ? 'quiz-container-arcade' : ''}`}>
            <ConfettiEffect active={showConfetti} />

            {antiCheatEnforced && antiCheatRequireFullscreen && fullscreenSupported && (
                <AnimatePresence>
                    {!isFullscreenActive && (
                        <motion.div
                            className="quiz-fullscreen-lock"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="quiz-fullscreen-lock-card"
                                initial={{ y: 24, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: 16, opacity: 0 }}
                            >
                                <div className="quiz-fullscreen-lock-icon"><i className="bi bi-arrows-fullscreen"></i></div>
                                <h3>Bài thi đang bị khóa</h3>
                                <p>Đề này yêu cầu toàn màn hình. Hãy quay lại toàn màn hình để tiếp tục. Đồng hồ vẫn đang chạy.</p>
                                <div className="quiz-fullscreen-lock-actions">
                                    <button className="btn btn-primary" onClick={enableFullscreen}>
                                        <i className="bi bi-arrows-fullscreen"></i> Tiếp tục làm bài
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {isPreviewMode && (
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                    <i className="bi bi-display"></i> Preview giao diện làm bài cho {activeStudentName}. Trả lời và nộp bài chỉ mô phỏng, không ghi dữ liệu vào Firestore.
                </div>
            )}

            {antiCheatUiEnabled && (
                <div className={`quiz-security-banner ${antiCheatViolations > 0 ? 'warn' : ''}`}>
                    <div className="quiz-security-stack">
                        <div className="quiz-security-title"><i className="bi bi-shield-lock"></i> Chế độ chống gian lận</div>
                        <div className="quiz-security-copy">
                            {isPreviewMode
                                ? `Mô phỏng anti-cheat${antiCheatRequireFullscreen ? ` · ${isFullscreenActive ? 'Đang toàn màn hình' : 'Chưa toàn màn hình'}` : ''}`
                                : `Cảnh cáo ${antiCheatViolations}/${antiCheatMaxWarnings}${antiCheatRequireFullscreen ? ` · ${isFullscreenActive ? 'Đang toàn màn hình' : 'Chưa toàn màn hình'}` : ''}`}
                        </div>
                        {antiCheatNotice && <div className="quiz-security-note">{antiCheatNotice}</div>}
                    </div>
                    {antiCheatRequireFullscreen && fullscreenSupported && !isFullscreenActive && (
                        <button className="btn btn-primary btn-sm" onClick={enableFullscreen}>
                            <i className="bi bi-arrows-fullscreen"></i> Bật toàn màn hình
                        </button>
                    )}
                </div>
            )}

            {/* Answer feedback overlay */}
            <AnimatePresence>
                {answerFeedback && (
                    <motion.div
                        className={`answer-feedback ${answerFeedback}`}
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                    >
                        {answerFeedback === 'correct' ? (
                            <><i className="bi bi-check-circle-fill"></i> {quizStreak > 1 && <span className="streak-combo">{quizStreak}x Combo!</span>}</>
                        ) : (
                            <i className="bi bi-x-circle-fill"></i>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="quiz-shell">
                <div className="quiz-main-column">
                    <div className="quiz-header">
                        <div className="quiz-header-left">
                            <div className="quiz-mode-label">{getGamificationPresetLabel(gamification)}</div>
                            <h2 className="quiz-title">{exam?.title}</h2>
                            <div className="quiz-subtitle">
                                Câu {currentIdx + 1}/{questions.length}
                                {quizStreak >= 2 && (
                                    <motion.span
                                        className="quiz-streak-badge"
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        key={quizStreak}
                                    >
                                        🔥 {quizStreak}
                                    </motion.span>
                                )}
                            </div>
                        </div>
                        <div className={`quiz-timer ${timeLeft < 60 ? 'urgent' : timeLeft < 300 ? 'warning' : ''}`}>
                            <i className="bi bi-clock"></i> {formatDuration(timeLeft)}
                        </div>
                    </div>

                    <div className="quiz-progress-group">
                        <div className="quiz-progress" title="Tiến độ làm bài">
                            <div className="quiz-progress-bar progress-answer" style={{ width: `${progress}%` }}></div>
                        </div>
                        <div className="quiz-progress time-progress" title="Thời gian còn lại">
                            <div className={`quiz-progress-bar progress-time ${timeLeft < 60 ? 'urgent' : ''}`} style={{ width: `${timePercent}%` }}></div>
                        </div>
                    </div>

                    <div className="quiz-meta-grid quiz-meta-grid-rich">
                        <div className="quiz-meta-card">
                            <span>Đã làm</span>
                            <strong>{answeredCount}/{questions.length}</strong>
                        </div>
                        <div className="quiz-meta-card">
                            <span>Còn lại</span>
                            <strong>{remainingCount} câu</strong>
                        </div>
                        <div className="quiz-meta-card">
                            <span>Đánh dấu lại</span>
                            <strong>{flaggedCount} câu</strong>
                        </div>
                        <div className={`quiz-meta-card ${antiCheatUiEnabled ? 'security' : ''}`}>
                            <span>{antiCheatUiEnabled ? 'Cảnh cáo' : 'Hạng tạm tính'}</span>
                            <strong>{antiCheatUiEnabled ? `${antiCheatViolations}/${antiCheatMaxWarnings}` : (projectedRank ? `#${projectedRank}` : '—')}</strong>
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentIdx}
                            initial={{ opacity: 0, x: 40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -40 }}
                            transition={{ duration: 0.25 }}
                        >
                            <div className={`question-card question-card-${currentQ?.type || 'mcq'}`}>
                                <div className="question-header">
                                    <span className="question-number">{currentIdx + 1}</span>
                                    <div className="question-text-block">
                                        <div className="question-inline-actions">
                                            <span className={`question-status-pill ${isQuestionAnswered(currentQ, answers[currentQ.id]) ? 'answered' : 'pending'}`}>
                                                {isQuestionAnswered(currentQ, answers[currentQ.id]) ? 'Đã trả lời' : 'Chưa trả lời'}
                                            </span>
                                            <span className="question-status-pill type">{currentQuestionTypeLabel}</span>
                                            <span className="question-status-pill score">{currentQuestionPointsLabel} điểm</span>
                                            {currentSelectedChoice && <span className="question-status-pill neutral">Đã chọn {currentSelectedChoice}</span>}
                                            {flaggedQuestions[currentQ.id] && <span className="question-status-pill flagged">Đang đánh dấu xem lại</span>}
                                            <button className={`btn btn-outline btn-sm question-flag-btn ${flaggedQuestions[currentQ.id] ? 'active' : ''}`} onClick={toggleCurrentFlag}>
                                                <i className={`bi bi-${flaggedQuestions[currentQ.id] ? 'flag-fill' : 'flag'}`}></i> {flaggedQuestions[currentQ.id] ? 'Bỏ đánh dấu' : 'Đánh dấu lại'}
                                            </button>
                                        </div>
                                        {currentQ?.deliverySection?.isSectionStart && (currentQ?.deliverySection?.hasSections || currentQ?.deliverySection?.contextHtml || currentQ?.deliverySection?.contextText) && (
                                            <div className="section-context-card quiz-mode">
                                                <div className="section-context-head">
                                                    <strong>{currentQ.deliverySection.title || 'Phan cau hoi'}</strong>
                                                    {currentQ.deliverySection.tag && <span className="stat-badge muted">{currentQ.deliverySection.tag}</span>}
                                                </div>
                                                {currentQ.deliverySection.contextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(currentQ.deliverySection.contextHtml) }} />}
                                            </div>
                                        )}
                                        <div className="question-stem-panel">
                                            <div className="question-text" dangerouslySetInnerHTML={{ __html: currentQuestionHtml }} />
                                        </div>
                                    </div>
                                </div>

                                {currentQ?.type === 'tf' ? (
                                    <div className="tf-question-grid">
                                        {(currentQ?.choices || []).map((choice, itemIdx) => {
                                            const label = choice.letter || String.fromCharCode(97 + itemIdx);
                                            const tfAns = Array.isArray(answers[currentQ.id]) ? answers[currentQ.id] : [];
                                            const selected = tfAns[itemIdx];
                                            return (
                                                <div key={itemIdx} className={`tf-item-row ${selected ? 'answered' : ''}`}>
                                                    <div className="tf-item-text">
                                                        <span className="tf-item-label">{label})</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(choice, currentQ.type, itemIdx)) }} />
                                                    </div>
                                                    <div className="tf-item-buttons">
                                                        <button
                                                            className={`tf-btn tf-btn-true${selected === 'D' ? ' tf-selected-true' : ''}`}
                                                            onClick={() => handleTfAnswer(currentQ.id, itemIdx, 'D', currentQ)}
                                                        >Đúng</button>
                                                        <button
                                                            className={`tf-btn tf-btn-false${selected === 'S' ? ' tf-selected-false' : ''}`}
                                                            onClick={() => handleTfAnswer(currentQ.id, itemIdx, 'S', currentQ)}
                                                        >Sai</button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : currentQ?.type === 'short_answer' ? (
                                    <div className="quiz-text-answer-wrap">
                                        <label className="form-label">Nhập đáp án ngắn</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={answers[currentQ.id] || ''}
                                            onChange={(e) => handleTextAnswer(currentQ.id, e.target.value)}
                                            placeholder="Nhập đáp án chính xác của bạn..."
                                        />
                                    </div>
                                ) : currentQ?.type === 'essay' ? (
                                    <div className="quiz-text-answer-wrap quiz-essay-wrap">
                                        <div className="quiz-essay-toolbar">
                                            <div className="quiz-essay-toolbar-row">
                                                <button type="button" className={`btn btn-outline btn-sm ${essayMathOpen ? 'active' : ''}`} onClick={() => setEssayMathOpen((prev) => !prev)}>
                                                    <i className="bi bi-sigma"></i> Công thức
                                                </button>
                                                <button type="button" className="btn btn-outline btn-sm" onClick={() => essayGalleryInputRef.current?.click()}>
                                                    <i className="bi bi-images"></i> Tải ảnh
                                                </button>
                                                <button type="button" className="btn btn-outline btn-sm" onClick={() => essayCameraInputRef.current?.click()}>
                                                    <i className="bi bi-camera"></i> Chụp ảnh
                                                </button>
                                            </div>
                                            <div className="quiz-essay-toolbar-note">
                                                Tối đa {ESSAY_ATTACHMENT_LIMITS.perQuestion} ảnh mỗi câu, {ESSAY_ATTACHMENT_LIMITS.perQuiz} ảnh cho cả bài, dưới 2MB mỗi ảnh sau khi nén.
                                            </div>
                                        </div>

                                        <input
                                            ref={essayGalleryInputRef}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={(e) => handleEssayAttachmentSelection(currentQ.id, e.target.files)}
                                            style={{ display: 'none' }}
                                        />
                                        <input
                                            ref={essayCameraInputRef}
                                            type="file"
                                            accept="image/*"
                                            capture="environment"
                                            onChange={(e) => handleEssayAttachmentSelection(currentQ.id, e.target.files)}
                                            style={{ display: 'none' }}
                                        />

                                        {essayMathOpen && (
                                            <div className="quiz-essay-math-panel">
                                                <div className="quiz-essay-math-wraps">
                                                    {MATH_WRAP_OPTIONS.map((option) => (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            className={`quiz-math-chip ${essayMathWrapMode === option.id ? 'active' : ''}`}
                                                            onClick={() => setEssayMathWrapMode(option.id)}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="quiz-essay-math-groups">
                                                    {MATH_GROUPS.map((group, groupIndex) => (
                                                        <button
                                                            key={group.label}
                                                            type="button"
                                                            className={`quiz-math-chip ${essayMathPaletteGroup === groupIndex ? 'active' : ''}`}
                                                            onClick={() => setEssayMathPaletteGroup(groupIndex)}
                                                        >
                                                            {group.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className="quiz-essay-math-symbols">
                                                    {MATH_GROUPS[essayMathPaletteGroup].items.map((item) => (
                                                        <button key={`${item.l}_${item.t}`} type="button" className="quiz-math-symbol" onClick={() => insertEssayMathSymbol(item.t)}>
                                                            {item.l}
                                                        </button>
                                                    ))}
                                                </div>
                                                <textarea
                                                    className="form-input quiz-essay-math-input"
                                                    rows={3}
                                                    value={essayMathLatex}
                                                    onChange={(e) => setEssayMathLatex(e.target.value)}
                                                    placeholder="Nhập hoặc ghép công thức LaTeX rồi bấm Chèn vào bài làm"
                                                />
                                                <div className="quiz-essay-math-actions">
                                                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEssayMathLatex('')}>Xóa nháp công thức</button>
                                                    <button type="button" className="btn btn-primary btn-sm" onClick={applyEssayMathSnippet}>Chèn vào bài làm</button>
                                                </div>
                                            </div>
                                        )}

                                        <label className="form-label">Bài làm tự luận</label>
                                        <textarea
                                            ref={essayAnswerInputRef}
                                            className="form-input quiz-essay-input"
                                            rows={10}
                                            value={currentEssayAnswer.text}
                                            onChange={(e) => handleTextAnswer(currentQ.id, e.target.value, 'essay')}
                                            placeholder="Nhập bài làm tự luận của bạn tại đây..."
                                        />

                                        {currentEssayAnswer.attachments.length > 0 && (
                                            <div className="quiz-essay-attachment-grid">
                                                {currentEssayAnswer.attachments.map((attachment) => (
                                                    <div key={attachment.id} className="quiz-essay-attachment-card">
                                                        <div className="quiz-essay-attachment-preview">
                                                            <img src={attachment.previewUrl} alt={attachment.name} />
                                                        </div>
                                                        <div className="quiz-essay-attachment-meta">
                                                            <strong>{attachment.name}</strong>
                                                            <span>{Math.round((attachment.size || 0) / 1024)} KB</span>
                                                        </div>
                                                        <button type="button" className="btn btn-outline btn-sm" onClick={() => removeEssayAttachment(currentQ.id, attachment.id)}>
                                                            <i className="bi bi-trash"></i> Bỏ ảnh
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="quiz-essay-note">
                                            <strong>Cách nộp phần tự luận:</strong><br />
                                            1. Gõ trực tiếp nếu làm được trên máy.<br />
                                            2. Nếu viết tay, chụp ảnh đủ sáng và đúng thứ tự trang.<br />
                                            3. Nếu tải lại trang trước khi nộp, hãy chọn lại ảnh vì hệ thống chỉ lưu tạm phần chữ trong lúc làm bài.<br />
                                            4. Bài làm này sẽ được giáo viên xuất PDF để tự chấm ngoài hệ thống. Dữ liệu bài nộp được giữ tối đa 3 năm rồi tự xóa.
                                        </div>
                                    </div>
                                ) : (
                                <ul className={`choice-list ${currentChoiceLayoutClass} ${currentChoiceDensityClass} ${currentChoiceCountClass}`}>
                                    {(currentQ?.choices || []).map((choice, idx) => {
                                        const letter = choice.letter || String.fromCharCode(65 + idx);
                                        const isSelected = answers[currentQ.id] === idx;
                                        return (
                                            <motion.li
                                                key={idx}
                                                className={`choice-item ${isSelected ? 'selected' : ''}`}
                                                onClick={() => handleAnswer(currentQ.id, idx)}
                                                whileHover={{ scale: 1.01 }}
                                                whileTap={{ scale: 0.98 }}
                                            >
                                                <span className="choice-leading">
                                                    <span className="choice-letter">{letter}</span>
                                                    <span className="choice-select-icon"><i className={`bi bi-${isSelected ? 'check2-circle' : 'circle'}`}></i></span>
                                                </span>
                                                <span className="choice-copy" dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(choice, currentQ.type, idx)) }} />
                                            </motion.li>
                                        );
                                    })}
                                </ul>
                                )}
                            </div>
                        </motion.div>
                    </AnimatePresence>

                    <div className="quiz-nav">
                        <button className="btn btn-outline" disabled={currentIdx === 0} onClick={goToPrev}>
                            <i className="bi bi-chevron-left"></i> Trước
                        </button>

                        <button className="btn btn-danger-soft" onClick={() => handleSubmit(false)}>
                            <i className="bi bi-send"></i> Nộp bài
                        </button>

                        <button className="btn btn-primary" disabled={currentIdx >= questions.length - 1} onClick={goToNext}>
                            Tiếp <i className="bi bi-chevron-right"></i>
                        </button>
                    </div>

                    {!gamification.showQuestionNavigator && (
                        <div className="question-dots">
                            {questions.map((q, idx) => (
                                <button
                                    key={q.id}
                                    className={`question-dot ${idx === currentIdx ? 'current' : ''} ${isQuestionAnswered(q, answers[q.id]) ? 'answered' : ''}`}
                                    onClick={() => setCurrentIdx(idx)}
                                >
                                    {idx + 1}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <aside className="quiz-side-column">
                    <div className="quiz-side-card quiz-side-card-highlight">
                        <div className="quiz-side-title">Arcade HUD</div>
                        <div className="quiz-side-score">{gamification.mode === 'arcade' ? gameSummary.totalGamePoints : `${currentAttemptSummary.earnedScore}/${currentAttemptSummary.autoTotalPoints || currentAttemptSummary.manualTotalPoints || questions.length}`}</div>
                        <div className="quiz-side-caption">
                            {gamification.mode === 'arcade' ? 'Điểm game tạm tính nếu nộp ngay' : 'Điểm tạm tính nếu nộp ngay'}
                        </div>
                        <div className="quiz-score-breakdown">
                            <div><span>Điểm chuẩn</span><strong>{gameSummary.basePoints}</strong></div>
                            <div><span>Combo</span><strong>+{gameSummary.streakBonusPoints}</strong></div>
                            <div><span>Tốc độ</span><strong>+{gameSummary.speedBonusPoints}</strong></div>
                        </div>
                    </div>

                    {gamification.showQuestionNavigator && (
                        <div className="quiz-side-card">
                            <div className="quiz-side-title">Thanh chọn câu</div>
                            <div className="quiz-navigator-legend">
                                <span><i className="bi bi-circle-fill legend-current"></i> Hiện tại</span>
                                <span><i className="bi bi-circle-fill legend-answered"></i> Đã làm</span>
                                <span><i className="bi bi-circle-fill legend-flagged"></i> Đánh dấu</span>
                            </div>
                            <div className="quiz-navigator-grid">
                                {questions.map((question, idx) => {
                                    const answered = answers[question.id] !== undefined;
                                    const flagged = Boolean(flaggedQuestions[question.id]);
                                    return (
                                        <button
                                            key={question.id}
                                            className={`quiz-navigator-btn ${idx === currentIdx ? 'current' : ''} ${answered ? 'answered' : ''} ${flagged ? 'flagged' : ''}`}
                                            onClick={() => setCurrentIdx(idx)}
                                        >
                                            <span>{idx + 1}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {gamification.liveLeaderboard && projectedLeaderboard.length > 0 && (
                        <div className="quiz-side-card">
                            <div className="quiz-side-title">BXH lớp tạm tính</div>
                            <div className="quiz-live-status">
                                {projectedRank > 0 ? `Nếu nộp lúc này bạn đang ở vị trí #${projectedRank}` : 'Thứ hạng sẽ hiện khi có đủ dữ liệu lớp.'}
                            </div>
                            <div className="quiz-live-list">
                                {projectedLeaderboard.slice(0, 5).map((entry, idx) => (
                                    <div key={entry.uid} className={`quiz-live-item ${entry.uid === (activeStudentProfile?.uid || user?.uid) ? 'me' : ''}`}>
                                        <div>
                                            <div className="quiz-live-rank">#{idx + 1}</div>
                                            <strong>{entry.displayName || 'Học sinh'}</strong>
                                        </div>
                                        <div className="quiz-live-score">
                                            <strong>{entry.totalScore}/{entry.totalQuestions}</strong>
                                            <small>{entry.projected ? 'tạm tính' : `${entry.totalQuizzes} bài`}</small>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
