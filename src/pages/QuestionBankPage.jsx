import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { formatTimeAgo } from '../utils/formatters';
import { renderLatexContent as renderLatex } from '../utils/math';
import { buildExamSearchFields } from '../utils/search';
import {
    appendImportHistoryEntry,
    buildImportHistoryEntry,
} from '../utils/importQuality';
import {
    BANK_SCOPE_PRIVATE,
    BANK_SCOPE_SYSTEM,
    buildQuestionFromBankItem,
    buildSyncExamToPrivateBankOperations,
    commitWriteOperations,
    getQuestionChapter,
} from '../utils/bank';
import {
    BANK_SUBMISSION_STATUS,
    loadTeacherSubmissions,
    submitQuestionSetForModeration,
} from '../utils/bankModeration';
import {
    getTeacherCatalogAccess,
    getTeacherCatalogAccessSummary,
} from '../utils/teacherCatalogAccess';
import {
    BANK_BLUEPRINT_DIFFICULTY_OPTIONS,
    BANK_BLUEPRINT_SCOPE_OPTIONS,
    BANK_BLUEPRINT_TYPE_OPTIONS,
    EXAM_DELIVERY_MODE_META,
    EXAM_DELIVERY_SOURCE_BANK,
    EXAM_DELIVERY_SOURCE_FIXED,
    EXAM_DELIVERY_VARIANT_FIXED,
    EXAM_DELIVERY_VARIANT_PER_ATTEMPT,
    EXAM_DELIVERY_VARIANT_PER_STUDENT,
    computeBankBlueprintQuestionCount,
    createBankBlueprintRow,
    createDefaultExamDeliveryConfig,
    getBankBlueprintGuideSteps,
    getBankScopeLabel,
    getChapterLabel,
    getDifficultyLabel,
    normalizeExamDeliveryConfig,
    matchesBlueprintRow,
    pickBankItemsForDelivery,
    usesBankBlueprint,
} from '../utils/examDelivery';
import { getChoiceDisplayText } from '../utils/examSections';

function escHtml(value) {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    return new Date(value).getTime();
}

function getSourceLabel(item) {
    if (item.scope === BANK_SCOPE_SYSTEM) return 'Ngân hàng hệ thống';
    return item.sourceExamTitle || 'Ngân hàng cá nhân';
}

const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Điền/Tự luận ngắn', essay: 'Tự luận' };
const TYPE_COLORS = { mcq: { bg: '#dbeafe', color: '#1e40af' }, tf: { bg: '#fef3c7', color: '#92400e' }, short_answer: { bg: '#d1fae5', color: '#065f46' }, essay: { bg: '#f3e8ff', color: '#6b21a8' } };
const DIFF_LABELS = { 1: 'Dễ', 2: 'Trung bình', 3: 'Khó' };
const DIFF_COLORS = { 1: { bg: '#d1fae5', color: '#065f46' }, 2: { bg: '#fef3c7', color: '#92400e' }, 3: { bg: '#fee2e2', color: '#991b1b' } };

function getSubmissionStatusMeta(status) {
    switch (status) {
        case BANK_SUBMISSION_STATUS.APPROVED:
            return { label: 'Đã duyệt', className: 'active', icon: 'patch-check-fill' };
        case BANK_SUBMISSION_STATUS.REJECTED:
            return { label: 'Bị từ chối', className: 'expired', icon: 'x-octagon-fill' };
        default:
            return { label: 'Chờ duyệt', className: 'warning', icon: 'hourglass-split' };
    }
}

