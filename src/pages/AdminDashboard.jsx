import React, { useState, useEffect, useCallback, useDeferredValue, useMemo } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, Timestamp, orderBy, limit, startAfter } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate, formatTimeAgo } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import { logAuditEvent } from '../utils/audit';
import Swal from 'sweetalert2';
import { estimateTeacherCost, formatBytes, formatCurrencyVnd, getUsageTier } from '../utils/cost';
import { normalizeSearchTerm } from '../utils/search';
import AISettingsPanel from '../components/AISettingsPanel';
import {
    DEFAULT_TAXONOMY,
    formatTaxonomyTextarea,
    loadTaxonomyConfig,
    parseTaxonomyTextarea,
    saveTaxonomyConfig,
} from '../utils/taxonomy';
import {
    DEFAULT_ADMIN_PLAYBOOK,
    loadAdminPlaybook,
    saveAdminPlaybook,
} from '../utils/adminPlaybook';
import {
    MAX_TEACHER_ACCESS_PAIRS,
    TEACHER_PACKAGE_TYPES,
    buildTeacherCatalogAccessPayload,
    getTeacherCatalogAccessSummary,
} from '../utils/teacherCatalogAccess';
import {
    approveBankSubmission,
    BANK_SUBMISSION_STATUS,
    loadModerationSubmissions,
    loadSubmissionQuestions,
    rejectBankSubmission,
} from '../utils/bankModeration';
import {
    approveTeacherPlanRequest,
    formatTeacherPlanDuration,
    getTeacherPlanRequestStatusMeta,
    getTeacherPlanRequestTypeMeta,
    loadAdminTeacherPlanRequests,
    rejectTeacherPlanRequest,
    TEACHER_PLAN_REQUEST_STATUS,
} from '../utils/teacherPlanRequests';
import { getTeacherComputedStatus } from '../utils/teacherPlan';

const USAGE_PAGE_SIZE = 20;

function generateSlug(name) {
    return (name || 'user')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 40);
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderCheckboxList(options = [], selected = [], inputName = '') {
    return options.map((option) => {
        const checked = selected.includes(option) ? 'checked' : '';
        const safe = escapeHtml(option);
        return `
            <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer;">
                <input type="checkbox" name="${inputName}" value="${safe}" ${checked}>
                <span>${safe}</span>
            </label>
        `;
    }).join('');
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    return new Date(value).getTime();
}

function getMissingFieldLabel(missingSubject, missingGrade) {
    if (missingSubject && missingGrade) return 'Thiếu môn và khối';
    if (missingSubject) return 'Thiếu môn';
    if (missingGrade) return 'Thiếu khối';
    return 'Đủ metadata';
}

