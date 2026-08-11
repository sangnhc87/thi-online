import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, updateDoc, deleteDoc, addDoc, writeBatch, query, where, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate } from '../utils/formatters';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { MATH_GROUPS, MATH_WRAP_OPTIONS, DEFAULT_MATH_WRAP, wrapMathExpression, renderLatexContent as renderLatex } from '../utils/math';
import { DEFAULT_ANTI_CHEAT, normalizeAntiCheatSettings } from '../utils/examSecurity';
import {
    IMAGE_ALIGN_OPTIONS,
    IMAGE_SIZE_OPTIONS,
    DEFAULT_IMAGE_ALIGN,
    DEFAULT_IMAGE_SIZE,
    buildImageTag,
    getStorageSafeImageName,
    optimizeImageFile,
} from '../utils/image';
import { buildExamSearchFields } from '../utils/search';
import { logAuditEvent } from '../utils/audit';
import { publishExamToSharedLibrary, unpublishSharedExam } from '../utils/library';
import { DEFAULT_GAMIFICATION, getGamificationPresetLabel, normalizeGamificationSettings } from '../utils/gamification';
import { buildExamAssetRefs, mergeExamAssetRefs, summarizeExamAssets } from '../utils/examAssets';
import { buildSectionTag, getChoiceDisplayContent, getQuestionSectionKey, getSectionDisplayTitle, groupQuestionsBySection, stripQuestionNumberPrefix } from '../utils/examSections';
import { extractResourceLinksFromHtml, mergeResourceLinks } from '../utils/resourceLinks';
import {
    DEFAULT_TF_SCORING,
    TF_SCORING_PRESETS,
    DEFAULT_QUESTION_SCORING,
    buildQuestionTypePatch,
    evaluateTfAnswer,
    getQuestionMaxPoints,
    getTfPresetId,
    normalizeQuestionScoring,
    normalizeTextAnswer,
    normalizeTfScoring,
} from '../utils/examScoring';
import {
    appendImportHistoryEntry,
    blocksExamActivation,
    buildImportHistoryEntry,
    buildImportQualityReport,
    formatImportQualitySummary,
    getImportQualityBadge,
    getImportHistoryLabel,
    normalizeImportQuality,
    normalizeImportHistory,
    shouldWarnBeforeActivation,
} from '../utils/importQuality';
import {
    applyQuestionOptionLayout,
    getQuestionOptionLayout,
    getQuestionOptionLayoutLabel,
    QUESTION_OPTION_LAYOUT_OPTIONS,
    stripOptionLayoutHints,
} from '../utils/questionLayout';
import {
    buildDeletePrivateBankOperations,
    buildDeleteSystemBankOperations,
    buildSyncExamToPrivateBankOperations,
    commitWriteOperations,
    deletePrivateBankItem,
    publishExamToSystemBank,
    removeExamFromSystemBank,
    upsertPrivateBankItem,
} from '../utils/bank';
import { getAIQuestionAssistantStatus, QUESTION_AI_ACTIONS, requestQuestionAIDraft } from '../utils/aiAuthoring';
import { DEFAULT_TAXONOMY, loadTaxonomyConfig, mergeTaxonomyOptions } from '../utils/taxonomy';
import { getTeacherCatalogAccess, getTeacherCatalogAccessSummary } from '../utils/teacherCatalogAccess';
import {
    EXAM_DELIVERY_SOURCE_BANK,
    EXAM_DELIVERY_VARIANT_PER_ATTEMPT,
    computeBankBlueprintQuestionCount,
    getBankScopeLabel,
    getChapterLabel,
    getDifficultyLabel,
    getExamDeliveryModeMeta,
    getExamQuestionCount,
    isDynamicBankDelivery,
    normalizeExamDeliveryConfig,
} from '../utils/examDelivery';

const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Tự luận ngắn', essay: 'Tự luận' };
const TYPE_COLORS = {
    mcq: { bg: '#dbeafe', color: '#1e40af' },
    tf: { bg: '#fef3c7', color: '#92400e' },
    short_answer: { bg: '#d1fae5', color: '#065f46' },
    essay: { bg: '#f3e8ff', color: '#6b21a8' },
};
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }
function extractImgTags(html) { return html ? (html.match(/<img [^>]*>/g) || []) : []; }
function toDateValue(value) {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    return value instanceof Date ? value : new Date(value);
}
function richHtml(text, preservedImgs) {
    let html = (text || '');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/^• (.+)$/gm, '<li style="list-style:disc;margin-left:20px">$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="list-style:decimal;margin-left:20px">$1</li>');
    html = html.replace(/\n/g, '<br>');
    if (preservedImgs?.length > 0) html += preservedImgs.join('');
    return html;
}

const CONICGV_URL = import.meta.env.VITE_CONICGV_URL || 'https://conicgv.web.app';

