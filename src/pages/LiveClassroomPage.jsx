import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    doc, getDoc, getDocs, setDoc, collection, updateDoc, onSnapshot, runTransaction, serverTimestamp, Timestamp, deleteDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import Swal from 'sweetalert2';
import { renderLatexContent as renderLatex } from '../utils/math';
import {
    buildAudiencePoll,
    buildExpertHint,
    buildMillionaireLadder,
    formatMillionairePrize,
    isLiveAnswerCorrect,
    sortLiveLeaderboard,
    calcStreakBonus,
} from '../utils/liveMillionaire';
import { getChoiceDisplayText, orderQuestionsForDelivery, stripQuestionNumberPrefix } from '../utils/examSections';
import {
    FREE_TEACHER_LIMITS,
    getTeacherPremiumLiveUsage,
    hasTeacherWorkspaceAccess,
    isPremiumLiveMode,
    isTeacherFreePlan,
} from '../utils/teacherPlan';

function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

const MODE_CONFIG = {
    classic: {
        label: 'Classic Live',
        icon: 'play-circle',
        desc: 'Học sinh vào bằng mã phòng, có điểm và bảng xếp hạng realtime.',
        fit: 'Warm-up, checkpoint, exit ticket',
        category: 'Live có chấm điểm',
        tone: 'classic',
    },
    golden_bell: {
        label: 'Rung chuông vàng',
        icon: 'bell',
        desc: 'Sai là bị loại, giữ nhịp thi đấu rõ ràng cho cả lớp.',
        fit: 'Ôn thi, chung kết, tiết tổng hợp',
        category: 'Live game nâng cao',
        tone: 'golden-bell',
    },
    speed: {
        label: 'Đua tốc độ',
        icon: 'lightning',
        desc: 'Đúng và nhanh hơn thì được nhiều điểm hơn, pace rất gắt.',
        fit: 'Gọi nhớ nhanh, drill công thức, từ vựng',
        category: 'Live game nâng cao',
        tone: 'speed',
    },
    millionaire: {
        label: 'Ai là triệu phú',
        icon: 'trophy',
        desc: 'Có lifeline, mốc an toàn, BXH realtime và award stage.',
        fit: 'Tiết tổng kết, gameshow, review chủ đề',
        category: 'Live game flagship',
        tone: 'millionaire',
    },
    presentation: {
        label: 'Ôn tập qua phòng live',
        icon: 'people',
        desc: 'Học sinh vẫn vào bằng mã phòng, giáo viên lật từng câu nhưng không chấm điểm.',
        fit: 'Ôn tập có room, chữa bài có học sinh cùng xem',
        category: 'Live không chấm điểm',
        tone: 'presentation',
    },
};

const MODE_PLAYBOOK = {
    classic: {
        title: 'Classic live de can bang giua thi dua va kiem tra nhanh',
        summary: 'Mode an toan nhat khi can mot tro choi de do nhiet lop, check hieu bai va van cho phep dung nhieu dang cau hoi.',
        bestFor: 'Checkpoint, warm-up, exit ticket',
        questionMix: 'MCQ + TF + short answer',
        durationHint: '5-12 cau · 15-30 giay/cau',
        classScale: '10-80 hoc sinh',
        patterns: ['Khoi dong dau gio', 'Checkpoint giua bai', 'Exit ticket cuoi tiet'],
    },
    golden_bell: {
        title: 'Rung chuong vang hop voi tiet can phan hoa va ap luc thi dau ro',
        summary: 'Sai la bi loai nen nhin rat ro nhom nao giu duoc phong do den cuoi. Rat hop cho tiet on thi hoac chung ket chu de.',
        bestFor: 'On thi, chung ket, tiet tong hop',
        questionMix: 'Uu tien MCQ/TF ngan va ro rang',
        durationHint: '8-15 cau · 15-30 giay/cau',
        classScale: '15-100 hoc sinh',
        patterns: ['Chung ket chu de', 'On thi dinh ky', 'Thi dau toan lop'],
    },
    speed: {
        title: 'Dua toc do dung de goi tri nho va phan xa',
        summary: 'Neu muc tieu la keo nang luong lop trong vai phut va ep hoc sinh tra loi nhanh, day la mode nen uu tien dau tien.',
        bestFor: 'Speed drill, tu vung, cong thuc',
        questionMix: 'MCQ stem ngan, du lieu gon',
        durationHint: '5-10 cau · 10-15 giay/cau',
        classScale: '10-60 hoc sinh',
        patterns: ['Warm-up 5 phut', 'Goi nho cong thuc', 'Vocabulary sprint'],
    },
    millionaire: {
        title: 'Ai la trieu phu dung cho tiet hoc can cao trao va nghi thuc',
        summary: 'Mode flagship hien tai: co ready check, lifeline, muc an toan, BXH realtime va man award stage cuoi tran.',
        bestFor: 'Tong ket chu de, review su kien, ngay hoi hoc tap',
        questionMix: 'MCQ 100%',
        durationHint: '10-15 cau · tang do kho dan',
        classScale: '1-60 hoc sinh',
        patterns: ['Tiet tong ket', 'Chuong review', 'Flagship gameshow'],
    },
    presentation: {
        title: 'Trinh chieu / chua bai dung khi giao vien can giu nhac dieu tiet',
        summary: 'Khong cham diem, khong dat nang xep hang. Toan bo tiet hoc xoay quanh viec hien tung cau, thao luan va lot dap an dung luc.',
        bestFor: 'Debrief, giai de, dan dat thao luan',
        questionMix: 'Moi dang cau hoi, uu tien cau co loi giai',
        durationHint: 'Khong ap luc timer',
        classScale: 'Khong gioi han',
        patterns: ['Giai de', 'Chua bai tap', 'Doc hieu passage'],
    },
};

const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Tự luận ngắn' };

function createDefaultScoreState() {
    return {
        score: 0,
        correct: 0,
        wrong: 0,
        streak: 0,
        level: 0,
        safePrize: 0,
        safeLevel: 0,
        lastCorrectAtMs: 0,
        eliminatedAtLevel: 0,
    };
}

function getLiveScoreLabel(entry, liveMode) {
    if (liveMode === 'millionaire') return formatMillionairePrize(entry?.score || 0);
    return `${Number(entry?.score || 0).toLocaleString('vi-VN')} điểm`;
}