export default function AdminDashboard() {
    const { user } = useAuth();
    const [teachers, setTeachers] = useState([]);
    const [stats, setStats] = useState({ pending: 0, free: 0, active: 0, expired: 0 });
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('teachers');
    const [usageRows, setUsageRows] = useState([]);
    const [usageLoading, setUsageLoading] = useState(false);
    const [usageCursor, setUsageCursor] = useState(null);
    const [hasMoreUsage, setHasMoreUsage] = useState(false);
    const [rebuildingUsage, setRebuildingUsage] = useState(false);
    const [taxonomyLoading, setTaxonomyLoading] = useState(true);
    const [taxonomySaving, setTaxonomySaving] = useState(false);
    const [taxonomyMeta, setTaxonomyMeta] = useState(null);
    const [taxonomyDraft, setTaxonomyDraft] = useState({
        grades: formatTaxonomyTextarea(DEFAULT_TAXONOMY.grades),
        subjects: formatTaxonomyTextarea(DEFAULT_TAXONOMY.subjects),
    });
    const [playbookLoading, setPlaybookLoading] = useState(true);
    const [playbookSaving, setPlaybookSaving] = useState(false);
    const [playbookMeta, setPlaybookMeta] = useState(null);
    const [playbookDraft, setPlaybookDraft] = useState({
        collectionMap: DEFAULT_ADMIN_PLAYBOOK.collectionMap,
        dailyWorkflow: DEFAULT_ADMIN_PLAYBOOK.dailyWorkflow,
        subjectLockPlan: DEFAULT_ADMIN_PLAYBOOK.subjectLockPlan,
        privateNotes: DEFAULT_ADMIN_PLAYBOOK.privateNotes,
    });
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogHealth, setCatalogHealth] = useState({
        systemItemCount: 0,
        systemSourceCount: 0,
        dirtySystemItemCount: 0,
        dirtySourceCount: 0,
        issueRows: [],
        sharedPublishedCount: 0,
        sharedIssueRows: [],
    });
    const [moderationRows, setModerationRows] = useState([]);
    const [moderationLoading, setModerationLoading] = useState(false);
    const [moderationFilter, setModerationFilter] = useState(BANK_SUBMISSION_STATUS.PENDING);
    const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
    const [selectedSubmissionQuestions, setSelectedSubmissionQuestions] = useState([]);
    const [submissionQuestionsLoading, setSubmissionQuestionsLoading] = useState(false);
    const [moderationActingId, setModerationActingId] = useState(null);
    const [planRequests, setPlanRequests] = useState([]);
    const [planRequestsLoading, setPlanRequestsLoading] = useState(false);
    const [planRequestFilter, setPlanRequestFilter] = useState(TEACHER_PLAN_REQUEST_STATUS.PENDING);
    const [planRequestActingId, setPlanRequestActingId] = useState(null);
    const deferredSearch = useDeferredValue(search);
    const searchToken = normalizeSearchTerm(deferredSearch).split(' ').filter(Boolean)[0] || '';
    const selectedSubmission = moderationRows.find((row) => row.id === selectedSubmissionId) || null;
    const adminTabLabel = {
        teachers: 'Giáo viên',
        billing: 'Nâng cấp / gia hạn',
        usage: 'Usage / Cost',
        catalog: 'Gói & Kho',
        moderation: 'Duyệt ngân hàng',
        taxonomy: 'Taxonomy',
        playbook: 'Sơ đồ vận hành',
        ai: 'AI BYOK',
    }[activeTab] || 'Giáo viên';

    const loadTaxonomy = useCallback(async () => {
        setTaxonomyLoading(true);
        try {
            const config = await loadTaxonomyConfig();
            setTaxonomyMeta(config);
            setTaxonomyDraft({
                grades: formatTaxonomyTextarea(config.grades),
                subjects: formatTaxonomyTextarea(config.subjects),
            });
        } catch (error) {
            console.error('load taxonomy failed', error);
        } finally {
            setTaxonomyLoading(false);
        }
    }, []);

    const loadPlaybook = useCallback(async () => {
        if (!user?.uid) {
            setPlaybookLoading(false);
            return;
        }

        setPlaybookLoading(true);
        try {
            const data = await loadAdminPlaybook(user.uid);
            setPlaybookMeta(data);
            setPlaybookDraft({
                collectionMap: data.collectionMap,
                dailyWorkflow: data.dailyWorkflow,
                subjectLockPlan: data.subjectLockPlan,
                privateNotes: data.privateNotes,
            });
        } catch (error) {
            console.error('load admin playbook failed', error);
        } finally {
            setPlaybookLoading(false);
        }
    }, [user?.uid]);

    const loadCatalogHealth = useCallback(async () => {
        setCatalogLoading(true);
        try {
            const [systemBankSnapshot, sharedExamSnapshot] = await Promise.all([
                getDocs(query(collection(db, 'bankItems'), where('scope', '==', 'system'))),
                getDocs(query(collection(db, 'sharedExams'), where('published', '==', true))),
            ]);

            const systemItems = systemBankSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            const systemSourceMap = new Map();
            let dirtySystemItemCount = 0;

            systemItems.forEach((item) => {
                const sourceKey = item.sourceExamId || item.sourceExamTitle || item.id;
                const row = systemSourceMap.get(sourceKey) || {
                    sourceKey,
                    sourceExamId: item.sourceExamId || null,
                    title: item.sourceExamTitle || 'Đề hệ thống không rõ nguồn',
                    subject: item.subject || null,
                    grade: item.grade || null,
                    issueCount: 0,
                    questionCount: 0,
                    missingSubjectCount: 0,
                    missingGradeCount: 0,
                    updatedAt: item.updatedAt || null,
                };

                row.questionCount += 1;
                row.updatedAt = toMillis(item.updatedAt) > toMillis(row.updatedAt) ? item.updatedAt : row.updatedAt;
                if (!row.subject && item.subject) row.subject = item.subject;
                if (!row.grade && item.grade) row.grade = item.grade;

                const missingSubject = !item.subject;
                const missingGrade = !item.grade;
                if (missingSubject || missingGrade) {
                    dirtySystemItemCount += 1;
                    row.issueCount += 1;
                    if (missingSubject) row.missingSubjectCount += 1;
                    if (missingGrade) row.missingGradeCount += 1;
                }

                systemSourceMap.set(sourceKey, row);
            });

            const issueRows = [...systemSourceMap.values()]
                .filter((row) => row.issueCount > 0)
                .sort((left, right) => right.issueCount - left.issueCount || toMillis(right.updatedAt) - toMillis(left.updatedAt));

            const sharedIssueRows = sharedExamSnapshot.docs
                .map((item) => ({ id: item.id, ...item.data() }))
                .filter((item) => !item.subject || !item.grade)
                .sort((left, right) => toMillis(right.updatedAt || right.publishedAt) - toMillis(left.updatedAt || left.publishedAt))
                .map((item) => ({
                    id: item.id,
                    title: item.title || 'Đề thư viện không rõ tên',
                    sourceExamId: item.sourceExamId || null,
                    missingSubject: !item.subject,
                    missingGrade: !item.grade,
                    updatedAt: item.updatedAt || item.publishedAt || null,
                }));

            setCatalogHealth({
                systemItemCount: systemItems.length,
                systemSourceCount: systemSourceMap.size,
                dirtySystemItemCount,
                dirtySourceCount: issueRows.length,
                issueRows,
                sharedPublishedCount: sharedExamSnapshot.size,
                sharedIssueRows,
            });
        } catch (error) {
            console.error('load catalog health failed', error);
            setCatalogHealth({
                systemItemCount: 0,
                systemSourceCount: 0,
                dirtySystemItemCount: 0,
                dirtySourceCount: 0,
                issueRows: [],
                sharedPublishedCount: 0,
                sharedIssueRows: [],
            });
        } finally {
            setCatalogLoading(false);
        }
    }, []);

    const loadPlanRequestQueue = useCallback(async () => {
        setPlanRequestsLoading(true);
        try {
            const rows = await loadAdminTeacherPlanRequests({ maxResults: 200 });
            setPlanRequests(rows);
        } catch (error) {
            console.error('load teacher plan requests failed', error);
            setPlanRequests([]);
        } finally {
            setPlanRequestsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
        loadTaxonomy();
        loadPlaybook();
        loadPlanRequestQueue();
    }, [loadPlanRequestQueue, loadPlaybook, loadTaxonomy]);

    const previewGrades = parseTaxonomyTextarea(taxonomyDraft.grades);
    const previewSubjects = parseTaxonomyTextarea(taxonomyDraft.subjects);
    const teacherLookup = useMemo(() => new Map(teachers.map((teacher) => [teacher.uid, teacher])), [teachers]);
    const packageOverview = useMemo(() => {
        const teacherRows = teachers.filter((teacher) => teacher.role === 'teacher');
        const typeBuckets = {
            [TEACHER_PACKAGE_TYPES.FULL_CATALOG]: { key: TEACHER_PACKAGE_TYPES.FULL_CATALOG, label: 'Toàn bộ kho', icon: 'grid-3x3-gap', color: 'cool', total: 0, active: 0, free: 0, expired: 0 },
            [TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT]: { key: TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT, label: 'Gói môn', icon: 'book', color: 'success', total: 0, active: 0, free: 0, expired: 0 },
            [TEACHER_PACKAGE_TYPES.MULTI_SUBJECT]: { key: TEACHER_PACKAGE_TYPES.MULTI_SUBJECT, label: 'Gói liên môn', icon: 'bookshelf', color: 'warm', total: 0, active: 0, free: 0, expired: 0 },
            [TEACHER_PACKAGE_TYPES.CUSTOM]: { key: TEACHER_PACKAGE_TYPES.CUSTOM, label: 'Tùy chỉnh', icon: 'sliders', color: 'gold', total: 0, active: 0, free: 0, expired: 0 },
        };
        const packageMap = new Map();
        const subjectMap = new Map();

        teacherRows.forEach((teacher) => {
            const accessSummary = getTeacherCatalogAccessSummary(teacher, {
                subjects: previewSubjects,
                grades: previewGrades,
            });
            const packageKey = accessSummary.hasFullCatalogAccess ? TEACHER_PACKAGE_TYPES.FULL_CATALOG : accessSummary.packageType;
            const bucket = typeBuckets[packageKey] || typeBuckets[TEACHER_PACKAGE_TYPES.CUSTOM];
            bucket.total += 1;
            if (teacher.computedStatus === 'active') bucket.active += 1;
            if (teacher.computedStatus === 'free') bucket.free += 1;
            if (teacher.computedStatus === 'expired') bucket.expired += 1;

            const labelKey = `${packageKey}::${accessSummary.packageLabel}`;
            const packageRow = packageMap.get(labelKey) || {
                key: labelKey,
                packageLabel: accessSummary.packageLabel,
                badgeLabel: accessSummary.badgeLabel,
                badgeClass: accessSummary.badgeClass,
                packageType: packageKey,
                total: 0,
                active: 0,
                free: 0,
                expired: 0,
                subjects: new Set(),
                grades: new Set(),
            };

            packageRow.total += 1;
            if (teacher.computedStatus === 'active') packageRow.active += 1;
            if (teacher.computedStatus === 'free') packageRow.free += 1;
            if (teacher.computedStatus === 'expired') packageRow.expired += 1;
            accessSummary.approvedSubjects?.forEach((subject) => packageRow.subjects.add(subject));
            accessSummary.approvedGrades?.forEach((grade) => packageRow.grades.add(grade));
            packageMap.set(labelKey, packageRow);

            if (!accessSummary.hasFullCatalogAccess) {
                accessSummary.approvedSubjects?.forEach((subject) => {
                    const row = subjectMap.get(subject) || { subject, total: 0, active: 0, free: 0, expired: 0 };
                    row.total += 1;
                    if (teacher.computedStatus === 'active') row.active += 1;
                    if (teacher.computedStatus === 'free') row.free += 1;
                    if (teacher.computedStatus === 'expired') row.expired += 1;
                    subjectMap.set(subject, row);
                });
            }
        });

        return {
            totalTeachers: teacherRows.length,
            monetizedTeachers: teacherRows.filter((teacher) => teacher.computedStatus === 'active').length,
            packageTypeRows: Object.values(typeBuckets),
            packageRows: [...packageMap.values()]
                .map((row) => ({
                    ...row,
                    subjectsText: row.packageType === TEACHER_PACKAGE_TYPES.FULL_CATALOG ? 'Mọi môn' : ([...row.subjects].sort((left, right) => left.localeCompare(right, 'vi')).join(', ') || 'Chưa khóa môn'),
                    gradesText: row.packageType === TEACHER_PACKAGE_TYPES.FULL_CATALOG ? 'Mọi khối' : ([...row.grades].sort((left, right) => left.localeCompare(right, 'vi')).join(', ') || 'Chưa khóa khối'),
                }))
                .sort((left, right) => right.active - left.active || right.total - left.total || left.packageLabel.localeCompare(right.packageLabel, 'vi')),
            subjectRows: [...subjectMap.values()].sort((left, right) => right.active - left.active || right.total - left.total || left.subject.localeCompare(right.subject, 'vi')),
        };
    }, [previewGrades, previewSubjects, teachers]);
    const planRequestStats = useMemo(() => ({
        total: planRequests.length,
        pending: planRequests.filter((row) => row.status === TEACHER_PLAN_REQUEST_STATUS.PENDING).length,
        approved: planRequests.filter((row) => row.status === TEACHER_PLAN_REQUEST_STATUS.APPROVED).length,
        rejected: planRequests.filter((row) => row.status === TEACHER_PLAN_REQUEST_STATUS.REJECTED).length,
    }), [planRequests]);

    const loadUsagePage = useCallback(async (reset = false, cursor = null) => {
        setUsageLoading(true);
        try {
            const constraints = [];
            if (searchToken) constraints.push(where('searchKeywords', 'array-contains', searchToken));
            constraints.push(orderBy('updatedAt', 'desc'));
            if (!reset && cursor) constraints.push(startAfter(cursor));
            constraints.push(limit(USAGE_PAGE_SIZE));

            const snapshot = await getDocs(query(collection(db, 'teacherStats'), ...constraints));
            const rows = snapshot.docs
                .map(d => ({ teacherId: d.id, ...d.data() }))
                .filter(row => row.teacherId !== user?.uid && row.teacherStatus !== null);

            setUsageRows(prev => reset ? rows : [...prev, ...rows]);
            setUsageCursor(snapshot.docs.at(-1) || null);
            setHasMoreUsage(snapshot.docs.length === USAGE_PAGE_SIZE);
        } catch (error) {
            console.error('load usage failed', error);
            if (reset) setUsageRows([]);
        } finally {
            setUsageLoading(false);
        }
    }, [searchToken, user?.uid]);

    useEffect(() => {
        if (activeTab !== 'usage') return;
        setUsageCursor(null);
        loadUsagePage(true);
    }, [activeTab, loadUsagePage, searchToken]);

    const loadModerationQueue = useCallback(async () => {
        setModerationLoading(true);
        try {
            const rows = await loadModerationSubmissions(moderationFilter);
            setModerationRows(rows);
            setSelectedSubmissionId((previous) => (rows.some((row) => row.id === previous) ? previous : rows[0]?.id || null));
        } catch (error) {
            console.error('load moderation submissions failed', error);
            setModerationRows([]);
            setSelectedSubmissionId(null);
        } finally {
            setModerationLoading(false);
        }
    }, [moderationFilter]);

    const loadSubmissionPreview = useCallback(async (submissionId) => {
        if (!submissionId) {
            setSelectedSubmissionQuestions([]);
            return;
        }
        setSubmissionQuestionsLoading(true);
        try {
            const questions = await loadSubmissionQuestions(submissionId);
            setSelectedSubmissionQuestions(questions);
        } catch (error) {
            console.error('load submission questions failed', error);
            setSelectedSubmissionQuestions([]);
        } finally {
            setSubmissionQuestionsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeTab !== 'moderation') return;
        loadModerationQueue();
    }, [activeTab, loadModerationQueue]);

    useEffect(() => {
        if (activeTab !== 'billing') return;
        loadPlanRequestQueue();
    }, [activeTab, loadPlanRequestQueue]);

    useEffect(() => {
        if (activeTab !== 'catalog') return;
        loadCatalogHealth();
    }, [activeTab, loadCatalogHealth]);

    useEffect(() => {
        if (activeTab !== 'moderation' || !selectedSubmissionId) {
            setSelectedSubmissionQuestions([]);
            return;
        }
        loadSubmissionPreview(selectedSubmissionId);
    }, [activeTab, loadSubmissionPreview, selectedSubmissionId]);

    const loadData = async () => {
        // Load all teachers
        const teacherQ = query(collection(db, 'users'), where('role', '==', 'teacher'));
        const teacherSnap = await getDocs(teacherQ);
        const teacherList = teacherSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

        const enriched = teacherList.map((teacher) => ({
            ...teacher,
            computedStatus: getTeacherComputedStatus(teacher),
        }));

        // Load pending teachers (role: 'pending_teacher')
        const pendingQ = query(collection(db, 'users'), where('role', '==', 'pending_teacher'));
        const pendingSnap = await getDocs(pendingQ);
        const pendingList = pendingSnap.docs.map(d => ({ uid: d.id, ...d.data(), computedStatus: 'pending' }));

        const allTeachers = [...pendingList, ...enriched].sort((a, b) => {
            const order = { pending: 0, free: 1, active: 2, expired: 3 };
            return (order[a.computedStatus] || 9) - (order[b.computedStatus] || 9);
        });

        setTeachers(allTeachers);

        // Stats
        const pending = allTeachers.filter(t => t.computedStatus === 'pending').length;
        const free = allTeachers.filter(t => t.computedStatus === 'free').length;
        const active = allTeachers.filter(t => t.computedStatus === 'active').length;
        const expired = allTeachers.filter(t => t.computedStatus === 'expired').length;
        setStats({ pending, free, active, expired });
        setLoading(false);
    };

    const approveTeacher = async (teacher, months) => {
        const slug = teacher.teacherSlug || generateSlug(teacher.displayName) + '-' + Date.now().toString(36);
        const now = new Date();
        let subscriptionEnd = null;
        let teacherStatus = 'free';

        if (months > 0) {
            teacherStatus = 'active';
            subscriptionEnd = new Date(now);
            subscriptionEnd.setMonth(subscriptionEnd.getMonth() + months);
        }

        const updateData = {
            role: 'teacher',
            teacherStatus,
            teacherSlug: slug,
            schoolName: teacher.schoolName || '',
            subscriptionMonths: months,
            approvedAt: Timestamp.now(),
            approvedBy: user.uid,
            ...buildTeacherCatalogAccessPayload({ packageType: TEACHER_PACKAGE_TYPES.FULL_CATALOG }),
        };
        if (subscriptionEnd) {
            updateData.subscriptionEnd = Timestamp.fromDate(subscriptionEnd);
        }

        await updateDoc(doc(db, 'users', teacher.uid), updateData);
        await logAuditEvent({
            actorId: user.uid,
            actorRole: 'admin',
            actorName: user.email,
            action: 'teacher.approve',
            targetType: 'user',
            targetId: teacher.uid,
            teacherId: teacher.uid,
            metadata: {
                teacherName: teacher.displayName || null,
                teacherEmail: teacher.email || null,
                months,
                teacherStatus,
            },
        }).catch((error) => console.error('audit log failed', error));
        Swal.fire({ icon: 'success', title: 'Đã duyệt!', text: `${teacher.displayName} — ${months === 0 ? 'Gói Free' : months + ' tháng'}`, timer: 2000, showConfirmButton: false });
        loadData();
    };

    const handleApprove = async (teacher) => {
        const { value: months } = await Swal.fire({
            title: `Duyệt: ${teacher.displayName}`,
            html: `
                <p style="margin-bottom:12px;color:#64748b">${teacher.email}</p>
                ${teacher.schoolName ? `<p style="margin-bottom:12px"><b>Trường:</b> ${teacher.schoolName}</p>` : ''}
                <label style="font-weight:600;display:block;margin-bottom:6px">Thời hạn gói:</label>
                <select id="swal-months" class="swal2-select" style="width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0">
                    <option value="0">Gói Free mặc định</option>
                    <option value="1">1 tháng</option>
                    <option value="3">3 tháng</option>
                    <option value="6">6 tháng</option>
                    <option value="12" selected>12 tháng (1 năm)</option>
                    <option value="24">24 tháng (2 năm)</option>
                    <option value="36">36 tháng (3 năm)</option>
                    <option value="60">60 tháng (5 năm)</option>
                    <option value="120">120 tháng (10 năm)</option>
                </select>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Duyệt & Kích hoạt',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#10b981',
            preConfirm: () => {
                return parseInt(document.getElementById('swal-months').value);
            },
        });
        if (months !== undefined) {
            await approveTeacher(teacher, months);
        }
    };

    const handleExtend = async (teacher) => {
        const actionLabel = teacher.computedStatus === 'free' ? 'Nâng cấp' : 'Gia hạn';
        const { value: months } = await Swal.fire({
            title: `${actionLabel}: ${teacher.displayName}`,
            html: `
                <p style="color:#64748b">${teacher.email}</p>
                <p style="margin:8px 0">Trạng thái: <b>${getStatusLabel(teacher.computedStatus)}</b></p>
                ${teacher.subscriptionEnd ? `<p>Hết hạn: <b>${formatDate(teacher.subscriptionEnd)}</b></p>` : ''}
                <label style="font-weight:600;display:block;margin:12px 0 6px">Gia hạn thêm:</label>
                <select id="swal-months" class="swal2-select" style="width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0">
                    <option value="1">1 tháng</option>
                    <option value="3">3 tháng</option>
                    <option value="6">6 tháng</option>
                    <option value="12" selected>12 tháng</option>
                    <option value="24">24 tháng</option>
                    <option value="36">36 tháng</option>
                </select>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: actionLabel,
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#5b5ea6',
            preConfirm: () => parseInt(document.getElementById('swal-months').value),
        });
        if (!months) return;

        // Calculate new end date (from current end or from now if expired)
        let baseDate = new Date();
        if (teacher.subscriptionEnd) {
            const end = teacher.subscriptionEnd.toDate ? teacher.subscriptionEnd.toDate() : new Date(teacher.subscriptionEnd);
            if (end > baseDate) baseDate = end; // extend from current end
        }
        const newEnd = new Date(baseDate);
        newEnd.setMonth(newEnd.getMonth() + months);

        await updateDoc(doc(db, 'users', teacher.uid), {
            teacherStatus: 'active',
            subscriptionEnd: Timestamp.fromDate(newEnd),
            subscriptionMonths: (teacher.subscriptionMonths || 0) + months,
        });
        await logAuditEvent({
            actorId: user.uid,
            actorRole: 'admin',
            actorName: user.email,
            action: 'teacher.extend',
            targetType: 'user',
            targetId: teacher.uid,
            teacherId: teacher.uid,
            metadata: {
                teacherName: teacher.displayName || null,
                teacherEmail: teacher.email || null,
                months,
                newEnd: newEnd.toISOString(),
            },
        }).catch((error) => console.error('audit log failed', error));
        Swal.fire({ icon: 'success', title: 'Đã gia hạn!', text: `Hết hạn mới: ${newEnd.toLocaleDateString('vi-VN')}`, timer: 2000, showConfirmButton: false });
        loadData();
    };

    const handleReject = async (teacher) => {
        const result = await Swal.fire({
            title: `Từ chối: ${teacher.displayName}?`,
            text: 'Tài khoản sẽ trở về trạng thái học sinh.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Từ chối',
            cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;

        await updateDoc(doc(db, 'users', teacher.uid), {
            role: 'student',
            teacherStatus: null,
            teacherSlug: null,
            schoolName: null,
            accessPackageType: null,
            accessPackageLabel: null,
            approvedSubjects: [],
            approvedGrades: [],
            approvedAccessPairs: [],
            catalogPairCount: 0,
        });
        await logAuditEvent({
            actorId: user.uid,
            actorRole: 'admin',
            actorName: user.email,
            action: 'teacher.reject',
            targetType: 'user',
            targetId: teacher.uid,
            teacherId: teacher.uid,
            metadata: {
                teacherName: teacher.displayName || null,
                teacherEmail: teacher.email || null,
            },
        }).catch((error) => console.error('audit log failed', error));
        Swal.fire({ icon: 'info', title: 'Đã từ chối', timer: 1500, showConfirmButton: false });
        loadData();
    };

    const handleSuspend = async (teacher) => {
        const result = await Swal.fire({
            title: `Tạm khóa: ${teacher.displayName}?`,
            text: 'Giáo viên sẽ không thể tạo/mở đề thi.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#f59e0b',
            confirmButtonText: 'Tạm khóa',
            cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;

        await updateDoc(doc(db, 'users', teacher.uid), { teacherStatus: 'expired' });
        await logAuditEvent({
            actorId: user.uid,
            actorRole: 'admin',
            actorName: user.email,
            action: 'teacher.suspend',
            targetType: 'user',
            targetId: teacher.uid,
            teacherId: teacher.uid,
            metadata: {
                teacherName: teacher.displayName || null,
                teacherEmail: teacher.email || null,
            },
        }).catch((error) => console.error('audit log failed', error));
        Swal.fire({ icon: 'info', title: 'Đã tạm khóa', timer: 1500, showConfirmButton: false });
        loadData();
    };

    const handleConfigureCatalogAccess = async (teacher) => {
        const accessSummary = getTeacherCatalogAccessSummary(teacher, {
            subjects: previewSubjects,
            grades: previewGrades,
        });
        const packageOptions = [
            { value: TEACHER_PACKAGE_TYPES.FULL_CATALOG, label: 'Toàn bộ kho' },
            { value: TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT, label: 'Gói môn' },
            { value: TEACHER_PACKAGE_TYPES.MULTI_SUBJECT, label: 'Gói liên môn' },
            { value: TEACHER_PACKAGE_TYPES.CUSTOM, label: 'Tùy chỉnh' },
        ].map((item) => {
            const selected = accessSummary.packageType === item.value ? 'selected' : '';
            return `<option value="${item.value}" ${selected}>${item.label}</option>`;
        }).join('');

        const result = await Swal.fire({
            title: `Phân quyền kho cho ${teacher.displayName || teacher.email}`,
            width: 920,
            showCancelButton: true,
            confirmButtonText: 'Lưu quyền truy cập',
            cancelButtonText: 'Hủy',
            focusConfirm: false,
            html: `
                <div style="display:grid;gap:14px;text-align:left;">
                    <div style="padding:12px 14px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;line-height:1.6;">
                        <div><strong>Hiện tại:</strong> ${escapeHtml(accessSummary.packageLabel)}</div>
                        <div>${escapeHtml(accessSummary.subjectsText)} · ${escapeHtml(accessSummary.gradesText)}</div>
                        <div style="margin-top:6px;font-size:0.85rem;">Giới hạn an toàn hiện tại: tối đa ${MAX_TEACHER_ACCESS_PAIRS} tổ hợp môn-khối cho gói giới hạn.</div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;">
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px;">Loại gói</label>
                            <select id="swal-package-type" class="swal2-select" style="width:100%;margin:0;">
                                ${packageOptions}
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px;">Tên gói hiển thị</label>
                            <input id="swal-package-label" class="swal2-input" style="width:100%;margin:0;" value="${escapeHtml(accessSummary.packageLabel || '')}" placeholder="VD: Gói Toán THPT" />
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;align-items:start;">
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px;">Môn được dùng</label>
                            <div style="max-height:260px;overflow:auto;display:grid;gap:8px;padding:10px;border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;">
                                ${renderCheckboxList(previewSubjects, accessSummary.approvedSubjects, 'swal-approved-subject')}
                            </div>
                        </div>
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px;">Khối được dùng</label>
                            <div style="max-height:260px;overflow:auto;display:grid;gap:8px;padding:10px;border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;">
                                ${renderCheckboxList(previewGrades, accessSummary.approvedGrades, 'swal-approved-grade')}
                            </div>
                        </div>
                    </div>
                </div>
            `,
            preConfirm: () => {
                const packageType = document.getElementById('swal-package-type')?.value || TEACHER_PACKAGE_TYPES.FULL_CATALOG;
                const packageLabel = document.getElementById('swal-package-label')?.value || '';
                const approvedSubjects = Array.from(document.querySelectorAll('input[name="swal-approved-subject"]:checked')).map((input) => input.value);
                const approvedGrades = Array.from(document.querySelectorAll('input[name="swal-approved-grade"]:checked')).map((input) => input.value);

                try {
                    return buildTeacherCatalogAccessPayload({
                        packageType,
                        approvedSubjects,
                        approvedGrades,
                        packageLabel,
                    });
                } catch (error) {
                    Swal.showValidationMessage(error.message);
                    return false;
                }
            },
        });

        if (!result.isConfirmed || !result.value) return;

        await updateDoc(doc(db, 'users', teacher.uid), {
            ...result.value,
            catalogAccessUpdatedAt: Timestamp.now(),
            catalogAccessUpdatedBy: user.uid,
        });
        await logAuditEvent({
            actorId: user.uid,
            actorRole: 'admin',
            actorName: user.email,
            action: 'teacher.catalog_access.update',
            targetType: 'user',
            targetId: teacher.uid,
            teacherId: teacher.uid,
            metadata: {
                teacherName: teacher.displayName || null,
                teacherEmail: teacher.email || null,
                accessPackageType: result.value.accessPackageType,
                accessPackageLabel: result.value.accessPackageLabel,
                approvedSubjects: result.value.approvedSubjects,
                approvedGrades: result.value.approvedGrades,
                catalogPairCount: result.value.catalogPairCount,
            },
        }).catch((error) => console.error('audit log failed', error));
        Swal.fire({ icon: 'success', title: 'Đã cập nhật gói truy cập', timer: 1600, showConfirmButton: false });
        loadData();
    };

    const copyPortalLink = (slug) => {
        const url = `${window.location.origin}/t/${slug}`;
        navigator.clipboard.writeText(url);
        Swal.fire({ icon: 'success', title: 'Đã sao chép!', text: url, timer: 2000, showConfirmButton: false });
    };

    const handleRebuildUsage = async (teacherId = null) => {
        setRebuildingUsage(true);
        try {
            const rebuildUsageStats = httpsCallable(functions, 'adminRebuildUsageStats');
            const result = await rebuildUsageStats(teacherId ? { teacherId } : {});
            await loadUsagePage(true);
            Swal.fire({
                icon: 'success',
                title: 'Đã tái tạo thống kê',
                text: `${result.data?.processed || 0} hồ sơ đã được cập nhật.`,
                timer: 1800,
                showConfirmButton: false,
            });
        } catch (error) {
            console.error('rebuild usage failed', error);
            Swal.fire('Không thể tái tạo thống kê', error.message, 'error');
        } finally {
            setRebuildingUsage(false);
        }
    };

    const handleSaveTaxonomy = async () => {
        const grades = parseTaxonomyTextarea(taxonomyDraft.grades);
        const subjects = parseTaxonomyTextarea(taxonomyDraft.subjects);

        if (!grades.length || !subjects.length) {
            Swal.fire('Thiếu dữ liệu', 'Taxonomy cần có ít nhất 1 lớp và 1 môn học.', 'warning');
            return;
        }

        setTaxonomySaving(true);
        try {
            const saved = await saveTaxonomyConfig({
                grades,
                subjects,
                user: {
                    uid: user.uid,
                    displayName: user.displayName || user.email,
                    email: user.email,
                },
            });
            setTaxonomyMeta(saved);
            setTaxonomyDraft({
                grades: formatTaxonomyTextarea(saved.grades),
                subjects: formatTaxonomyTextarea(saved.subjects),
            });
            Swal.fire({ icon: 'success', title: 'Đã lưu taxonomy', timer: 1500, showConfirmButton: false });
        } catch (error) {
            console.error('save taxonomy failed', error);
            Swal.fire('Không thể lưu taxonomy', error.message, 'error');
        } finally {
            setTaxonomySaving(false);
        }
    };

    const handleSavePlaybook = async () => {
        if (!user?.uid) return;

        setPlaybookSaving(true);
        try {
            const saved = await saveAdminPlaybook({
                adminId: user.uid,
                user: {
                    uid: user.uid,
                    displayName: user.displayName || user.email,
                    email: user.email,
                },
                draft: playbookDraft,
            });
            setPlaybookMeta(saved);
            setPlaybookDraft({
                collectionMap: saved.collectionMap,
                dailyWorkflow: saved.dailyWorkflow,
                subjectLockPlan: saved.subjectLockPlan,
                privateNotes: saved.privateNotes,
            });
            Swal.fire({ icon: 'success', title: 'Đã lưu playbook', timer: 1500, showConfirmButton: false });
        } catch (error) {
            console.error('save playbook failed', error);
            Swal.fire('Không thể lưu playbook', error.message, 'error');
        } finally {
            setPlaybookSaving(false);
        }
    };

    const handleResetPlaybook = () => {
        setPlaybookDraft({
            collectionMap: DEFAULT_ADMIN_PLAYBOOK.collectionMap,
            dailyWorkflow: DEFAULT_ADMIN_PLAYBOOK.dailyWorkflow,
            subjectLockPlan: DEFAULT_ADMIN_PLAYBOOK.subjectLockPlan,
            privateNotes: DEFAULT_ADMIN_PLAYBOOK.privateNotes,
        });
    };

    const getModerationStatusMeta = (status) => {
        switch (status) {
            case BANK_SUBMISSION_STATUS.APPROVED:
                return { label: 'Đã duyệt', className: 'active', icon: 'check-circle' };
            case BANK_SUBMISSION_STATUS.REJECTED:
                return { label: 'Từ chối', className: 'expired', icon: 'x-circle' };
            case BANK_SUBMISSION_STATUS.PENDING:
            default:
                return { label: 'Chờ duyệt', className: 'warning', icon: 'hourglass-split' };
        }
    };

    const summarizeQuestion = (question) => {
        const raw = question?.content_text || question?.content_html || '';
        return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    };

    const handleApproveSubmission = async (submission) => {
        const result = await Swal.fire({
            title: `Duyệt bộ câu: ${submission.title}`,
            input: 'textarea',
            inputLabel: 'Ghi chú review (không bắt buộc)',
            inputPlaceholder: 'Ví dụ: Bộ câu đạt yêu cầu, đã đẩy vào thư viện dùng chung.',
            showCancelButton: true,
            confirmButtonText: 'Duyệt và publish',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#10b981',
        });
        if (!result.isConfirmed) return;

        setModerationActingId(submission.id);
        try {
            await approveBankSubmission({
                submissionId: submission.id,
                reviewer: {
                    uid: user.uid,
                    displayName: user.displayName || user.email,
                    email: user.email,
                },
                reviewNote: result.value || '',
            });
            await loadModerationQueue();
            Swal.fire({ icon: 'success', title: 'Đã duyệt bộ câu', timer: 1500, showConfirmButton: false });
        } catch (error) {
            console.error('approve submission failed', error);
            Swal.fire('Không thể duyệt submission', error.message, 'error');
        } finally {
            setModerationActingId(null);
        }
    };

    const handleRejectSubmission = async (submission) => {
        const result = await Swal.fire({
            title: `Từ chối bộ câu: ${submission.title}`,
            input: 'textarea',
            inputLabel: 'Lý do từ chối',
            inputPlaceholder: 'Ví dụ: Cần chuẩn hóa đáp án phần đúng/sai trước khi gửi lại.',
            inputValidator: (value) => (!value?.trim() ? 'Cần nhập lý do từ chối để giáo viên chỉnh lại.' : undefined),
            showCancelButton: true,
            confirmButtonText: 'Từ chối',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#ef4444',
        });
        if (!result.isConfirmed) return;

        setModerationActingId(submission.id);
        try {
            await rejectBankSubmission({
                submissionId: submission.id,
                reviewer: {
                    uid: user.uid,
                    displayName: user.displayName || user.email,
                    email: user.email,
                },
                reviewNote: result.value || '',
            });
            await loadModerationQueue();
            Swal.fire({ icon: 'success', title: 'Đã từ chối submission', timer: 1500, showConfirmButton: false });
        } catch (error) {
            console.error('reject submission failed', error);
            Swal.fire('Không thể từ chối submission', error.message, 'error');
        } finally {
            setModerationActingId(null);
        }
    };

    const handleApprovePlanRequest = async (requestRow) => {
        const linkedTeacher = teacherLookup.get(requestRow.teacherId) || null;
        const accessSummary = linkedTeacher
            ? getTeacherCatalogAccessSummary(linkedTeacher, {
                subjects: previewSubjects,
                grades: previewGrades,
            })
            : null;

        const result = await Swal.fire({
            title: `Duyệt yêu cầu: ${requestRow.teacherName || requestRow.teacherEmail}`,
            width: 760,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Duyệt và kích hoạt',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#10b981',
            html: `
                <div style="display:grid;gap:14px;text-align:left;">
                    <div style="padding:12px 14px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;line-height:1.6;">
                        <div><strong>Yêu cầu:</strong> ${requestRow.requestedPlanLabel || 'Không rõ gói'}</div>
                        <div><strong>Giáo viên:</strong> ${requestRow.teacherEmail || 'Không rõ email'}${requestRow.schoolName ? ` · ${requestRow.schoolName}` : ''}</div>
                        <div><strong>Trạng thái hiện tại:</strong> ${linkedTeacher ? getStatusLabel(linkedTeacher.computedStatus) : (requestRow.teacherStatusSnapshot ? getStatusLabel(requestRow.teacherStatusSnapshot) : 'Không rõ')}</div>
                        <div><strong>Quyền truy cập kho:</strong> ${accessSummary ? `${accessSummary.packageLabel} · ${accessSummary.subjectsText} · ${accessSummary.gradesText}` : (requestRow.requestedCatalogPackage || 'Chưa rõ')}</div>
                    </div>
                    <div>
                        <label style="display:block;font-weight:700;margin-bottom:6px;">Kích hoạt / gia hạn thêm</label>
                        <input id="swal-plan-approve-months" type="number" min="1" max="120" class="swal2-input" style="width:100%;margin:0;" value="${requestRow.requestedMonths || 12}" />
                        <div style="margin-top:6px;font-size:0.82rem;color:#64748b;">Duyệt ở đây chỉ xử lý thuê bao. Nếu cần đổi môn/khối của kho, dùng nút Gói ở tab Giáo viên sau khi duyệt.</div>
                    </div>
                    <div>
                        <label style="display:block;font-weight:700;margin-bottom:6px;">Ghi chú admin</label>
                        <textarea id="swal-plan-approve-note" class="swal2-textarea" style="width:100%;margin:0;min-height:110px;" placeholder="Ví dụ: Đã nhận chuyển khoản và kích hoạt tới hết năm học."></textarea>
                    </div>
                </div>
            `,
            preConfirm: () => {
                const approvedMonths = parseInt(document.getElementById('swal-plan-approve-months')?.value || '0', 10);
                const reviewNote = document.getElementById('swal-plan-approve-note')?.value || '';

                if (!approvedMonths || approvedMonths < 1) {
                    Swal.showValidationMessage('Số tháng duyệt phải lớn hơn 0.');
                    return false;
                }

                return { approvedMonths, reviewNote };
            },
        });
        if (!result.isConfirmed || !result.value) return;

        setPlanRequestActingId(requestRow.id);
        try {
            const approval = await approveTeacherPlanRequest({
                requestId: requestRow.id,
                reviewer: {
                    uid: user.uid,
                    displayName: user.displayName || user.email,
                    email: user.email,
                },
                approvedMonths: result.value.approvedMonths,
                reviewNote: result.value.reviewNote,
            });
            await Promise.all([loadPlanRequestQueue(), loadData()]);
            Swal.fire({
                icon: 'success',
                title: 'Đã duyệt yêu cầu',
                text: `Thuê bao mới kéo dài tới ${approval.approvedUntil.toDate().toLocaleDateString('vi-VN')}.`,
                timer: 1800,
                showConfirmButton: false,
            });
        } catch (error) {
            console.error('approve plan request failed', error);
            Swal.fire('Không thể duyệt yêu cầu', error.message, 'error');
        } finally {
            setPlanRequestActingId(null);
        }
    };

    const handleRejectPlanRequest = async (requestRow) => {
        const result = await Swal.fire({
            title: `Từ chối yêu cầu: ${requestRow.teacherName || requestRow.teacherEmail}`,
            input: 'textarea',
            inputLabel: 'Lý do từ chối',
            inputPlaceholder: 'Ví dụ: Vui lòng bổ sung thông tin thanh toán hoặc chờ đợt cấu hình gói môn mới.',
            inputValidator: (value) => (!value?.trim() ? 'Cần nhập lý do để giáo viên biết cần làm gì tiếp.' : undefined),
            showCancelButton: true,
            confirmButtonText: 'Từ chối',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#ef4444',
        });
        if (!result.isConfirmed) return;

        setPlanRequestActingId(requestRow.id);
        try {
            await rejectTeacherPlanRequest({
                requestId: requestRow.id,
                reviewer: {
                    uid: user.uid,
                    displayName: user.displayName || user.email,
                    email: user.email,
                },
                reviewNote: result.value || '',
            });
            await loadPlanRequestQueue();
            Swal.fire({ icon: 'success', title: 'Đã từ chối yêu cầu', timer: 1500, showConfirmButton: false });
        } catch (error) {
            console.error('reject plan request failed', error);
            Swal.fire('Không thể từ chối yêu cầu', error.message, 'error');
        } finally {
            setPlanRequestActingId(null);
        }
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'pending': return 'Chờ duyệt';
            case 'free':
            case 'trial': return 'Gói Free';
            case 'active': return 'Teacher Plus';
            case 'expired': return 'Hết hạn';
            default: return status || 'N/A';
        }
    };

    const getStatusClass = (status) => {
        switch (status) {
            case 'pending': return 'warning';
            case 'free':
            case 'trial': return 'info';
            case 'active': return 'success';
            case 'expired': return 'danger';
            default: return 'muted';
        }
    };

    const filtered = teachers
        .filter(t => filter === 'all' || t.computedStatus === filter)
        .filter(t => !search || t.displayName?.toLowerCase().includes(search.toLowerCase()) || t.email?.toLowerCase().includes(search.toLowerCase()));
    const filteredPlanRequests = planRequests
        .filter((row) => planRequestFilter === 'all' || row.status === planRequestFilter)
        .filter((row) => {
            if (!search) return true;
            const haystacks = [
                row.teacherName,
                row.teacherEmail,
                row.schoolName,
                row.requestedPlanLabel,
                row.note,
                row.requestedCatalogPackage,
            ].map((value) => (value || '').toLowerCase());
            return haystacks.some((value) => value.includes(search.toLowerCase()));
        });

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;

    return (
        <div className="dashboard-shell dashboard-shell-admin">
            <section className="dashboard-hero dashboard-hero-admin">
                <div className="dashboard-hero-main">
                    <div className="dashboard-hero-topline">
                        <span className="dashboard-hero-kicker">ADMIN CONTROL ROOM</span>
                        <span className={`dashboard-hero-pill ${stats.pending > 0 ? 'warn' : 'good'}`}>
                            <i className={`bi bi-${stats.pending > 0 ? 'shield-exclamation' : 'shield-check'}`}></i>
                            {stats.pending > 0 ? `${stats.pending} tài khoản chờ duyệt` : 'Hệ thống ổn định'}
                        </span>
                    </div>
                    <h1>Super Admin Control Room</h1>
                    <p>Quản lý giáo viên, chuẩn taxonomy, usage, kiểm duyệt ngân hàng dùng chung và giữ toàn bộ bề mặt quản trị ở trạng thái sáng, rõ và kiểm soát được.</p>
                    <div className="dashboard-hero-chips">
                        <span className="dashboard-hero-pill neutral"><i className="bi bi-grid-1x2"></i> Tab: {adminTabLabel}</span>
                        <span className="dashboard-hero-pill neutral"><i className="bi bi-people"></i> Tổng tài khoản giáo viên: {teachers.length}</span>
                        <span className="dashboard-hero-pill neutral"><i className="bi bi-diagram-3"></i> {previewSubjects.length} môn · {previewGrades.length} khối</span>
                        {planRequestStats.pending > 0 && <span className="dashboard-hero-pill warn"><i className="bi bi-cash-coin"></i> {planRequestStats.pending} yêu cầu gói chờ duyệt</span>}
                    </div>
                    <div className="dashboard-hero-actions">
                        <button type="button" className="btn btn-primary" onClick={() => { setActiveTab('teachers'); setSearch(''); }}>
                            <i className="bi bi-people"></i> Giáo viên
                        </button>
                        <button type="button" className="btn btn-outline" onClick={() => { setActiveTab('billing'); setSearch(''); }}>
                            <i className="bi bi-cash-coin"></i> Gói chờ duyệt
                        </button>
                        <button type="button" className="btn btn-outline" onClick={() => { setActiveTab('catalog'); setSearch(''); }}>
                            <i className="bi bi-bar-chart-steps"></i> Gói & Kho
                        </button>
                        <button type="button" className="btn btn-outline" onClick={() => { setActiveTab('moderation'); setSearch(''); }}>
                            <i className="bi bi-send-check"></i> Duyệt ngân hàng
                        </button>
                        <button type="button" className="btn btn-outline" onClick={() => { setActiveTab('taxonomy'); setSearch(''); }}>
                            <i className="bi bi-diagram-3"></i> Taxonomy
                        </button>
                        <button type="button" className="btn btn-outline" onClick={() => { setActiveTab('playbook'); setSearch(''); }}>
                            <i className="bi bi-journal-text"></i> Sơ đồ vận hành
                        </button>
                    </div>
                </div>
                <div className="dashboard-hero-side">
                    <div className="dashboard-hero-metrics">
                        <div>
                            <span>Chờ duyệt</span>
                            <strong>{stats.pending}</strong>
                            <small>cần xử lý sớm</small>
                        </div>
                        <div>
                            <span>Gói Free</span>
                            <strong>{stats.free}</strong>
                            <small>đang dùng mức thấp</small>
                        </div>
                        <div>
                            <span>Teacher Plus</span>
                            <strong>{stats.active}</strong>
                            <small>tài khoản ổn định</small>
                        </div>
                        <div>
                            <span>Hết hạn</span>
                            <strong>{stats.expired}</strong>
                            <small>cần chăm sóc lại</small>
                        </div>
                    </div>
                </div>
            </section>

            <div className="alert alert-info" style={{ marginBottom: 20 }}>
                <i className="bi bi-info-circle"></i> Super admin quản lý giáo viên, taxonomy, duyệt bộ câu dùng chung và cấu hình AI BYOK cục bộ. Dữ liệu học sinh chi tiết vẫn do giáo viên tự quản.
            </div>

            <div className="stats-grid">
                <StatsCard icon="hourglass-split" label="Chờ duyệt" value={stats.pending} color="warm" delay={0} />
                <StatsCard icon="gift" label="Gói Free" value={stats.free} color="cool" delay={1} />
                <StatsCard icon="check-circle" label="Teacher Plus" value={stats.active} color="success" delay={2} />
                <StatsCard icon="exclamation-triangle" label="Hết hạn" value={stats.expired} color="warm" delay={3} />
                <StatsCard icon="cash-coin" label="YC gói chờ duyệt" value={planRequestStats.pending} color="primary" delay={4} />
            </div>

            <div className="tab-nav" style={{ marginBottom: 16 }}>
                <button className={`tab-btn ${activeTab === 'teachers' ? 'active' : ''}`} onClick={() => { setActiveTab('teachers'); setSearch(''); }}>
                    <i className="bi bi-people"></i> Giáo viên
                </button>
                <button className={`tab-btn ${activeTab === 'billing' ? 'active' : ''}`} onClick={() => { setActiveTab('billing'); setSearch(''); }}>
                    <i className="bi bi-cash-coin"></i> Nâng cấp / gia hạn
                </button>
                <button className={`tab-btn ${activeTab === 'usage' ? 'active' : ''}`} onClick={() => { setActiveTab('usage'); setSearch(''); }}>
                    <i className="bi bi-speedometer2"></i> Usage / Cost
                </button>
                <button className={`tab-btn ${activeTab === 'catalog' ? 'active' : ''}`} onClick={() => { setActiveTab('catalog'); setSearch(''); }}>
                    <i className="bi bi-bar-chart-steps"></i> Gói & Kho
                </button>
                <button className={`tab-btn ${activeTab === 'moderation' ? 'active' : ''}`} onClick={() => { setActiveTab('moderation'); setSearch(''); }}>
                    <i className="bi bi-send-check"></i> Duyệt ngân hàng chung
                </button>
                <button className={`tab-btn ${activeTab === 'taxonomy' ? 'active' : ''}`} onClick={() => { setActiveTab('taxonomy'); setSearch(''); }}>
                    <i className="bi bi-diagram-3"></i> Taxonomy
                </button>
                <button className={`tab-btn ${activeTab === 'playbook' ? 'active' : ''}`} onClick={() => { setActiveTab('playbook'); setSearch(''); }}>
                    <i className="bi bi-journal-text"></i> Sơ đồ vận hành
                </button>
                <button className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => { setActiveTab('ai'); setSearch(''); }}>
                    <i className="bi bi-cpu"></i> AI BYOK
                </button>
            </div>

            {activeTab === 'teachers' && (
                <>
                    <div className="filter-bar">
                        <div className="filter-tabs">
                            {[
                                { key: 'all', label: 'Tất cả' },
                                { key: 'pending', label: 'Chờ duyệt' },
                                { key: 'free', label: 'Gói Free' },
                                { key: 'active', label: 'Teacher Plus' },
                                { key: 'expired', label: 'Hết hạn' },
                            ].map(f => (
                                <button key={f.key} className={`filter-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
                            ))}
                        </div>
                        <div className="search-box">
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm giáo viên..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div className="empty-state"><i className="bi bi-person-x"></i><p>Không tìm thấy giáo viên.</p></div>
                    ) : (
                        <div className="admin-teacher-list">
                            <AnimatePresence>
                                {filtered.map((t, idx) => {
                                    const accessSummary = getTeacherCatalogAccessSummary(t, {
                                        subjects: previewSubjects,
                                        grades: previewGrades,
                                    });

                                    return (
                                    <motion.div key={t.uid} className="admin-teacher-card" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.03 }}>
                                        <div className="atc-left">
                                            {t.photoURL ? (
                                                <img src={t.photoURL} alt="" className="atc-avatar" referrerPolicy="no-referrer" />
                                            ) : (
                                                <div className="atc-avatar-placeholder">{(t.displayName || '?')[0]}</div>
                                            )}
                                            <div className="atc-info">
                                                <div className="atc-name">{t.displayName || 'Không tên'}</div>
                                                <div className="atc-email">{t.email}</div>
                                                {t.schoolName && <div className="atc-school"><i className="bi bi-building"></i> {t.schoolName}</div>}
                                            </div>
                                        </div>
                                        <div className="atc-center">
                                            <span className={`stat-badge ${getStatusClass(t.computedStatus)}`}>{getStatusLabel(t.computedStatus)}</span>
                                            <span className={`stat-badge ${accessSummary.badgeClass}`}>{accessSummary.badgeLabel}</span>
                                            <div className="teacher-access-summary">
                                                <div className="teacher-access-label">{accessSummary.packageLabel}</div>
                                                <div className="teacher-access-detail">{accessSummary.subjectsText} · {accessSummary.gradesText}</div>
                                            </div>
                                            {t.subscriptionEnd && t.computedStatus !== 'pending' && (
                                                <div className="atc-expire">
                                                    <i className="bi bi-calendar3"></i>
                                                    HH: {formatDate(t.subscriptionEnd)}
                                                </div>
                                            )}
                                            {t.teacherSlug && (
                                                <button className="btn-link-small" onClick={() => copyPortalLink(t.teacherSlug)} title={`/t/${t.teacherSlug}`}>
                                                    <i className="bi bi-link-45deg"></i> /t/{t.teacherSlug}
                                                </button>
                                            )}
                                        </div>
                                        <div className="atc-actions">
                                            <button className="btn btn-sm btn-outline" onClick={() => handleConfigureCatalogAccess(t)}>
                                                <i className="bi bi-sliders"></i> Gói
                                            </button>
                                            {t.computedStatus === 'pending' && (
                                                <>
                                                    <button className="btn btn-sm btn-success-soft" onClick={() => handleApprove(t)}>
                                                        <i className="bi bi-check-lg"></i> Duyệt
                                                    </button>
                                                    <button className="btn btn-sm btn-danger-soft" onClick={() => handleReject(t)}>
                                                        <i className="bi bi-x-lg"></i> Từ chối
                                                    </button>
                                                </>
                                            )}
                                            {(t.computedStatus === 'active' || t.computedStatus === 'free') && (
                                                <>
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleExtend(t)}>
                                                        <i className="bi bi-plus-circle"></i> {t.computedStatus === 'free' ? 'Nâng cấp' : 'Gia hạn'}
                                                    </button>
                                                    <button className="btn btn-sm btn-warning-soft" onClick={() => handleSuspend(t)}>
                                                        <i className="bi bi-pause-circle"></i> Khóa
                                                    </button>
                                                </>
                                            )}
                                            {t.computedStatus === 'expired' && (
                                                <>
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleExtend(t)}>
                                                        <i className="bi bi-arrow-clockwise"></i> Gia hạn
                                                    </button>
                                                    <button className="btn btn-sm btn-danger-soft" onClick={() => handleReject(t)}>
                                                        <i className="bi bi-trash3"></i> Xóa quyền
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </motion.div>
                                );})}
                            </AnimatePresence>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'billing' && (
                <div>
                    <div className="alert alert-info" style={{ marginBottom: 16 }}>
                        <i className="bi bi-info-circle"></i> Đây là luồng kiếm tiền giai đoạn 1: giáo viên tự gửi yêu cầu nâng cấp hoặc gia hạn, admin duyệt trong dashboard, hệ thống tự kéo dài thuê bao và ghi audit log.
                    </div>

                    <div className="stats-grid" style={{ marginBottom: 16 }}>
                        <StatsCard icon="inboxes" label="Tổng yêu cầu" value={planRequestStats.total} color="cool" delay={0} />
                        <StatsCard icon="hourglass-split" label="Chờ duyệt" value={planRequestStats.pending} color="warm" delay={1} />
                        <StatsCard icon="check-circle" label="Đã duyệt" value={planRequestStats.approved} color="success" delay={2} />
                        <StatsCard icon="x-circle" label="Từ chối" value={planRequestStats.rejected} color="warm" delay={3} />
                    </div>

                    <div className="filter-bar" style={{ alignItems: 'center' }}>
                        <div className="filter-tabs">
                            {[
                                { key: TEACHER_PLAN_REQUEST_STATUS.PENDING, label: 'Chờ duyệt' },
                                { key: TEACHER_PLAN_REQUEST_STATUS.APPROVED, label: 'Đã duyệt' },
                                { key: TEACHER_PLAN_REQUEST_STATUS.REJECTED, label: 'Từ chối' },
                                { key: 'all', label: 'Tất cả' },
                            ].map((item) => (
                                <button key={item.key} className={`filter-tab ${planRequestFilter === item.key ? 'active' : ''}`} onClick={() => setPlanRequestFilter(item.key)}>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
                            <div className="search-box" style={{ minWidth: 260, flex: '1 1 320px', maxWidth: 420 }}>
                                <i className="bi bi-search"></i>
                                <input type="text" placeholder="Tìm theo tên giáo viên, email hoặc gói..." value={search} onChange={e => setSearch(e.target.value)} />
                            </div>
                            <button className="btn btn-outline" onClick={loadPlanRequestQueue} disabled={planRequestsLoading}>
                                <i className="bi bi-arrow-repeat"></i> {planRequestsLoading ? 'Đang tải...' : 'Tải lại'}
                            </button>
                        </div>
                    </div>

                    {planRequestsLoading ? (
                        <div className="loading-screen" style={{ minHeight: 260 }}>
                            <div className="spinner"></div>
                            <p>Đang tải hàng đợi yêu cầu gói...</p>
                        </div>
                    ) : filteredPlanRequests.length === 0 ? (
                        <div className="empty-state" style={{ minHeight: 240 }}>
                            <i className="bi bi-cash-stack"></i>
                            <p>Chưa có yêu cầu nào trong trạng thái này.</p>
                        </div>
                    ) : (
                        <div className="teacher-plan-request-list teacher-plan-request-list-admin">
                            {filteredPlanRequests.map((requestRow) => {
                                const statusMeta = getTeacherPlanRequestStatusMeta(requestRow.status);
                                const typeMeta = getTeacherPlanRequestTypeMeta(requestRow.requestType);
                                const linkedTeacher = teacherLookup.get(requestRow.teacherId) || null;
                                const accessSummary = linkedTeacher
                                    ? getTeacherCatalogAccessSummary(linkedTeacher, {
                                        subjects: previewSubjects,
                                        grades: previewGrades,
                                    })
                                    : null;

                                return (
                                    <div key={requestRow.id} className="teacher-plan-request-card teacher-plan-request-card-admin">
                                        <div className="teacher-plan-request-head">
                                            <div>
                                                <div className="teacher-plan-request-title">{requestRow.teacherName || requestRow.teacherEmail || 'Không rõ giáo viên'}</div>
                                                <div className="teacher-plan-request-meta">{requestRow.teacherEmail || 'Không rõ email'}{requestRow.schoolName ? ` · ${requestRow.schoolName}` : ''}</div>
                                            </div>
                                            <div className="teacher-plan-request-badges">
                                                <span className={`stat-badge ${typeMeta.className}`}><i className={`bi bi-${typeMeta.icon}`}></i> {typeMeta.label}</span>
                                                <span className={`stat-badge ${statusMeta.className}`}><i className={`bi bi-${statusMeta.icon}`}></i> {statusMeta.label}</span>
                                            </div>
                                        </div>

                                        <div className="teacher-plan-request-grid">
                                            <div>
                                                <span className="teacher-plan-request-label">Yêu cầu</span>
                                                <strong>{requestRow.requestedPlanLabel || formatTeacherPlanDuration(requestRow.requestedMonths)}</strong>
                                            </div>
                                            <div>
                                                <span className="teacher-plan-request-label">Trạng thái giáo viên</span>
                                                <strong>{linkedTeacher ? getStatusLabel(linkedTeacher.computedStatus) : (requestRow.teacherStatusSnapshot ? getStatusLabel(requestRow.teacherStatusSnapshot) : 'Không rõ')}</strong>
                                            </div>
                                            <div>
                                                <span className="teacher-plan-request-label">Gói kho hiện tại</span>
                                                <strong>{accessSummary ? accessSummary.packageLabel : (requestRow.requestedCatalogPackage || 'Chưa rõ')}</strong>
                                            </div>
                                            <div>
                                                <span className="teacher-plan-request-label">Hết hạn hiện tại</span>
                                                <strong>{linkedTeacher?.subscriptionEnd ? formatDate(linkedTeacher.subscriptionEnd) : 'Chưa có'}</strong>
                                            </div>
                                        </div>

                                        {requestRow.note && <div className="teacher-plan-request-note">GV nhắn: {requestRow.note}</div>}
                                        {requestRow.reviewNote && requestRow.status !== TEACHER_PLAN_REQUEST_STATUS.PENDING && (
                                            <div className="teacher-plan-request-review">Phản hồi admin: {requestRow.reviewNote}</div>
                                        )}

                                        <div className="teacher-plan-request-footer">
                                            <div className="teacher-plan-request-meta">
                                                Gửi {formatTimeAgo(requestRow.requestedAt)}
                                                {requestRow.resolvedAt ? ` · xử lý ${formatTimeAgo(requestRow.resolvedAt)}` : ''}
                                                {requestRow.approvedUntil?.toDate && requestRow.status === TEACHER_PLAN_REQUEST_STATUS.APPROVED
                                                    ? ` · tới ${requestRow.approvedUntil.toDate().toLocaleDateString('vi-VN')}`
                                                    : ''}
                                            </div>
                                            {requestRow.status === TEACHER_PLAN_REQUEST_STATUS.PENDING && (
                                                <div className="teacher-plan-request-actions">
                                                    <button className="btn btn-danger-soft" onClick={() => handleRejectPlanRequest(requestRow)} disabled={planRequestActingId === requestRow.id}>
                                                        <i className="bi bi-x-circle"></i> {planRequestActingId === requestRow.id ? 'Đang xử lý...' : 'Từ chối'}
                                                    </button>
                                                    <button className="btn btn-primary" onClick={() => handleApprovePlanRequest(requestRow)} disabled={planRequestActingId === requestRow.id}>
                                                        <i className="bi bi-check-circle"></i> {planRequestActingId === requestRow.id ? 'Đang xử lý...' : 'Duyệt'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'usage' && (
                <div>
                    <div className="alert alert-info" style={{ marginBottom: 16 }}>
                        <i className="bi bi-info-circle"></i> Đây là ước tính usage/cost sơ bộ dựa trên `teacherStats`: số bài thi, lượt làm bài, ảnh lưu trữ và read/write Firestore dự kiến.
                    </div>

                    <div className="filter-bar" style={{ alignItems: 'center' }}>
                        <div className="search-box" style={{ flex: 1 }}>
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm giáo viên trong usage..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <button className="btn btn-outline" onClick={() => handleRebuildUsage()} disabled={rebuildingUsage}>
                            <i className="bi bi-arrow-repeat"></i> {rebuildingUsage ? 'Đang tái tạo...' : 'Tái tạo thống kê'}
                        </button>
                    </div>

                    {usageLoading ? (
                        <div className="loading-screen" style={{ minHeight: 220 }}>
                            <div className="spinner"></div>
                            <p>Đang tải usage...</p>
                        </div>
                    ) : usageRows.length === 0 ? (
                        <div className="empty-state"><i className="bi bi-graph-down"></i><p>Chưa có dữ liệu usage phù hợp.</p></div>
                    ) : (
                        <div className="admin-teacher-list">
                            {usageRows.map((row, idx) => {
                                const usageTier = getUsageTier(row);
                                const cost = estimateTeacherCost(row);
                                return (
                                    <motion.div key={row.teacherId} className="admin-teacher-card" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }}>
                                        <div className="atc-left">
                                            <div className="atc-avatar-placeholder">{(row.teacherName || '?')[0]}</div>
                                            <div className="atc-info">
                                                <div className="atc-name">{row.teacherName || 'Không rõ tên'}</div>
                                                <div className="atc-email">{row.teacherEmail || 'Không rõ email'}</div>
                                                <div className="atc-school"><i className="bi bi-collection"></i> {row.examCount || 0} đề · {row.studentCount || 0} học sinh · {row.sessionCount || 0} lượt thi</div>
                                            </div>
                                        </div>
                                        <div className="atc-center">
                                            <span className={`stat-badge ${usageTier.className}`}>{usageTier.label}</span>
                                            <div className="atc-expire"><i className="bi bi-images"></i> {formatBytes(row.storageBytes || 0)}</div>
                                            <div className="atc-expire"><i className="bi bi-currency-dollar"></i> ~ {formatCurrencyVnd(cost.totalVnd)}</div>
                                            {row.updatedAt && <div className="atc-expire"><i className="bi bi-clock-history"></i> Cập nhật: {formatDate(row.updatedAt)}</div>}
                                        </div>
                                        <div className="atc-actions">
                                            <button className="btn btn-sm btn-outline" onClick={() => handleRebuildUsage(row.teacherId)} disabled={rebuildingUsage}>
                                                <i className="bi bi-arrow-repeat"></i> Làm mới
                                            </button>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    )}

                    {hasMoreUsage && (
                        <div style={{ marginTop: 16, textAlign: 'center' }}>
                            <button className="btn btn-outline" onClick={() => loadUsagePage(false, usageCursor)} disabled={usageLoading}>
                                {usageLoading ? 'Đang tải...' : 'Xem thêm usage'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'catalog' && (
                <div className="catalog-admin-layout">
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h3><i className="bi bi-graph-up-arrow"></i> Thống kê gói đang bán</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                                    Nhìn nhanh cơ cấu giáo viên theo loại gói, tên gói và môn được cấp nhiều nhất để biết hệ thống đang bán gì trên thực tế.
                                </p>
                            </div>
                        </div>
                        <div className="card-body" style={{ display: 'grid', gap: 18 }}>
                            <div className="stats-grid">
                                <StatsCard icon="people" label="Tổng giáo viên" value={packageOverview.totalTeachers} sub={`${packageOverview.monetizedTeachers} đang dùng Teacher Plus`} color="cool" delay={0} />
                                {packageOverview.packageTypeRows.map((row, index) => (
                                    <StatsCard
                                        key={row.key}
                                        icon={row.icon}
                                        label={row.label}
                                        value={row.total}
                                        sub={`${row.active} Teacher Plus · ${row.free} Free · ${row.expired} hết hạn`}
                                        color={row.color}
                                        delay={index + 1}
                                    />
                                ))}
                            </div>

                            <div className="catalog-package-list">
                                {packageOverview.packageRows.length === 0 ? (
                                    <div className="empty-state" style={{ minHeight: 220 }}>
                                        <i className="bi bi-box-seam"></i>
                                        <p>Chưa có giáo viên nào để phân tích gói truy cập.</p>
                                    </div>
                                ) : (
                                    packageOverview.packageRows.map((row) => (
                                        <div key={row.key} className="catalog-package-card">
                                            <div className="catalog-package-head">
                                                <div>
                                                    <div className="catalog-package-title">{row.packageLabel}</div>
                                                    <div className="catalog-package-meta">{row.subjectsText} · {row.gradesText}</div>
                                                </div>
                                                <span className={`stat-badge ${row.badgeClass}`}>{row.badgeLabel}</span>
                                            </div>
                                            <div className="catalog-package-metrics">
                                                <span><i className="bi bi-people"></i> {row.total} GV</span>
                                                <span><i className="bi bi-check-circle"></i> {row.active} Teacher Plus</span>
                                                <span><i className="bi bi-gift"></i> {row.free} Free</span>
                                                <span><i className="bi bi-clock-history"></i> {row.expired} hết hạn</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div>
                                <div className="catalog-section-title">Môn được cấp nhiều nhất</div>
                                {packageOverview.subjectRows.length === 0 ? (
                                    <div className="catalog-empty-inline">Các gói hiện tại vẫn đang để toàn bộ kho hoặc chưa khóa môn cụ thể.</div>
                                ) : (
                                    <div className="catalog-chip-grid">
                                        {packageOverview.subjectRows.slice(0, 12).map((row) => (
                                            <div key={row.subject} className="catalog-chip-card">
                                                <strong>{row.subject}</strong>
                                                <span>{row.total} GV · {row.active} active</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h3><i className="bi bi-shield-exclamation"></i> Cảnh báo vệ sinh kho hệ thống</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                                    Quét trực tiếp ngân hàng hệ thống và thư viện dùng chung để tìm các đề đang thiếu `subject` hoặc `grade` trước khi giáo viên bị lọc sai theo gói.
                                </p>
                            </div>
                            <button className="btn btn-outline btn-sm" onClick={loadCatalogHealth} disabled={catalogLoading}>
                                <i className="bi bi-arrow-repeat"></i> {catalogLoading ? 'Đang quét...' : 'Quét lại kho'}
                            </button>
                        </div>
                        <div className="card-body" style={{ display: 'grid', gap: 18 }}>
                            <div className="stats-grid">
                                <StatsCard icon="database" label="Câu NH hệ thống" value={catalogHealth.systemItemCount} sub={`${catalogHealth.systemSourceCount} đề nguồn`} color="cool" delay={0} />
                                <StatsCard icon="exclamation-diamond" label="Câu thiếu metadata" value={catalogHealth.dirtySystemItemCount} sub={`${catalogHealth.dirtySourceCount} đề nguồn cần dọn`} color={catalogHealth.dirtySystemItemCount > 0 ? 'warm' : 'success'} delay={1} />
                                <StatsCard icon="journal-bookmark" label="Đề thư viện thiếu metadata" value={catalogHealth.sharedIssueRows.length} sub={`${catalogHealth.sharedPublishedCount} đề đang publish`} color={catalogHealth.sharedIssueRows.length > 0 ? 'warm' : 'success'} delay={2} />
                            </div>

                            <div>
                                <div className="catalog-section-title">Đề nguồn system bank cần dọn trước</div>
                                {catalogLoading ? (
                                    <div className="loading-screen" style={{ minHeight: 180 }}>
                                        <div className="spinner"></div>
                                        <p>Đang quét metadata ngân hàng hệ thống...</p>
                                    </div>
                                ) : catalogHealth.issueRows.length === 0 ? (
                                    <div className="empty-state" style={{ minHeight: 180 }}>
                                        <i className="bi bi-patch-check"></i>
                                        <p>System bank hiện không có đề nguồn nào thiếu `subject` hoặc `grade`.</p>
                                    </div>
                                ) : (
                                    <div className="catalog-health-list">
                                        {catalogHealth.issueRows.map((row) => (
                                            <div key={row.sourceKey} className="catalog-health-card">
                                                <div className="catalog-health-head">
                                                    <div>
                                                        <div className="catalog-health-title">{row.title}</div>
                                                        <div className="catalog-health-meta">{row.questionCount} câu snapshot · lỗi trên {row.issueCount} câu · cập nhật {formatTimeAgo(row.updatedAt)}</div>
                                                    </div>
                                                    <span className="stat-badge warning">{getMissingFieldLabel(row.missingSubjectCount > 0, row.missingGradeCount > 0)}</span>
                                                </div>
                                                <div className="catalog-health-flags">
                                                    <span><i className="bi bi-tag"></i> Thiếu môn: {row.missingSubjectCount}</span>
                                                    <span><i className="bi bi-mortarboard"></i> Thiếu khối: {row.missingGradeCount}</span>
                                                    <span><i className="bi bi-diagram-3"></i> Hiện tại: {row.subject || 'Chưa có môn'} · {row.grade || 'Chưa có khối'}</span>
                                                </div>
                                                {row.sourceExamId && (
                                                    <div className="catalog-health-actions">
                                                        <button className="btn btn-sm btn-outline" onClick={() => { window.location.href = `/teacher/exam/${row.sourceExamId}`; }}>
                                                            <i className="bi bi-box-arrow-up-right"></i> Mở đề nguồn
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="catalog-section-title">Đề thư viện dùng chung đang thiếu taxonomy</div>
                                {catalogLoading ? (
                                    <div className="catalog-empty-inline">Đang kiểm tra thư viện dùng chung...</div>
                                ) : catalogHealth.sharedIssueRows.length === 0 ? (
                                    <div className="catalog-empty-inline">Thư viện dùng chung đang sạch metadata.</div>
                                ) : (
                                    <div className="catalog-health-list compact">
                                        {catalogHealth.sharedIssueRows.map((row) => (
                                            <div key={row.id} className="catalog-health-card compact">
                                                <div className="catalog-health-head">
                                                    <div>
                                                        <div className="catalog-health-title">{row.title}</div>
                                                        <div className="catalog-health-meta">Cập nhật {formatTimeAgo(row.updatedAt)}</div>
                                                    </div>
                                                    <span className="stat-badge warning">{getMissingFieldLabel(row.missingSubject, row.missingGrade)}</span>
                                                </div>
                                                {row.sourceExamId && (
                                                    <div className="catalog-health-actions">
                                                        <button className="btn btn-sm btn-outline" onClick={() => { window.location.href = `/teacher/exam/${row.sourceExamId}`; }}>
                                                            <i className="bi bi-box-arrow-up-right"></i> Mở đề nguồn
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'moderation' && (
                <div className="moderation-layout">
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h3><i className="bi bi-send-check"></i> Hàng chờ kiểm duyệt</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>Các bộ câu cá nhân được giáo viên gửi lên để xuất bản vào thư viện dùng chung.</p>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <div className="filter-tabs">
                                    {[
                                        { key: BANK_SUBMISSION_STATUS.PENDING, label: 'Chờ duyệt' },
                                        { key: BANK_SUBMISSION_STATUS.APPROVED, label: 'Đã duyệt' },
                                        { key: BANK_SUBMISSION_STATUS.REJECTED, label: 'Từ chối' },
                                        { key: 'all', label: 'Tất cả' },
                                    ].map((item) => (
                                        <button key={item.key} className={`filter-tab ${moderationFilter === item.key ? 'active' : ''}`} onClick={() => setModerationFilter(item.key)}>
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                                <button className="btn btn-outline btn-sm" onClick={loadModerationQueue} disabled={moderationLoading}>
                                    <i className="bi bi-arrow-repeat"></i> {moderationLoading ? 'Đang tải...' : 'Tải lại'}
                                </button>
                            </div>
                        </div>
                        <div className="card-body moderation-list">
                            {moderationLoading ? (
                                <div className="loading-screen" style={{ minHeight: 220 }}>
                                    <div className="spinner"></div>
                                    <p>Đang tải submission...</p>
                                </div>
                            ) : moderationRows.length === 0 ? (
                                <div className="empty-state" style={{ minHeight: 220 }}>
                                    <i className="bi bi-inbox"></i>
                                    <p>Chưa có bộ câu nào trong trạng thái này.</p>
                                </div>
                            ) : (
                                moderationRows.map((submission) => {
                                    const status = getModerationStatusMeta(submission.status);
                                    return (
                                        <button
                                            key={submission.id}
                                            type="button"
                                            className={`moderation-card${selectedSubmissionId === submission.id ? ' active' : ''}`}
                                            onClick={() => setSelectedSubmissionId(submission.id)}
                                        >
                                            <div className="moderation-card-head">
                                                <div>
                                                    <div className="moderation-card-title">{submission.title}</div>
                                                    <div className="moderation-card-meta">{submission.submitterName || submission.submitterEmail || 'Không rõ giáo viên'} · {submission.questionCount || 0} câu</div>
                                                </div>
                                                <span className={`stat-badge ${status.className}`}><i className={`bi bi-${status.icon}`}></i> {status.label}</span>
                                            </div>
                                            <div className="moderation-card-meta">{submission.subject || 'Nhiều môn'} · {submission.grade || 'Nhiều khối'} · Gửi {formatTimeAgo(submission.submittedAt)}</div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    <div className="card moderation-preview">
                        {!selectedSubmission ? (
                            <div className="empty-state" style={{ minHeight: 320 }}>
                                <i className="bi bi-file-earmark-check"></i>
                                <p>Chọn một submission để xem trước chi tiết.</p>
                            </div>
                        ) : (
                            <>
                                <div className="card-header">
                                    <div>
                                        <h3><i className="bi bi-journal-text"></i> {selectedSubmission.title}</h3>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                                            {selectedSubmission.submitterName || selectedSubmission.submitterEmail || 'Không rõ giáo viên'} · {selectedSubmission.questionCount || 0} câu · {selectedSubmission.duration || 45} phút
                                        </p>
                                    </div>
                                    <span className={`stat-badge ${getModerationStatusMeta(selectedSubmission.status).className}`}>
                                        <i className={`bi bi-${getModerationStatusMeta(selectedSubmission.status).icon}`}></i> {getModerationStatusMeta(selectedSubmission.status).label}
                                    </span>
                                </div>
                                <div className="card-body" style={{ display: 'grid', gap: 16 }}>
                                    <div className="moderation-meta-grid">
                                        <div className="submission-status-card">
                                            <div className="submission-status-title">Taxonomy</div>
                                            <div className="submission-status-meta">{selectedSubmission.subject || 'Nhiều môn'} · {selectedSubmission.grade || 'Nhiều khối'}</div>
                                            {selectedSubmission.chapters?.length > 0 && <div className="submission-status-note">Chương: {selectedSubmission.chapters.join(', ')}</div>}
                                        </div>
                                        <div className="submission-status-card">
                                            <div className="submission-status-title">Ghi chú giáo viên</div>
                                            <div className="submission-status-note">{selectedSubmission.note || 'Không có ghi chú gửi duyệt.'}</div>
                                            {selectedSubmission.reviewNote && <div className="submission-status-review">Review gần nhất: {selectedSubmission.reviewNote}</div>}
                                        </div>
                                    </div>

                                    {selectedSubmission.status === BANK_SUBMISSION_STATUS.PENDING && (
                                        <div className="moderation-actions">
                                            <button className="btn btn-danger-soft" onClick={() => handleRejectSubmission(selectedSubmission)} disabled={moderationActingId === selectedSubmission.id}>
                                                <i className="bi bi-x-circle"></i> {moderationActingId === selectedSubmission.id ? 'Đang xử lý...' : 'Từ chối'}
                                            </button>
                                            <button className="btn btn-primary" onClick={() => handleApproveSubmission(selectedSubmission)} disabled={moderationActingId === selectedSubmission.id}>
                                                <i className="bi bi-check-circle"></i> {moderationActingId === selectedSubmission.id ? 'Đang xử lý...' : 'Duyệt và publish'}
                                            </button>
                                        </div>
                                    )}

                                    {submissionQuestionsLoading ? (
                                        <div className="loading-screen" style={{ minHeight: 200 }}>
                                            <div className="spinner"></div>
                                            <p>Đang tải câu hỏi...</p>
                                        </div>
                                    ) : (
                                        <div className="moderation-question-list">
                                            {selectedSubmissionQuestions.map((question, index) => (
                                                <div key={question.id} className="moderation-question-card">
                                                    <div className="moderation-card-head">
                                                        <div className="moderation-card-title">Câu {index + 1}</div>
                                                        <div className="moderation-card-meta">{question.type || 'mcq'} · Mức {question.difficulty || 1}</div>
                                                    </div>
                                                    <div className="moderation-question-text">{summarizeQuestion(question) || 'Câu hỏi không có nội dung text preview.'}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'taxonomy' && (
                <div className="card">
                    <div className="card-header">
                        <div>
                            <h3><i className="bi bi-diagram-3"></i> Taxonomy môn học và lớp</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                                Danh sách này được dùng lại ở trang tạo đề, chỉnh sửa đề và ngân hàng câu hỏi.
                            </p>
                        </div>
                        <button className="btn btn-outline btn-sm" onClick={loadTaxonomy} disabled={taxonomyLoading}>
                            <i className="bi bi-arrow-repeat"></i> {taxonomyLoading ? 'Đang tải...' : 'Tải lại'}
                        </button>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: 18 }}>
                        <div className="alert alert-info" style={{ marginBottom: 0 }}>
                            <i className="bi bi-info-circle"></i> Mỗi dòng là một giá trị. Giá trị trùng sẽ tự gộp, khoảng trắng đầu/cuối sẽ tự loại bỏ.
                        </div>

                        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                            <div>
                                <label className="form-label">Các khối lớp</label>
                                <textarea
                                    className="form-input"
                                    value={taxonomyDraft.grades}
                                    onChange={(event) => setTaxonomyDraft((previous) => ({ ...previous, grades: event.target.value }))}
                                    rows={12}
                                    style={{ minHeight: 260, resize: 'vertical' }}
                                    placeholder="Lớp 10&#10;Lớp 11&#10;Lớp 12"
                                />
                                <div className="taxonomy-chip-grid">
                                    {previewGrades.map((grade) => <span key={grade} className="taxonomy-chip">{grade}</span>)}
                                </div>
                            </div>

                            <div>
                                <label className="form-label">Các môn học</label>
                                <textarea
                                    className="form-input"
                                    value={taxonomyDraft.subjects}
                                    onChange={(event) => setTaxonomyDraft((previous) => ({ ...previous, subjects: event.target.value }))}
                                    rows={12}
                                    style={{ minHeight: 260, resize: 'vertical' }}
                                    placeholder="Toán&#10;Ngữ văn&#10;Tiếng Anh"
                                />
                                <div className="taxonomy-chip-grid">
                                    {previewSubjects.map((subject) => <span key={subject} className="taxonomy-chip">{subject}</span>)}
                                </div>
                            </div>
                        </div>

                        <div className="taxonomy-footer">
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                {taxonomyMeta?.updatedAt
                                    ? `Cập nhật gần nhất: ${formatDate(taxonomyMeta.updatedAt)}${taxonomyMeta.updatedByName ? ` bởi ${taxonomyMeta.updatedByName}` : ''}`
                                    : 'Chưa có bản taxonomy lưu riêng, đang dùng bộ mặc định của hệ thống.'}
                            </div>
                            <button className="btn btn-primary" onClick={handleSaveTaxonomy} disabled={taxonomySaving || taxonomyLoading}>
                                <i className="bi bi-save"></i> {taxonomySaving ? 'Đang lưu...' : 'Lưu taxonomy'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'playbook' && (
                <div className="playbook-grid">
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h3><i className="bi bi-journal-text"></i> Sơ đồ vận hành riêng cho super admin</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                                    Đây là bản ghi nhớ vận hành của riêng anh cho hệ thống này. Có thể sửa trực tiếp và lưu lại để lần sau mở ra là thấy đúng quy trình.
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className="btn btn-outline btn-sm" onClick={handleResetPlaybook} disabled={playbookSaving}>
                                    <i className="bi bi-arrow-counterclockwise"></i> Khôi phục mẫu chuẩn
                                </button>
                                <button className="btn btn-primary btn-sm" onClick={handleSavePlaybook} disabled={playbookSaving || playbookLoading}>
                                    <i className="bi bi-save"></i> {playbookSaving ? 'Đang lưu...' : 'Lưu playbook'}
                                </button>
                            </div>
                        </div>
                        <div className="card-body" style={{ display: 'grid', gap: 16 }}>
                            <div className="alert alert-info" style={{ marginBottom: 0 }}>
                                <i className="bi bi-lock"></i> Playbook này được lưu riêng theo tài khoản admin hiện tại, không dùng chung cho giáo viên.
                            </div>

                            <div className="playbook-meta-row">
                                <span><i className="bi bi-database"></i> Nguồn dữ liệu: adminPlaybooks/{user?.uid || 'adminId'}</span>
                                <span>
                                    <i className="bi bi-clock-history"></i>
                                    {' '}
                                    {playbookMeta?.updatedAt
                                        ? `Cập nhật gần nhất: ${formatDate(playbookMeta.updatedAt)}${playbookMeta.updatedByName ? ` bởi ${playbookMeta.updatedByName}` : ''}`
                                        : 'Chưa có bản lưu riêng, đang dùng mẫu mặc định'}
                                </span>
                            </div>

                            <div className="playbook-summary-grid">
                                <div className="playbook-summary-card">
                                    <strong>System bank</strong>
                                    <p>Kho câu hỏi gốc do admin chuẩn hóa và publish sang bankItems với scope=system.</p>
                                </div>
                                <div className="playbook-summary-card">
                                    <strong>Shared library</strong>
                                    <p>Kho đề hoàn chỉnh để giáo viên nhập nhanh về tài khoản riêng.</p>
                                </div>
                                <div className="playbook-summary-card">
                                    <strong>Moderation queue</strong>
                                    <p>Hàng chờ để duyệt nội dung giáo viên gửi lên trước khi xuất bản dùng chung.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {[
                        {
                            key: 'collectionMap',
                            icon: 'diagram-3',
                            title: '1. Sơ đồ collection Firestore theo vai trò admin / teacher',
                            note: 'Phần này dùng để nhớ collection nào là kho gốc, collection nào là kho chia sẻ, collection nào là dữ liệu vận hành.',
                            rows: 18,
                        },
                        {
                            key: 'dailyWorkflow',
                            icon: 'calendar-check',
                            title: '2. Quy trình vận hành hằng ngày của super admin',
                            note: 'Dùng như checklist mở ra mỗi ngày để không bị lẫn khi đang chạy nhiều hệ thống khác nhau.',
                            rows: 16,
                        },
                        {
                            key: 'subjectLockPlan',
                            icon: 'shield-lock',
                            title: '3. Danh sách thay đổi code tối thiểu để khóa giáo viên theo môn đăng ký',
                            note: 'Đây là roadmap kỹ thuật ngắn nhất để chuyển từ kho mở sang kho có phân quyền theo môn / khối.',
                            rows: 14,
                        },
                        {
                            key: 'privateNotes',
                            icon: 'sticky',
                            title: '4. Ghi chú riêng / cập nhật vận hành',
                            note: 'Anh có thể ghi thêm những quyết định mới, taxonomy nội bộ, hoặc nhắc việc cần làm tuần sau.',
                            rows: 10,
                        },
                    ].map((section) => (
                        <div key={section.key} className="card playbook-section-card">
                            <div className="card-header">
                                <div>
                                    <h3><i className={`bi bi-${section.icon}`}></i> {section.title}</h3>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>{section.note}</p>
                                </div>
                            </div>
                            <div className="card-body">
                                <textarea
                                    className="form-input playbook-textarea"
                                    rows={section.rows}
                                    value={playbookDraft[section.key]}
                                    onChange={(event) => setPlaybookDraft((previous) => ({ ...previous, [section.key]: event.target.value }))}
                                    placeholder="Nhập ghi chú vận hành..."
                                    disabled={playbookLoading}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'ai' && (
                <AISettingsPanel
                    userId={user?.uid}
                    heading="AI BYOK cho admin"
                    description="Dùng để thử các provider Gemini, Groq, DeepSeek trong trình duyệt hiện tại khi rà soát nội dung hoặc chuẩn bị tính năng AI chi phí thấp."
                />
            )}
        </div>
    );
}