// ------- Item Analysis sub-component -------
function ItemAnalysisSection({ examId, questions }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    const load = async () => {
        if (data) { setOpen(true); return; }
        setLoading(true);
        try {
            const { getDocs: _getDocs, collection: _col, query: _query, where: _where } = await import('firebase/firestore');
            const sessSnap = await _getDocs(_query(_col(db, 'sessions'), _where('examId', '==', examId)));
            const sessions = sessSnap.docs.map(d => d.data());
            if (sessions.length === 0) { setData([]); setOpen(true); return; }

            const totals = {};
            const correct = {};
            questions.forEach(q => { totals[q.id] = 0; correct[q.id] = 0; });

            sessions.forEach(s => {
                (s.answers || []).forEach(a => {
                    if (totals[a.questionId] !== undefined) {
                        totals[a.questionId]++;
                        if (a.isCorrect) correct[a.questionId]++;
                    }
                });
            });

            const result = questions.map(q => ({
                id: q.id,
                number: q.number,
                type: q.type,
                content_text: q.content_text,
                total: totals[q.id] || 0,
                correctCount: correct[q.id] || 0,
                pct: totals[q.id] ? Math.round((correct[q.id] / totals[q.id]) * 100) : null,
            }));
            setData(result);
            setOpen(true);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="item-analysis-wrap" style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? 16 : 0 }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                    <i className="bi bi-graph-up"></i> Phân tích câu hỏi (Item Analysis)
                </h3>
                <button className="btn btn-outline btn-sm" onClick={open ? () => setOpen(false) : load} disabled={loading}>
                    {loading ? 'Đang tải...' : open ? <><i className="bi bi-chevron-up"></i> Thu gọn</> : <><i className="bi bi-bar-chart-fill"></i> Xem phân tích</>}
                </button>
            </div>
            {open && data !== null && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {data.length === 0 ? (
                        <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>Chưa có bài thi nào để phân tích.</div>
                    ) : (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Câu</th>
                                        <th>Nội dung</th>
                                        <th>Loại</th>
                                        <th>Lượt trả lời</th>
                                        <th>Tỉ lệ đúng</th>
                                        <th>Phân tích</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.map(q => {
                                        const diff = q.pct === null ? null : q.pct >= 70 ? 'easy' : q.pct >= 40 ? 'medium' : 'hard';
                                        const diffLabel = { easy: 'Dễ', medium: 'TB', hard: 'Khó' };
                                        const diffColor = { easy: '#10b981', medium: '#f59e0b', hard: '#ef4444' };
                                        return (
                                            <tr key={q.id}>
                                                <td><strong>{q.number || '-'}</strong></td>
                                                <td style={{ maxWidth: 220, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '0.85rem' }}>
                                                    {(q.content_text || '').slice(0, 60)}
                                                </td>
                                                <td><span className="stat-badge muted" style={{ fontSize: '0.7rem' }}>{TYPE_LABELS[q.type] || q.type}</span></td>
                                                <td style={{ textAlign: 'center' }}>{q.total}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {q.pct === null ? '—' : <strong style={{ color: diffColor[diff] }}>{q.pct}%</strong>}
                                                </td>
                                                <td>
                                                    {q.pct !== null && (
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div style={{ flex: 1, background: '#e2e8f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                                                                <div style={{ width: `${q.pct}%`, background: diffColor[diff], height: '100%', borderRadius: 4, transition: 'width 0.4s' }} />
                                                            </div>
                                                            <span className="stat-badge" style={{ fontSize: '0.65rem', background: diffColor[diff] + '20', color: diffColor[diff] }}>{diffLabel[diff]}</span>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </motion.div>
            )}
        </div>
    );
}

export default function ExamDetailPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({});
    const [loading, setLoading] = useState(true);
    const [editingQ, setEditingQ] = useState(-1);
    const [savingQ, setSavingQ] = useState(false);
    const [mathTarget, setMathTarget] = useState(null);
    const [mathLatex, setMathLatex] = useState('');
    const [mathPaletteGroup, setMathPaletteGroup] = useState(0);
    const [mathWrapMode, setMathWrapMode] = useState(DEFAULT_MATH_WRAP);
    const fieldRefs = useRef({});
    const imgInputRef = useRef(null);
    const [imgTarget, setImgTarget] = useState(null);
    const [sharingLibrary, setSharingLibrary] = useState(false);
    const [syncingSystemBank, setSyncingSystemBank] = useState(false);
    const [savingSectionKey, setSavingSectionKey] = useState(null);
    const [taxonomy, setTaxonomy] = useState(DEFAULT_TAXONOMY);
    const [aiAction, setAiAction] = useState('improve');
    const [aiBrief, setAiBrief] = useState('');
    const [aiDraft, setAiDraft] = useState(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiLastRun, setAiLastRun] = useState(null);
    const isAdminView = userProfile?.role === 'admin';
    const canSyncPrivateBank = exam?.teacherId === user.uid && exam?.bankSyncEnabled !== false;
    const deliveryConfig = useMemo(() => normalizeExamDeliveryConfig(exam?.deliveryConfig, {
        subject: exam?.subject || '',
        grade: exam?.grade || '',
    }, { includeBankDefaults: false }), [exam?.deliveryConfig, exam?.grade, exam?.subject]);
    const bankDeliveryModeMeta = useMemo(() => getExamDeliveryModeMeta(exam?.deliveryConfig), [exam?.deliveryConfig]);
    const dynamicBankExam = useMemo(() => isDynamicBankDelivery(exam?.deliveryConfig), [exam?.deliveryConfig]);
    const displayQuestionCount = useMemo(() => getExamQuestionCount(exam, questions), [exam, questions]);
    const importQuality = useMemo(() => {
        if (dynamicBankExam) {
            return normalizeImportQuality(exam?.importQuality, exam?.sourceFormat || 'bank');
        }

        return buildImportQualityReport({
            questions,
            warningCount: exam?.importQuality?.warningCount || 0,
            warningSamples: exam?.importQuality?.warningSamples || [],
            sourceFormat: exam?.sourceFormat || 'manual',
            imageCount: exam?.assetSummary?.imageCount || 0,
            teacherReviewed: exam?.importQuality?.teacherReviewed,
            teacherReviewedAt: exam?.importQuality?.teacherReviewedAt || null,
            teacherReviewedBy: exam?.importQuality?.teacherReviewedBy || null,
            teacherReviewedName: exam?.importQuality?.teacherReviewedName || null,
        });
    }, [dynamicBankExam, exam?.assetSummary?.imageCount, exam?.importQuality, exam?.sourceFormat, questions]);
    const importQualityBadge = getImportQualityBadge(importQuality, exam?.sourceFormat || 'manual');
    const importHistory = useMemo(() => normalizeImportHistory(exam?.importHistory), [exam?.importHistory]);
    const aiAssistantStatus = getAIQuestionAssistantStatus(user?.uid);
    const sectionGroups = useMemo(() => groupQuestionsBySection(questions || []), [questions]);
    const explicitSectionGroups = useMemo(() => sectionGroups.filter((group) => group.meta.explicit), [sectionGroups]);
    const activeEditingQuestion = editingQ >= 0 ? questions[editingQ] : null;

    const buildDraftImportQuality = useCallback((questionList, reviewMetadata = {}) => buildImportQualityReport({
        questions: questionList,
        warningCount: exam?.importQuality?.warningCount || 0,
        warningSamples: exam?.importQuality?.warningSamples || [],
        sourceFormat: exam?.sourceFormat || 'manual',
        imageCount: exam?.assetSummary?.imageCount || 0,
        ...reviewMetadata,
    }), [exam?.assetSummary?.imageCount, exam?.importQuality, exam?.sourceFormat]);
    const buildDraftAssetState = useCallback((questionList) => {
        const assetRefs = buildExamAssetRefs({ questions: questionList, existingAssetRefs: exam?.assetRefs || [] });
        return {
            assetRefs,
            assetSummary: summarizeExamAssets(assetRefs, exam?.assetSummary),
        };
    }, [exam?.assetRefs, exam?.assetSummary]);
    const appendImportEvent = useCallback((kind, note, report, at = Timestamp.now()) => {
        return appendImportHistoryEntry(exam?.importHistory, buildImportHistoryEntry({
            kind,
            actorId: user.uid,
            actorName: userProfile?.displayName || user.displayName || user.email,
            actorRole: userProfile?.role || 'teacher',
            at,
            note,
            report,
            sourceFormat: exam?.sourceFormat || 'manual',
        }));
    }, [exam?.importHistory, exam?.sourceFormat, user.uid, user.displayName, user.email, userProfile?.displayName, userProfile?.role]);

    const updateSectionGroupSettings = useCallback((groupKey, patch = {}) => {
        setQuestions((previous) => previous.map((question, index) => {
            if (getQuestionSectionKey(question, index, previous) !== groupKey) return question;

            const nextQuestion = {
                ...question,
                sectionShuffleQuestions: patch.sectionShuffleQuestions ?? question.sectionShuffleQuestions ?? true,
                sectionShuffleChoices: patch.sectionShuffleChoices ?? question.sectionShuffleChoices ?? (question.type !== 'essay'),
                sectionFixedPosition: patch.sectionFixedPosition ?? question.sectionFixedPosition ?? false,
                sectionQuestionLimit: patch.sectionQuestionLimit === '' || patch.sectionQuestionLimit == null
                    ? null
                    : Math.max(0, Number(patch.sectionQuestionLimit) || 0),
            };

            return {
                ...nextQuestion,
                sectionTag: nextQuestion.sectionTag ? buildSectionTag(nextQuestion) : null,
                sectionTitle: nextQuestion.sectionTitle || getSectionDisplayTitle(nextQuestion),
            };
        }));
    }, []);

    const saveSectionGroupSettings = useCallback(async (groupKey) => {
        const sectionEntries = questions
            .map((question, index) => ({ question, index }))
            .filter(({ question, index }) => getQuestionSectionKey(question, index, questions) === groupKey && question.id);

        if (!sectionEntries.length) return;

        const sectionTitle = getSectionDisplayTitle(sectionEntries[0].question);
        const nextImportQuality = buildDraftImportQuality(questions);
        const nextImportHistory = appendImportEvent('settings_updated', `Cập nhật cấu hình phần ${sectionTitle}.`, nextImportQuality);

        setSavingSectionKey(groupKey);
        try {
            const batch = writeBatch(db);
            sectionEntries.forEach(({ question }) => {
                batch.update(doc(db, 'exams', examId, 'questions', question.id), {
                    sectionTag: question.sectionTag || null,
                    sectionTitle: question.sectionTitle || null,
                    sectionShuffleQuestions: question.sectionShuffleQuestions ?? null,
                    sectionShuffleChoices: question.sectionShuffleChoices ?? null,
                    sectionFixedPosition: question.sectionFixedPosition ?? null,
                    sectionQuestionLimit: question.sectionQuestionLimit ?? null,
                });
            });
            batch.update(doc(db, 'exams', examId), {
                importQuality: nextImportQuality,
                importHistory: nextImportHistory,
            });
            await batch.commit();

            if (canSyncPrivateBank) {
                await Promise.all(sectionEntries.map(({ question }) => upsertPrivateBankItem({
                    ownerId: exam.teacherId,
                    ownerName: exam.teacherName || userProfile?.displayName || user.displayName || user.email,
                    exam: {
                        ...exam,
                        id: examId,
                        subject: form.subject || exam.subject || null,
                        grade: form.grade || exam.grade || null,
                        title: form.title || exam.title,
                    },
                    question,
                    actorId: user.uid,
                    actorName: userProfile?.displayName || user.displayName || user.email,
                })));
            }

            setExam((previous) => ({
                ...previous,
                importQuality: nextImportQuality,
                importHistory: nextImportHistory,
            }));
            Swal.fire({ icon: 'success', title: `Đã lưu cấu hình ${sectionTitle}`, timer: 1200, showConfirmButton: false });
        } catch (error) {
            console.error(error);
            Swal.fire('Lỗi', error.message, 'error');
        } finally {
            setSavingSectionKey(null);
        }
    }, [appendImportEvent, buildDraftImportQuality, canSyncPrivateBank, exam, examId, form.grade, form.subject, form.title, questions, user.uid, user.displayName, user.email, userProfile?.displayName]);

    useEffect(() => {
        let active = true;
        loadTaxonomyConfig()
            .then((config) => {
                if (active) setTaxonomy(config);
            })
            .catch((error) => console.error('load taxonomy failed', error));

        return () => {
            active = false;
        };
    }, []);

    const catalogAccess = useMemo(() => getTeacherCatalogAccess(userProfile, taxonomy), [taxonomy, userProfile]);
    const catalogAccessSummary = useMemo(() => getTeacherCatalogAccessSummary(userProfile, taxonomy), [taxonomy, userProfile]);
    const subjectOptions = useMemo(() => mergeTaxonomyOptions(catalogAccess.allowedSubjects, form.subject), [catalogAccess.allowedSubjects, form.subject]);
    const gradeOptions = useMemo(() => mergeTaxonomyOptions(catalogAccess.allowedGrades, form.grade), [catalogAccess.allowedGrades, form.grade]);

    const loadData = useCallback(async () => {
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) { navigate('/teacher'); return; }
        const examData = { id: examDoc.id, ...examDoc.data() };
        if (userProfile?.role !== 'admin' && examData.teacherId !== user.uid) {
            Swal.fire('Không có quyền', 'Bạn không được xem đề thi này.', 'error');
            navigate('/teacher');
            return;
        }
        setExam(examData);
        setForm({
            title: examData.title || '', subject: examData.subject || '', grade: examData.grade || '',
            duration: examData.duration || 45, maxAttempts: examData.maxAttempts || 1,
            shuffleQuestions: examData.shuffleQuestions ?? true, shuffleChoices: examData.shuffleChoices ?? true,
            showResult: examData.showResult ?? true,
            examType: examData.examType || '',
            scoreScale: examData.scoreScale || '',
            tfScoring: examData.tfScoring || DEFAULT_TF_SCORING,
            questionScoring: normalizeQuestionScoring(examData.questionScoring || DEFAULT_QUESTION_SCORING),
            antiCheat: normalizeAntiCheatSettings(examData.antiCheat || DEFAULT_ANTI_CHEAT),
            gamification: normalizeGamificationSettings(examData.gamification || DEFAULT_GAMIFICATION),
        });
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        setQuestions(
            qSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .map((question) => applyQuestionOptionLayout(question, getQuestionOptionLayout(question)))
                .sort((a, b) => (a.order || a.number || 0) - (b.order || b.number || 0))
        );
        setLoading(false);
    }, [examId, navigate, user?.uid, userProfile?.role]);

    useEffect(() => {
        if (user && userProfile) loadData();
    }, [loadData, user, userProfile]);

    useEffect(() => {
        setAiAction(activeEditingQuestion?.content_text ? 'improve' : 'generate');
        setAiBrief('');
        setAiDraft(null);
        setAiLastRun(null);
    }, [activeEditingQuestion?.content_text, editingQ, user?.uid]);

    const handleSave = async () => {
        const trimmedTitle = form.title.trim();
        if (!isAdminView && !catalogAccess.hasFullCatalogAccess) {
            const subjectAllowed = !form.subject || subjectOptions.includes(form.subject);
            const gradeAllowed = !form.grade || gradeOptions.includes(form.grade);
            if (!subjectAllowed || !gradeAllowed) {
                Swal.fire('Ngoài gói đã cấp', 'Môn hoặc khối của đề không nằm trong gói truy cập hiện tại của bạn.', 'warning');
                return;
            }
        }
        const nextExam = {
            ...exam,
            title: trimmedTitle,
            subject: form.subject || null,
            grade: form.grade || null,
            duration: Number(form.duration),
            maxAttempts: Number(form.maxAttempts),
            shuffleQuestions: form.shuffleQuestions,
            shuffleChoices: form.shuffleChoices,
            showResult: form.showResult,
            examType: form.examType || null,
            scoreScale: form.scoreScale || null,
            tfScoring: normalizeTfScoring(form.tfScoring || DEFAULT_TF_SCORING),
            questionScoring: normalizeQuestionScoring(form.questionScoring || DEFAULT_QUESTION_SCORING),
            antiCheat: normalizeAntiCheatSettings(form.antiCheat),
            gamification: normalizeGamificationSettings(form.gamification),
        };
        const nextExamData = { ...nextExam };
        delete nextExamData.id;
        const nextImportHistory = appendImportEvent('settings_updated', 'Cập nhật cài đặt đề và chế độ trộn.', importQuality);
        const operations = [{
            type: 'update',
            ref: doc(db, 'exams', examId),
            data: {
                ...nextExamData,
                importHistory: nextImportHistory,
                ...buildExamSearchFields({
                    title: trimmedTitle,
                    subject: form.subject,
                    grade: form.grade,
                    teacherName: exam?.teacherName,
                }),
            },
        }];
        if (canSyncPrivateBank) {
            operations.push(...buildSyncExamToPrivateBankOperations({
                ownerId: exam.teacherId,
                ownerName: exam.teacherName || userProfile?.displayName || user.displayName || user.email,
                exam: { id: examId, ...nextExam },
                questions,
                actorId: user.uid,
                actorName: userProfile?.displayName || user.displayName || user.email,
            }));
        }
        await commitWriteOperations(operations);
        setExam(prev => ({ ...prev, ...nextExam, importHistory: nextImportHistory }));
        setEditing(false);
        Swal.fire({ icon: 'success', title: 'Đã lưu!', timer: 1200, showConfirmButton: false });
    };

    const toggleStatus = async () => {
        const newStatus = exam.status === 'active' ? 'draft' : 'active';

        if (newStatus === 'active') {
            if (dynamicBankExam) {
                const hasRows = Boolean(deliveryConfig.bankPolicy?.rows?.length);
                const plannedCount = computeBankBlueprintQuestionCount(deliveryConfig) || Number(exam?.questionCount) || 0;

                if (!hasRows || plannedCount <= 0) {
                    Swal.fire('Thiếu ma trận phát đề', 'Đề này đang ở chế độ phát từ ngân hàng nhưng chưa có ma trận câu hỏi hợp lệ.', 'warning');
                    return;
                }
            }

            if (blocksExamActivation(importQuality, exam?.sourceFormat || 'manual')) {
                Swal.fire('Đề chưa an toàn để mở', `Khiên nhập đề đang chặn phát hành vì còn ${importQuality.invalidQuestions} câu lỗi cấu trúc. Hãy sửa các câu đó trước khi mở cho học sinh.`, 'warning');
                return;
            }

            if (shouldWarnBeforeActivation(importQuality, exam?.sourceFormat || 'manual')) {
                const confirmation = await Swal.fire({
                    title: 'Đề chưa được giáo viên xác nhận',
                    html: `Hệ thống khuyến nghị bạn rà soát đề này một lần nữa trước khi mở. Tóm tắt hiện tại: <b>${formatImportQualitySummary(importQuality, exam?.sourceFormat || 'manual')}</b>.`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Vẫn mở đề',
                    cancelButtonText: 'Quay lại kiểm tra',
                    confirmButtonColor: '#f59e0b',
                });
                if (!confirmation.isConfirmed) return;
            }
        }

        await updateDoc(doc(db, 'exams', examId), { status: newStatus, importQuality });
        setExam(prev => ({ ...prev, status: newStatus }));
    };

    const markImportReviewed = async () => {
        const reviewedAt = Timestamp.now();
        const reviewedReport = buildDraftImportQuality(questions, {
            teacherReviewed: true,
            teacherReviewedAt: reviewedAt,
            teacherReviewedBy: user.uid,
            teacherReviewedName: userProfile?.displayName || user.displayName || user.email,
        });
        const nextImportHistory = appendImportEvent('reviewed', 'Giáo viên đã rà soát và xác nhận có thể phát hành.', reviewedReport, reviewedAt);

        await updateDoc(doc(db, 'exams', examId), { importQuality: reviewedReport, importHistory: nextImportHistory });
        setExam(prev => ({ ...prev, importQuality: reviewedReport, importHistory: nextImportHistory }));
        Swal.fire({ icon: 'success', title: 'Đã đánh dấu đã kiểm', text: 'Từ bây giờ hệ thống sẽ xem đề này đã được giáo viên rà soát.', timer: 1600, showConfirmButton: false });
    };

    const toggleSharedLibrary = async () => {
        if (!isAdminView) return;

        const actionLabel = exam.sharedPublished ? 'gỡ khỏi thư viện' : 'đưa vào thư viện';
        const result = await Swal.fire({
            title: `${exam.sharedPublished ? 'Gỡ đề khỏi thư viện' : 'Xuất bản vào thư viện'}?`,
            html: exam.sharedPublished
                ? 'Giáo viên đã nhập trước đó vẫn giữ bản sao của họ, nhưng đề này sẽ không còn hiện trong thư viện dùng chung.'
                : 'Đề sẽ xuất hiện trong thư viện dùng chung để giáo viên nhập thành bản nháp riêng.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: exam.sharedPublished ? 'Gỡ khỏi thư viện' : 'Xuất bản',
            cancelButtonText: 'Hủy',
            confirmButtonColor: exam.sharedPublished ? '#f59e0b' : '#2563eb',
        });
        if (!result.isConfirmed) return;

        setSharingLibrary(true);
        try {
            const actor = {
                uid: user.uid,
                displayName: userProfile?.displayName || user.displayName || user.email,
                email: user.email,
            };

            if (exam.sharedPublished) {
                await unpublishSharedExam({ exam, user: actor });
                setExam(prev => ({ ...prev, sharedPublished: false, sharedExamId: null, sharedPublishedAt: null }));
            } else {
                const sharedExamId = await publishExamToSharedLibrary({ exam, questions, user: actor });
                setExam(prev => ({ ...prev, sharedPublished: true, sharedExamId, sharedPublishedAt: new Date() }));
            }

            Swal.fire({
                icon: 'success',
                title: `Đã ${actionLabel}`,
                timer: 1500,
                showConfirmButton: false,
            });
        } catch (error) {
            console.error('toggle shared library failed', error);
            Swal.fire('Không thể cập nhật thư viện', error.message, 'error');
        } finally {
            setSharingLibrary(false);
        }
    };

    const toggleSystemBank = async () => {
        if (!isAdminView) return;

        const actionLabel = exam.systemBankPublished ? 'gỡ khỏi ngân hàng hệ thống' : 'đưa vào ngân hàng hệ thống';
        const result = await Swal.fire({
            title: exam.systemBankPublished ? 'Gỡ khỏi ngân hàng hệ thống?' : 'Đưa vào ngân hàng hệ thống?',
            html: exam.systemBankPublished
                ? 'Các câu hỏi sẽ biến mất khỏi ngân hàng hệ thống của giáo viên, nhưng đề gốc vẫn được giữ nguyên.'
                : 'Ngân hàng hệ thống sẽ nhận bản snapshot hiện tại của toàn bộ câu hỏi trong đề này để giáo viên tái sử dụng.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: exam.systemBankPublished ? 'Gỡ khỏi ngân hàng' : 'Xuất bản snapshot',
            cancelButtonText: 'Hủy',
            confirmButtonColor: exam.systemBankPublished ? '#f59e0b' : '#0f766e',
        });
        if (!result.isConfirmed) return;

        setSyncingSystemBank(true);
        try {
            const actorName = userProfile?.displayName || user.displayName || user.email;
            if (exam.systemBankPublished) {
                await removeExamFromSystemBank({ examId, questionIds: questions.map((question) => question.id) });
                await updateDoc(doc(db, 'exams', examId), {
                    systemBankPublished: false,
                    systemBankPublishedAt: null,
                    systemBankPublishedBy: null,
                });
                setExam((prev) => ({ ...prev, systemBankPublished: false, systemBankPublishedAt: null, systemBankPublishedBy: null }));
            } else {
                await publishExamToSystemBank({
                    exam: { ...exam, id: examId },
                    questions,
                    actorId: user.uid,
                    actorName,
                });
                const publishedAt = Timestamp.now();
                await updateDoc(doc(db, 'exams', examId), {
                    systemBankPublished: true,
                    systemBankPublishedAt: publishedAt,
                    systemBankPublishedBy: user.uid,
                });
                setExam((prev) => ({ ...prev, systemBankPublished: true, systemBankPublishedAt: publishedAt, systemBankPublishedBy: user.uid }));
            }

            await logAuditEvent({
                actorId: user.uid,
                actorRole: 'admin',
                actorName,
                action: exam.systemBankPublished ? 'bank.system_unpublish_exam' : 'bank.system_publish_exam',
                targetType: 'exam',
                targetId: examId,
                teacherId: exam.teacherId,
                examId,
                metadata: {
                    examTitle: exam.title,
                    questionCount: questions.length,
                },
            }).catch((error) => console.error('audit log failed', error));

            Swal.fire({
                icon: 'success',
                title: `Đã ${actionLabel}`,
                timer: 1500,
                showConfirmButton: false,
            });
        } catch (error) {
            console.error('toggle system bank failed', error);
            Swal.fire('Không thể cập nhật ngân hàng hệ thống', error.message, 'error');
        } finally {
            setSyncingSystemBank(false);
        }
    };

    const deleteExam = async () => {
        const result = await Swal.fire({
            title: 'Xóa đề thi?', html: `<b>${exam.title}</b> và tất cả câu hỏi sẽ bị xóa vĩnh viễn.`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;
        const operations = [
            ...questions.map((question) => ({
                type: 'delete',
                ref: doc(db, 'exams', examId, 'questions', question.id),
            })),
            { type: 'delete', ref: doc(db, 'exams', examId) },
        ];
        if (canSyncPrivateBank) {
            operations.push(...buildDeletePrivateBankOperations({
                ownerId: exam.teacherId,
                examId,
                questionIds: questions.map((question) => question.id),
            }));
        }
        if (exam.systemBankPublished) {
            operations.push(...buildDeleteSystemBankOperations({
                examId,
                questionIds: questions.map((question) => question.id),
            }));
        }
        await commitWriteOperations(operations);
        Swal.fire({ icon: 'success', title: 'Đã xóa!', timer: 1200, showConfirmButton: false });
        navigate('/teacher');
    };

    const deleteQuestion = async (qId) => {
        const result = await Swal.fire({
            title: 'Xóa câu hỏi?', icon: 'warning', showCancelButton: true,
            confirmButtonColor: '#ef4444', confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;
        await deleteDoc(doc(db, 'exams', examId, 'questions', qId));
        if (canSyncPrivateBank) {
            await deletePrivateBankItem({ ownerId: exam.teacherId, examId, questionId: qId });
        }
        const updated = questions.filter(q => q.id !== qId);
        setQuestions(updated);
        if (editingQ >= updated.length) setEditingQ(updated.length - 1);
        const nextImportQuality = buildDraftImportQuality(updated);
        const nextAssetState = buildDraftAssetState(updated);
        const nextImportHistory = appendImportEvent('question_deleted', `Xóa câu ${questions.findIndex((question) => question.id === qId) + 1}.`, nextImportQuality);
        await updateDoc(doc(db, 'exams', examId), {
            questionCount: updated.length,
            importQuality: nextImportQuality,
            importHistory: nextImportHistory,
            assetRefs: nextAssetState.assetRefs,
            assetSummary: nextAssetState.assetSummary,
        });
        setExam(prev => ({
            ...prev,
            questionCount: updated.length,
            importQuality: nextImportQuality,
            importHistory: nextImportHistory,
            assetRefs: nextAssetState.assetRefs,
            assetSummary: nextAssetState.assetSummary,
        }));
    };

    /* ═══ Rescore all sessions ═══ */
    const rescoreAllSessions = async () => {
        const confirm = await Swal.fire({
            title: 'Chấm lại tất cả?',
            html: 'Hệ thống sẽ tính lại điểm tất cả bài thi dựa trên đáp án hiện tại.',
            icon: 'question', showCancelButton: true, confirmButtonText: 'Chấm lại', cancelButtonText: 'Hủy',
        });
        if (!confirm.isConfirmed) return;

        Swal.fire({ title: 'Đang chấm lại...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const sessionQ = query(collection(db, 'sessions'), where('examId', '==', examId));
            const sessionSnap = await getDocs(sessionQ);
            if (sessionSnap.empty) { Swal.fire({ icon: 'info', title: 'Chưa có bài thi nào', timer: 1500, showConfirmButton: false }); return; }

            // Build correct answer map from current questions
            const correctMap = {};
            questions.forEach(q => {
                if (q.type === 'mcq') {
                    const idx = (q.choices || []).findIndex(c => c.letter === q.correct_answer);
                    correctMap[q.id] = idx;
                } else if (q.type === 'tf') {
                    correctMap[q.id] = q.correct_answer; // e.g. "DDSS"
                } else if (q.type === 'short_answer') {
                    correctMap[q.id] = (q.correct_answer || '').trim().toLowerCase();
                }
            });

            const effectiveQuestionScoring = normalizeQuestionScoring(exam?.questionScoring || form.questionScoring || DEFAULT_QUESTION_SCORING);
            const effectiveTfScoring = normalizeTfScoring(exam?.tfScoring || form.tfScoring || DEFAULT_TF_SCORING);
            const pointMap = {};
            questions.forEach(q => { pointMap[q.id] = getQuestionMaxPoints(q, effectiveQuestionScoring, effectiveTfScoring); });
            const autoTotalPoints = questions.reduce((sum, q) => sum + (q.type === 'essay' ? 0 : pointMap[q.id]), 0);
            const manualTotalPoints = questions.reduce((sum, q) => sum + (q.type === 'essay' ? pointMap[q.id] : 0), 0);
            const displayTotal = autoTotalPoints > 0 ? autoTotalPoints : manualTotalPoints;

            let updated = 0;
            const batch = writeBatch(db);
            sessionSnap.docs.forEach(sessionDoc => {
                const data = sessionDoc.data();
                const answers = data.answers || [];
                let newScore = 0;
                const newAnswers = answers.map(a => {
                    const q = questions.find(q => q.id === a.questionId);
                    if (!q) return { ...a, isCorrect: false };
                    let isCorrect = false;
                    let nextCorrectIdx = correctMap[q.id];
                    let nextCorrectOriginLetter = a.correctOriginLetter || null;
                    if (q.type === 'mcq') {
                        const selectedOriginLetter = a.selectedOriginLetter
                            || (typeof a.selected === 'number' ? a.choiceSnapshot?.[a.selected]?.originLetter || a.choiceSnapshot?.[a.selected]?.letter : null);
                        nextCorrectOriginLetter = q.correct_answer;
                        if (Array.isArray(a.choiceSnapshot)) {
                            const snapshotCorrectIdx = a.choiceSnapshot.findIndex((choice) => (choice.originLetter || choice.letter) === q.correct_answer);
                            if (snapshotCorrectIdx >= 0) nextCorrectIdx = snapshotCorrectIdx;
                        }
                        isCorrect = selectedOriginLetter === q.correct_answer;
                    } else if (q.type === 'tf') {
                        const tfResult = evaluateTfAnswer(q, a.tfItemAnswers || [], effectiveTfScoring, effectiveQuestionScoring);
                        isCorrect = tfResult.isCorrect;
                        newScore += tfResult.earnedPoints;
                        return { ...a, isCorrect, tfCorrectItems: tfResult.correctItems, earnedPoints: tfResult.earnedPoints, maxPoints: tfResult.maxPoints };
                    } else if (q.type === 'short_answer') {
                        isCorrect = normalizeTextAnswer(a.textAnswer).toLowerCase() === correctMap[q.id];
                    } else if (q.type === 'essay') {
                        return { ...a, isCorrect: null, earnedPoints: a.earnedPoints ?? 0, maxPoints: pointMap[q.id], manualReviewPending: true };
                    }
                    if (isCorrect) newScore += pointMap[q.id];
                    return { ...a, isCorrect, earnedPoints: isCorrect ? pointMap[q.id] : 0, maxPoints: pointMap[q.id], correctIdx: nextCorrectIdx, correctOriginLetter: nextCorrectOriginLetter };
                });
                batch.update(sessionDoc.ref, {
                    score: newScore,
                    total: displayTotal,
                    autoGradedScore: newScore,
                    autoGradedTotal: autoTotalPoints,
                    totalPoints: autoTotalPoints + manualTotalPoints,
                    manualTotalPoints,
                    manualReviewPending: manualTotalPoints > 0,
                    answers: newAnswers,
                });
                updated++;
            });
            await batch.commit();
            await logAuditEvent({
                actorId: user.uid,
                actorRole: userProfile?.role,
                actorName: userProfile?.displayName || user.email,
                action: 'exam.rescore_sessions',
                targetType: 'exam',
                targetId: examId,
                teacherId: exam?.teacherId || user.uid,
                examId,
                metadata: {
                    examTitle: exam?.title || null,
                    updatedSessions: updated,
                    totalPoints: autoTotalPoints + manualTotalPoints,
                },
            }).catch((error) => console.error('audit log failed', error));
            Swal.fire({ icon: 'success', title: `Đã chấm lại ${updated} bài thi!`, timer: 2000, showConfirmButton: false });
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi', err.message, 'error');
        }
    };

    /* ═══ Question editing helpers ═══ */
    const eq = editingQ >= 0 ? questions[editingQ] : null;

    const updateQ = useCallback((idx, updates) => {
        setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q));
    }, []);

    const updateChoice = useCallback((qIdx, cIdx, updates) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const choices = q.choices.map((c, j) => j === cIdx ? { ...c, ...updates } : c);
            return { ...q, choices };
        }));
    }, []);

    const setCorrectAnswer = useCallback((qIdx, answer) => {
        setQuestions(prev => prev.map((q, i) => i === qIdx ? { ...q, correct_answer: answer } : q));
    }, []);

    const addChoice = useCallback((qIdx) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const nextLetter = LETTERS[q.choices.length] || String(q.choices.length + 1);
            return { ...q, choices: [...q.choices, { letter: nextLetter, text: '', html: '' }] };
        }));
    }, []);

    const removeChoice = useCallback((qIdx, cIdx) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const choices = q.choices.filter((_, j) => j !== cIdx);
            let correct = q.correct_answer;
            if (q.type === 'mcq' && correct === q.choices[cIdx]?.letter) correct = null;
            return { ...q, choices, correct_answer: correct };
        }));
    }, []);

    const handleQuestionTypeChange = useCallback((qIdx, newType) => {
        setQuestions((prev) => prev.map((question, questionIndex) => {
            if (questionIndex !== qIdx) return question;
            return applyQuestionOptionLayout({
                ...question,
                ...buildQuestionTypePatch(
                    question,
                    newType,
                    form.questionScoring || exam?.questionScoring || DEFAULT_QUESTION_SCORING,
                    form.tfScoring || exam?.tfScoring || DEFAULT_TF_SCORING,
                ),
            }, newType === 'mcq' ? getQuestionOptionLayout(question) : null);
        }));
    }, [exam?.questionScoring, exam?.tfScoring, form.questionScoring, form.tfScoring]);

    const setQuestionOptionLayout = useCallback((qIdx, nextLayout) => {
        setQuestions((prev) => prev.map((question, questionIndex) => {
            if (questionIndex !== qIdx) return question;
            return applyQuestionOptionLayout(question, nextLayout);
        }));
    }, []);

    const wrapSelection = useCallback((fieldKey, before, after) => {
        const ta = fieldRefs.current[fieldKey];
        if (!ta) return;
        const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
        const selected = val.slice(start, end);
        const newVal = val.slice(0, start) + before + selected + after + val.slice(end);
        if (fieldKey === 'q-content') updateQ(editingQ, { content_text: newVal });
        else if (fieldKey === 'q-expl') updateQ(editingQ, { explanation: newVal });
        else if (fieldKey.startsWith('q-c')) updateChoice(editingQ, parseInt(fieldKey.slice(3)), { text: newVal });
        setTimeout(() => { ta.focus(); ta.selectionStart = start + before.length; ta.selectionEnd = start + before.length + selected.length; }, 10);
    }, [editingQ, updateQ, updateChoice]);

    const insertAtLineStart = useCallback((fieldKey, prefix) => {
        const ta = fieldRefs.current[fieldKey];
        if (!ta) return;
        const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = val.indexOf('\n', end); const actualEnd = lineEnd === -1 ? val.length : lineEnd;
        const lines = val.slice(lineStart, actualEnd).split('\n');
        const prefixed = lines.map((line, i) => prefix === '1. ' ? `${i+1}. ${line}` : prefix + line).join('\n');
        const newVal = val.slice(0, lineStart) + prefixed + val.slice(actualEnd);
        if (fieldKey === 'q-content') updateQ(editingQ, { content_text: newVal });
        else if (fieldKey === 'q-expl') updateQ(editingQ, { explanation: newVal });
        else if (fieldKey.startsWith('q-c')) updateChoice(editingQ, parseInt(fieldKey.slice(3)), { text: newVal });
        setTimeout(() => { ta.focus(); }, 10);
    }, [editingQ, updateQ, updateChoice]);

    const askImageInsertOptions = useCallback(async () => {
        const sizeOptionsHtml = IMAGE_SIZE_OPTIONS.map((option) => `<option value="${option.id}" ${option.id === DEFAULT_IMAGE_SIZE ? 'selected' : ''}>${option.label}</option>`).join('');
        const alignOptionsHtml = IMAGE_ALIGN_OPTIONS.map((option) => `<option value="${option.id}" ${option.id === DEFAULT_IMAGE_ALIGN ? 'selected' : ''}>${option.label}</option>`).join('');

        const result = await Swal.fire({
            title: 'Chèn ảnh',
            html: `
                <div style="display:grid;gap:12px;text-align:left">
                    <label style="display:grid;gap:6px">
                        <span style="font-size:0.85rem;font-weight:600">Kích thước</span>
                        <select id="swal-image-size" class="swal2-select" style="display:flex;width:100%;margin:0">${sizeOptionsHtml}</select>
                    </label>
                    <label style="display:grid;gap:6px">
                        <span style="font-size:0.85rem;font-weight:600">Vị trí</span>
                        <select id="swal-image-align" class="swal2-select" style="display:flex;width:100%;margin:0">${alignOptionsHtml}</select>
                    </label>
                    <small style="color:#64748b">Ảnh tải mới sẽ được nén sang WebP nếu có thể để nhẹ hơn.</small>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Chèn ảnh',
            cancelButtonText: 'Hủy',
            focusConfirm: false,
            preConfirm: () => {
                const popup = Swal.getPopup();
                return {
                    size: popup.querySelector('#swal-image-size')?.value || DEFAULT_IMAGE_SIZE,
                    align: popup.querySelector('#swal-image-align')?.value || DEFAULT_IMAGE_ALIGN,
                };
            },
        });

        return result.isConfirmed ? result.value : null;
    }, []);

    /* ═══ Image upload ═══ */
    const handleImageUpload = useCallback(async (e) => {
        const files = Array.from(e.target.files || []);
        const target = imgTarget;
        if (!files.length || editingQ < 0 || !target) return;

        const insertOptions = await askImageInsertOptions();
        if (!insertOptions) {
            setImgTarget(null);
            if (imgInputRef.current) imgInputRef.current.value = '';
            return;
        }

        const uploadedAssetRefs = [];
        for (const file of files) {
            if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) continue;
            const optimized = await optimizeImageFile(file, { fileName: file.name });
            const imgRef = ref(storage, 'exams/' + user.uid + '/' + Date.now() + '_' + getStorageSafeImageName(optimized.name));
            await uploadBytes(imgRef, optimized.blob, { contentType: optimized.mime });
            const url = await getDownloadURL(imgRef);
            uploadedAssetRefs.push({
                path: imgRef.fullPath,
                url,
                size: optimized.blob.size,
                mime: optimized.mime,
                uploadedAt: Timestamp.now(),
            });
            const imgTag = buildImageTag(url, insertOptions);
            const i = editingQ;
            if (target.field === 'content') {
                setQuestions(prev => prev.map((q, qi) => qi !== i ? q : { ...q, content_html: (q.content_html || '') + imgTag }));
            } else if (target.field === 'choice' && target.cIdx != null) {
                setQuestions(prev => prev.map((q, qi) => {
                    if (qi !== i) return q;
                    const choices = q.choices.map((c, j) => j === target.cIdx ? { ...c, html: (c.html || '') + imgTag } : c);
                    return { ...q, choices };
                }));
            } else if (target.field === 'explanation') {
                setQuestions(prev => prev.map((q, qi) => qi !== i ? q : { ...q, explanation_html: (q.explanation_html || '') + imgTag }));
            }
        }
        if (uploadedAssetRefs.length > 0) {
            const nextAssetRefs = mergeExamAssetRefs(exam?.assetRefs || [], uploadedAssetRefs);
            const nextAssetSummary = summarizeExamAssets(nextAssetRefs, exam?.assetSummary);
            await updateDoc(doc(db, 'exams', examId), { assetRefs: nextAssetRefs, assetSummary: nextAssetSummary });
            setExam(prev => ({ ...prev, assetRefs: nextAssetRefs, assetSummary: nextAssetSummary }));
        }
        setImgTarget(null);
        if (imgInputRef.current) imgInputRef.current.value = '';
    }, [askImageInsertOptions, editingQ, exam?.assetRefs, exam?.assetSummary, examId, imgTarget, user]);

    const triggerImgUpload = useCallback((field, cIdx) => {
        setImgTarget({ field, cIdx });
        setTimeout(() => imgInputRef.current?.click(), 50);
    }, []);

    /* ═══ Math ═══ */
    const openMath = (field, cIdx) => { setMathTarget({ field, cIdx }); setMathLatex(''); setMathPaletteGroup(0); setMathWrapMode(DEFAULT_MATH_WRAP); };
    const insertMathSymbol = (latex) => { setMathLatex(prev => { const ph = '\u25AB'; const idx = prev.indexOf(ph); return idx >= 0 ? prev.slice(0, idx) + latex + prev.slice(idx + 1) : prev + latex; }); };
    const confirmMath = () => {
        if (!mathTarget || editingQ < 0 || !mathLatex.trim()) return;
        const i = editingQ;
        const tex = wrapMathExpression(mathLatex, mathWrapMode);
        if (mathTarget.field === 'content') updateQ(i, { content_text: (questions[i].content_text || '') + tex });
        else if (mathTarget.field === 'choice') updateChoice(i, mathTarget.cIdx, { text: (questions[i].choices[mathTarget.cIdx]?.text || '') + tex });
        else if (mathTarget.field === 'explanation') updateQ(i, { explanation: (questions[i].explanation || '') + tex });
        setMathTarget(null); setMathLatex(''); setMathWrapMode(DEFAULT_MATH_WRAP);
    };

    /* ═══ Save single question ═══ */
    const saveQuestion = async (idx) => {
        const q = questions[idx];
        if (!q.id) return;
        setSavingQ(true);
        try {
            const preparedQuestion = applyQuestionOptionLayout(q, getQuestionOptionLayout(q));
            const content_html = richHtml(preparedQuestion.content_text, extractImgTags(preparedQuestion.content_html));
            const explanation_html = preparedQuestion.explanation ? richHtml(preparedQuestion.explanation, extractImgTags(preparedQuestion.explanation_html)) : null;
            const choices = (preparedQuestion.choices || []).map(c => ({
                letter: c.letter, text: c.text, html: richHtml(c.text, extractImgTags(c.html)),
            }));
            const resourceLinks = mergeResourceLinks(
                preparedQuestion.resourceLinks || [],
                extractResourceLinksFromHtml(content_html || '', { scope: 'question', source: 'content_html' }),
                extractResourceLinksFromHtml(explanation_html || '', { scope: 'question', source: 'explanation_html' }),
                ...choices.map((choice) => extractResourceLinksFromHtml(choice.html || '', { scope: 'question', source: 'choice_html' })),
            );
            const sectionResourceLinks = mergeResourceLinks(
                preparedQuestion.sectionResourceLinks || [],
                extractResourceLinksFromHtml(preparedQuestion.sectionContextHtml || '', { scope: 'section', source: 'section_html' }),
            );
            const nextQuestions = questions.map((item, questionIndex) => questionIndex === idx ? {
                ...preparedQuestion,
                content_html,
                explanation_html,
                choices,
                resourceLinks,
                sectionResourceLinks,
            } : item);
            const nextImportQuality = buildDraftImportQuality(nextQuestions);
            const nextAssetState = buildDraftAssetState(nextQuestions);
            const nextImportHistory = appendImportEvent('question_saved', `Cập nhật câu ${idx + 1}.`, nextImportQuality);
            await updateDoc(doc(db, 'exams', examId, 'questions', q.id), {
                content_text: preparedQuestion.content_text || '', content_html,
                choices, correct_answer: preparedQuestion.correct_answer || null,
                explanation: preparedQuestion.explanation || null, explanation_html, type: preparedQuestion.type,
                optionLayout: preparedQuestion.optionLayout,
                resourceLinks,
                sectionResourceLinks,
                points: getQuestionMaxPoints(preparedQuestion, form.questionScoring || exam?.questionScoring, form.tfScoring || exam?.tfScoring),
            });
            await updateDoc(doc(db, 'exams', examId), {
                importQuality: nextImportQuality,
                importHistory: nextImportHistory,
                assetRefs: nextAssetState.assetRefs,
                assetSummary: nextAssetState.assetSummary,
            });
            if (canSyncPrivateBank) {
                await upsertPrivateBankItem({
                    ownerId: exam.teacherId,
                    ownerName: exam.teacherName || userProfile?.displayName || user.displayName || user.email,
                    exam: {
                        ...exam,
                        id: examId,
                        subject: form.subject || exam.subject || null,
                        grade: form.grade || exam.grade || null,
                        title: form.title || exam.title,
                    },
                    question: {
                        ...nextQuestions[idx],
                        id: q.id,
                    },
                    actorId: user.uid,
                    actorName: userProfile?.displayName || user.displayName || user.email,
                });
            }
            setQuestions(nextQuestions);
            setExam(prev => ({
                ...prev,
                importQuality: nextImportQuality,
                importHistory: nextImportHistory,
                assetRefs: nextAssetState.assetRefs,
                assetSummary: nextAssetState.assetSummary,
            }));
            Swal.fire({ icon: 'success', title: 'Đã lưu câu ' + (idx + 1), timer: 800, showConfirmButton: false });
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi', err.message, 'error');
        } finally { setSavingQ(false); }
    };

    /* ═══ Add new question ═══ */
    const addQuestion = async () => {
        const newQ = {
            number: questions.length + 1, type: 'mcq', order: questions.length + 1,
            points: normalizeQuestionScoring(exam?.questionScoring || form.questionScoring || DEFAULT_QUESTION_SCORING).mcq,
            optionLayout: null,
            content_text: '', content_html: '',
            choices: [{ letter: 'A', text: '', html: '' }, { letter: 'B', text: '', html: '' }, { letter: 'C', text: '', html: '' }, { letter: 'D', text: '', html: '' }],
            correct_answer: null, explanation: null, explanation_html: null,
        };
        const docRef = await addDoc(collection(db, 'exams', examId, 'questions'), newQ);
        const nextQuestions = [...questions, { id: docRef.id, ...newQ }];
        const nextImportQuality = buildDraftImportQuality(nextQuestions);
        const nextAssetState = buildDraftAssetState(nextQuestions);
        const nextImportHistory = appendImportEvent('question_added', `Thêm câu ${questions.length + 1}.`, nextImportQuality);
        setQuestions(nextQuestions);
        await updateDoc(doc(db, 'exams', examId), {
            questionCount: questions.length + 1,
            importQuality: nextImportQuality,
            importHistory: nextImportHistory,
            assetRefs: nextAssetState.assetRefs,
            assetSummary: nextAssetState.assetSummary,
        });
        setExam(prev => ({
            ...prev,
            questionCount: questions.length + 1,
            importQuality: nextImportQuality,
            importHistory: nextImportHistory,
            assetRefs: nextAssetState.assetRefs,
            assetSummary: nextAssetState.assetSummary,
        }));
        if (canSyncPrivateBank) {
            await upsertPrivateBankItem({
                ownerId: exam.teacherId,
                ownerName: exam.teacherName || userProfile?.displayName || user.displayName || user.email,
                exam: {
                    ...exam,
                    id: examId,
                    subject: form.subject || exam.subject || null,
                    grade: form.grade || exam.grade || null,
                    title: form.title || exam.title,
                },
                question: { id: docRef.id, ...newQ },
                actorId: user.uid,
                actorName: userProfile?.displayName || user.displayName || user.email,
            });
        }
        setEditingQ(questions.length);
        Swal.fire({ icon: 'success', title: 'Đã thêm câu ' + (questions.length + 1), timer: 800, showConfirmButton: false });
    };

    const runQuestionAIAssistant = async () => {
        const activeQuestion = editingQ >= 0 ? questions[editingQ] : null;
        if (!activeQuestion || !user?.uid) return;

        setAiLoading(true);
        try {
            const result = await requestQuestionAIDraft({
                userId: user.uid,
                action: aiAction,
                brief: aiBrief,
                exam: {
                    title: form.title || exam?.title,
                    subject: form.subject || exam?.subject,
                    grade: form.grade || exam?.grade,
                    duration: form.duration || exam?.duration,
                },
                question: activeQuestion,
                preferredType: activeQuestion.type,
            });

            setAiDraft(result.draft);
            setAiLastRun(result);
            Swal.fire({
                icon: 'success',
                title: 'AI đã tạo nháp',
                text: `${result.providerLabel} · ${result.model}`,
                timer: 1400,
                showConfirmButton: false,
            });
        } catch (error) {
            console.error('question ai failed', error);
            Swal.fire('Không thể tạo nháp AI', error.message, 'error');
        } finally {
            setAiLoading(false);
        }
    };

    const applyQuestionAIDraft = useCallback((mode = 'all') => {
        if (!aiDraft || editingQ < 0) return;

        setQuestions((previous) => previous.map((question, questionIndex) => {
            if (questionIndex !== editingQ) return question;

            const nextQuestion = {
                ...question,
                explanation: aiDraft.explanation || question.explanation || null,
                explanation_html: null,
            };

            if (mode !== 'explanation') {
                nextQuestion.content_text = aiDraft.content_text || question.content_text || '';
                nextQuestion.content_html = '';

                if (question.type === 'mcq' || question.type === 'tf') {
                    nextQuestion.choices = aiDraft.choices?.length ? aiDraft.choices : question.choices;
                    nextQuestion.correct_answer = aiDraft.correct_answer || question.correct_answer || null;
                } else {
                    nextQuestion.choices = [];
                    nextQuestion.correct_answer = aiDraft.correct_answer || question.correct_answer || '';
                }
            }

            return applyQuestionOptionLayout(nextQuestion, question.type === 'mcq' ? getQuestionOptionLayout(question) : null);
        }));

        Swal.fire({
            icon: 'success',
            title: mode === 'explanation' ? 'Đã áp dụng lời giải AI' : 'Đã áp dụng nháp AI',
            timer: 1200,
            showConfirmButton: false,
        });
    }, [aiDraft, editingQ]);

    /* ═══ Print exam ═══ */
    const printExam = () => {
        const printWindow = window.open('', '_blank');
        const qHtml = questions.map((q, idx) => {
            const choicesHtml = (q.choices || []).map(c =>
                `<div class="print-choice ${q.correct_answer === c.letter ? 'correct' : ''}">
                    <strong>${c.letter}.</strong> ${c.text || ''}
                </div>`
            ).join('');
            const effectivePoints = getQuestionMaxPoints(q, exam?.questionScoring || DEFAULT_QUESTION_SCORING, exam?.tfScoring || DEFAULT_TF_SCORING);
            return `
                <div class="print-question">
                    <div class="print-q-num">Câu ${idx + 1} (${q.type === 'mcq' ? 'Trắc nghiệm' : q.type === 'tf' ? 'Đúng/Sai' : q.type === 'short_answer' ? 'Điền đáp án' : 'Tự luận'}) — ${effectivePoints} điểm</div>
                    <div class="print-q-content">${q.content_html || q.content_text || ''}</div>
                    ${choicesHtml}
                    ${q.type === 'essay' ? '<div class="print-essay-box" style="min-height:160px;border:1px dashed #bbb;border-radius:10px;margin:10px 0;padding:12px;color:#777">Bài làm tự luận...</div>' : ''}
                    ${q.explanation ? `<div class="print-expl"><em>Giải: ${q.explanation}</em></div>` : ''}
                </div>
            `;
        }).join('<hr class="print-div">');
        printWindow.document.write(`
            <!DOCTYPE html><html><head><meta charset="utf-8">
            <title>${exam.title}</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
            <style>
                body { font-family: 'Times New Roman', serif; max-width: 800px; margin: 0 auto; padding: 24px; font-size: 14px; }
                h1 { font-size: 1.4rem; text-align: center; margin-bottom: 4px; }
                .print-meta { text-align: center; color: #555; font-size: 0.9rem; margin-bottom: 24px; }
                .print-question { margin-bottom: 20px; }
                .print-q-num { font-weight: bold; font-size: 0.9rem; color: #555; margin-bottom: 4px; }
                .print-q-content { margin-bottom: 8px; font-size: 14px; }
                .print-choice { margin: 4px 0 4px 20px; }
                .print-choice.correct { font-weight: bold; text-decoration: underline; }
                .print-expl { margin-top: 6px; font-size: 0.88rem; color: #555; }
                .print-div { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
                @media print { body { padding: 0; } }
            </style></head><body>
            <h1>${exam.title}</h1>
            <div class="print-meta">${exam.subject || ''} ${exam.grade || ''} · ${questions.length} câu · ${exam.duration} phút</div>
            ${qHtml}
            </body></html>
        `);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 400);
    };

    /* Mini toolbar */
    const EditorToolbar = ({ fieldKey, onMath, onImage }) => (
        <div className="ed-toolbar">
            <button type="button" className="ed-tb-btn textual" title="In đậm" onClick={() => wrapSelection(fieldKey, '**', '**')}><span className="ed-tb-glyph">B</span></button>
            <button type="button" className="ed-tb-btn textual" title="In nghiêng" onClick={() => wrapSelection(fieldKey, '*', '*')}><span className="ed-tb-glyph italic">I</span></button>
            <button type="button" className="ed-tb-btn textual" title="Gạch chân" onClick={() => wrapSelection(fieldKey, '<u>', '</u>')}><span className="ed-tb-glyph underline">U</span></button>
            <button type="button" className="ed-tb-btn textual" title="Gạch ngang" onClick={() => wrapSelection(fieldKey, '~~', '~~')}><span className="ed-tb-glyph strike">S</span></button>
            <span className="ed-tb-sep" />
            <button type="button" className="ed-tb-btn textual compact" title="Căn giữa" onClick={() => wrapSelection(fieldKey, '{center}', '{/center}')}><span className="ed-tb-glyph small">Căn</span></button>
            <button type="button" className="ed-tb-btn textual compact" title="Danh sách •" onClick={() => insertAtLineStart(fieldKey, '• ')}><span className="ed-tb-glyph">•</span></button>
            <button type="button" className="ed-tb-btn textual compact" title="Danh sách 1." onClick={() => insertAtLineStart(fieldKey, '1. ')}><span className="ed-tb-glyph small">1.</span></button>
            <span className="ed-tb-sep" />
            <button type="button" className="ed-tb-btn textual compact" title="Tô sáng" onClick={() => wrapSelection(fieldKey, '==', '==')}><span className="ed-tb-glyph small">HL</span></button>
            <button type="button" className="ed-tb-btn textual" title="Chỉ số trên" onClick={() => wrapSelection(fieldKey, '<sup>', '</sup>')}>x<sup style={{fontSize:'0.6em'}}>²</sup></button>
            <button type="button" className="ed-tb-btn textual" title="Chỉ số dưới" onClick={() => wrapSelection(fieldKey, '<sub>', '</sub>')}>x<sub style={{fontSize:'0.6em'}}>₂</sub></button>
            <span className="ed-tb-sep" />
            <button type="button" className="ed-tb-btn accent" title="Công thức" onClick={onMath}><i className="bi bi-calculator"></i> <span className="ed-tb-label">Σ Công thức</span></button>
            <button type="button" className="ed-tb-btn accent" title="Ảnh" onClick={onImage}><i className="bi bi-image"></i> <span className="ed-tb-label">Ảnh</span></button>
        </div>
    );

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />

            {/* Breadcrumb */}
            <div className="breadcrumb">
                <Link to="/teacher"><i className="bi bi-arrow-left"></i> Kho đề</Link>
                <span className="breadcrumb-sep">/</span>
                <span>{exam.title}</span>
            </div>

            {/* Exam info card */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header-gradient" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ color: '#fff', margin: 0 }}>{exam.title}</h2>
                        <p style={{ color: 'rgba(255,255,255,0.8)', margin: '4px 0 0', fontSize: '0.85rem' }}>
                            {exam.subject && `${exam.subject}`}{exam.grade && ` · ${exam.grade}`} · {formatDate(exam.createdAt)}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {isAdminView && (
                            <>
                                <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8 }} onClick={toggleSharedLibrary} disabled={sharingLibrary}>
                                    <i className={`bi bi-${exam.sharedPublished ? 'box-arrow-in-down-left' : 'box-arrow-up-right'}`}></i>
                                    {sharingLibrary ? ' Đang cập nhật...' : exam.sharedPublished ? ' Gỡ khỏi thư viện' : ' Đưa vào thư viện'}
                                </button>
                                <button className="btn btn-sm" style={{ background: 'rgba(15,118,110,0.2)', color: '#ecfeff', border: '1px solid rgba(153,246,228,0.35)', borderRadius: 8 }} onClick={toggleSystemBank} disabled={syncingSystemBank}>
                                    <i className={`bi bi-${exam.systemBankPublished ? 'database-dash' : 'database-add'}`}></i>
                                    {syncingSystemBank ? ' Đang cập nhật...' : exam.systemBankPublished ? ' Gỡ khỏi NH hệ thống' : ' Đưa vào NH hệ thống'}
                                </button>
                            </>
                        )}
                        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8 }} onClick={toggleStatus}>
                            <i className={`bi bi-${exam.status === 'active' ? 'pause-circle' : 'play-circle'}`}></i>
                            {exam.status === 'active' ? ' Đóng' : ' Kích hoạt'}
                        </button>
                        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: '#fca5a5', border: '1px solid rgba(252,165,165,0.3)', borderRadius: 8 }} onClick={deleteExam}>
                            <i className="bi bi-trash3"></i> Xóa đề
                        </button>
                    </div>
                </div>
                <div className="card-body">
                    {editing ? (
                        <div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tiêu đề</label><input className="form-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Môn</label>
                                    <select className="form-select" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}>
                                {!isAdminView && !catalogAccess.hasFullCatalogAccess && (
                                    <div className="ee-access-note" style={{ gridColumn: '1 / -1' }}>
                                        <i className="bi bi-shield-lock"></i> Gói hiện tại: {catalogAccessSummary.packageLabel} · {catalogAccessSummary.subjectsText} · {catalogAccessSummary.gradesText}
                                    </div>
                                )}
                                        <option value="">—</option>
                                        {subjectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Lớp</label>
                                    <select className="form-select" value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })}>
                                        <option value="">—</option>
                                        {gradeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Loại đề</label>
                                    <select className="form-select" value={form.examType} onChange={e => setForm({ ...form, examType: e.target.value })}>
                                        <option value="">— Không phân loại —</option>
                                        <option value="Kiểm tra miệng">Kiểm tra miệng</option>
                                        <option value="Kiểm tra 15 phút">Kiểm tra 15 phút</option>
                                        <option value="Kiểm tra 1 tiết">Kiểm tra 1 tiết</option>
                                        <option value="Kiểm tra giữa kỳ">Kiểm tra giữa kỳ</option>
                                        <option value="Kiểm tra cuối kỳ">Kiểm tra cuối kỳ</option>
                                        <option value="Thi thử">Thi thử</option>
                                        <option value="Bài luyện tập">Bài luyện tập</option>
                                        <option value="Bài tập về nhà">Bài tập về nhà</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Thang điểm hiển thị</label>
                                    <select className="form-select" value={form.scoreScale} onChange={e => setForm({ ...form, scoreScale: e.target.value })}>
                                        <option value="">Số câu đúng / tổng câu</option>
                                        <option value="10">Thang 10 (7.5/10)</option>
                                        <option value="100">Thang 100 (%)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Thời gian (phút)</label><input type="number" className="form-input" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Lần thi tối đa</label><input type="number" className="form-input" value={form.maxAttempts} onChange={e => setForm({ ...form, maxAttempts: e.target.value })} /></div>
                            </div>
                            <div className="toggle-group">
                                <label className="toggle-label"><input type="checkbox" checked={form.shuffleQuestions} onChange={e => setForm({ ...form, shuffleQuestions: e.target.checked })} /><span className="toggle-switch"></span><span>Xáo trộn câu hỏi</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.shuffleChoices} onChange={e => setForm({ ...form, shuffleChoices: e.target.checked })} /><span className="toggle-switch"></span><span>Xáo trộn đáp án</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.showResult} onChange={e => setForm({ ...form, showResult: e.target.checked })} /><span className="toggle-switch"></span><span>Hiện kết quả chi tiết</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.antiCheat?.enabled || false} onChange={e => setForm({ ...form, antiCheat: { ...normalizeAntiCheatSettings(form.antiCheat), enabled: e.target.checked } })} /><span className="toggle-switch"></span><span>Chống gian lận</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.antiCheat?.requireFullscreen ?? DEFAULT_ANTI_CHEAT.requireFullscreen} onChange={e => setForm({ ...form, antiCheat: { ...normalizeAntiCheatSettings(form.antiCheat), requireFullscreen: e.target.checked } })} disabled={!form.antiCheat?.enabled} /><span className="toggle-switch"></span><span>Yêu cầu toàn màn hình</span></label>
                            </div>
                            <div className="form-row" style={{ marginTop: 12 }}>
                                <div className="form-group"><label className="form-label">Số cảnh cáo tối đa</label><input type="number" min="1" max="10" className="form-input" value={form.antiCheat?.maxWarnings || DEFAULT_ANTI_CHEAT.maxWarnings} onChange={e => setForm({ ...form, antiCheat: { ...normalizeAntiCheatSettings(form.antiCheat), maxWarnings: e.target.value } })} disabled={!form.antiCheat?.enabled} /></div>
                            </div>
                            <div className="form-row" style={{ marginTop: 12 }}>
                                <div className="form-group">
                                    <label className="form-label"><i className="bi bi-check2-square"></i> Chấm điểm câu Đúng/Sai</label>
                                    <select className="form-select" value={getTfPresetId(form.tfScoring)} onChange={e => {
                                        const p = TF_SCORING_PRESETS.find(x => x.id === e.target.value);
                                        if (p?.values) setForm({ ...form, tfScoring: p.values });
                                        else setForm({ ...form, tfScoring: { ...form.tfScoring } });
                                    }}>
                                        {TF_SCORING_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="tf-scoring-config-grid">
                                {[['tf_1_4','1/4 ý đúng'],['tf_2_4','2/4 ý đúng'],['tf_3_4','3/4 ý đúng'],['tf_4_4','4/4 ý đúng']].map(([key,lbl]) => (
                                    <div key={key} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                                        <label className="form-label" style={{ fontSize:'0.78rem' }}>{lbl}</label>
                                        <input type="number" min="0" max="5" step="0.05" className="form-input" style={{ textAlign:'center' }}
                                            value={form.tfScoring?.[key] ?? DEFAULT_TF_SCORING[key]}
                                            onChange={e => setForm({ ...form, tfScoring: { ...form.tfScoring, [key]: parseFloat(e.target.value) || 0 } })} />
                                    </div>
                                ))}
                            </div>
                            <div className="form-row" style={{ marginTop: 12 }}>
                                <div className="form-group"><label className="form-label">Điểm trắc nghiệm</label><input type="number" min="0" step="0.05" className="form-input" value={form.questionScoring?.mcq ?? DEFAULT_QUESTION_SCORING.mcq} onChange={e => setForm({ ...form, questionScoring: normalizeQuestionScoring({ ...form.questionScoring, mcq: e.target.value }) })} /></div>
                                <div className="form-group"><label className="form-label">Điểm điền đáp án</label><input type="number" min="0" step="0.05" className="form-input" value={form.questionScoring?.short_answer ?? DEFAULT_QUESTION_SCORING.short_answer} onChange={e => setForm({ ...form, questionScoring: normalizeQuestionScoring({ ...form.questionScoring, short_answer: e.target.value }) })} /></div>
                                <div className="form-group"><label className="form-label">Điểm tự luận</label><input type="number" min="0" step="0.25" className="form-input" value={form.questionScoring?.essay ?? DEFAULT_QUESTION_SCORING.essay} onChange={e => setForm({ ...form, questionScoring: normalizeQuestionScoring({ ...form.questionScoring, essay: e.target.value }) })} /></div>
                            </div>
                            <div className="form-row" style={{ marginTop: 12 }}>
                                <div className="form-group">
                                    <label className="form-label">Chế độ thi</label>
                                    <select className="form-select" value={form.gamification?.mode || DEFAULT_GAMIFICATION.mode} onChange={e => setForm({ ...form, gamification: normalizeGamificationSettings({ ...form.gamification, mode: e.target.value }) })}>
                                        <option value="classic">Classic Focus</option>
                                        <option value="arcade">Arcade / Quizizz</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Điểm cơ bản/câu</label><input type="number" min="50" max="300" className="form-input" value={form.gamification?.pointsPerCorrect || DEFAULT_GAMIFICATION.pointsPerCorrect} onChange={e => setForm({ ...form, gamification: normalizeGamificationSettings({ ...form.gamification, pointsPerCorrect: e.target.value }) })} /></div>
                            </div>
                            <div className="toggle-group">
                                <label className="toggle-label"><input type="checkbox" checked={form.gamification?.liveLeaderboard || false} onChange={e => setForm({ ...form, gamification: normalizeGamificationSettings({ ...form.gamification, liveLeaderboard: e.target.checked }) })} /><span className="toggle-switch"></span><span>BXH lớp tạm tính</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.gamification?.streakBonus !== false} onChange={e => setForm({ ...form, gamification: normalizeGamificationSettings({ ...form.gamification, streakBonus: e.target.checked }) })} /><span className="toggle-switch"></span><span>Thưởng combo</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.gamification?.speedBonus || false} onChange={e => setForm({ ...form, gamification: normalizeGamificationSettings({ ...form.gamification, speedBonus: e.target.checked }) })} /><span className="toggle-switch"></span><span>Thưởng tốc độ</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.gamification?.showQuestionNavigator !== false} onChange={e => setForm({ ...form, gamification: normalizeGamificationSettings({ ...form.gamification, showQuestionNavigator: e.target.checked }) })} /><span className="toggle-switch"></span><span>Thanh chọn câu</span></label>
                            </div>
                            <div className="integration-callout" style={{ marginTop: 12 }}>
                                <div>
                                    <strong><i className="bi bi-bezier2"></i> Kết nối ConicGV</strong>
                                    <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)' }}>
                                        Soạn công thức trên ConicGV, xuất `.tex`, sau đó quay lại đây để cập nhật đề thi hoặc nhập phiên bản mới.
                                    </p>
                                </div>
                                <a href={CONICGV_URL} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                                    <i className="bi bi-box-arrow-up-right"></i> Mở ConicGV
                                </a>
                            </div>
                            <div className="alert alert-info" style={{ marginTop: 12 }}>
                                <i className="bi bi-image"></i>
                                Ảnh tải mới sẽ tự tối ưu sang WebP nếu trình duyệt hỗ trợ; khi chèn có thể chọn kích thước và canh vị trí.
                            </div>
                            {dynamicBankExam && (
                                <div className="alert alert-info" style={{ marginTop: 12 }}>
                                    <i className="bi bi-shuffle"></i>
                                    Đề này phát câu trực tiếp từ ngân hàng. Tại trang này bạn chỉnh thời gian, lượt thi, xáo trộn và chống gian lận; ma trận bốc câu được xem ở phần thông tin bên dưới.
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                <button className="btn btn-primary btn-sm" onClick={handleSave}><i className="bi bi-check-lg"></i> Lưu</button>
                                <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>Hủy</button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="info-grid">
                                <div className="info-item"><span className="info-label">Loại đề</span><span className="info-value">{exam.examType || '—'}</span></div>
                                <div className="info-item"><span className="info-label">Thang điểm</span><span className="info-value">{exam.scoreScale === '10' ? 'Thang 10' : exam.scoreScale === '100' ? 'Thang 100' : 'Điểm gốc'}</span></div>
                                <div className="info-item"><span className="info-label">Chấm câu ĐS</span><span className="info-value">{(() => {
                                    const p = TF_SCORING_PRESETS.find(x => x.id === getTfPresetId(exam.tfScoring));
                                    const s = exam.tfScoring || DEFAULT_TF_SCORING;
                                    return p?.id !== 'custom' ? p?.label?.replace(/✅?️? /, '') : `${s.tf_1_4}·${s.tf_2_4}·${s.tf_3_4}·${s.tf_4_4}`;
                                })()}</span></div>
                                <div className="info-item"><span className="info-label">Điểm TN / Điền / TL</span><span className="info-value">{`${normalizeQuestionScoring(exam.questionScoring || DEFAULT_QUESTION_SCORING).mcq} / ${normalizeQuestionScoring(exam.questionScoring || DEFAULT_QUESTION_SCORING).short_answer} / ${normalizeQuestionScoring(exam.questionScoring || DEFAULT_QUESTION_SCORING).essay}`}</span></div>
                                <div className="info-item"><span className="info-label">Thời gian</span><span className="info-value">{exam.duration} phút</span></div>
                                <div className="info-item"><span className="info-label">Số câu</span><span className="info-value">{displayQuestionCount}</span></div>
                                <div className="info-item"><span className="info-label">Lần thi tối đa</span><span className="info-value">{exam.maxAttempts || 1}</span></div>
                                <div className="info-item"><span className="info-label">Trạng thái</span><span className={`stat-badge ${exam.status === 'active' ? 'success' : 'warning'}`}>{exam.status === 'active' ? 'Đang mở' : 'Nháp'}</span></div>
                                <div className="info-item"><span className="info-label">Xáo trộn câu</span><span className="info-value">{exam.shuffleQuestions ? '✓' : '✗'}</span></div>
                                <div className="info-item"><span className="info-label">Xáo trộn đáp án</span><span className="info-value">{exam.shuffleChoices ? '✓' : '✗'}</span></div>
                                <div className="info-item"><span className="info-label">Chống gian lận</span><span className="info-value">{exam.antiCheat?.enabled ? `Bật · ${exam.antiCheat?.maxWarnings || DEFAULT_ANTI_CHEAT.maxWarnings} cảnh cáo` : 'Tắt'}</span></div>
                                <div className="info-item"><span className="info-label">Toàn màn hình</span><span className="info-value">{exam.antiCheat?.enabled ? (exam.antiCheat?.requireFullscreen === false ? 'Không bắt buộc' : 'Bắt buộc') : '—'}</span></div>
                                <div className="info-item"><span className="info-label">Preset trải nghiệm</span><span className="info-value">{getGamificationPresetLabel(exam.gamification)}</span></div>
                                <div className="info-item"><span className="info-label">Live leaderboard</span><span className="info-value">{exam.gamification?.liveLeaderboard ? 'Bật' : 'Tắt'}</span></div>
                                <div className="info-item"><span className="info-label">Nguồn nhập</span><span className="info-value">{exam.sourceFormat || 'manual'}</span></div>
                                <div className="info-item"><span className="info-label">Mode phát đề</span><span className="info-value">{bankDeliveryModeMeta.label}</span></div>
                                <div className="info-item"><span className="info-label">Ảnh đã tối ưu</span><span className="info-value">{exam.assetSummary?.imageCount || 0} ảnh</span></div>
                                <div className="info-item"><span className="info-label">Khiên nhập đề</span><span className="info-value">{importQuality.score}/100</span></div>
                                <div className="info-item"><span className="info-label">Lần rà gần nhất</span><span className="info-value">{importQuality.teacherReviewedAt ? `${importQuality.teacherReviewedName || 'Giáo viên'} · ${formatDate(toDateValue(importQuality.teacherReviewedAt))}` : 'Chưa xác nhận'}</span></div>
                                {isAdminView && (
                                    <div className="info-item"><span className="info-label">Thư viện dùng chung</span><span className={`stat-badge ${exam.sharedPublished ? 'success' : 'warning'}`}>{exam.sharedPublished ? 'Đang phát hành' : 'Chưa phát hành'}</span></div>
                                )}
                            </div>
                            {dynamicBankExam && deliveryConfig.bankPolicy?.rows?.length > 0 && (
                                <div className="import-history-card" style={{ marginTop: 14 }}>
                                    <div className="section-context-head" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                        <strong><i className="bi bi-shuffle"></i> Ma trận đề ngẫu nhiên từ ngân hàng</strong>
                                        <Link to="/teacher/bank" className="btn btn-outline btn-sm">
                                            <i className="bi bi-box-arrow-up-right"></i> Mở ngân hàng câu hỏi
                                        </Link>
                                    </div>
                                    <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                                        {bankDeliveryModeMeta.description} Tổng dự kiến: <strong>{computeBankBlueprintQuestionCount(deliveryConfig) || displayQuestionCount}</strong> câu.
                                    </p>
                                    <div style={{ display: 'grid', gap: 10 }}>
                                        {deliveryConfig.bankPolicy.rows.map((row, index) => (
                                            <div key={row.id || index} className="import-history-item" style={{ marginBottom: 0 }}>
                                                <div className="import-history-row">
                                                    <strong>Dòng {index + 1}</strong>
                                                    <span>{row.count} câu</span>
                                                </div>
                                                <div className="import-history-row muted" style={{ flexWrap: 'wrap', gap: 8 }}>
                                                    <span>{TYPE_LABELS[row.type] || 'Tất cả loại'}</span>
                                                    <span>{getDifficultyLabel(row.difficulty)}</span>
                                                    <span>{getChapterLabel(row.chapter)}</span>
                                                    <span>{getBankScopeLabel(row.scope === 'all' ? deliveryConfig.bankPolicy.scope : row.scope)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="alert alert-info" style={{ marginTop: 12, marginBottom: 0 }}>
                                        <i className="bi bi-info-circle"></i>
                                        Khi học sinh bấm vào thi, hệ thống sẽ bốc câu trực tiếp từ ngân hàng theo ma trận này. Bài đang làm dở vẫn giữ nguyên snapshot câu hỏi của lượt thi đó.
                                    </div>
                                </div>
                            )}
                            {!dynamicBankExam && explicitSectionGroups.length > 0 && (
                                <div className="import-history-card" style={{ marginTop: 14 }}>
                                    <div className="section-context-head" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <strong><i className="bi bi-diagram-3"></i> Blueprint theo phần của đề</strong>
                                        <span className="stat-badge info">Có thể sửa ngay tại đây</span>
                                    </div>
                                    <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                                        Cùng một đề này có thể dùng cho bài thi thường, live và trình chiếu. Mỗi phần bên dưới có thể chỉnh lại số câu lấy ra, cách hoán vị và vị trí phần mà không cần quay về file nguồn.
                                    </p>
                                    <div style={{ display: 'grid', gap: 12 }}>
                                        {explicitSectionGroups.map((group, index) => {
                                            const sampleQuestion = group.questions[0] || {};
                                            const sectionLimit = Number(group.meta.questionLimit) || 0;
                                            const savingSection = savingSectionKey === group.key;
                                            return (
                                                <div key={group.key} className="import-history-item" style={{ marginBottom: 0 }}>
                                                    <div className="import-history-row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                                                        <div>
                                                            <strong>Phần {index + 1}: {group.meta.title || getSectionDisplayTitle(sampleQuestion)}</strong>
                                                            <div className="import-history-row muted" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
                                                                <span>Tag: {sampleQuestion.sectionTag || buildSectionTag(sampleQuestion)}</span>
                                                                <span>{group.questions.length} câu nguồn</span>
                                                            </div>
                                                        </div>
                                                        <div className="form-group" style={{ minWidth: 180, marginBottom: 0 }}>
                                                            <label className="form-label">Lấy k câu trong phần</label>
                                                            <input
                                                                type="number"
                                                                className="form-input"
                                                                min="0"
                                                                max={group.questions.length}
                                                                value={sectionLimit || ''}
                                                                placeholder={`0 = lấy hết ${group.questions.length}`}
                                                                onChange={(event) => updateSectionGroupSettings(group.key, { sectionQuestionLimit: event.target.value })}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="toggle-group" style={{ marginTop: 12 }}>
                                                        <label className="toggle-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={group.meta.shuffleQuestions !== false}
                                                                onChange={(event) => updateSectionGroupSettings(group.key, { sectionShuffleQuestions: event.target.checked })}
                                                            />
                                                            <span className="toggle-switch"></span>
                                                            <span>Hoán vị câu trong phần</span>
                                                        </label>
                                                        <label className="toggle-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={group.meta.shuffleChoices !== false}
                                                                onChange={(event) => updateSectionGroupSettings(group.key, { sectionShuffleChoices: event.target.checked })}
                                                            />
                                                            <span className="toggle-switch"></span>
                                                            <span>Hoán vị đáp án trong phần</span>
                                                        </label>
                                                        <label className="toggle-label">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(group.meta.fixedPosition)}
                                                                onChange={(event) => updateSectionGroupSettings(group.key, { sectionFixedPosition: event.target.checked })}
                                                            />
                                                            <span className="toggle-switch"></span>
                                                            <span>Cố định vị trí phần</span>
                                                        </label>
                                                    </div>
                                                    <div className="import-history-row muted" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                                                        <span>{sectionLimit > 0 ? `Đang lấy ${Math.min(sectionLimit, group.questions.length)}/${group.questions.length} câu` : `Đang lấy toàn bộ ${group.questions.length} câu`}</span>
                                                        <span>{group.meta.shuffleQuestions !== false ? 'Câu sẽ được trộn trong phần' : 'Câu giữ nguyên thứ tự hiện tại'}</span>
                                                        <span>{group.meta.fixedPosition ? 'Phần giữ nguyên vị trí' : 'Phần đi theo thứ tự đề'}</span>
                                                    </div>
                                                    {sampleQuestion.sectionContextHtml && <div className="section-context-body" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: renderLatex(sampleQuestion.sectionContextHtml) }} />}
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                                                        <button className="btn btn-outline btn-sm" onClick={() => saveSectionGroupSettings(group.key)} disabled={savingSection}>
                                                            <i className="bi bi-save"></i> {savingSection ? 'Đang lưu...' : 'Lưu cấu hình phần'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            <div className={`import-shield-card ${importQualityBadge.className}`} style={{ marginTop: 14 }}>
                                <div className="import-shield-header">
                                    <div>
                                        <div className="import-shield-kicker"><i className="bi bi-shield-check"></i> Khiên nhập đề</div>
                                        <h3>{importQualityBadge.label} · {importQuality.score}/100</h3>
                                        <p>{formatImportQualitySummary(importQuality, exam.sourceFormat || 'manual')}</p>
                                    </div>
                                    <span className={`stat-badge ${importQualityBadge.className}`}>
                                        <i className={`bi bi-${importQualityBadge.icon}`}></i> {importQualityBadge.label}
                                    </span>
                                </div>
                                {(importQuality.warningSamples?.length > 0 || importQuality.issueQuestions?.length > 0) && (
                                    <div className="import-shield-issues">
                                        {importQuality.warningSamples?.slice(0, 3).map((warning, index) => (
                                            <div key={`warning-${index}`} className="import-shield-issue-item">
                                                <strong>Cảnh báo</strong>
                                                <span>{warning}</span>
                                            </div>
                                        ))}
                                        {importQuality.issueQuestions?.slice(0, 4).map((item) => (
                                            <div key={`issue-${item.number}`} className="import-shield-issue-item">
                                                <strong>Câu {item.number}</strong>
                                                <span>{item.issues.join(', ')}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {importHistory.length > 0 && (
                                <div className="import-history-card" style={{ marginTop: 14 }}>
                                    <div className="section-context-head" style={{ marginBottom: 10 }}>
                                        <strong><i className="bi bi-clock-history"></i> Lịch sử nhập đề</strong>
                                    </div>
                                    <div className="import-history-list">
                                        {importHistory.map((entry) => (
                                            <div key={entry.id || `${entry.kind}-${entry.score}`} className="import-history-item">
                                                <div className="import-history-row">
                                                    <strong>{getImportHistoryLabel(entry)}</strong>
                                                    <span>{entry.at ? formatDate(toDateValue(entry.at)) : 'Vừa xong'}</span>
                                                </div>
                                                <div className="import-history-row muted">
                                                    <span>{entry.actorName || 'Hệ thống'}</span>
                                                    <span>{entry.score}/100</span>
                                                </div>
                                                <p>{entry.note || entry.summary}</p>
                                                {entry.warningSamples?.length > 0 && <small>Parser: {entry.warningSamples.join(' · ')}</small>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}><i className="bi bi-pencil"></i> Chỉnh sửa cài đặt</button>
                                {!importQuality.teacherReviewed && !importQuality.publishBlocked && (
                                    <button className="btn btn-outline btn-sm" onClick={markImportReviewed}><i className="bi bi-shield-check"></i> Danh dau da kiem</button>
                                )}
                                {!isAdminView && <Link to={`/teacher/exam/${examId}/sessions`} className="btn btn-outline btn-sm"><i className="bi bi-bar-chart"></i> Xem kết quả thi</Link>}
                                {!isAdminView && <Link to={`/teacher/exam/${examId}/live`} className="btn btn-sm btn-live"><i className="bi bi-broadcast"></i> Phát sóng Live</Link>}
                                {!dynamicBankExam && questions.length > 0 && (
                                    <Link to={`/teacher/exam/${examId}/presentation?role=presenter`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                                        <i className="bi bi-display"></i> Presenter View
                                    </Link>
                                )}
                                {!dynamicBankExam && <button className="btn btn-outline btn-sm" onClick={printExam}><i className="bi bi-printer"></i> In đề</button>}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Questions header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <h2 className="section-title" style={{ margin: 0 }}>
                    <i className="bi bi-list-ol"></i> Câu hỏi ({displayQuestionCount})
                </h2>
                {!dynamicBankExam && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-outline btn-sm" onClick={rescoreAllSessions} title="Chấm lại điểm dựa trên đáp án hiện tại">
                            <i className="bi bi-arrow-repeat"></i> Chấm lại
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={addQuestion}>
                            <i className="bi bi-plus-lg"></i> Thêm câu hỏi
                        </button>
                    </div>
                )}
            </div>

            {/* Question cards */}
            {!dynamicBankExam && questions.map((q, idx) => {
                const questionLayout = q.type === 'mcq' ? getQuestionOptionLayout(q) : null;
                const sectionKey = getQuestionSectionKey(q, idx, questions);
                const prevSectionKey = idx > 0 ? getQuestionSectionKey(questions[idx - 1], idx - 1, questions) : null;
                const showSectionIntro = sectionKey !== '__default' && sectionKey !== prevSectionKey;
                return (
                <React.Fragment key={`${sectionKey}_${q.id}`}>
                {showSectionIntro && (
                    <div className="section-context-card detail-mode">
                        <div className="section-context-head">
                            <strong>{getSectionDisplayTitle(q)}</strong>
                            {q.sectionTag && <span className="stat-badge muted">{q.sectionTag}</span>}
                        </div>
                        {q.sectionContextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(q.sectionContextHtml) }} />}
                    </div>
                )}
                <motion.div className="question-preview-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
                    style={{ cursor: 'pointer' }} onClick={() => setEditingQ(idx)}>
                    <div className="question-preview-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="question-number">{idx + 1}</span>
                            <span className="stat-badge" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color, fontSize: '0.7rem' }}>{TYPE_LABELS[q.type] || q.type}</span>
                            {questionLayout && <span className="stat-badge muted">{getQuestionOptionLayoutLabel(questionLayout)}</span>}
                            <span className="stat-badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '0.7rem' }}>{getQuestionMaxPoints(q, exam?.questionScoring || DEFAULT_QUESTION_SCORING, exam?.tfScoring || DEFAULT_TF_SCORING)}đ</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-icon-sm" onClick={e => { e.stopPropagation(); setEditingQ(idx); }} title="Sửa"><i className="bi bi-pencil"></i></button>
                            <button className="btn-icon-sm danger" onClick={e => { e.stopPropagation(); deleteQuestion(q.id); }} title="Xóa"><i className="bi bi-trash3"></i></button>
                        </div>
                    </div>
                    <div className="question-preview-content" dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(q.content_html || escHtml(q.content_text) || ''), q, idx)) }} />
                    <div className="choice-preview-list">
                        {(q.choices || []).map((c, ci) => {
                            const isCorrect = q.type === 'mcq' ? (q.correct_answer === c.letter || c.isCorrect) :
                                q.type === 'tf' ? q.correct_answer?.[ci] === 'D' : false;
                            return (
                                <div key={ci} className={`choice-preview ${isCorrect ? 'correct' : ''}`}>
                                    <span className="choice-letter-sm">{c.letter || String.fromCharCode(65 + ci)}</span>
                                    <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, q.type, ci)) }} />
                                    {isCorrect && <i className="bi bi-check-circle-fill" style={{ color: '#10b981', marginLeft: 'auto' }}></i>}
                                </div>
                            );
                        })}
                    </div>
                    {q.type === 'short_answer' && q.correct_answer && (
                        <div style={{ fontSize: '0.85rem', marginTop: 6, color: '#059669' }}>
                            <i className="bi bi-check2-circle"></i> Đáp án: <b>{q.correct_answer}</b>
                        </div>
                    )}
                    {q.type === 'essay' && q.correct_answer && (
                        <div style={{ fontSize: '0.85rem', marginTop: 6, color: '#7c3aed' }}>
                            <i className="bi bi-journal-richtext"></i> Gợi ý chấm: <b>{q.correct_answer}</b>
                        </div>
                    )}
                </motion.div>
                </React.Fragment>
                );
            })}

            {!dynamicBankExam && questions.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                    <i className="bi bi-inbox" style={{ fontSize: 48 }}></i>
                    <p style={{ marginTop: 12 }}>Chưa có câu hỏi nào. Bấm "Thêm câu hỏi" để bắt đầu.</p>
                </div>
            )}

            {dynamicBankExam && (
                <div style={{ textAlign: 'center', padding: '40px 24px', color: '#64748b', border: '1px dashed #cbd5e1', borderRadius: 16, background: '#f8fafc' }}>
                    <i className="bi bi-shuffle" style={{ fontSize: 42, color: '#7c3aed' }}></i>
                    <p style={{ margin: '12px 0 6px', fontWeight: 600, color: '#334155' }}>Đề này không lưu sẵn một bộ câu cố định.</p>
                    <p style={{ margin: 0, maxWidth: 680, marginInline: 'auto' }}>
                        Hệ thống sẽ bốc câu trực tiếp từ ngân hàng khi học sinh bắt đầu thi, theo đúng mode và ma trận đã cấu hình ở phía trên. Nếu cần đổi ma trận, hãy quay lại mục Ngân hàng câu hỏi để tạo lại cấu hình phù hợp.
                    </p>
                </div>
            )}

            {/* Item Analysis section */}
            {!isAdminView && !dynamicBankExam && questions.length > 0 && (
                <ItemAnalysisSection examId={examId} questions={questions} />
            )}

            {/* ══════ EDIT DIALOG ══════ */}
            <AnimatePresence>
                {eq && (
                    <motion.div className="ed-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={e => { if (e.target === e.currentTarget) setEditingQ(-1); }}>
                        <motion.div className="ed-dialog" initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0, scale: 0.97 }}
                            transition={{ type: 'spring', damping: 28, stiffness: 400 }}>
                            <div className="ed-head">
                                <div className="ed-head-left">
                                    <span className="ed-head-num">Câu {editingQ + 1}</span>
                                    <select value={eq.type} onChange={e => handleQuestionTypeChange(editingQ, e.target.value)} className="ed-type-select">
                                        <option value="mcq">Trắc nghiệm</option>
                                        <option value="tf">Đúng/Sai</option>
                                        <option value="short_answer">Tự luận ngắn</option>
                                        <option value="essay">Tự luận</option>
                                    </select>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                                        <label style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Điểm:</label>
                                        <input type="number" min="0" step="0.05" value={eq.points ?? getQuestionMaxPoints(eq, form.questionScoring || exam?.questionScoring, form.tfScoring || exam?.tfScoring)}
                                            onChange={e => updateQ(editingQ, { points: parseFloat(e.target.value) || 0 })}
                                            style={{ width: 50, padding: '2px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.85rem', textAlign: 'center' }} />
                                    </div>
                                </div>
                                <div className="ed-head-right">
                                    <button type="button" className="ed-nav-btn" disabled={editingQ <= 0} onClick={() => setEditingQ(editingQ - 1)}>
                                        <span className="ed-nav-glyph" aria-hidden="true">&lsaquo;</span>
                                        <span className="ed-nav-text">Trước</span>
                                    </button>
                                    <span className="ed-nav-label">{editingQ + 1} / {questions.length}</span>
                                    <button type="button" className="ed-nav-btn" disabled={editingQ >= questions.length - 1} onClick={() => setEditingQ(editingQ + 1)}>
                                        <span className="ed-nav-text">Sau</span>
                                        <span className="ed-nav-glyph" aria-hidden="true">&rsaquo;</span>
                                    </button>
                                    <button className="btn btn-primary btn-sm" onClick={() => saveQuestion(editingQ)} disabled={savingQ} style={{ marginLeft: 8 }}>
                                        {savingQ ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> : <><i className="bi bi-check-lg"></i> Lưu</>}
                                    </button>
                                    <button type="button" className="ed-close" onClick={() => setEditingQ(-1)}>
                                        <span className="ed-nav-glyph" aria-hidden="true">&times;</span>
                                        <span className="ed-nav-text">Đóng</span>
                                    </button>
                                </div>
                            </div>

                            <div className="ed-body">
                                <div className="ed-form">
                                    <div className="ed-section">
                                        <label className="ed-label"><i className="bi bi-card-text"></i> Nội dung câu hỏi</label>
                                        <EditorToolbar fieldKey="q-content" onMath={() => openMath('content')} onImage={() => triggerImgUpload('content')} />
                                        <textarea ref={el => fieldRefs.current['q-content'] = el} value={eq.content_text || ''}
                                            onChange={e => updateQ(editingQ, { content_text: e.target.value })}
                                            rows={Math.max(3, Math.min(10, (eq.content_text || '').split('\n').length + 1))}
                                            className="ed-textarea" placeholder="Nhập nội dung câu hỏi..." />
                                    </div>

                                    {(eq.type === 'mcq' || eq.type === 'tf') && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-list-check"></i> Đáp án {eq.type === 'mcq' && <small>(chọn đáp án đúng)</small>}</label>
                                            {eq.type === 'mcq' && (
                                                <div className="ed-layout-row">
                                                    <label className="ed-layout-label"><i className="bi bi-grid-3x2-gap"></i> Bố cục hiển thị</label>
                                                    <select className="ed-layout-select" value={getQuestionOptionLayout(eq) || ''} onChange={e => setQuestionOptionLayout(editingQ, e.target.value)}>
                                                        {QUESTION_OPTION_LAYOUT_OPTIONS.map((option) => (
                                                            <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                    <small className="ed-layout-hint">Điện thoại vẫn tự gộp về 1 cột để dễ thao tác.</small>
                                                </div>
                                            )}
                                            <div className="ed-choices">
                                                {eq.choices.map((c, j) => {
                                                    const isCorrect = eq.type === 'mcq' ? eq.correct_answer === c.letter : eq.correct_answer?.[j] === 'D';
                                                    return (
                                                        <div key={j} className={'ed-choice' + (isCorrect ? ' correct' : '')}>
                                                            <div className="ed-choice-main">
                                                                {eq.type === 'mcq' ? (
                                                                    <label className="ed-radio">
                                                                        <input type="radio" name="ed-correct" checked={eq.correct_answer === c.letter}
                                                                            onChange={() => setCorrectAnswer(editingQ, c.letter)} />
                                                                        <span className={'ed-dot' + (isCorrect ? ' on' : '')} />
                                                                    </label>
                                                                ) : (
                                                                    <button className={'ed-tf' + (isCorrect ? ' on' : '')}
                                                                        onClick={() => {
                                                                            const arr = (eq.correct_answer || 'SSSS').split('');
                                                                            arr[j] = arr[j] === 'D' ? 'S' : 'D';
                                                                            setCorrectAnswer(editingQ, arr.join(''));
                                                                        }}>
                                                                        {isCorrect ? 'Đ' : 'S'}
                                                                    </button>
                                                                )}
                                                                <span className="ed-cletter">{eq.type === 'tf' ? c.letter + ')' : c.letter + '.'}</span>
                                                                <input type="text" ref={el => fieldRefs.current['q-c' + j] = el}
                                                                    value={c.text || ''} onChange={e => updateChoice(editingQ, j, { text: e.target.value })}
                                                                    className="ed-cinput" placeholder="Nội dung đáp án..." />
                                                                <button type="button" className="ed-mini" onClick={() => openMath('choice', j)} title="Công thức">&Sigma;</button>
                                                                <button type="button" className="ed-mini" onClick={() => triggerImgUpload('choice', j)} title="Ảnh">Ảnh</button>
                                                                <button type="button" className="ed-mini danger" onClick={() => removeChoice(editingQ, j)} title="Xóa">&times;</button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <button className="ed-add-choice" onClick={() => addChoice(editingQ)}><i className="bi bi-plus-circle"></i> Thêm đáp án</button>
                                        </div>
                                    )}

                                    {eq.type === 'short_answer' && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-check2-circle"></i> Đáp án</label>
                                            <input type="text" value={eq.correct_answer || ''} onChange={e => setCorrectAnswer(editingQ, e.target.value)}
                                                className="ed-cinput" style={{ width: '100%' }} placeholder="Nhập đáp án..." />
                                        </div>
                                    )}

                                    {eq.type === 'essay' && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-journal-richtext"></i> Hướng dẫn chấm / đáp án gợi ý <small>(không bắt buộc)</small></label>
                                            <textarea value={eq.correct_answer || ''} onChange={e => setCorrectAnswer(editingQ, e.target.value)}
                                                rows={4} className="ed-textarea" placeholder="Nhập rubric, dàn ý hoặc tiêu chí chấm..." />
                                        </div>
                                    )}

                                    <div className="ed-section ed-expl">
                                        <label className="ed-label"><i className="bi bi-lightbulb"></i> Lời giải <small>(không bắt buộc)</small></label>
                                        <EditorToolbar fieldKey="q-expl" onMath={() => openMath('explanation')} onImage={() => triggerImgUpload('explanation')} />
                                        <textarea ref={el => fieldRefs.current['q-expl'] = el} value={eq.explanation || ''}
                                            onChange={e => updateQ(editingQ, { explanation: e.target.value })}
                                            rows={3} className="ed-textarea" placeholder="Giải thích chi tiết..." />
                                    </div>

                                    <div className="ed-section ai-question-assistant">
                                        <div className="ai-question-assistant-head">
                                            <div>
                                                <div className="ai-provider-title"><i className="bi bi-stars"></i> AI trợ lý soạn câu</div>
                                                <div className="ai-helper-text">Dùng model và API key của chính bạn. Key chỉ chạy cục bộ trong trình duyệt hiện tại.</div>
                                            </div>
                                            <span className={`stat-badge ${aiAssistantStatus.ready ? 'active' : 'warning'}`}>{aiAssistantStatus.label}</span>
                                        </div>

                                        <div className="ai-question-assistant-grid">
                                            <div>
                                                <label className="form-label">Tác vụ AI</label>
                                                <select className="form-select" value={aiAction} onChange={(event) => setAiAction(event.target.value)}>
                                                    {QUESTION_AI_ACTIONS.map((action) => (
                                                        <option key={action.id} value={action.id}>{action.label}</option>
                                                    ))}
                                                </select>
                                                <div className="ai-helper-text">
                                                    {QUESTION_AI_ACTIONS.find((action) => action.id === aiAction)?.description}
                                                </div>
                                            </div>

                                            <div>
                                                <label className="form-label">Yêu cầu bổ sung cho AI</label>
                                                <textarea
                                                    className="ed-textarea ai-question-brief"
                                                    rows={3}
                                                    value={aiBrief}
                                                    onChange={(event) => setAiBrief(event.target.value)}
                                                    placeholder="Ví dụ: tăng độ phân hoá, bám sát lớp 10, tránh mẹo đoán đáp án, thêm lời giải ngắn gọn."
                                                />
                                            </div>
                                        </div>

                                        <div className="ai-usage-strip">
                                            <span className="stat-badge muted">{aiAssistantStatus.detail}</span>
                                            {aiLastRun && <span className="stat-badge info">Lần vừa rồi ~{aiLastRun.estimatedCostVnd.toLocaleString('vi-VN')} đ</span>}
                                            <button className="btn btn-primary btn-sm" type="button" onClick={runQuestionAIAssistant} disabled={!aiAssistantStatus.ready || aiLoading}>
                                                {aiLoading ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> Đang tạo nháp...</> : <><i className="bi bi-magic"></i> Tạo nháp bằng AI</>}
                                            </button>
                                        </div>

                                        {aiDraft && (
                                            <div className="ai-question-draft">
                                                <div className="ai-question-draft-head">
                                                    <strong>Nháp AI</strong>
                                                    {aiLastRun && <span className="stat-badge info">{aiLastRun.providerLabel} · {aiLastRun.model}</span>}
                                                </div>

                                                <div className="ai-question-draft-text">{aiDraft.content_text}</div>

                                                {(eq.type === 'mcq' || eq.type === 'tf') && aiDraft.choices?.length > 0 && (
                                                    <div className="ai-question-choice-list">
                                                        {aiDraft.choices.map((choice) => (
                                                            <div key={choice.letter} className="ai-question-choice-row">
                                                                <span className="choice-letter-sm">{choice.letter}</span>
                                                                <span>{choice.text || '(trống)'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {aiDraft.correct_answer && (
                                                    <div className="ai-question-draft-answer"><strong>Đáp án:</strong> {aiDraft.correct_answer}</div>
                                                )}

                                                {aiDraft.explanation && (
                                                    <div className="ai-question-draft-text subtle">{aiDraft.explanation}</div>
                                                )}

                                                <div className="ai-actions-row">
                                                    <button className="btn btn-outline btn-sm" type="button" onClick={() => applyQuestionAIDraft('explanation')}>
                                                        <i className="bi bi-lightbulb"></i> Chỉ áp dụng lời giải
                                                    </button>
                                                    <button className="btn btn-primary btn-sm" type="button" onClick={() => applyQuestionAIDraft('all')}>
                                                        <i className="bi bi-check2-square"></i> Áp dụng vào câu đang sửa
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="ed-preview">
                                    <div className="ed-preview-label"><i className="bi bi-eye"></i> Xem trước</div>
                                    <div className="ed-preview-card">
                                        <div className="ed-p-head">
                                            <span className="ep-num">Câu {editingQ + 1}</span>
                                            <span className="ep-type" style={{ background: TYPE_COLORS[eq.type]?.bg, color: TYPE_COLORS[eq.type]?.color }}>{TYPE_LABELS[eq.type]}</span>
                                            {eq.type === 'mcq' && getQuestionOptionLayout(eq) && <span className="stat-badge muted">{getQuestionOptionLayoutLabel(getQuestionOptionLayout(eq))}</span>}
                                        </div>
                                        <div className="ed-p-content" dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(eq.content_html || escHtml(eq.content_text)), eq, editingQ)) }} />
                                        {eq.type === 'mcq' && eq.choices.length > 0 && (
                                            <div className="ep-choices">
                                                {eq.choices.map((c, j) => (
                                                    <div key={j} className={'ep-choice' + (eq.correct_answer === c.letter ? ' correct' : '')}>
                                                        <span className="ep-radio">{eq.correct_answer === c.letter ? '●' : '○'}</span>
                                                        <span className="ep-letter">{c.letter}.</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, eq.type, j)) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {eq.type === 'tf' && eq.choices.length > 0 && (
                                            <div className="ep-choices">
                                                {eq.choices.map((c, j) => (
                                                    <div key={j} className={'ep-choice' + (eq.correct_answer?.[j] === 'D' ? ' correct' : '')}>
                                                        <span style={{ display:'inline-block', width:24, height:24, borderRadius:4, textAlign:'center', lineHeight:'24px', fontSize:'0.75rem', fontWeight:700, background: eq.correct_answer?.[j] === 'D' ? '#d1fae5' : '#fee2e2', color: eq.correct_answer?.[j] === 'D' ? '#065f46' : '#991b1b' }}>{eq.correct_answer?.[j] === 'D' ? 'Đ' : 'S'}</span>
                                                        <span className="ep-letter">{c.letter})</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, eq.type, j)) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {eq.type === 'short_answer' && eq.correct_answer && <div style={{ margin: '12px 0', color: '#059669', fontWeight: 600 }}><i className="bi bi-pencil-square"></i> Đáp án: {eq.correct_answer}</div>}
                                        {eq.type === 'essay' && eq.correct_answer && <div style={{ margin: '12px 0', color: '#7c3aed', fontWeight: 600 }}><i className="bi bi-journal-richtext"></i> Gợi ý chấm: {eq.correct_answer}</div>}
                                        {(eq.explanation || eq.explanation_html) ? (
                                            <div className="ed-p-expl">
                                                <div className="ed-p-expl-head"><i className="bi bi-lightbulb-fill"></i> Lời giải</div>
                                                <div className="ed-p-expl-body" dangerouslySetInnerHTML={{ __html: renderLatex(eq.explanation_html || escHtml(eq.explanation || '')) }} />
                                            </div>
                                        ) : <div style={{ padding: '12px', color: '#94a3b8', fontSize: '0.85rem' }}><i className="bi bi-lightbulb"></i> Chưa có lời giải</div>}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ══════ MATH SUB-DIALOG ══════ */}
            <AnimatePresence>
                {mathTarget && (
                    <motion.div className="math-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setMathTarget(null)} style={{ zIndex: 1100 }}>
                        <motion.div className="math-dialog" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            onClick={e => e.stopPropagation()}>
                            <div className="math-dialog-head">
                                <h3><i className="bi bi-calculator"></i> Chèn công thức</h3>
                                <button className="math-close" onClick={() => setMathTarget(null)}><i className="bi bi-x-lg"></i></button>
                            </div>
                            <div className="math-palette">
                                <div className="math-palette-tabs">
                                    {MATH_GROUPS.map((g, gi) => (
                                        <button key={gi} className={'math-tab' + (mathPaletteGroup === gi ? ' active' : '')}
                                            onClick={() => setMathPaletteGroup(gi)}>{g.label}</button>
                                    ))}
                                </div>
                                <div className="math-palette-grid">
                                    {MATH_GROUPS[mathPaletteGroup].items.map((item, ii) => (
                                        <button key={ii} className="math-sym-btn" title={item.t}
                                            onClick={() => insertMathSymbol(item.t)}>{item.l}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="math-input-area"><label>LaTeX</label>
                                <textarea value={mathLatex} onChange={e => setMathLatex(e.target.value)}
                                    placeholder='Nhập LaTeX: \frac{1}{2}, \sqrt{x},...' rows={3} autoFocus />
                            </div>
                            <div className="math-wrap-area">
                                <label>Kiểu chèn</label>
                                <div className="math-wrap-options">
                                    {MATH_WRAP_OPTIONS.map((option) => (
                                        <button key={option.id} type="button" className={'math-wrap-btn' + (mathWrapMode === option.id ? ' active' : '')}
                                            onClick={() => setMathWrapMode(option.id)}>{option.label}</button>
                                    ))}
                                </div>
                                <small>Inline: \(...\) hoặc $...$ . Khối: \[...\] hoặc $$...$$.</small>
                            </div>
                            <div className="math-live"><label>Xem trước</label>
                                <div className="math-live-render" dangerouslySetInnerHTML={{
                                    __html: mathLatex.trim() ? (() => {
                                        try { return katex.renderToString(mathLatex.replace(/\u25AB/g, '\\square '), { displayMode: true, throwOnError: false }); }
                                        catch { return '<span style="color:#e53e3e">Lỗi cú pháp</span>'; }
                                    })() : '<span style="color:#999">Bấm ký hiệu hoặc nhập LaTeX...</span>'
                                }} />
                            </div>
                            <div className="math-dialog-foot">
                                <button className="btn btn-ghost btn-sm" onClick={() => setMathTarget(null)}>Huỷ</button>
                                <button className="btn btn-primary btn-sm" onClick={confirmMath} disabled={!mathLatex.trim()}>
                                    <i className="bi bi-plus-lg"></i> Chèn
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