export default function LiveClassroomPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();

    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [teacherStats, setTeacherStats] = useState({ premiumLiveUsageMonth: null, premiumLiveUsageCount: 0 });

    // Room state
    const [room, setRoom] = useState(null);
    const [roomCode, setRoomCode] = useState(null);
    const [phase, setPhase] = useState('setup'); // setup | lobby | ready_check | question | reveal | leaderboard | ended
    const [mode, setMode] = useState('classic');
    const [questionDuration, setQuestionDuration] = useState(30);

    const [timeLeft, setTimeLeft] = useState(0);
    const [answerKeys, setAnswerKeys] = useState([]); // loaded from private subcollection
    const [teamMode, setTeamMode] = useState(false);
    const [showAnalytics, setShowAnalytics] = useState(false);

    const timerRef = useRef(null);
    const unsubRef = useRef(null);
    const autoRevealFiredRef = useRef(false);
    const revealRef = useRef(null); // kept current for auto-reveal effect
    const hasTeacherAccess = hasTeacherWorkspaceAccess(userProfile);
    const isFreeTeacherPlan = isTeacherFreePlan(userProfile);
    const selectedModeIsPremium = isPremiumLiveMode(mode);
    const premiumLiveUsage = useMemo(() => getTeacherPremiumLiveUsage(teacherStats), [teacherStats]);
    const deliveredQuestions = useMemo(() => orderQuestionsForDelivery(questions, {
        shuffleQuestions: exam?.shuffleQuestions !== false,
        shuffleChoices: exam?.shuffleChoices !== false,
    }), [exam?.shuffleChoices, exam?.shuffleQuestions, questions]);

    // Load exam + questions
    useEffect(() => {
        if (!user || !userProfile) return;
        (async () => {
            const examDoc = await getDoc(doc(db, 'exams', examId));
            if (!examDoc.exists()) { navigate('/teacher'); return; }
            const examData = { id: examDoc.id, ...examDoc.data() };
            if (userProfile.role !== 'admin' && examData.teacherId !== user.uid) {
                navigate('/teacher'); return;
            }
            setExam(examData);
            const [qSnap, statsSnap] = await Promise.all([
                getDocs(collection(db, 'exams', examId, 'questions')),
                userProfile.role === 'admin' ? Promise.resolve(null) : getDoc(doc(db, 'teacherStats', user.uid)),
            ]);
            const qs = qSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.order || a.number || 0) - (b.order || b.number || 0));
            setQuestions(qs);
            setTeacherStats(statsSnap?.exists() ? statsSnap.data() : { premiumLiveUsageMonth: null, premiumLiveUsageCount: 0 });
            setLoading(false);
        })();
        return () => {
            if (unsubRef.current) unsubRef.current();
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [examId, user, userProfile, navigate]);

    // Subscribe to room changes
    const subscribeRoom = useCallback((code) => {
        if (unsubRef.current) unsubRef.current();
        // Load private answer key once (teacher can read own room's private subcollection)
        getDoc(doc(db, 'liveRooms', code, 'private', 'answerKey')).then(keySnap => {
            if (keySnap.exists()) setAnswerKeys(keySnap.data().keys || []);
        }).catch(() => {});
        unsubRef.current = onSnapshot(doc(db, 'liveRooms', code), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setRoom(data);
                setPhase(data.status);
                if (data.status === 'question' && data.questionStartAt) {
                    const elapsed = Math.floor((Date.now() - data.questionStartAt.toMillis()) / 1000);
                    const remaining = Math.max(0, (data.questionDuration || 30) - elapsed);
                    setTimeLeft(remaining);
                    if (timerRef.current) clearInterval(timerRef.current);
                    timerRef.current = setInterval(() => {
                        setTimeLeft(t => {
                            if (t <= 1) { clearInterval(timerRef.current); return 0; }
                            return t - 1;
                        });
                    }, 1000);
                } else {
                    if (timerRef.current) clearInterval(timerRef.current);
                }
            }
        });
    }, []);

    // Keep revealRef current so auto-reveal useEffect can call latest version
    useEffect(() => { revealRef.current = revealAnswers; }); // eslint-disable-line

    // Auto-reveal: reset flag when question changes
    useEffect(() => {
        autoRevealFiredRef.current = false;
    }, [room?.currentQIdx]);

    // Auto-reveal when timer expires
    useEffect(() => {
        if (phase !== 'question' || timeLeft !== 0) return;
        if (autoRevealFiredRef.current) return;
        autoRevealFiredRef.current = true;
        revealRef.current?.();
    }, [timeLeft, phase]);

    // Create room
    const createRoom = async () => {
        if (!hasTeacherAccess) {
            Swal.fire('Hết hạn', 'Teacher Plus đã hết hạn. Hãy gia hạn từ dashboard để mở lại live room.', 'warning');
            return;
        }

        const code = generateRoomCode();
        const millionaireLadder = buildMillionaireLadder(deliveredQuestions.length);
        const roomData = {
            examId,
            examTitle: exam.title,
            teacherId: user.uid,
            teacherName: userProfile?.displayName || user.email,
            mode,
            questionDuration: Number(questionDuration),
            status: 'lobby',
            currentQIdx: -1,
            lifelines: { used: { ff: false, audience: false, expert: false } },
            millionaire: mode === 'millionaire' ? {
                ladder: millionaireLadder,
                topPrize: millionaireLadder.at(-1)?.amount || 0,
                checkpointLevels: millionaireLadder.filter((step) => step.isCheckpoint).map((step) => step.level),
            } : null,
            questions: deliveredQuestions.map(q => ({
                id: q.id,
                number: q.number,
                type: q.type,
                content_html: q.content_html || escHtml(q.content_text),
                content_text: q.content_text || '',
                choices: q.choices || [],
                // correct_answer intentionally omitted – stored in private subcollection
                points: q.points || 1,
                sectionTag: q.sectionTag || null,
                sectionContextText: q.sectionContextText || null,
                sectionContextHtml: q.sectionContextHtml || null,
                deliverySection: q.deliverySection || null,
            })),
            participants: {},
            readyChecks: {},
            scores: {},
            answers: {},
            eliminated: [],
            revealedCorrectAnswers: {},
            teamMode: teamMode,
            teams: {},
            teamScores: {},
            createdAt: serverTimestamp(),
            expiresAt: Timestamp.fromMillis(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
        };

        try {
            await runTransaction(db, async (transaction) => {
                if (isFreeTeacherPlan && isPremiumLiveMode(mode)) {
                    const statsRef = doc(db, 'teacherStats', user.uid);
                    const statsSnap = await transaction.get(statsRef);
                    const latestUsage = getTeacherPremiumLiveUsage(statsSnap.exists() ? statsSnap.data() : {});

                    if (latestUsage.count >= FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth) {
                        throw new Error('FREE_PREMIUM_LIVE_LIMIT');
                    }

                    transaction.set(statsRef, {
                        teacherId: user.uid,
                        teacherName: userProfile?.displayName || user.email || null,
                        teacherEmail: userProfile?.email || user.email || null,
                        premiumLiveUsageMonth: latestUsage.monthKey,
                        premiumLiveUsageCount: latestUsage.count + 1,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                }

                transaction.set(doc(db, 'liveRooms', code), roomData);
            });
        } catch (error) {
            if (error.message === 'FREE_PREMIUM_LIVE_LIMIT') {
                const result = await Swal.fire({
                    title: 'Đã hết lượt live game nâng cao trong tháng',
                    html: `Gói Free chỉ có <b>${FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth}</b> lượt cho các mode nâng cao như Đua tốc độ, Rung chuông vàng và Ai là triệu phú trong mỗi tháng.<br><br>Bạn có thể chuyển sang Classic Live / Trình chiếu hoặc về dashboard để nâng cấp Teacher Plus.`,
                    icon: 'info',
                    showCancelButton: true,
                    confirmButtonText: 'Về dashboard',
                    cancelButtonText: 'Ở lại trang này',
                    confirmButtonColor: '#2563eb',
                });

                if (result.isConfirmed) navigate('/teacher');
                return;
            }

            console.error('create live room failed', error);
            Swal.fire('Không thể tạo phòng', error.message || 'Đã có lỗi xảy ra khi tạo live room.', 'error');
            return;
        }

        if (isFreeTeacherPlan && isPremiumLiveMode(mode)) {
            setTeacherStats((previous) => {
                const usage = getTeacherPremiumLiveUsage(previous);
                return {
                    ...previous,
                    premiumLiveUsageMonth: usage.monthKey,
                    premiumLiveUsageCount: usage.count + 1,
                };
            });
        }

        // Write private answer key (outside transaction – teacher-only subcollection)
        const initialAnswerKeys = deliveredQuestions.map(q => ({
            correct_answer: q.correct_answer || null,
            points: q.points || 1,
            type: q.type || 'mcq',
        }));
        await setDoc(doc(db, 'liveRooms', code, 'private', 'answerKey'), {
            teacherId: user.uid,
            keys: initialAnswerKeys,
        });
        setAnswerKeys(initialAnswerKeys);

        setRoomCode(code);
        setPhase('lobby');
        setRoom(roomData);
        subscribeRoom(code);
    };

    // Advance to next question
    const nextQuestion = async () => {
        const nextIdx = (room?.currentQIdx ?? -1) + 1;
        if (nextIdx >= (room?.questions?.length || deliveredQuestions.length)) {
            await endRoom();
            return;
        }
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            status: 'question',
            currentQIdx: nextIdx,
            questionStartAt: serverTimestamp(),
            readyCheckStartedAt: null,
        });
    };

    const startReadyCheck = async () => {
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            status: 'ready_check',
            readyChecks: {},
            readyCheckStartedAt: serverTimestamp(),
        });
    };

    const backToLobby = async () => {
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            status: 'lobby',
            readyChecks: {},
            readyCheckStartedAt: null,
        });
    };

    // 50/50 lifeline (millionaire mode)
    const use50Fifty = async () => {
        const qIdx = room.currentQIdx;
        if (room.lifelines?.used?.ff) return;
        const q = room.questions[qIdx];
        const correctAnswer = answerKeys[qIdx]?.correct_answer ?? null;
        if (!correctAnswer) return;
        const wrongLetters = (q.choices || [])
            .filter(c => c.letter !== correctAnswer)
            .map(c => c.letter)
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.max(0, (q.choices?.length || 4) - 2));
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            [`lifelines.ff.${qIdx}`]: wrongLetters,
            'lifelines.used.ff': true,
            'lifelines.ffQuestion': qIdx,
        });
    };

    const useAudiencePoll = async () => {
        const qIdx = room.currentQIdx;
        if (room.lifelines?.used?.audience) return;
        const q = room.questions[qIdx];
        const qWithAnswer = { ...q, correct_answer: answerKeys[qIdx]?.correct_answer ?? null };
        const poll = buildAudiencePoll(qWithAnswer, room.answers?.[qIdx] || {});
        if (!poll) return;
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            [`lifelines.audience.${qIdx}`]: poll,
            'lifelines.used.audience': true,
            'lifelines.audienceQuestion': qIdx,
        });
    };

    const useExpertHint = async () => {
        const qIdx = room.currentQIdx;
        if (room.lifelines?.used?.expert) return;
        const q = room.questions[qIdx];
        const qWithAnswer = { ...q, correct_answer: answerKeys[qIdx]?.correct_answer ?? null };
        const hint = buildExpertHint(qWithAnswer, room.lifelines?.audience?.[qIdx] || null);
        if (!hint) return;
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            [`lifelines.expert.${qIdx}`]: hint,
            'lifelines.used.expert': true,
            'lifelines.expertQuestion': qIdx,
        });
    };

    // Reveal answers – presentation mode is local; other modes use server-side Cloud Function
    const revealAnswers = async () => {
        if (room.mode === 'presentation') {
            await updateDoc(doc(db, 'liveRooms', roomCode), { status: 'reveal' });
            return;
        }
        try {
            const revealFn = httpsCallable(functions, 'revealLiveAnswers');
            await revealFn({ roomCode });
        } catch (error) {
            console.error('revealLiveAnswers CF failed', error);
            // Fallback: client-side scoring
            await revealAnswersClientSide();
        }
    };

    // Client-side fallback scoring (also used when CF not available)
    const revealAnswersClientSide = async () => {
        const qIdx = room.currentQIdx;
        const qAnswers = room.answers?.[qIdx] || {};
        const newScores = { ...(room.scores || {}) };
        const newEliminated = [...(room.eliminated || [])];
        const duration = room.questionDuration || 30;
        const startMs = room.questionStartAt?.toMillis?.() || Date.now();
        const liveMode = room.mode;
        const millionaireLadder = room.millionaire?.ladder?.length
            ? room.millionaire.ladder
            : buildMillionaireLadder(room.questions?.length || 0);
        const currentMillionaireStep = millionaireLadder[qIdx] || null;
        const correctAnswer = answerKeys[qIdx]?.correct_answer ?? null;
        const questionPoints = answerKeys[qIdx]?.points ?? 1;
        const questionType = answerKeys[qIdx]?.type ?? 'mcq';
        const qWithAnswer = { type: questionType, correct_answer: correctAnswer, choices: room.questions?.[qIdx]?.choices || [] };

        Object.entries(qAnswers).forEach(([uid, data]) => {
            if (newEliminated.includes(uid)) return;
            const answerMs = data.answeredAt?.toMillis?.() || startMs + duration * 1000;
            const elapsed = Math.max(0, (answerMs - startMs) / 1000);
            const speedBonus = liveMode === 'speed' ? Math.max(0, Math.floor((duration - elapsed) / duration * 200)) : 0;
            const correct = isLiveAnswerCorrect(qWithAnswer, data);

            if (!newScores[uid]) newScores[uid] = createDefaultScoreState();
            if (correct) {
                if (liveMode === 'millionaire') {
                    const nextLevel = qIdx + 1;
                    const safePrize = currentMillionaireStep?.isCheckpoint ? currentMillionaireStep.amount : (newScores[uid].safePrize || 0);
                    const safeLevel = currentMillionaireStep?.isCheckpoint ? nextLevel : (newScores[uid].safeLevel || 0);
                    newScores[uid] = { ...newScores[uid], score: currentMillionaireStep?.amount || (newScores[uid].score || 0), correct: (newScores[uid].correct || 0) + 1, streak: (newScores[uid].streak || 0) + 1, level: nextLevel, safePrize, safeLevel, lastCorrectAtMs: answerMs };
                } else {
                    const newStreak = (newScores[uid].streak || 0) + 1;
                    const basePoints = questionPoints * 100;
                    const streakBonus = (liveMode === 'classic' || liveMode === 'speed') ? calcStreakBonus(newStreak) : 0;
                    newScores[uid].score = (newScores[uid].score || 0) + basePoints + speedBonus + streakBonus;
                    newScores[uid].correct = (newScores[uid].correct || 0) + 1;
                    newScores[uid].streak = newStreak;
                    newScores[uid].lastCorrectAtMs = answerMs;
                }
            } else {
                newScores[uid].wrong = (newScores[uid].wrong || 0) + 1;
                newScores[uid].streak = 0;
                if (liveMode === 'millionaire') {
                    newScores[uid].score = newScores[uid].safePrize || 0;
                    newScores[uid].eliminatedAtLevel = newScores[uid].level || 0;
                    newScores[uid].lastCorrectAtMs = newScores[uid].lastCorrectAtMs || answerMs;
                    if (!newEliminated.includes(uid)) newEliminated.push(uid);
                } else if (liveMode === 'golden_bell') {
                    if (!newEliminated.includes(uid)) newEliminated.push(uid);
                }
            }
        });

        Object.keys(room.participants || {}).forEach(uid => {
            if (!qAnswers[uid] && !newEliminated.includes(uid)) {
                if (!newScores[uid]) newScores[uid] = createDefaultScoreState();
                newScores[uid].wrong = (newScores[uid].wrong || 0) + 1;
                newScores[uid].streak = 0;
                if (liveMode === 'millionaire') {
                    newScores[uid].score = newScores[uid].safePrize || 0;
                    newScores[uid].eliminatedAtLevel = newScores[uid].level || 0;
                    if (!newEliminated.includes(uid)) newEliminated.push(uid);
                } else if (liveMode === 'golden_bell') {
                    if (!newEliminated.includes(uid)) newEliminated.push(uid);
                }
            }
        });

        const activeCount = Object.keys(room.participants || {}).length - newEliminated.length;
        const autoEnd = (liveMode === 'golden_bell' || liveMode === 'millionaire') && activeCount <= 1;

        await updateDoc(doc(db, 'liveRooms', roomCode), {
            status: autoEnd ? 'ended' : 'reveal',
            scores: newScores,
            eliminated: newEliminated,
            [`revealedCorrectAnswers.${qIdx}`]: correctAnswer,
        });
    };

    // Show leaderboard between questions
    const showLeaderboard = async () => {
        await updateDoc(doc(db, 'liveRooms', roomCode), { status: 'leaderboard' });
    };

    const endRoom = async () => {
        await updateDoc(doc(db, 'liveRooms', roomCode), { status: 'ended' });
        setPhase('ended');
    };

    const closeRoom = async () => {
        if (roomCode) {
            // Save results to liveSessions archive (non-presentation modes only)
            if (room && room.mode !== 'presentation') {
                try {
                    await setDoc(doc(db, 'liveSessions', `${examId}_${Date.now()}`), {
                        examId,
                        examTitle: room.examTitle || exam?.title || null,
                        teacherId: room.teacherId,
                        teacherName: room.teacherName || null,
                        mode: room.mode,
                        roomCode,
                        totalQuestions: room.questions?.length || 0,
                        totalParticipants: Object.keys(room.participants || {}).length,
                        scores: room.scores || {},
                        participants: room.participants || {},
                        revealedCorrectAnswers: room.revealedCorrectAnswers || {},
                        teamMode: room.teamMode || false,
                        teams: room.teams || {},
                        teamScores: room.teamScores || {},
                        playedAt: serverTimestamp(),
                    });
                } catch (error) {
                    console.error('save liveSessions failed', error);
                }
            }
            // Delete private subcollection first, then room
            try { await deleteDoc(doc(db, 'liveRooms', roomCode, 'private', 'answerKey')); } catch (_) {}
            await deleteDoc(doc(db, 'liveRooms', roomCode));
        }
        navigate(`/teacher/exam/${examId}`);
    };

    const qrValue = roomCode ? `${window.location.origin}/live/${roomCode}` : null;

    const liveMode = room?.mode || mode;
    const isMillionaireMode = liveMode === 'millionaire';
    const presenterRoute = `/teacher/exam/${examId}/presentation?role=presenter`;
    const deckRoute = `/teacher/exam/${examId}/presentation`;
    const previewMillionaireLadder = buildMillionaireLadder(questions.length);
    const millionaireLadder = room?.millionaire?.ladder?.length
        ? room.millionaire.ladder
        : buildMillionaireLadder(room?.questions?.length || questions.length);
    const currentMillionaireStep = room && room.currentQIdx >= 0 ? millionaireLadder[room.currentQIdx] : null;
    const currentMillionaireFloor = millionaireLadder
        .filter((step) => step.isCheckpoint && step.level <= ((room?.currentQIdx || -1) + 1))
        .at(-1)?.amount || 0;
    const currentAudiencePoll = room?.lifelines?.audience?.[room?.currentQIdx] || null;
    const currentExpertHint = room?.lifelines?.expert?.[room?.currentQIdx] || null;
    const usedLifelines = room?.lifelines?.used || {};
    const participantEntries = room
        ? Object.entries(room.participants || {}).map(([uid, participant]) => ({
            uid,
            name: participant?.name || 'Học sinh',
            photoURL: participant?.photoURL || null,
        }))
        : [];
    const readyEntries = participantEntries.map((participant) => ({
        ...participant,
        ready: Boolean(room?.readyChecks?.[participant.uid]?.ready),
    }));
    const readyCount = readyEntries.filter((participant) => participant.ready).length;
    const everyoneReady = readyEntries.length > 0 && readyCount === readyEntries.length;
    const activePlayers = room ? Object.entries(room.participants || {}).filter(([uid]) => !room.eliminated?.includes(uid)) : [];
    const sortedLeaderboard = room
        ? sortLiveLeaderboard(Object.entries(room.scores || {})
            .map(([uid, data]) => ({
                uid,
                name: room.participants?.[uid]?.name || 'Học sinh',
                photoURL: room.participants?.[uid]?.photoURL || null,
                score: data.score || 0,
                correct: data.correct || 0,
                streak: data.streak || 0,
                level: data.level || 0,
                safePrize: data.safePrize || 0,
                safeLevel: data.safeLevel || 0,
                lastCorrectAtMs: data.lastCorrectAtMs || 0,
                eliminated: room.eliminated?.includes(uid),
            })), liveMode)
        : [];
    const awardWinners = sortedLeaderboard.slice(0, 3);
    const champion = awardWinners[0] || null;

    const currentQ = room && room.currentQIdx >= 0 ? room.questions?.[room.currentQIdx] : null;
    const isLastQuestion = room && room.currentQIdx >= (room.questions?.length || 0) - 1;
    const selectedModePlaybook = MODE_PLAYBOOK[mode];

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div className={`live-host-page${isMillionaireMode ? ' live-host-page-millionaire' : ''}`}>
            {/* ── SETUP ── */}
            {phase === 'setup' && (
                <div className="live-setup-wrap">
                    <div className="live-setup-card">
                        <div className="live-setup-head">
                            <Link to={`/teacher/exam/${examId}`} className="btn btn-sm btn-ghost" style={{ marginRight: 8 }}>
                                <i className="bi bi-arrow-left"></i>
                            </Link>
                            <div>
                                <h2><i className="bi bi-broadcast"></i> Phát sóng Live</h2>
                                <p className="live-exam-name">{exam?.title}</p>
                            </div>
                        </div>

                        <div className="live-beamer-callout">
                            <div className="live-beamer-copy">
                                <div className="live-room-code-label">BEAMER / PRESENTER</div>
                                <h3>Chỉ muốn chiếu chữa bài thì không cần tạo phòng live</h3>
                                <p>
                                    Presenter View là chế độ đúng cho 2 màn hình: một màn giáo viên có notes, reveal, spotlight;
                                    một màn chiếu cho lớp. Cụm mode bên dưới chỉ dùng khi bạn muốn học sinh vào bằng mã phòng.
                                </p>
                            </div>
                            <div className="live-beamer-actions">
                                <Link to={presenterRoute} target="_blank" rel="noreferrer" className="btn btn-primary live-beamer-btn">
                                    <i className="bi bi-display"></i> Mở Presenter View
                                </Link>
                                <Link to={deckRoute} target="_blank" rel="noreferrer" className="btn btn-outline live-beamer-btn">
                                    <i className="bi bi-easel2"></i> Mở deck thường
                                </Link>
                            </div>
                        </div>

                        <div className="live-mode-headline">
                            <div>
                                <div className="live-room-code-label">PHÁT LIVE CHO HỌC SINH</div>
                                <h3>Chọn mode có học sinh tham gia bằng mã phòng</h3>
                            </div>
                            <p>
                                Nếu bạn chỉ cần chiếu bài kiểu beamer, dùng cụm Presenter ở trên. Nếu muốn học sinh quét mã,
                                vào phòng và xem cùng hoặc thi cùng, chọn một mode ở dưới.
                            </p>
                        </div>

                        <div className="live-mode-grid">
                            {Object.entries(MODE_CONFIG).map(([key, cfg]) => (
                                <button key={key} className={`live-mode-card tone-${cfg.tone} ${mode === key ? 'active' : ''}`} onClick={() => setMode(key)}>
                                    <div className="live-mode-card-top">
                                        <span className="live-mode-icon"><i className={`bi bi-${cfg.icon}`}></i></span>
                                        <span className="live-mode-category">{cfg.category}</span>
                                    </div>
                                    <strong>{cfg.label}</strong>
                                    <span className="live-mode-desc">{cfg.desc}</span>
                                    <span className="live-mode-fit">Hợp cho: {cfg.fit}</span>
                                </button>
                            ))}
                        </div>

                        {isFreeTeacherPlan && (
                            <div className="live-setup-note">
                                <i className="bi bi-stars"></i>
                                {selectedModeIsPremium
                                    ? premiumLiveUsage.remaining > 0
                                        ? <>
                                            Bạn đang ở gói Free. Mode này dùng <strong>1 trong {FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth}</strong> lượt live game nâng cao mỗi tháng. Tháng này còn <strong>{premiumLiveUsage.remaining}</strong> lượt.
                                        </>
                                        : <>
                                            Bạn đã dùng hết <strong>{FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth}</strong> lượt live game nâng cao trong tháng này. Chuyển sang Classic Live hoặc Trình chiếu, hoặc nâng cấp Teacher Plus để mở tiếp.
                                        </>
                                    : <>
                                        Gói Free dùng thoải mái <strong>Classic Live</strong> và <strong>Trình chiếu</strong>. Các mode nâng cao có <strong>{FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth} lượt / tháng</strong>.
                                    </>}
                            </div>
                        )}

                        {selectedModePlaybook && (
                            <div className="live-mode-playbook">
                                <div className="live-mode-playbook-head">
                                    <div>
                                        <div className="live-room-code-label">GOI Y CHON MODE</div>
                                        <h3>{selectedModePlaybook.title}</h3>
                                        <p>{selectedModePlaybook.summary}</p>
                                    </div>
                                    <div className="live-mode-playbook-scale">{selectedModePlaybook.classScale}</div>
                                </div>

                                <div className="live-mode-playbook-grid">
                                    <div className="live-mode-playbook-item">
                                        <span>Hop nhat cho</span>
                                        <strong>{selectedModePlaybook.bestFor}</strong>
                                    </div>
                                    <div className="live-mode-playbook-item">
                                        <span>Dinh dang cau</span>
                                        <strong>{selectedModePlaybook.questionMix}</strong>
                                    </div>
                                    <div className="live-mode-playbook-item">
                                        <span>Pace goi y</span>
                                        <strong>{selectedModePlaybook.durationHint}</strong>
                                    </div>
                                </div>

                                <div className="live-mode-playbook-tags">
                                    {selectedModePlaybook.patterns.map((item) => (
                                        <span key={item}>{item}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="live-setup-row">
                            <label>
                                <i className="bi bi-hourglass-split"></i> Thời gian mỗi câu
                            </label>
                            <div className="live-timer-options">
                                {[10, 15, 20, 30, 45, 60].map(s => (
                                    <button key={s} className={`live-timer-btn ${questionDuration === s ? 'active' : ''}`}
                                        onClick={() => setQuestionDuration(s)}>{s}s</button>
                                ))}
                            </div>
                        </div>

                        <div className="live-setup-row">
                            <label>
                                <i className="bi bi-people-fill"></i> Chế độ nhóm (Team mode)
                            </label>
                            <label className="live-toggle-label">
                                <input type="checkbox" checked={teamMode} onChange={e => setTeamMode(e.target.checked)} className="live-toggle-input" />
                                <span className="live-toggle-switch"></span>
                                <span>{teamMode ? 'Bật – học sinh sẽ được phân nhóm' : 'Tắt – thi cá nhân'}</span>
                            </label>
                        </div>

                        {mode === 'presentation' && (
                            <div className="live-setup-note">
                                <i className="bi bi-info-circle-fill"></i>
                                Mode này vẫn tạo mã phòng để học sinh cùng vào xem. Nếu không cần học sinh join phòng và chỉ muốn chiếu kiểu beamer,
                                hãy dùng Presenter View ở phía trên. Timer ở đây chỉ là tham khảo.
                            </div>
                        )}
                        {mode === 'millionaire' && (
                            <>
                                <div className="live-setup-note">
                                    <i className="bi bi-trophy-fill"></i>
                                    Sai 1 câu bị loại. Ban to chuc co 3 lifeline duy nhat cho ca phong: <strong>50/50</strong>, <strong>Hoi khan gia</strong> va <strong>Chuyen gia</strong>.
                                </div>
                                <div className="live-millionaire-preflight">
                                    <div className="live-millionaire-preflight-head">
                                        <strong>Prize ladder</strong>
                                        <span>{formatMillionairePrize(previewMillionaireLadder.at(-1)?.amount || 0)}</span>
                                    </div>
                                    <div className="live-millionaire-preflight-rules">
                                        {previewMillionaireLadder.filter((step) => step.isCheckpoint).map((step) => (
                                            <span key={step.level}><i className="bi bi-shield-check"></i> Moc an toan {step.level}</span>
                                        ))}
                                        <span><i className="bi bi-broadcast-pin"></i> BXH realtime</span>
                                        <span><i className="bi bi-stars"></i> Hieu ung san khau</span>
                                    </div>
                                    <div className="live-millionaire-ladder-preview">
                                        {previewMillionaireLadder.slice().reverse().slice(0, 6).map((step) => (
                                            <div key={step.level} className={`live-millionaire-ladder-step${step.isCheckpoint ? ' checkpoint' : ''}`}>
                                                <span>#{step.level}</span>
                                                <strong>{step.label}</strong>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                        <div className="live-setup-info">
                            <i className="bi bi-info-circle"></i>
                            <span><strong>{questions.length}</strong> câu hỏi · Chế độ: <strong>{MODE_CONFIG[mode]?.label}</strong> · <strong>{questionDuration}s</strong>/câu</span>
                        </div>

                        <button className="btn btn-primary live-start-btn" onClick={createRoom}>
                            <i className="bi bi-broadcast"></i> Tạo phòng &amp; Phát sóng
                        </button>
                    </div>
                </div>
            )}

            {/* ── LOBBY ── */}
            {phase === 'lobby' && room && (
                <div className="live-lobby-wrap">
                    <div className="live-lobby-top">
                        <div className="live-room-info">
                            <div className="live-room-code-label">MÃ PHÒNG</div>
                            <div className="live-room-code">{roomCode}</div>
                            <div className="live-room-url">{window.location.origin}/live/{roomCode}</div>
                            <div className="live-badge">{MODE_CONFIG[room.mode]?.label}</div>
                        </div>
                        {qrValue && (
                            <div className="live-qr-wrap">
                                <QRCodeSVG value={qrValue} size={200} className="live-qr-img" includeMargin />
                                <div className="live-qr-label">Học sinh quét để vào</div>
                            </div>
                        )}
                    </div>

                    <div className="live-participants-panel">
                        <div className="live-panel-head">
                            <strong><i className="bi bi-people-fill"></i> Học sinh đã vào ({Object.keys(room.participants || {}).length})</strong>
                        </div>
                        <div className="live-participants-grid">
                            <AnimatePresence>
                                {participantEntries.map((participant) => (
                                    <motion.div key={participant.uid} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="live-participant-chip">
                                        {participant.photoURL ? <img src={participant.photoURL} alt="" referrerPolicy="no-referrer" /> : <i className="bi bi-person-circle"></i>}
                                        <span>{participant.name}</span>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                            {participantEntries.length === 0 && (
                                <div className="live-waiting-hint">Đang chờ học sinh vào phòng...</div>
                            )}
                        </div>
                    </div>

                    <div className="live-lobby-actions">
                        <button className="btn btn-outline" onClick={closeRoom}>Hủy phòng</button>
                        {room.teamMode && participantEntries.length >= 2 && (
                            <button className="btn btn-outline" onClick={async () => {
                                const shuffled = [...participantEntries].sort(() => Math.random() - 0.5);
                                const mid = Math.ceil(shuffled.length / 2);
                                await updateDoc(doc(db, 'liveRooms', roomCode), {
                                    teams: {
                                        A: shuffled.slice(0, mid).map(p => p.uid),
                                        B: shuffled.slice(mid).map(p => p.uid),
                                    },
                                    teamNames: { A: 'Nhóm A', B: 'Nhóm B' },
                                    teamScores: { A: 0, B: 0 },
                                });
                            }}>
                                <i className="bi bi-shuffle"></i> Phân nhóm ngẫu nhiên
                            </button>
                        )}
                        <button className="btn btn-outline" disabled={participantEntries.length === 0} onClick={startReadyCheck}>
                            <i className="bi bi-check2-circle"></i> Ready check
                        </button>
                        <button className="btn btn-primary" disabled={participantEntries.length === 0} onClick={nextQuestion}>
                            <i className="bi bi-play-fill"></i> Bắt đầu ngay ({participantEntries.length} học sinh)
                        </button>
                    </div>
                </div>
            )}

            {phase === 'ready_check' && room && (
                <div className={`live-ready-wrap${isMillionaireMode ? ' millionaire' : ''}`}>
                    <div className="live-ready-head">
                        <div>
                            <span className="live-room-code-label">READY CHECK</span>
                            <h2>Sẵn sàng vào sân khấu</h2>
                            <p>Giáo viên đang kiểm tra thiết bị và độ tập trung trước khi khóa phòng vào câu 1.</p>
                        </div>
                        <div className="live-ready-counter">
                            <strong>{readyCount}/{readyEntries.length}</strong>
                            <span>{everyoneReady ? 'Tất cả đã sẵn sàng' : 'Học sinh đã xác nhận'}</span>
                        </div>
                    </div>

                    <div className="live-ready-progress">
                        <div style={{ width: `${readyEntries.length ? Math.round((readyCount / readyEntries.length) * 100) : 0}%` }}></div>
                    </div>

                    <div className="live-ready-grid">
                        {readyEntries.map((participant) => (
                            <div key={participant.uid} className={`live-ready-player${participant.ready ? ' ready' : ''}`}>
                                <div className="live-ready-player-main">
                                    {participant.photoURL ? <img src={participant.photoURL} alt="" referrerPolicy="no-referrer" /> : <i className="bi bi-person-circle"></i>}
                                    <div>
                                        <strong>{participant.name}</strong>
                                        <span>{participant.ready ? 'Đã xác nhận sẵn sàng' : 'Đang chờ xác nhận'}</span>
                                    </div>
                                </div>
                                <em>{participant.ready ? 'READY' : 'WAITING'}</em>
                            </div>
                        ))}
                        {readyEntries.length === 0 && (
                            <div className="live-waiting-hint">Chưa có học sinh trong phòng để chạy ready check.</div>
                        )}
                    </div>

                    <div className="live-lobby-actions">
                        <button className="btn btn-outline" onClick={backToLobby}>Quay lại lobby</button>
                        <button className="btn btn-primary" disabled={readyEntries.length === 0} onClick={nextQuestion}>
                            <i className="bi bi-rocket-takeoff-fill"></i> {everyoneReady ? 'Tất cả đã sẵn sàng - vào câu 1' : `Bắt đầu với ${readyCount}/${readyEntries.length}`}
                        </button>
                    </div>
                </div>
            )}

            {/* ── QUESTION ── */}
            {(phase === 'question' || phase === 'reveal') && room && currentQ && (() => {
                const qAnswers = room.answers?.[room.currentQIdx] || {};
                const answeredCount = Object.keys(qAnswers).length;
                const totalPlayers = Object.keys(room.participants || {}).length - (room.eliminated?.length || 0);
                const allAnswered = totalPlayers > 0 && answeredCount >= totalPlayers;
                return (
                <div className={`live-question-wrap${room.mode === 'millionaire' ? ' live-question-wrap-millionaire' : ''}`}>
                    <div className="live-q-header">
                        <span className="live-q-progress">Câu {(room.currentQIdx || 0) + 1} / {room.questions?.length}</span>
                        {phase === 'question' && (
                            <div className={`live-q-timer ${timeLeft <= 5 ? 'urgent' : ''}`}>
                                <i className="bi bi-hourglass-split"></i> {timeLeft}s
                            </div>
                        )}
                        {phase === 'reveal' && <span className="live-q-revealed"><i className="bi bi-check-circle-fill"></i> Đã lộ đáp án</span>}
                        <div className="live-q-stats">
                            <span className={`live-answer-count-badge ${allAnswered ? 'all-in' : ''}`}>
                                <i className="bi bi-people"></i> {answeredCount}/{totalPlayers} trả lời
                                {allAnswered && <span className="live-all-in-tag"> ✓ Tất cả!</span>}
                            </span>
                        </div>
                    </div>

                    {room.mode === 'millionaire' && currentMillionaireStep && (
                        <div className="live-millionaire-marquee">
                            <span><i className="bi bi-gem"></i> Mốc hiện tại: <strong>{currentMillionaireStep.label}</strong></span>
                            <span><i className="bi bi-shield-lock"></i> Mốc an toàn: <strong>{currentMillionaireFloor ? formatMillionairePrize(currentMillionaireFloor) : 'Chưa có'}</strong></span>
                            <span><i className="bi bi-activity"></i> Còn lại <strong>{activePlayers.length}</strong> người chơi</span>
                        </div>
                    )}

                    {/* Answer progress bar (visible during question) */}
                    {phase === 'question' && totalPlayers > 0 && (
                        <div className="live-answer-progress-wrap">
                            <div className="live-answer-progress-bar"
                                style={{ width: `${Math.round((answeredCount / totalPlayers) * 100)}%` }} />
                        </div>
                    )}

                    <div className={`live-q-shell${room.mode === 'millionaire' ? ' millionaire' : ''}`}>
                        <div className="live-q-stage">
                            {currentQ?.deliverySection?.isSectionStart && (currentQ?.deliverySection?.hasSections || currentQ?.deliverySection?.contextHtml || currentQ?.deliverySection?.contextText) && (
                                <div className="section-context-card preview-mode" style={{ marginBottom: 14 }}>
                                    <div className="section-context-head">
                                        <strong>{currentQ.deliverySection.title || 'Phần câu hỏi'}</strong>
                                        {currentQ.deliverySection.tag && <span className="stat-badge muted">{currentQ.deliverySection.tag}</span>}
                                    </div>
                                    {currentQ.deliverySection.contextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(currentQ.deliverySection.contextHtml) }} />}
                                </div>
                            )}
                            <div className="live-q-content" dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(currentQ.content_html || escHtml(currentQ.content_text), currentQ, room?.currentQIdx || 0)) }} />

                            {currentQ.type === 'mcq' && (
                                <div className={`live-q-choices${room.mode === 'millionaire' ? ' millionaire' : ''}`}>
                                    {(currentQ.choices || []).map((c, ci) => {
                                        const revealedAnswer = room.revealedCorrectAnswers?.[room.currentQIdx];
                                        const isCorrect = phase === 'reveal' && c.letter === (revealedAnswer ?? answerKeys[room.currentQIdx]?.correct_answer);
                                        const answerCount = Object.values(qAnswers).filter(a => a.answer === c.letter).length;
                                        const total = Object.keys(qAnswers).length || 1;
                                        const pct = phase === 'reveal' ? Math.round((answerCount / total) * 100) : 0;
                                        return (
                                            <div key={ci} className={`live-choice ${isCorrect ? 'correct' : ''}${room.mode === 'millionaire' ? ' millionaire' : ''}`}>
                                                <span className="live-choice-letter">{c.letter}</span>
                                                <span className="live-choice-text">{getChoiceDisplayText(c, currentQ.type, ci)}</span>
                                                <span className="live-choice-live-count">{answerCount > 0 ? answerCount : ''}</span>
                                                {phase === 'reveal' && (
                                                    <div className="live-choice-bar-wrap">
                                                        <motion.div className="live-choice-bar"
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${pct}%` }}
                                                            transition={{ duration: 0.5, ease: 'easeOut' }} />
                                                        <span className="live-choice-count">{answerCount} ({pct}%)</span>
                                                    </div>
                                                )}
                                                {isCorrect && <i className="bi bi-check-circle-fill live-correct-icon"></i>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {phase === 'reveal' && (room.mode === 'golden_bell' || room.mode === 'millionaire') && (
                                <div className="live-eliminated-notice">
                                    <i className="bi bi-x-circle-fill"></i>
                                    <strong>{(room.eliminated?.length || 0)} học sinh bị loại trong trò chơi này</strong>
                                </div>
                            )}

                            <div className="live-q-actions">
                                {phase === 'question' && (
                                    <button className="btn btn-warning" onClick={revealAnswers}>
                                        <i className="bi bi-eye-fill"></i> {room.mode === 'presentation' ? 'Lộ đáp án' : allAnswered ? 'Lộ đáp án (Tất cả đã trả lời)' : 'Lộ đáp án ngay'}
                                    </button>
                                )}
                                {phase === 'reveal' && (
                                    <>
                                        {room.mode !== 'presentation' && (
                                            <button className="btn btn-outline" onClick={showLeaderboard}>
                                                <i className="bi bi-trophy"></i> Bảng xếp hạng
                                            </button>
                                        )}
                                        <button className="btn btn-primary" onClick={nextQuestion}>
                                            {isLastQuestion ? <><i className="bi bi-flag-fill"></i> Kết thúc</> : <><i className="bi bi-skip-forward-fill"></i> Câu tiếp theo</>}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {room.mode === 'millionaire' && (
                            <aside className="live-millionaire-side">
                                <div className="live-millionaire-panel spotlight">
                                    <div className="live-millionaire-panel-title">Lifeline cockpit</div>
                                    <div className="live-millionaire-lifeline-grid">
                                        <button className="btn btn-lifeline" onClick={use50Fifty} disabled={phase !== 'question' || usedLifelines.ff || currentQ.type === 'short_answer'} title={currentQ.type === 'short_answer' ? '50/50 không áp dụng cho câu tự luận' : ''}>
                                            <i className="bi bi-scissors"></i> {usedLifelines.ff ? '50/50 đã dùng' : '50/50'}
                                        </button>
                                        <button className="btn btn-lifeline alt" onClick={useAudiencePoll} disabled={phase !== 'question' || usedLifelines.audience || currentQ.type === 'short_answer'} title={currentQ.type === 'short_answer' ? 'Hỏi khán giả không áp dụng cho câu tự luận' : ''}>
                                            <i className="bi bi-people-fill"></i> {usedLifelines.audience ? 'Khán giả đã dùng' : 'Hỏi khán giả'}
                                        </button>
                                        <button className="btn btn-lifeline ghost" onClick={useExpertHint} disabled={phase !== 'question' || usedLifelines.expert || currentQ.type === 'short_answer'} title={currentQ.type === 'short_answer' ? 'Chuyên gia không áp dụng cho câu tự luận' : ''}>
                                            <i className="bi bi-lightbulb-fill"></i> {usedLifelines.expert ? 'Chuyên gia đã dùng' : 'Chuyên gia'}
                                        </button>
                                    </div>
                                </div>

                                {currentAudiencePoll && (
                                    <div className="live-millionaire-panel">
                                        <div className="live-millionaire-panel-title">Khán giả đang nghiêng về</div>
                                        <div className="live-millionaire-poll-list">
                                            {Object.entries(currentAudiencePoll.distribution || {}).map(([letter, value]) => (
                                                <div key={letter} className="live-millionaire-poll-item">
                                                    <span>{letter}</span>
                                                    <div className="live-millionaire-poll-track"><div style={{ width: `${value}%` }}></div></div>
                                                    <strong>{value}%</strong>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {currentExpertHint && (
                                    <div className="live-millionaire-panel">
                                        <div className="live-millionaire-panel-title">Gợi ý chuyên gia</div>
                                        <div className="live-millionaire-expert-card">
                                            <strong>{currentExpertHint.recommended}</strong>
                                            <span>{currentExpertHint.message}</span>
                                            <small>Độ tự tin {currentExpertHint.confidence}%</small>
                                        </div>
                                    </div>
                                )}

                                <div className="live-millionaire-panel">
                                    <div className="live-millionaire-panel-title">BXH thời gian thực</div>
                                    <div className="live-millionaire-mini-board">
                                        {sortedLeaderboard.slice(0, 6).map((entry, rank) => (
                                            <div key={entry.uid} className={`live-millionaire-mini-row${entry.eliminated ? ' eliminated' : ''}`}>
                                                <span>#{rank + 1}</span>
                                                <strong>{entry.name}</strong>
                                                <small>{entry.level || 0} mốc</small>
                                                <em>{getLiveScoreLabel(entry, liveMode)}</em>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="live-millionaire-panel">
                                    <div className="live-millionaire-panel-title">Prize ladder</div>
                                    <div className="live-millionaire-ladder-list">
                                        {millionaireLadder.slice().reverse().map((step) => (
                                            <div key={step.level} className={`live-millionaire-ladder-step${step.level === ((room.currentQIdx || -1) + 1) ? ' current' : ''}${step.isCheckpoint ? ' checkpoint' : ''}`}>
                                                <span>#{step.level}</span>
                                                <strong>{step.label}</strong>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </aside>
                        )}
                    </div>
                </div>
                );
            })()}

            {/* ── LEADERBOARD (between questions) ── */}
            {phase === 'leaderboard' && room && (
                <div className="live-lb-wrap">
                    <h2 className="live-lb-title"><i className="bi bi-trophy-fill"></i> {room.mode === 'millionaire' ? 'Bảng xếp hạng triệu phú' : 'Bảng xếp hạng'}</h2>
                    <div className="live-lb-list">
                        {sortedLeaderboard.slice(0, 10).map((entry, rank) => (
                            <motion.div key={entry.uid} initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: rank * 0.07 }}
                                className={`live-lb-item rank-${rank + 1} ${entry.eliminated ? 'eliminated' : ''}`}>
                                <span className="live-lb-rank">{rank + 1}</span>
                                {entry.photoURL ? <img src={entry.photoURL} alt="" className="live-lb-avatar" referrerPolicy="no-referrer" /> : <i className="bi bi-person-circle live-lb-avatar-icon"></i>}
                                <span className="live-lb-name">{entry.name}</span>
                                {entry.eliminated && <span className="live-lb-elim"><i className="bi bi-x-circle"></i> Loại</span>}
                                {room.mode === 'millionaire' && <span className="live-lb-meta">Mốc {entry.level || 0}</span>}
                                <span className="live-lb-score">{getLiveScoreLabel(entry, liveMode)}</span>
                                {entry.streak >= 2 && <span className="live-lb-streak">🔥 {entry.streak}</span>}
                            </motion.div>
                        ))}
                    </div>
                    <div className="live-lb-actions">
                        <button className="btn btn-primary" onClick={nextQuestion}>
                            {isLastQuestion ? <><i className="bi bi-flag-fill"></i> Kết thúc</> : <><i className="bi bi-skip-forward-fill"></i> Câu tiếp theo</>}
                        </button>
                    </div>
                </div>
            )}

            {/* ── ENDED ── */}
            {phase === 'ended' && room && (
                <div className="live-ended-wrap">
                    <div className="live-ended-hero">
                        <div className="live-ended-trophy">{room.mode === 'presentation' ? '📖' : '🏆'}</div>
                        <h2>Kết thúc!</h2>
                        <p>{
                            room.mode === 'golden_bell' ? 'Rung chuông vàng đã kết thúc!' :
                            room.mode === 'millionaire' ? 'Ai là triệu phú đã kết thúc!' :
                            room.mode === 'presentation' ? 'Buổi ôn tập đã kết thúc!' :
                            'Buổi live đã kết thúc!'
                        }</p>
                    </div>

                    {room.mode === 'millionaire' && champion && (
                        <div className="live-millionaire-award-banner">
                            <span className="live-millionaire-panel-title">Award stage</span>
                            <h3>{champion.name} đang đứng trên bục vô địch</h3>
                            <p>Chạm mốc {champion.level || 0} và chốt {getLiveScoreLabel(champion, liveMode)} trong trận live này.</p>
                        </div>
                    )}

                    <div className="live-podium">
                        {awardWinners.map((entry, rank) => (
                            <div key={entry.uid} className={`live-podium-slot rank-${rank + 1}`}>
                                <div className="live-podium-rank">{rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉'}</div>
                                {entry.photoURL ? <img src={entry.photoURL} alt="" className="live-podium-avatar" referrerPolicy="no-referrer" /> : null}
                                <div className="live-podium-name">{entry.name}</div>
                                <div className="live-podium-score">{room.mode === 'millionaire' ? getLiveScoreLabel(entry, liveMode) : entry.score.toLocaleString()}</div>
                                <div className="live-podium-bar" style={{ height: [80, 60, 45][rank] }}></div>
                            </div>
                        ))}
                    </div>

                    {room.mode === 'millionaire' && awardWinners.length > 0 && (
                        <div className="live-millionaire-award-grid">
                            {awardWinners.map((entry, rank) => (
                                <div key={entry.uid} className={`live-millionaire-award-card rank-${rank + 1}`}>
                                    <span>Top {rank + 1}</span>
                                    <strong>{entry.name}</strong>
                                    <em>Mốc {entry.level || 0}</em>
                                    <b>{getLiveScoreLabel(entry, liveMode)}</b>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="live-lb-list" style={{ maxWidth: 560, margin: '0 auto 24px' }}>
                        {sortedLeaderboard.map((entry, rank) => (
                            <div key={entry.uid} className={`live-lb-item ${entry.eliminated ? 'eliminated' : ''}`}>
                                <span className="live-lb-rank">{rank + 1}</span>
                                <span className="live-lb-name">{entry.name}</span>
                                {entry.eliminated && <span className="live-lb-elim"><i className="bi bi-x-circle"></i> Loại</span>}
                                {room.mode === 'millionaire' && <span className="live-lb-meta">Mốc {entry.level || 0}</span>}
                                <span className="live-lb-score">{getLiveScoreLabel(entry, liveMode)}</span>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                        <button className="btn btn-outline" onClick={() => setShowAnalytics(a => !a)}>
                            <i className="bi bi-bar-chart-fill"></i> {showAnalytics ? 'Ẩn phân tích' : 'Phân tích kết quả'}
                        </button>
                        <button className="btn btn-outline" onClick={closeRoom}>Về trang đề thi</button>
                    </div>

                    {showAnalytics && (() => {
                        const questionStats = (room.questions || []).map((q, qIdx) => {
                            const answers = room.answers?.[qIdx] || {};
                            const revealedAnswer = room.revealedCorrectAnswers?.[qIdx];
                            const totalAnswered = Object.keys(answers).length;
                            if (!revealedAnswer || totalAnswered === 0) return null;
                            const correctCount = Object.values(answers).filter(a => {
                                const ans = a.answer ?? a;
                                if (q.type === 'short_answer') return String(ans || '').trim().toLowerCase() === String(revealedAnswer).trim().toLowerCase();
                                return ans === revealedAnswer;
                            }).length;
                            const pct = Math.round((correctCount / totalAnswered) * 100);
                            return { qIdx, correctCount, totalAnswered, pct, label: q.content_text?.slice(0, 60) || `Câu ${qIdx + 1}` };
                        }).filter(Boolean).sort((a, b) => a.pct - b.pct);
                        return (
                            <div className="live-analytics-panel">
                                <h3><i className="bi bi-graph-down"></i> Câu khó nhất (% đúng thấp)</h3>
                                <div className="live-analytics-list">
                                    {questionStats.slice(0, 5).map(stat => (
                                        <div key={stat.qIdx} className="live-analytics-row">
                                            <span className="live-analytics-label">Câu {stat.qIdx + 1}: {stat.label}</span>
                                            <div className="live-analytics-bar-wrap">
                                                <div className="live-analytics-bar" style={{ width: `${stat.pct}%`, background: stat.pct < 40 ? '#ef4444' : stat.pct < 70 ? '#f59e0b' : '#22c55e' }} />
                                                <span>{stat.correctCount}/{stat.totalAnswered} đúng ({stat.pct}%)</span>
                                            </div>
                                        </div>
                                    ))}
                                    {questionStats.length === 0 && <p>Chưa có dữ liệu câu hỏi.</p>}
                                </div>
                                <h3 style={{ marginTop: 20 }}><i className="bi bi-people-fill"></i> Học sinh cần chú ý</h3>
                                <div className="live-analytics-list">
                                    {sortedLeaderboard.slice(-Math.min(3, sortedLeaderboard.length)).reverse().map(entry => (
                                        <div key={entry.uid} className="live-analytics-row">
                                            <span className="live-analytics-label">{entry.name}</span>
                                            <span>{entry.correct || 0} đúng · {entry.score?.toLocaleString() || 0} điểm</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