export default function QuestionBankPage() {
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();

    const [questions, setQuestions] = useState([]);
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(new Set());
    const [generating, setGenerating] = useState(false);
    const [syncingLegacy, setSyncingLegacy] = useState(false);
    const [submittingReview, setSubmittingReview] = useState(false);
    const [teacherSubmissions, setTeacherSubmissions] = useState([]);

    const [filterType, setFilterType] = useState('all');
    const [filterDiff, setFilterDiff] = useState('all');
    const [filterSubject, setFilterSubject] = useState('all');
    const [filterChapter, setFilterChapter] = useState('all');
    const [filterScope, setFilterScope] = useState('all');
    const [search, setSearch] = useState('');
    const [viewMode, setViewMode] = useState('flat');

    const [editingKey, setEditingKey] = useState(null);
    const [editChapter, setEditChapter] = useState('');
    const [editDiff, setEditDiff] = useState(1);
    const [savingMeta, setSavingMeta] = useState(false);

    const [showGenerate, setShowGenerate] = useState(false);
    const [genTitle, setGenTitle] = useState('');
    const [genDeliveryConfig, setGenDeliveryConfig] = useState(() => createDefaultExamDeliveryConfig());

    const isAdmin = userProfile?.role === 'admin';
    const catalogAccess = useMemo(() => getTeacherCatalogAccess(userProfile), [userProfile]);
    const catalogAccessSummary = useMemo(() => getTeacherCatalogAccessSummary(userProfile), [userProfile]);

    const loadBank = useCallback(async () => {
        if (!user?.uid) return;
        setLoading(true);
        try {
            const [examSnap, privateSnap] = await Promise.all([
                getDocs(query(collection(db, 'exams'), where('teacherId', '==', user.uid))),
                getDocs(query(collection(db, 'bankItems'), where('ownerId', '==', user.uid))),
            ]);

            let systemDocs = [];
            if (isAdmin || catalogAccess.hasFullCatalogAccess) {
                const systemSnap = await getDocs(query(collection(db, 'bankItems'), where('scope', '==', BANK_SCOPE_SYSTEM)));
                systemDocs = systemSnap.docs;
            } else if (catalogAccess.allowedPairs.length) {
                const snapshots = await Promise.all(catalogAccess.allowedPairs.map((pair) => getDocs(query(
                    collection(db, 'bankItems'),
                    where('scope', '==', BANK_SCOPE_SYSTEM),
                    where('subject', '==', pair.subject),
                    where('grade', '==', pair.grade),
                ))));
                systemDocs = [...new Map(
                    snapshots.flatMap((snapshot) => snapshot.docs.map((item) => [item.id, item]))
                ).values()];
            }

            const examList = examSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
            const bankItems = [
                ...privateSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
                ...systemDocs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
            ].sort((left, right) => {
                const byUpdatedAt = toMillis(right.updatedAt) - toMillis(left.updatedAt);
                if (byUpdatedAt !== 0) return byUpdatedAt;
                return (left.sourceExamTitle || '').localeCompare(right.sourceExamTitle || '');
            });

            setExams(examList);
            setQuestions(bankItems);
        } catch (error) {
            console.error('load bank failed', error);
            setQuestions([]);
            setExams([]);
        } finally {
            setLoading(false);
        }
    }, [catalogAccess, isAdmin, user?.uid]);

    useEffect(() => {
        if (user && userProfile) loadBank();
    }, [loadBank, user, userProfile]);

    const loadSubmissions = useCallback(async () => {
        if (!user?.uid) return;
        try {
            const rows = await loadTeacherSubmissions(user.uid);
            setTeacherSubmissions(rows);
        } catch (error) {
            console.error('load teacher submissions failed', error);
            setTeacherSubmissions([]);
        }
    }, [user?.uid]);

    useEffect(() => {
        if (user && userProfile) loadSubmissions();
    }, [loadSubmissions, user, userProfile]);

    const privateCount = useMemo(() => questions.filter((question) => question.scope !== BANK_SCOPE_SYSTEM).length, [questions]);
    const systemCount = useMemo(() => questions.filter((question) => question.scope === BANK_SCOPE_SYSTEM).length, [questions]);
    const legacySyncableExams = useMemo(() => exams.filter((exam) => exam.bankSyncEnabled !== false), [exams]);
    const legacyQuestionCount = useMemo(
        () => legacySyncableExams.reduce((total, exam) => total + (Number(exam.questionCount) || 0), 0),
        [legacySyncableExams],
    );

    const subjects = useMemo(() => {
        const pool = filterScope === 'all' ? questions : questions.filter((question) => question.scope === filterScope);
        return [...new Set(pool.map((question) => question.subject).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi'));
    }, [filterScope, questions]);

    const chapters = useMemo(() => {
        const pool = questions.filter((question) => {
            if (filterScope !== 'all' && question.scope !== filterScope) return false;
            if (filterSubject !== 'all' && question.subject !== filterSubject) return false;
            return true;
        });
        return [...new Set(pool.map((question) => getQuestionChapter(question)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi'));
    }, [filterScope, filterSubject, questions]);

    const normalizedGenDelivery = useMemo(() => normalizeExamDeliveryConfig(genDeliveryConfig, {}, { includeBankDefaults: true }), [genDeliveryConfig]);
    const generatorSubjects = useMemo(() => [...new Set(questions.map((question) => question.subject).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi')), [questions]);
    const generatorGrades = useMemo(() => {
        const policy = normalizedGenDelivery.bankPolicy;
        const pool = questions.filter((question) => {
            if (!policy) return true;
            if (policy.scope !== 'all' && question.scope !== policy.scope) return false;
            if (policy.subject && question.subject !== policy.subject) return false;
            return true;
        });
        return [...new Set(pool.map((question) => question.grade).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi'));
    }, [normalizedGenDelivery.bankPolicy, questions]);
    const generatorChapters = useMemo(() => {
        const policy = normalizedGenDelivery.bankPolicy;
        const pool = questions.filter((question) => {
            if (!policy) return true;
            if (policy.scope !== 'all' && question.scope !== policy.scope) return false;
            if (policy.subject && question.subject !== policy.subject) return false;
            if (policy.grade && question.grade !== policy.grade) return false;
            return true;
        });
        return [...new Set(pool.map((question) => getQuestionChapter(question)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi'));
    }, [normalizedGenDelivery.bankPolicy, questions]);
    const generatorAvailability = useMemo(() => {
        const rows = normalizedGenDelivery.bankPolicy?.rows || [];

        return rows.map((row) => {
            const available = questions.filter((question) => matchesBlueprintRow(question, normalizedGenDelivery, row)).length;

            return {
                available,
                error: available < row.count ? `Thiếu ${row.count - available} câu so với cấu hình hiện tại.` : null,
            };
        });
    }, [normalizedGenDelivery, questions]);
    const generatorQuestionCount = useMemo(() => computeBankBlueprintQuestionCount(normalizedGenDelivery), [normalizedGenDelivery]);
    const generatorGuideSteps = useMemo(() => getBankBlueprintGuideSteps(), []);

    const filtered = useMemo(() => questions.filter((question) => {
        if (filterScope !== 'all' && question.scope !== filterScope) return false;
        if (filterType !== 'all' && question.type !== filterType) return false;
        if (filterDiff !== 'all' && String(question.difficulty || 1) !== filterDiff) return false;
        if (filterSubject !== 'all' && question.subject !== filterSubject) return false;
        if (filterChapter !== 'all') {
            const chapter = getQuestionChapter(question);
            if (filterChapter === '__none__' && chapter) return false;
            if (filterChapter !== '__none__' && chapter !== filterChapter) return false;
        }
        if (search.trim()) {
            const token = search.toLowerCase();
            if (![
                question.content_text,
                question.subject,
                question.grade,
                question.chapter,
                question.sectionTitle,
                question.sourceExamTitle,
            ].some((value) => (value || '').toLowerCase().includes(token))) {
                return false;
            }
        }
        return true;
    }), [filterChapter, filterDiff, filterScope, filterSubject, filterType, questions, search]);

    const grouped = useMemo(() => {
        if (viewMode === 'flat') return [];

        const map = new Map();
        filtered.forEach((question) => {
            const subject = question.subject || 'Chưa có môn';
            const chapter = getQuestionChapter(question) || 'Chưa phân chương';
            const key = `${subject}||${chapter}`;
            if (!map.has(key)) {
                map.set(key, { key, subject, chapter, questions: [] });
            }
            map.get(key).questions.push(question);
        });

        return [...map.values()].sort((left, right) => left.subject.localeCompare(right.subject, 'vi') || left.chapter.localeCompare(right.chapter, 'vi'));
    }, [filtered, viewMode]);

    const typeStats = useMemo(() => {
        const counts = { mcq: 0, tf: 0, short_answer: 0, essay: 0 };
        filtered.forEach((question) => {
            if (counts[question.type] !== undefined) counts[question.type] += 1;
        });
        return counts;
    }, [filtered]);

    const activeFilterCount = [
        filterType !== 'all',
        filterDiff !== 'all',
        filterSubject !== 'all',
        filterChapter !== 'all',
        filterScope !== 'all',
        search.trim() !== '',
    ].filter(Boolean).length;

    const selectedQuestions = useMemo(() => filtered.filter((question) => selected.has(question.id)), [filtered, selected]);
    const selectedPrivateQuestions = useMemo(() => selectedQuestions.filter((question) => question.scope === BANK_SCOPE_PRIVATE), [selectedQuestions]);
    const selectedSystemCount = selectedQuestions.length - selectedPrivateQuestions.length;

    const clearFilters = () => {
        setFilterType('all');
        setFilterDiff('all');
        setFilterSubject('all');
        setFilterChapter('all');
        setFilterScope('all');
        setSearch('');
    };

    const toggleSelection = (id) => {
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => setSelected(new Set(filtered.map((question) => question.id)));
    const deselectAll = () => setSelected(new Set());
    const toggleGroupSelection = (groupQuestions) => {
        const fullySelected = groupQuestions.every((question) => selected.has(question.id));
        setSelected((previous) => {
            const next = new Set(previous);
            groupQuestions.forEach((question) => {
                if (fullySelected) next.delete(question.id);
                else next.add(question.id);
            });
            return next;
        });
    };

    const openEdit = (event, question) => {
        event.stopPropagation();
        if (question.scope === BANK_SCOPE_SYSTEM && !isAdmin) return;

        if (editingKey === question.id) {
            setEditingKey(null);
            return;
        }

        setEditingKey(question.id);
        setEditChapter(getQuestionChapter(question) || '');
        setEditDiff(Number(question.difficulty) || 1);
    };

    const saveMeta = async (question) => {
        setSavingMeta(true);
        try {
            const nextChapter = editChapter.trim();
            await updateDoc(doc(db, 'bankItems', question.id), {
                chapter: nextChapter || null,
                difficulty: editDiff,
                updatedAt: serverTimestamp(),
            });

            if (question.scope === BANK_SCOPE_PRIVATE && question.sourceExamId && question.sourceQuestionId) {
                await updateDoc(doc(db, 'exams', question.sourceExamId, 'questions', question.sourceQuestionId), {
                    chapter: nextChapter || null,
                    difficulty: editDiff,
                });
            }

            setQuestions((previous) => previous.map((item) => (
                item.id === question.id
                    ? { ...item, chapter: nextChapter || null, difficulty: editDiff, updatedAt: new Date() }
                    : item
            )));
            setEditingKey(null);
        } catch (error) {
            Swal.fire('Lỗi', error.message, 'error');
        } finally {
            setSavingMeta(false);
        }
    };

    const syncLegacyQuestions = async () => {
        if (!legacySyncableExams.length) {
            Swal.fire('Không có dữ liệu để đồng bộ', 'Kho đề hiện tại không có đề nào cần nhập vào ngân hàng thật.', 'info');
            return;
        }

        setSyncingLegacy(true);
        try {
            const ownerName = userProfile?.displayName || user.displayName || user.email;
            let syncedQuestions = 0;
            const operations = [];

            for (const exam of legacySyncableExams) {
                const snapshot = await getDocs(collection(db, 'exams', exam.id, 'questions'));
                const examQuestions = snapshot.docs.map((questionDoc) => ({ id: questionDoc.id, ...questionDoc.data() }));
                syncedQuestions += examQuestions.length;
                operations.push(...buildSyncExamToPrivateBankOperations({
                    ownerId: user.uid,
                    ownerName,
                    exam,
                    questions: examQuestions,
                    actorId: user.uid,
                    actorName: ownerName,
                }));
            }

            if (!operations.length) {
                Swal.fire('Không có câu hỏi để đồng bộ', 'Các đề đã chọn chưa có câu hỏi hợp lệ.', 'info');
                return;
            }

            await commitWriteOperations(operations);
            await loadBank();
            Swal.fire({
                icon: 'success',
                title: 'Đã đồng bộ ngân hàng',
                text: `${syncedQuestions} câu hỏi từ ${legacySyncableExams.length} đề đã được nạp vào ngân hàng thật.`,
                timer: 1800,
                showConfirmButton: false,
            });
        } catch (error) {
            console.error('sync legacy questions failed', error);
            Swal.fire('Không thể đồng bộ ngân hàng', error.message, 'error');
        } finally {
            setSyncingLegacy(false);
        }
    };

    const resolveExamMeta = (items) => {
        const subjectsInSelection = [...new Set(items.map((item) => item.subject).filter(Boolean))];
        const gradesInSelection = [...new Set(items.map((item) => item.grade).filter(Boolean))];

        return {
            subject: subjectsInSelection.length === 1 ? subjectsInSelection[0] : null,
            grade: gradesInSelection.length === 1 ? gradesInSelection[0] : null,
        };
    };

    const buildBankSourceLabel = (deliveryConfig = null) => {
        const normalized = normalizeExamDeliveryConfig(deliveryConfig, {}, { includeBankDefaults: false });
        if (normalized.source === EXAM_DELIVERY_SOURCE_BANK) {
            if (normalized.variantMode === EXAM_DELIVERY_VARIANT_PER_ATTEMPT) return 'Ngân hàng câu hỏi · Mỗi lượt thi bốc lại';
            return 'Ngân hàng câu hỏi · Mỗi học sinh một bộ';
        }
        return 'Ngân hàng câu hỏi · Bộ câu cố định';
    };

    const buildBankImportQuality = (questionCount) => ({
        parserVersion: 'import-quality-v1',
        sourceFormat: 'bank',
        questionCount,
        validQuestions: questionCount,
        invalidQuestions: 0,
        warningCount: 0,
        warningSamples: [],
        imageCount: 0,
        issueQuestions: [],
        reviewRecommended: false,
        publishBlocked: false,
        teacherReviewed: false,
        teacherReviewedAt: null,
        teacherReviewedBy: null,
        teacherReviewedName: null,
        score: 100,
        status: 'stable',
    });

    const buildExamPayload = (title, items = [], options = {}) => {
        const ownerName = userProfile?.displayName || user.displayName || user.email;
        const derivedMeta = resolveExamMeta(items);
        const normalizedDelivery = options.deliveryConfig
            ? normalizeExamDeliveryConfig(options.deliveryConfig, {
                subject: options.subject || derivedMeta.subject || '',
                grade: options.grade || derivedMeta.grade || '',
            }, { includeBankDefaults: false })
            : null;
        const subject = options.subject ?? normalizedDelivery?.bankPolicy?.subject ?? derivedMeta.subject ?? null;
        const grade = options.grade ?? normalizedDelivery?.bankPolicy?.grade ?? derivedMeta.grade ?? null;
        const questionCount = Number(options.questionCount ?? items.length) || 0;
        const sourceLabel = options.sourceLabel || buildBankSourceLabel(normalizedDelivery);
        const importQuality = options.importQuality || buildBankImportQuality(questionCount);
        const importHistory = appendImportHistoryEntry([], buildImportHistoryEntry({
            kind: 'import_created',
            actorId: user.uid,
            actorName: ownerName,
            actorRole: userProfile?.role || 'teacher',
            at: new Date(),
            note: sourceLabel,
            report: importQuality,
            sourceFormat: 'bank',
        }));

        return {
            title,
            teacherId: user.uid,
            teacherName: ownerName,
            status: 'draft',
            questionCount,
            duration: 45,
            maxAttempts: 1,
            shuffleQuestions: true,
            shuffleChoices: true,
            showResult: true,
            sourceFormat: 'bank',
            sourceLabel,
            subject,
            grade,
            bankSyncEnabled: false,
            importQuality,
            importHistory,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...(normalizedDelivery && usesBankBlueprint(normalizedDelivery) ? { deliveryConfig: normalizedDelivery } : {}),
            ...buildExamSearchFields({
                title,
                subject: subject || '',
                grade: grade || '',
                teacherName: ownerName,
            }),
        };
    };

    const buildQuestionPayload = (item, index) => ({
        ...buildQuestionFromBankItem(item, index),
        sourceBankItemId: item.id,
        sourceBankScope: item.scope || BANK_SCOPE_PRIVATE,
        sourceExamId: item.sourceExamId || null,
    });

    const createExamFromBankItems = async (title, items, options = {}) => {
        const examRef = doc(collection(db, 'exams'));
        const examPayload = buildExamPayload(title, items, options);
        const operations = [{ type: 'set', ref: examRef, data: examPayload }];

        items.forEach((item, index) => {
            operations.push({
                type: 'set',
                ref: doc(collection(db, 'exams', examRef.id, 'questions')),
                data: buildQuestionPayload(item, index),
            });
        });

        await commitWriteOperations(operations);
        navigate(`/teacher/exam/${examRef.id}`);
    };

    const createExamFromBankBlueprint = async (title, deliveryConfig) => {
        const examRef = doc(collection(db, 'exams'));
        const questionCount = computeBankBlueprintQuestionCount(deliveryConfig);
        const examPayload = buildExamPayload(title, [], {
            deliveryConfig,
            questionCount,
            subject: deliveryConfig.bankPolicy?.subject || null,
            grade: deliveryConfig.bankPolicy?.grade || null,
            sourceLabel: buildBankSourceLabel(deliveryConfig),
            importQuality: buildBankImportQuality(questionCount),
        });

        await commitWriteOperations([{ type: 'set', ref: examRef, data: examPayload }]);
        navigate(`/teacher/exam/${examRef.id}`);
    };

    const openGenerateModal = () => {
        setGenTitle('');
        setGenDeliveryConfig({
            source: EXAM_DELIVERY_SOURCE_FIXED,
            variantMode: EXAM_DELIVERY_VARIANT_FIXED,
            bankPolicy: {
                subject: filterSubject !== 'all' ? filterSubject : '',
                grade: '',
                scope: filterScope !== 'all' ? filterScope : 'all',
                rows: [createBankBlueprintRow({ chapter: filterChapter !== 'all' ? filterChapter : 'all' })],
            },
        });
        setShowGenerate(true);
    };

    const closeGenerateModal = () => setShowGenerate(false);

    const updateGeneratorPolicy = (patch = {}) => {
        setGenDeliveryConfig((previous) => ({
            ...previous,
            bankPolicy: {
                ...(previous.bankPolicy || {}),
                ...patch,
            },
        }));
    };

    const updateGeneratorRow = (rowId, patch = {}) => {
        setGenDeliveryConfig((previous) => ({
            ...previous,
            bankPolicy: {
                ...(previous.bankPolicy || {}),
                rows: (previous.bankPolicy?.rows || []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
            },
        }));
    };

    const addGeneratorRow = () => {
        setGenDeliveryConfig((previous) => ({
            ...previous,
            bankPolicy: {
                ...(previous.bankPolicy || {}),
                rows: [
                    ...(previous.bankPolicy?.rows || []),
                    createBankBlueprintRow({ scope: previous.bankPolicy?.scope || 'all' }),
                ],
            },
        }));
    };

    const removeGeneratorRow = (rowId) => {
        setGenDeliveryConfig((previous) => {
            const rows = (previous.bankPolicy?.rows || []).filter((row) => row.id !== rowId);
            return {
                ...previous,
                bankPolicy: {
                    ...(previous.bankPolicy || {}),
                    rows: rows.length > 0 ? rows : [createBankBlueprintRow({ scope: previous.bankPolicy?.scope || 'all' })],
                },
            };
        });
    };

    const createFromSelected = async () => {
        if (!selectedQuestions.length) return;
        const result = await Swal.fire({
            title: 'Tên đề thi mới',
            input: 'text',
            inputPlaceholder: 'VD: Đề ôn tập giữa kỳ',
            showCancelButton: true,
            confirmButtonText: 'Tạo đề',
            cancelButtonText: 'Hủy',
        });
        const title = result.value?.trim();
        if (!title) return;

        setGenerating(true);
        try {
            await createExamFromBankItems(title, selectedQuestions, {
                deliveryConfig: {
                    source: EXAM_DELIVERY_SOURCE_FIXED,
                    variantMode: EXAM_DELIVERY_VARIANT_FIXED,
                    bankPolicy: {
                        subject: resolveExamMeta(selectedQuestions).subject || '',
                        grade: resolveExamMeta(selectedQuestions).grade || '',
                        scope: 'all',
                        rows: [createBankBlueprintRow({ count: selectedQuestions.length })],
                    },
                },
            });
            Swal.fire({ icon: 'success', title: 'Đã tạo đề!', text: `${selectedQuestions.length} câu đã được thêm vào bản nháp mới.`, timer: 1600, showConfirmButton: false });
        } catch (error) {
            Swal.fire('Lỗi', error.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const submitSelectionForReview = async () => {
        if (!selectedPrivateQuestions.length) {
            Swal.fire('Chưa có câu cá nhân', 'Chỉ có thể gửi duyệt các câu thuộc ngân hàng cá nhân của bạn.', 'warning');
            return;
        }

        if (selectedSystemCount > 0) {
            const result = await Swal.fire({
                title: 'Có câu hệ thống trong vùng chọn',
                text: `${selectedSystemCount} câu hệ thống sẽ bị bỏ qua. Chỉ gửi ${selectedPrivateQuestions.length} câu cá nhân?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Tiếp tục gửi duyệt',
                cancelButtonText: 'Hủy',
            });
            if (!result.isConfirmed) return;
        }

        const defaultTitle = selectedPrivateQuestions.length === 1
            ? `Đề chia sẻ - ${selectedPrivateQuestions[0].subject || 'Tổng hợp'}`
            : `Bộ câu chia sẻ (${selectedPrivateQuestions.length} câu)`;

        const result = await Swal.fire({
            title: 'Gửi bộ câu lên ngân hàng chung',
            html: `
                <input id="submission-title" class="swal2-input" placeholder="Tên bộ câu" value="${defaultTitle.replace(/"/g, '&quot;')}">
                <input id="submission-duration" class="swal2-input" type="number" min="5" value="45" placeholder="Thời lượng gợi ý (phút)">
                <textarea id="submission-note" class="swal2-textarea" placeholder="Ghi chú cho admin: phạm vi kiến thức, mục đích dùng, lưu ý chất lượng..."></textarea>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Gửi duyệt',
            cancelButtonText: 'Hủy',
            preConfirm: () => {
                const title = document.getElementById('submission-title')?.value?.trim();
                const duration = Number(document.getElementById('submission-duration')?.value || 45);
                const note = document.getElementById('submission-note')?.value?.trim() || '';
                if (!title) {
                    Swal.showValidationMessage('Nhập tên bộ câu trước khi gửi duyệt.');
                    return null;
                }
                return { title, duration, note };
            },
        });
        if (!result.value) return;

        setSubmittingReview(true);
        try {
            await submitQuestionSetForModeration({
                title: result.value.title,
                duration: result.value.duration,
                note: result.value.note,
                items: selectedPrivateQuestions,
                user,
                userProfile,
            });
            setSelected(new Set());
            await loadSubmissions();
            Swal.fire({ icon: 'success', title: 'Đã gửi duyệt', text: `${selectedPrivateQuestions.length} câu đã được chuyển vào hàng chờ admin duyệt.`, timer: 1800, showConfirmButton: false });
        } catch (error) {
            console.error('submit selection for moderation failed', error);
            Swal.fire('Không thể gửi duyệt', error.message, 'error');
        } finally {
            setSubmittingReview(false);
        }
    };

    const generateExam = async () => {
        if (!genTitle.trim()) {
            Swal.fire('Thiếu tiêu đề', 'Nhập tiêu đề đề thi mới.', 'warning');
            return;
        }

        if (!normalizedGenDelivery.bankPolicy?.rows?.length || generatorQuestionCount <= 0) {
            Swal.fire('Thiếu ma trận', 'Hãy thêm ít nhất 1 dòng ma trận với số câu lớn hơn 0.', 'warning');
            return;
        }

        if (!normalizedGenDelivery.bankPolicy?.subject && generatorSubjects.length > 1) {
            Swal.fire('Chưa chọn môn', 'Hãy chọn môn cho đề từ ngân hàng để tránh trộn câu ở nhiều môn khác nhau.', 'warning');
            return;
        }

        setGenerating(true);
        try {
            const previewSelection = pickBankItemsForDelivery(questions, normalizedGenDelivery);

            if (!previewSelection.length) {
                Swal.fire('Không đủ câu', 'Không tìm thấy câu hỏi phù hợp với ma trận đã chọn.', 'warning');
                return;
            }

            if (normalizedGenDelivery.source === EXAM_DELIVERY_SOURCE_BANK) {
                await createExamFromBankBlueprint(genTitle.trim(), normalizedGenDelivery);
                closeGenerateModal();
                Swal.fire({ icon: 'success', title: 'Đã tạo đề động!', text: `${generatorQuestionCount} câu sẽ được bốc từ ngân hàng khi học sinh bắt đầu thi.`, timer: 1800, showConfirmButton: false });
                return;
            }

            await createExamFromBankItems(genTitle.trim(), previewSelection, {
                deliveryConfig: normalizedGenDelivery,
                questionCount: previewSelection.length,
            });
            closeGenerateModal();
            Swal.fire({ icon: 'success', title: 'Đã tạo đề!', text: `${previewSelection.length} câu từ ngân hàng đã được chốt thành một bộ cố định.`, timer: 1600, showConfirmButton: false });
        } catch (error) {
            Swal.fire('Lỗi', error.message, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const renderCard = (question) => {
        const selectedState = selected.has(question.id);
        const difficulty = Number(question.difficulty) || 1;
        const chapter = getQuestionChapter(question);
        const editing = editingKey === question.id;
        const canEdit = question.scope === BANK_SCOPE_PRIVATE || isAdmin;

        return (
            <motion.div key={question.id} layout className={`bank-q-card${selectedState ? ' selected' : ''}`} onClick={() => toggleSelection(question.id)}>
                <div className="bank-q-check">
                    <div className={`bank-checkbox${selectedState ? ' checked' : ''}`}>{selectedState && <i className="bi bi-check2"></i>}</div>
                </div>
                <div className="bank-q-body">
                    <div className="bank-q-meta">
                        <span className="bank-q-badge" style={{ background: TYPE_COLORS[question.type]?.bg, color: TYPE_COLORS[question.type]?.color }}>
                            {TYPE_LABELS[question.type] || question.type}
                        </span>
                        <span className="bank-q-badge" style={{ background: DIFF_COLORS[difficulty]?.bg, color: DIFF_COLORS[difficulty]?.color }}>
                            {DIFF_LABELS[difficulty]}
                        </span>
                        {chapter && <span className="bank-q-badge bank-q-chapter"><i className="bi bi-bookmark-fill"></i> {chapter}</span>}
                        <span className={`bank-q-source-pill ${question.scope === BANK_SCOPE_SYSTEM ? 'system' : 'private'}`}>
                            <i className={`bi bi-${question.scope === BANK_SCOPE_SYSTEM ? 'database' : 'person-badge'}`}></i>
                            {getSourceLabel(question)}
                        </span>
                        {question.subject && <span className="bank-q-subject-pill">{question.subject}</span>}
                        {question.grade && <span className="bank-q-grade-pill">{question.grade}</span>}
                        {canEdit && (
                            <button className="bank-q-edit-btn" onClick={(event) => openEdit(event, question)} title="Sửa chương / độ khó">
                                <i className="bi bi-pencil-square"></i>
                            </button>
                        )}
                    </div>

                    <div className="bank-q-content" dangerouslySetInnerHTML={{ __html: renderLatex(question.content_html || escHtml(question.content_text) || '<em>Câu hỏi trống</em>') }} />

                    {question.choices?.length > 0 && (
                        <div className="bank-q-choices">
                            {question.choices.slice(0, 4).map((choice, index) => (
                                <span key={index} className={`bank-q-choice${question.correct_answer === choice.letter ? ' correct' : ''}`}>
                                    {choice.letter}. {getChoiceDisplayText(choice, question.type, index).slice(0, 50)}
                                </span>
                            ))}
                        </div>
                    )}

                    <AnimatePresence>
                        {editing && (
                            <motion.div
                                className="bank-meta-panel"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                onClick={(event) => event.stopPropagation()}
                            >
                                <div className="bank-meta-row">
                                    <label className="bank-meta-label"><i className="bi bi-bookmark"></i> Chương / Chủ đề</label>
                                    <input
                                        className="bank-meta-input"
                                        value={editChapter}
                                        onChange={(event) => setEditChapter(event.target.value)}
                                        placeholder="VD: Chương 3 – Phương trình"
                                    />
                                </div>
                                <div className="bank-meta-row">
                                    <label className="bank-meta-label"><i className="bi bi-bar-chart-steps"></i> Độ khó</label>
                                    <div className="bank-meta-diff-btns">
                                        {[1, 2, 3].map((value) => (
                                            <button
                                                key={value}
                                                className={`bank-meta-diff-btn${editDiff === value ? ' active' : ''}`}
                                                style={editDiff === value ? { background: DIFF_COLORS[value].bg, color: DIFF_COLORS[value].color, borderColor: DIFF_COLORS[value].color } : {}}
                                                onClick={() => setEditDiff(value)}
                                            >
                                                {DIFF_LABELS[value]}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="bank-meta-actions">
                                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingKey(null)}>Hủy</button>
                                    <button className="btn btn-primary btn-sm" onClick={() => saveMeta(question)} disabled={savingMeta}>
                                        {savingMeta ? '...' : <><i className="bi bi-check2"></i> Lưu</>}
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        );
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải ngân hàng câu hỏi...</p></div>;

    return (
        <div className="bank-page">
            {!catalogAccess.hasFullCatalogAccess && (
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                    <i className="bi bi-funnel"></i> Bạn đang dùng <strong>{catalogAccessSummary.packageLabel}</strong>: {catalogAccessSummary.subjectsText} · {catalogAccessSummary.gradesText}. Ngân hàng hệ thống đã được lọc theo đúng gói truy cập.
                </div>
            )}
            <div className="bank-header">
                <div>
                    <Link to="/teacher" className="breadcrumb-link"><i className="bi bi-arrow-left"></i> Kho đề</Link>
                    <h1 className="bank-title"><i className="bi bi-database-fill"></i> Ngân hàng câu hỏi</h1>
                    <p className="bank-sub">
                        <strong>{questions.length}</strong> câu
                        {' · '}
                        <strong>{privateCount}</strong> cá nhân
                        {' · '}
                        <strong>{systemCount}</strong> hệ thống
                        {' · '}
                        <strong>{legacySyncableExams.length}</strong> đề nguồn có thể đồng bộ
                    </p>
                </div>
                <div className="bank-header-actions">
                    <div className="bank-view-toggle">
                        <button className={`bank-view-btn${viewMode === 'flat' ? ' active' : ''}`} onClick={() => setViewMode('flat')} title="Danh sách phẳng"><i className="bi bi-list-ul"></i></button>
                        <button className={`bank-view-btn${viewMode === 'grouped' ? ' active' : ''}`} onClick={() => setViewMode('grouped')} title="Nhóm theo môn/chương"><i className="bi bi-collection"></i></button>
                    </div>
                    <button className="btn btn-outline" onClick={syncLegacyQuestions} disabled={syncingLegacy || legacySyncableExams.length === 0}>
                        <i className="bi bi-arrow-repeat"></i> {syncingLegacy ? 'Đang đồng bộ...' : 'Đồng bộ từ kho đề'}
                    </button>
                    {selectedPrivateQuestions.length > 0 && (
                        <button className="btn btn-outline" onClick={submitSelectionForReview} disabled={submittingReview}>
                            <i className="bi bi-send-check"></i> {submittingReview ? 'Đang gửi duyệt...' : `Gửi duyệt ${selectedPrivateQuestions.length} câu`}
                        </button>
                    )}
                    <button className="btn btn-outline" onClick={openGenerateModal}>
                        <i className="bi bi-magic"></i> Tạo đề tự động
                    </button>
                    {selected.size > 0 && (
                        <button className="btn btn-primary" onClick={createFromSelected} disabled={generating}>
                            <i className="bi bi-plus-square"></i> Tạo đề từ {selected.size} câu
                        </button>
                    )}
                </div>
            </div>

            {legacyQuestionCount > 0 && (
                <div className="alert alert-info" style={{ marginBottom: 16 }}>
                    <i className="bi bi-info-circle"></i>
                    Ngân hàng thật đang dùng collection riêng. Bạn có thể nhập <strong>{legacyQuestionCount}</strong> câu từ các đề đã lưu trước đây bằng nút Đồng bộ từ kho đề.
                </div>
            )}

            {teacherSubmissions.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                        <div>
                            <h3><i className="bi bi-send-check"></i> Bộ câu đã gửi duyệt</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>Theo dõi tiến trình đưa câu hỏi cá nhân lên ngân hàng chung có kiểm duyệt.</p>
                        </div>
                    </div>
                    <div className="card-body submission-list-grid">
                        {teacherSubmissions.slice(0, 4).map((submission) => {
                            const status = getSubmissionStatusMeta(submission.status);
                            return (
                                <div key={submission.id} className="submission-status-card">
                                    <div className="submission-status-head">
                                        <div>
                                            <div className="submission-status-title">{submission.title}</div>
                                            <div className="submission-status-meta">{submission.questionCount || 0} câu · {formatTimeAgo(submission.submittedAt)}</div>
                                        </div>
                                        <span className={`stat-badge ${status.className}`}><i className={`bi bi-${status.icon}`}></i> {status.label}</span>
                                    </div>
                                    {submission.note && <div className="submission-status-note">Ghi chú gửi duyệt: {submission.note}</div>}
                                    {submission.reviewNote && <div className="submission-status-review">Phản hồi admin: {submission.reviewNote}</div>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="bank-stats-row">
                {Object.entries(TYPE_LABELS).map(([type, label]) => (
                    <button
                        key={type}
                        className={`bank-stat-chip${filterType === type ? ' active' : ''}`}
                        style={filterType === type ? { background: TYPE_COLORS[type]?.bg, color: TYPE_COLORS[type]?.color, borderColor: TYPE_COLORS[type]?.color } : {}}
                        onClick={() => setFilterType(filterType === type ? 'all' : type)}
                    >
                        {label} <span className="bank-stat-count">{typeStats[type]}</span>
                    </button>
                ))}
                {activeFilterCount > 0 && <span className="bank-filter-active"><i className="bi bi-funnel-fill"></i> {filtered.length}/{questions.length} câu</span>}
            </div>

            <div className="bank-filters">
                <div className="bank-search-wrap">
                    <i className="bi bi-search bank-search-icon"></i>
                    <input type="text" className="bank-search" placeholder="Tìm câu hỏi, chương, môn..." value={search} onChange={(event) => setSearch(event.target.value)} />
                    {search && <button className="bank-search-clear" onClick={() => setSearch('')}>&times;</button>}
                </div>
                <select className="bank-select" value={filterScope} onChange={(event) => { setFilterScope(event.target.value); setFilterSubject('all'); setFilterChapter('all'); }}>
                    <option value="all">Mọi nguồn</option>
                    <option value={BANK_SCOPE_PRIVATE}>Ngân hàng cá nhân</option>
                    {systemCount > 0 && <option value={BANK_SCOPE_SYSTEM}>Ngân hàng hệ thống</option>}
                </select>
                <select className="bank-select" value={filterDiff} onChange={(event) => setFilterDiff(event.target.value)}>
                    <option value="all">Mọi độ khó</option>
                    <option value="1">Dễ</option>
                    <option value="2">Trung bình</option>
                    <option value="3">Khó</option>
                </select>
                {subjects.length > 0 && (
                    <select className="bank-select" value={filterSubject} onChange={(event) => { setFilterSubject(event.target.value); setFilterChapter('all'); }}>
                        <option value="all">Mọi môn</option>
                        {subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                    </select>
                )}
                {chapters.length > 0 && (
                    <select className="bank-select" value={filterChapter} onChange={(event) => setFilterChapter(event.target.value)}>
                        <option value="all">Mọi chương</option>
                        <option value="__none__">Chưa phân chương</option>
                        {chapters.map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}
                    </select>
                )}
                {activeFilterCount > 0 && (
                    <button className="bank-clear-btn" onClick={clearFilters}><i className="bi bi-x-circle"></i> Xóa lọc ({activeFilterCount})</button>
                )}
                <div className="bank-sel-actions">
                    {selected.size > 0
                        ? <button className="bank-sel-btn" onClick={deselectAll}><i className="bi bi-dash-square"></i> Bỏ chọn ({selected.size})</button>
                        : <button className="bank-sel-btn" onClick={selectAll}><i className="bi bi-check-square"></i> Chọn tất cả ({filtered.length})</button>}
                </div>
            </div>

            {filtered.length === 0 ? (
                <div className="empty-state">
                    <i className="bi bi-search"></i>
                    <p>{questions.length === 0 ? 'Ngân hàng thật đang trống. Hãy đồng bộ từ kho đề hoặc lưu đề mới để bắt đầu.' : 'Không có câu hỏi phù hợp với bộ lọc.'}</p>
                    {activeFilterCount > 0 && <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={clearFilters}>Xóa bộ lọc</button>}
                    {questions.length === 0 && legacySyncableExams.length > 0 && (
                        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={syncLegacyQuestions} disabled={syncingLegacy}>
                            <i className="bi bi-arrow-repeat"></i> {syncingLegacy ? 'Đang đồng bộ...' : 'Nhập câu hỏi từ kho đề hiện có'}
                        </button>
                    )}
                </div>
            ) : viewMode === 'flat' ? (
                <div className="bank-list">{filtered.map((question) => renderCard(question))}</div>
            ) : (
                <div className="bank-grouped">
                    {grouped.map((group) => (
                        <div key={group.key} className="bank-group">
                            <div className="bank-group-header">
                                {group.subject !== 'Chưa có môn' && <span className="bank-group-subject">{group.subject}</span>}
                                <span className="bank-group-chapter"><i className="bi bi-bookmark"></i> {group.chapter}</span>
                                <span className="bank-group-count">{group.questions.length} câu</span>
                                <button className="bank-group-sel-btn" onClick={() => toggleGroupSelection(group.questions)}>
                                    {group.questions.every((question) => selected.has(question.id)) ? 'Bỏ chọn nhóm' : 'Chọn nhóm'}
                                </button>
                            </div>
                            <div className="bank-list" style={{ padding: '10px 12px' }}>{group.questions.map((question) => renderCard(question))}</div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
                {showGenerate && (
                    <motion.div className="ed-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(event) => { if (event.target === event.currentTarget) closeGenerateModal(); }}>
                        <motion.div className="ed-dialog" style={{ maxWidth: 920, width: 'min(92vw, 920px)' }} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
                            <div className="ed-head">
                                <span style={{ fontWeight: 700, fontSize: '1.05rem' }}><i className="bi bi-magic"></i> Tạo đề từ ngân hàng</span>
                                <button type="button" className="ed-close" onClick={closeGenerateModal}>&times;</button>
                            </div>
                            <div style={{ padding: 20, display: 'grid', gap: 16, maxHeight: '78vh', overflowY: 'auto' }}>
                                <div className="ed-field">
                                    <label className="ed-label">Tiêu đề đề thi <span style={{ color: 'var(--danger)' }}>*</span></label>
                                    <input className="ed-cinput full" value={genTitle} onChange={(event) => setGenTitle(event.target.value)} placeholder="VD: Đề kiểm tra 1 tiết – Chương 1" />
                                </div>

                                <div style={{ display: 'grid', gap: 10 }}>
                                    <div className="ed-label">Mode phát đề cho học sinh</div>
                                    <div style={{ display: 'grid', gap: 10 }}>
                                        {[
                                            { value: EXAM_DELIVERY_VARIANT_FIXED, source: EXAM_DELIVERY_SOURCE_FIXED, icon: 'list-check' },
                                            { value: EXAM_DELIVERY_VARIANT_PER_STUDENT, source: EXAM_DELIVERY_SOURCE_BANK, icon: 'people' },
                                            { value: EXAM_DELIVERY_VARIANT_PER_ATTEMPT, source: EXAM_DELIVERY_SOURCE_BANK, icon: 'shuffle' },
                                        ].map((mode) => {
                                            const active = normalizedGenDelivery.variantMode === mode.value && normalizedGenDelivery.source === mode.source;
                                            const meta = EXAM_DELIVERY_MODE_META[mode.value];

                                            return (
                                                <button
                                                    key={mode.value}
                                                    type="button"
                                                    className={`bank-gen-tab${active ? ' active' : ''}`}
                                                    style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '12px 14px', display: 'grid', gap: 4 }}
                                                    onClick={() => setGenDeliveryConfig((previous) => ({
                                                        ...previous,
                                                        source: mode.source,
                                                        variantMode: mode.value,
                                                    }))}
                                                >
                                                    <span><i className={`bi bi-${mode.icon}`}></i> {meta.label}</span>
                                                    <small style={{ opacity: 0.8 }}>{meta.description}</small>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                    <div className="ed-field" style={{ flex: 1 }}>
                                        <label className="ed-label">Môn áp dụng</label>
                                        <select className="form-select" value={normalizedGenDelivery.bankPolicy?.subject || ''} onChange={(event) => updateGeneratorPolicy({ subject: event.target.value })}>
                                            <option value="">Tất cả môn trong ngân hàng hiện tại</option>
                                            {generatorSubjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                                        </select>
                                    </div>
                                    <div className="ed-field" style={{ flex: 1 }}>
                                        <label className="ed-label">Khối / lớp</label>
                                        <select className="form-select" value={normalizedGenDelivery.bankPolicy?.grade || ''} onChange={(event) => updateGeneratorPolicy({ grade: event.target.value })}>
                                            <option value="">Tất cả khối hiện có</option>
                                            {generatorGrades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                                        </select>
                                    </div>
                                    <div className="ed-field" style={{ flex: 1 }}>
                                        <label className="ed-label">Nguồn mặc định</label>
                                        <select className="form-select" value={normalizedGenDelivery.bankPolicy?.scope || 'all'} onChange={(event) => updateGeneratorPolicy({ scope: event.target.value })}>
                                            {BANK_BLUEPRINT_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="card" style={{ background: 'var(--bg-secondary, #f8fafc)', border: '1px solid var(--border, #e2e8f0)' }}>
                                    <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                            <div>
                                                <strong><i className="bi bi-grid-1x2"></i> Ma trận chọn câu</strong>
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>Mỗi dòng tương ứng một nhóm câu cần lấy từ ngân hàng.</div>
                                            </div>
                                            <button type="button" className="btn btn-outline btn-sm" onClick={addGeneratorRow}>
                                                <i className="bi bi-plus-lg"></i> Thêm dòng
                                            </button>
                                        </div>

                                        {(normalizedGenDelivery.bankPolicy?.rows || []).map((row, index) => {
                                            const availability = generatorAvailability[index] || { available: 0, error: null };
                                            return (
                                                <div key={row.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, display: 'grid', gap: 10, background: '#fff' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                        <strong>Dòng {index + 1}</strong>
                                                        <button type="button" className="btn-icon-sm danger" onClick={() => removeGeneratorRow(row.id)} title="Xóa dòng">
                                                            <i className="bi bi-trash3"></i>
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                                                        <div className="ed-field" style={{ marginBottom: 0 }}>
                                                            <label className="ed-label">Số câu</label>
                                                            <input type="number" min={1} className="ed-cinput" value={row.count} onChange={(event) => updateGeneratorRow(row.id, { count: Number(event.target.value) || 0 })} />
                                                        </div>
                                                        <div className="ed-field" style={{ marginBottom: 0 }}>
                                                            <label className="ed-label">Loại câu</label>
                                                            <select className="form-select" value={row.type} onChange={(event) => updateGeneratorRow(row.id, { type: event.target.value })}>
                                                                {BANK_BLUEPRINT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="ed-field" style={{ marginBottom: 0 }}>
                                                            <label className="ed-label">Độ khó</label>
                                                            <select className="form-select" value={row.difficulty} onChange={(event) => updateGeneratorRow(row.id, { difficulty: event.target.value })}>
                                                                {BANK_BLUEPRINT_DIFFICULTY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="ed-field" style={{ marginBottom: 0 }}>
                                                            <label className="ed-label">Chương</label>
                                                            <select className="form-select" value={row.chapter} onChange={(event) => updateGeneratorRow(row.id, { chapter: event.target.value })}>
                                                                <option value="all">Mọi chương</option>
                                                                <option value="__none__">Chưa phân chương</option>
                                                                {generatorChapters.map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}
                                                            </select>
                                                        </div>
                                                        <div className="ed-field" style={{ marginBottom: 0 }}>
                                                            <label className="ed-label">Nguồn riêng</label>
                                                            <select className="form-select" value={row.scope} onChange={(event) => updateGeneratorRow(row.id, { scope: event.target.value })}>
                                                                {BANK_BLUEPRINT_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: '0.84rem' }}>
                                                        <span className={`stat-badge ${availability.error ? 'warning' : 'success'}`}>
                                                            <i className={`bi bi-${availability.error ? 'exclamation-triangle' : 'check2-circle'}`}></i> Khả dụng: {availability.available} câu
                                                        </span>
                                                        <span style={{ color: availability.error ? '#b45309' : 'var(--text-muted)' }}>
                                                            {availability.error || `${row.count} câu · ${BANK_BLUEPRINT_TYPE_OPTIONS.find((option) => option.value === row.type)?.label || 'Tất cả loại'} · ${getDifficultyLabel(row.difficulty)} · ${getChapterLabel(row.chapter)} · ${getBankScopeLabel(row.scope === 'all' ? normalizedGenDelivery.bankPolicy?.scope : row.scope)}`}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div className="bank-distrib-total">Tổng cộng dự kiến: <strong>{generatorQuestionCount}</strong> câu</div>
                                    </div>
                                </div>

                                <div className="alert alert-info" style={{ margin: 0 }}>
                                    <i className="bi bi-journal-text"></i>
                                    <strong style={{ marginLeft: 6 }}>HDSD nhanh cho giáo viên</strong>
                                    <ol style={{ margin: '10px 0 0 18px', padding: 0, lineHeight: 1.8 }}>
                                        {generatorGuideSteps.map((step) => <li key={step}>{step}</li>)}
                                    </ol>
                                </div>
                            </div>
                            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                <button className="btn btn-outline btn-sm" onClick={closeGenerateModal}>Hủy</button>
                                <button className="btn btn-primary btn-sm" onClick={generateExam} disabled={generating || !genTitle.trim()}>
                                    {generating ? 'Đang tạo...' : <><i className="bi bi-magic"></i> Tạo đề</>}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}