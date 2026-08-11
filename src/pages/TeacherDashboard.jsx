import React, { useState, useEffect, useCallback, useDeferredValue, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy, deleteDoc, doc, updateDoc, getDoc, limit, startAfter, documentId, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimeAgo } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import AISettingsPanel from '../components/AISettingsPanel';
import { logAuditEvent } from '../utils/audit';
import Swal from 'sweetalert2';
import { normalizeSearchTerm } from '../utils/search';
import { importBuiltInSampleExam, importSharedExamToTeacher } from '../utils/library';
import { BUILT_IN_SAMPLE_EXAMS } from '../utils/sampleLibrary';
import { seedStarterExam } from '../utils/starterExam';
import {
    blocksExamActivation,
    formatImportQualitySummary,
    getImportQualityBadge,
    shouldWarnBeforeActivation,
} from '../utils/importQuality';
import {
    getTeacherCatalogAccess,
    getTeacherCatalogAccessSummary,
} from '../utils/teacherCatalogAccess';
import {
    createTeacherPlanRequest,
    formatTeacherPlanDuration,
    getTeacherPlanRequestStatusMeta,
    getTeacherPlanRequestTypeMeta,
    loadTeacherPlanRequests,
    TEACHER_PLAN_DURATION_OPTIONS,
    TEACHER_PLAN_REQUEST_STATUS,
    TEACHER_PLAN_REQUEST_TYPES,
} from '../utils/teacherPlanRequests';
import {
    FREE_TEACHER_LIMITS,
    getTeacherComputedStatus,
    getTeacherPremiumLiveUsage,
    getTeacherStatusMeta,
    isTeacherFreePlan,
} from '../utils/teacherPlan';

const EXAM_PAGE_SIZE = 12;
const STUDENT_PAGE_SIZE = 10;
const SHARED_PAGE_SIZE = 12;
const LIBRARY_VIEWS = [
    { id: 'math', icon: 'calculator', label: 'Đề mẫu Toán' },
    { id: 'english', icon: 'translate', label: 'Đề mẫu Tiếng Anh' },
    { id: 'shared', icon: 'collection', label: 'Thư viện dùng chung' },
];

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    return new Date(value).getTime();
}

export default function TeacherDashboard() {
    const navigate = useNavigate();
    const { user, userProfile, isSubscriptionActive, isPaidTeacherPlan, refreshProfile } = useAuth();
    const [exams, setExams] = useState([]);
    const [students, setStudents] = useState([]);
    const [sharedExams, setSharedExams] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0, draft: 0, totalSessions: 0, studentCount: 0, sharedExamCount: 0, premiumLiveUsageMonth: null, premiumLiveUsageCount: 0 });
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState('exams'); // 'exams' | 'students' | 'library' | 'guide' | 'settings'
    const [loading, setLoading] = useState(true);
    const [tabLoading, setTabLoading] = useState({ exams: false, students: false, library: false });
    const [examCursor, setExamCursor] = useState(null);
    const [studentCursor, setStudentCursor] = useState(null);
    const [sharedCursor, setSharedCursor] = useState(null);
    const [hasMoreExams, setHasMoreExams] = useState(false);
    const [hasMoreStudents, setHasMoreStudents] = useState(false);
    const [hasMoreShared, setHasMoreShared] = useState(false);
    const [importingSharedId, setImportingSharedId] = useState(null);
    const [importingSampleId, setImportingSampleId] = useState(null);
    const [libraryView, setLibraryView] = useState('math');
    const [starterSeedDone, setStarterSeedDone] = useState(false);
    const [pendingStudents, setPendingStudents] = useState([]);
    const [planRequests, setPlanRequests] = useState([]);
    const [planRequestLoading, setPlanRequestLoading] = useState(false);
    const [submittingPlanRequest, setSubmittingPlanRequest] = useState(false);
    const showLegacyGuide = false;

    const isAdminView = userProfile?.role === 'admin';
    const slug = isAdminView ? null : userProfile?.teacherSlug;
    const portalUrl = slug ? `${window.location.origin}/t/${slug}` : null;
    const computedTeacherStatus = isAdminView ? 'active' : getTeacherComputedStatus(userProfile);
    const teacherStatusMeta = isAdminView ? { label: 'Super Admin', badgeClass: 'active', status: 'active' } : getTeacherStatusMeta(userProfile);
    const hasTeacherAccess = isAdminView ? true : isSubscriptionActive?.();
    const isPaidPlan = isAdminView ? true : isPaidTeacherPlan?.();
    const isFreePlan = !isAdminView && isTeacherFreePlan(userProfile);
    const subEnd = isAdminView
        ? null
        : (userProfile?.subscriptionEnd
            ? (userProfile.subscriptionEnd.toDate ? userProfile.subscriptionEnd.toDate() : new Date(userProfile.subscriptionEnd))
            : null);
    const daysLeft = subEnd ? Math.ceil((subEnd - Date.now()) / 86400000) : null;
    const deferredSearch = useDeferredValue(search);
    const searchToken = normalizeSearchTerm(deferredSearch).split(' ').filter(Boolean)[0] || '';
    const dashboardTabLabel = {
        exams: 'Kho đề thi',
        students: 'Học sinh',
        library: 'Thư viện',
        guide: 'Hướng dẫn',
        bank: 'Ngân hàng câu',
        settings: 'Cài đặt',
    }[activeTab] || 'Dashboard';
    const catalogAccess = useMemo(() => getTeacherCatalogAccess(userProfile), [userProfile]);
    const catalogAccessSummary = useMemo(() => getTeacherCatalogAccessSummary(userProfile), [userProfile]);
    const sampleLibraryExams = useMemo(() => BUILT_IN_SAMPLE_EXAMS.filter((item) => !searchToken || item.searchKeywords?.includes(searchToken)), [searchToken]);
    const filteredSampleLibraryExams = useMemo(() => sampleLibraryExams.filter((item) => item.sampleCategory === (libraryView === 'english' ? 'english' : 'math')), [libraryView, sampleLibraryExams]);
    const premiumLiveUsage = useMemo(() => getTeacherPremiumLiveUsage(stats), [stats]);
    const latestPlanRequest = planRequests[0] || null;
    const latestPlanRequestStatus = latestPlanRequest ? getTeacherPlanRequestStatusMeta(latestPlanRequest.status) : null;
    const hasPendingPlanRequest = planRequests.some((item) => item.status === TEACHER_PLAN_REQUEST_STATUS.PENDING);
    const teacherAnnualPlanLabel = `${formatTeacherPlanDuration(12)} · 200.000đ`;
    const freeTierLimitSummary = `${FREE_TEACHER_LIMITS.maxStudents} học sinh · ${FREE_TEACHER_LIMITS.maxActiveExams} đề đang mở · ${FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth} live game nâng cao / tháng`;
    const currentStudentCount = Math.max(stats.studentCount || 0, students.length || 0);
    const teacherStatusLabel = isAdminView
        ? 'Super Admin'
        : computedTeacherStatus === 'expired'
            ? 'Teacher Plus đã hết hạn'
            : teacherStatusMeta.label;
    const teacherStatusBadgeClass = isAdminView ? 'active' : teacherStatusMeta.badgeClass;
    const teacherUpgradeCardTitle = hasPendingPlanRequest
        ? 'Yêu cầu gói của bạn đang chờ admin duyệt'
        : computedTeacherStatus === 'expired'
            ? 'Teacher Plus của bạn đã hết hạn'
            : isPaidPlan
                ? 'Gia hạn Teacher Plus để giữ trọn bộ công cụ giáo viên'
                : 'Bạn đang ở gói Free, có thể nâng cấp khi cần mở rộng';
    const teacherUpgradeCardSummary = hasPendingPlanRequest
        ? `Yêu cầu gần nhất: ${latestPlanRequest?.requestedPlanLabel || teacherAnnualPlanLabel}. Admin sẽ xử lý trực tiếp trong dashboard quản trị.`
        : computedTeacherStatus === 'expired'
            ? 'Bạn vẫn giữ kho đề hiện có nhưng không thể mở thêm đề hoặc tạo live room mới cho đến khi gia hạn.'
            : isPaidPlan
                ? 'Mức đang áp dụng cho giai đoạn 1 là 200.000đ / năm. Gói này ưu tiên cho giáo viên dùng kho đề, live game, studio dạy học và ngân hàng câu.'
                : `Gói Free cho phép ${freeTierLimitSummary}. Tháng này còn ${premiumLiveUsage.remaining}/${premiumLiveUsage.limit} lượt live game nâng cao. Teacher Plus đang ở mức 200.000đ / năm.`;

    const loadStats = useCallback(async () => {
        if (!user?.uid) return;
        try {
            const statsSnap = await getDoc(doc(db, 'teacherStats', user.uid));
            if (!statsSnap.exists()) {
                setStats({ total: 0, active: 0, draft: 0, totalSessions: 0, studentCount: 0, sharedExamCount: 0, premiumLiveUsageMonth: null, premiumLiveUsageCount: 0 });
                return;
            }
            const data = statsSnap.data();
            setStats({
                total: data.examCount || 0,
                active: data.activeExamCount || 0,
                draft: data.draftExamCount || 0,
                totalSessions: data.sessionCount || 0,
                studentCount: isAdminView ? 0 : data.studentCount || 0,
                sharedExamCount: data.sharedExamCount || 0,
                premiumLiveUsageMonth: data.premiumLiveUsageMonth || null,
                premiumLiveUsageCount: data.premiumLiveUsageCount || 0,
            });
        } catch (error) {
            console.error('load stats failed', error);
        }
    }, [isAdminView, user?.uid]);

    const fetchExamPage = useCallback(async (reset = false, cursor = null) => {
        if (!user?.uid) return;
        setTabLoading(prev => ({ ...prev, exams: true }));
        try {
            const constraints = [where('teacherId', '==', user.uid)];
            if (filter !== 'all') constraints.push(where('status', '==', filter));
            if (searchToken) constraints.push(where('searchKeywords', 'array-contains', searchToken));
            constraints.push(orderBy('createdAt', 'desc'));
            if (!reset && cursor) constraints.push(startAfter(cursor));
            constraints.push(limit(EXAM_PAGE_SIZE));

            const snapshot = await getDocs(query(collection(db, 'exams'), ...constraints));
            const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            const statMap = {};

            if (rows.length > 0) {
                const statSnapshot = await getDocs(query(collection(db, 'examStats'), where(documentId(), 'in', rows.map((row) => row.id))));
                statSnapshot.docs.forEach((item) => {
                    statMap[item.id] = item.data();
                });
            }

            const mergedRows = rows.map((row) => ({
                ...row,
                sessionCount: statMap[row.id]?.sessionCount || 0,
            }));

            setExams(prev => reset ? mergedRows : [...prev, ...mergedRows]);
            setExamCursor(snapshot.docs.at(-1) || null);
            setHasMoreExams(snapshot.docs.length === EXAM_PAGE_SIZE);
        } catch (error) {
            console.error('fetch exams failed', error);
            if (reset) setExams([]);
        } finally {
            setTabLoading(prev => ({ ...prev, exams: false }));
            setLoading(false);
        }
    }, [filter, searchToken, user?.uid]);

    const fetchStudentPage = useCallback(async (reset = false, cursor = null) => {
        if (isAdminView || !user?.uid) return;
        setTabLoading(prev => ({ ...prev, students: true }));
        try {
            const constraints = [where('teacherId', '==', user.uid), where('role', '==', 'student')];
            if (searchToken) constraints.push(where('searchKeywords', 'array-contains', searchToken));
            constraints.push(orderBy('displayNameLower', 'asc'));
            if (!reset && cursor) constraints.push(startAfter(cursor));
            constraints.push(limit(STUDENT_PAGE_SIZE));

            const snapshot = await getDocs(query(collection(db, 'users'), ...constraints));
            const rows = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
            const quizCountMap = {};

            if (rows.length > 0) {
                const studentIds = rows.map((row) => row.uid);
                const sessionSnapshot = await getDocs(query(
                    collection(db, 'sessions'),
                    where('teacherId', '==', user.uid),
                    where('studentId', 'in', studentIds),
                ));
                sessionSnapshot.docs.forEach((item) => {
                    const session = item.data();
                    quizCountMap[session.studentId] = (quizCountMap[session.studentId] || 0) + 1;
                });
            }

            const mergedRows = rows.map((row) => ({
                ...row,
                quizCount: quizCountMap[row.uid] || 0,
            }));

            setStudents(prev => reset ? mergedRows : [...prev, ...mergedRows]);
            setStudentCursor(snapshot.docs.at(-1) || null);
            setHasMoreStudents(snapshot.docs.length === STUDENT_PAGE_SIZE);
        } catch (error) {
            console.error('fetch students failed', error);
            if (reset) setStudents([]);
        } finally {
            setTabLoading(prev => ({ ...prev, students: false }));
            setLoading(false);
        }
    }, [isAdminView, searchToken, user?.uid]);

    const fetchPendingStudents = useCallback(async () => {
        if (isAdminView || !user?.uid) return;
        try {
            const snap = await getDocs(query(
                collection(db, 'users'),
                where('pendingTeacherId', '==', user.uid)
            ));
            setPendingStudents(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
        } catch (err) {
            console.error('fetch pending students failed', err);
        }
    }, [isAdminView, user?.uid]);

    const loadPlanRequests = useCallback(async () => {
        if (isAdminView || !user?.uid) return;
        setPlanRequestLoading(true);
        try {
            const rows = await loadTeacherPlanRequests(user.uid, { maxResults: 5 });
            setPlanRequests(rows);
        } catch (error) {
            console.error('load plan requests failed', error);
            setPlanRequests([]);
        } finally {
            setPlanRequestLoading(false);
        }
    }, [isAdminView, user?.uid]);

    const fetchSharedPage = useCallback(async (reset = false, cursor = null) => {
        if (isAdminView || !user?.uid) return;
        setTabLoading(prev => ({ ...prev, library: true }));
        try {
            if (!catalogAccess.hasFullCatalogAccess) {
                if (!catalogAccess.allowedPairs.length) {
                    setSharedExams([]);
                    setSharedCursor(null);
                    setHasMoreShared(false);
                    return;
                }

                const snapshots = await Promise.all(catalogAccess.allowedPairs.map((pair) => getDocs(query(
                    collection(db, 'sharedExams'),
                    where('published', '==', true),
                    where('subject', '==', pair.subject),
                    where('grade', '==', pair.grade),
                ))));

                const rows = [...new Map(
                    snapshots.flatMap((snapshot) => snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))
                ).values()]
                    .filter((item) => {
                        if (!search.trim()) return true;
                        const token = search.trim().toLowerCase();
                        return [
                            item.title,
                            item.subject,
                            item.grade,
                            item.ownerAdminName,
                            ...(item.searchKeywords || []),
                        ].some((value) => (value || '').toLowerCase().includes(token));
                    })
                    .sort((left, right) => toMillis(right.updatedAt || right.publishedAt) - toMillis(left.updatedAt || left.publishedAt));

                setSharedExams(rows);
                setSharedCursor(null);
                setHasMoreShared(false);
                return;
            }

            const constraints = [where('published', '==', true)];
            if (searchToken) constraints.push(where('searchKeywords', 'array-contains', searchToken));
            constraints.push(orderBy('updatedAt', 'desc'));
            if (!reset && cursor) constraints.push(startAfter(cursor));
            constraints.push(limit(SHARED_PAGE_SIZE));

            const snapshot = await getDocs(query(collection(db, 'sharedExams'), ...constraints));
            const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
            setSharedExams(prev => reset ? rows : [...prev, ...rows]);
            setSharedCursor(snapshot.docs.at(-1) || null);
            setHasMoreShared(snapshot.docs.length === SHARED_PAGE_SIZE);
        } catch (error) {
            console.error('fetch shared exams failed', error);
            if (reset) setSharedExams([]);
        } finally {
            setTabLoading(prev => ({ ...prev, library: false }));
            setLoading(false);
        }
    }, [catalogAccess, isAdminView, search, searchToken, user?.uid]);

    useEffect(() => {
        if (!user || !userProfile) return;
        loadStats();
        if (!isAdminView) fetchPendingStudents();
        if (!isAdminView) loadPlanRequests();
    }, [fetchPendingStudents, isAdminView, loadPlanRequests, loadStats, user, userProfile]);

    // Seed a starter exam once for brand-new teachers
    useEffect(() => {
        if (loading || starterSeedDone || isAdminView || !user || !userProfile) return;
        if (userProfile.starterExamSeeded) return;
        if (stats.total === 0) {
            setStarterSeedDone(true);
            seedStarterExam(user, userProfile)
                .then(() => { loadStats(); fetchExamPage(true); })
                .catch(console.error);
        }
    }, [loading, stats.total, user, userProfile, isAdminView, starterSeedDone, loadStats, fetchExamPage]);

    useEffect(() => {
        if (!user || !userProfile) return;
        if (activeTab === 'exams') {
            setExamCursor(null);
            fetchExamPage(true);
            return;
        }
        if (!isAdminView && activeTab === 'students') {
            setStudentCursor(null);
            fetchStudentPage(true);
            fetchPendingStudents();
            return;
        }
        if (!isAdminView && activeTab === 'library') {
            setSharedCursor(null);
            fetchSharedPage(true);
            return;
        }
        setLoading(false);
    }, [activeTab, fetchExamPage, fetchSharedPage, fetchStudentPage, fetchPendingStudents, filter, isAdminView, searchToken, user, userProfile]);

    async function promptUpgradeForLimit(title, html) {
        const result = await Swal.fire({
            title,
            html,
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: hasPendingPlanRequest ? 'Xem yêu cầu hiện tại' : 'Nâng cấp Teacher Plus',
            cancelButtonText: 'Để sau',
            confirmButtonColor: '#2563eb',
        });

        if (result.isConfirmed) {
            openPlanRequestPanel();
        }
    }

    const toggleStatus = async (exam) => {
        const examId = exam.id;
        const currentStatus = exam.status;
        if (!hasTeacherAccess && currentStatus !== 'active') {
            Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn. Liên hệ admin để gia hạn.', 'warning');
            return;
        }
        const newStatus = currentStatus === 'active' ? 'draft' : 'active';

        if (newStatus === 'active') {
            if (isFreePlan && (stats.active || 0) >= FREE_TEACHER_LIMITS.maxActiveExams) {
                await promptUpgradeForLimit(
                    'Gói Free đã chạm giới hạn đề đang mở',
                    `Bạn đang có <b>${stats.active || 0}</b> đề ở trạng thái Đang mở. Gói Free chỉ giữ tối đa <b>${FREE_TEACHER_LIMITS.maxActiveExams}</b> đề đang mở cùng lúc.<br><br>Bạn có thể đóng bớt đề cũ hoặc gửi yêu cầu nâng cấp Teacher Plus ngay trong app.`,
                );
                return;
            }

            if (blocksExamActivation(exam.importQuality, exam.sourceFormat || 'manual')) {
                Swal.fire('Đề chưa an toàn để mở', 'Khiên nhập đề đang chặn phát hành vì đề này còn lỗi cấu trúc. Hãy vào Chi tiết để sửa trước khi mở cho học sinh.', 'warning');
                return;
            }

            if (shouldWarnBeforeActivation(exam.importQuality, exam.sourceFormat || 'manual')) {
                const reviewWarning = await Swal.fire({
                    title: 'Đề chưa được rà soát xong',
                    html: `Tóm tắt hiện tại: <b>${formatImportQualitySummary(exam.importQuality, exam.sourceFormat || 'manual')}</b>.<br><br>Hệ thống khuyến nghị bạn mở trang Chi tiết đề để đánh dấu đã kiểm trước khi phát hành.`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Vẫn mở đề',
                    cancelButtonText: 'Quay lại kiểm tra',
                    confirmButtonColor: '#f59e0b',
                });
                if (!reviewWarning.isConfirmed) return;
            }
        }

        const r = await Swal.fire({
            title: `${newStatus === 'active' ? 'Kích hoạt' : 'Đóng'} đề thi?`,
            icon: 'question', showCancelButton: true,
            confirmButtonText: newStatus === 'active' ? 'Kích hoạt' : 'Đóng lại',
            cancelButtonText: 'Hủy',
            confirmButtonColor: newStatus === 'active' ? '#10b981' : '#f59e0b',
        });
        if (!r.isConfirmed) return;
        await updateDoc(doc(db, 'exams', examId), { status: newStatus });
        setExams(prev => prev.map(e => e.id === examId ? { ...e, status: newStatus } : e));
        setStats(prev => ({ ...prev, active: prev.active + (newStatus === 'active' ? 1 : -1), draft: prev.draft + (newStatus === 'active' ? -1 : 1) }));
    };

    const handleDelete = async (examId, title) => {
        const r = await Swal.fire({
            title: 'Xóa đề thi?', html: `Xóa "<b>${title}</b>"?<br><small>Không thể hoàn tác.</small>`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonText: 'Hủy', confirmButtonText: 'Xóa vĩnh viễn',
        });
        if (!r.isConfirmed) return;
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        await Promise.all(qSnap.docs.map(d => deleteDoc(d.ref)));
        await deleteDoc(doc(db, 'exams', examId));
        setExams(prev => prev.filter(e => e.id !== examId));
        setStats(prev => ({
            ...prev,
            total: Math.max(0, prev.total - 1),
            active: prev.active - (exams.find(e => e.id === examId)?.status === 'active' ? 1 : 0),
            draft: prev.draft - (exams.find(e => e.id === examId)?.status === 'active' ? 0 : 1),
        }));
        Swal.fire({ icon: 'success', title: 'Đã xóa!', timer: 1500, showConfirmButton: false });
    };

    const copyPortalLink = () => {
        if (!portalUrl) return;
        navigator.clipboard.writeText(portalUrl);
        Swal.fire({ icon: 'success', title: 'Đã copy link!', text: portalUrl, timer: 2000, showConfirmButton: false });
    };

    // ===== Student management =====
    const handleBlockStudent = async (student) => {
        const isBlocked = student.blocked;
        const r = await Swal.fire({
            title: isBlocked ? 'Mở khóa học sinh?' : 'Khóa học sinh?',
            text: isBlocked
                ? `Mở khóa "${student.displayName}"? Họ sẽ lại có thể thi.`
                : `Khóa "${student.displayName}"? Họ sẽ không thể thi.`,
            icon: 'question', showCancelButton: true,
            confirmButtonText: isBlocked ? 'Mở khóa' : 'Khóa',
            confirmButtonColor: isBlocked ? '#10b981' : '#f59e0b',
            cancelButtonText: 'Hủy',
        });
        if (!r.isConfirmed) return;
        await updateDoc(doc(db, 'users', student.uid), { blocked: !isBlocked });
        await logAuditEvent({
            actorId: user.uid,
            actorRole: userProfile?.role,
            actorName: userProfile?.displayName || user.email,
            action: isBlocked ? 'student.unblock' : 'student.block',
            targetType: 'user',
            targetId: student.uid,
            teacherId: user.uid,
            studentId: student.uid,
            metadata: {
                studentName: student.displayName || null,
                studentEmail: student.email || null,
            },
        }).catch((error) => console.error('audit log failed', error));
        setStudents(prev => prev.map(s => s.uid === student.uid ? { ...s, blocked: !isBlocked } : s));
    };

    const handleRemoveStudent = async (student) => {
        const r = await Swal.fire({
            title: 'Xóa học sinh?',
            html: `Xóa "<b>${student.displayName}</b>" khỏi lớp?<br><small>Họ có thể tham gia lại bằng link.</small>`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!r.isConfirmed) return;
        await updateDoc(doc(db, 'users', student.uid), { teacherId: null, teacherName: null, blocked: false });
        await logAuditEvent({
            actorId: user.uid,
            actorRole: userProfile?.role,
            actorName: userProfile?.displayName || user.email,
            action: 'student.remove_from_teacher',
            targetType: 'user',
            targetId: student.uid,
            teacherId: user.uid,
            studentId: student.uid,
            metadata: {
                studentName: student.displayName || null,
                studentEmail: student.email || null,
            },
        }).catch((error) => console.error('audit log failed', error));
        setStudents(prev => prev.filter(s => s.uid !== student.uid));
        setStats(prev => ({ ...prev, studentCount: prev.studentCount - 1 }));
    };

    const EXPIRY_OPTIONS = [
        { label: '1 tháng',  months: 1  },
        { label: '2 tháng',  months: 2  },
        { label: '3 tháng',  months: 3  },
        { label: '6 tháng',  months: 6  },
        { label: '12 tháng', months: 12 },
        { label: '24 tháng', months: 24 },
        { label: '36 tháng (tối đa)', months: 36 },
    ];

    const addMonths = (months) => {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        return d;
    };

    const formatExpiry = (ts) => {
        if (!ts) return null;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const now = new Date();
        if (d < now) return { label: 'Hết hạn', expired: true };
        const days = Math.ceil((d - now) / 86400000);
        if (days <= 30) return { label: `Còn ${days} ngày`, expired: false, warn: true };
        const months = Math.round(days / 30);
        return { label: `Còn ~${months} tháng`, expired: false };
    };

    const handleApproveStudent = async (student) => {
        if (isFreePlan && currentStudentCount >= FREE_TEACHER_LIMITS.maxStudents) {
            await promptUpgradeForLimit(
                'Gói Free đã chạm giới hạn học sinh',
                `Lớp của bạn đang có <b>${currentStudentCount}</b> học sinh. Gói Free chỉ quản lý tối đa <b>${FREE_TEACHER_LIMITS.maxStudents}</b> học sinh trong một lớp chính.<br><br>Bạn có thể dọn bớt học sinh cũ hoặc nâng cấp Teacher Plus để mở rộng lớp.`,
            );
            return;
        }

        // Ask duration
        const { value: months } = await Swal.fire({
            title: `Duyệt: ${student.displayName}`,
            html: `<div style="margin-bottom:8px;font-size:0.9rem;color:#64748b">Chọn thời hạn học sinh ở trong lớp:</div>
                   <select id="swal-expiry" class="swal2-input" style="margin:0;height:40px">
                     ${EXPIRY_OPTIONS.map(o => `<option value="${o.months}">${o.label}</option>`).join('')}
                   </select>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Duyệt',
            cancelButtonText: 'Hủy',
            preConfirm: () => {
                const v = document.getElementById('swal-expiry').value;
                return v ? parseInt(v) : null;
            },
        });
        if (!months) return;
        const expiry = addMonths(months);
        try {
            await updateDoc(doc(db, 'users', student.uid), {
                teacherId: user.uid,
                teacherName: userProfile?.displayName || '',
                teacherExpiry: expiry,
                pendingTeacherId: deleteField(),
                pendingTeacherName: deleteField(),
            });
            setPendingStudents(prev => prev.filter(s => s.uid !== student.uid));
            setStudents(prev => [...prev, { ...student, teacherId: user.uid, teacherExpiry: { toDate: () => expiry }, pendingTeacherId: null }]);
            setStats(prev => ({ ...prev, studentCount: prev.studentCount + 1 }));
            Swal.fire({ icon: 'success', title: 'Đã duyệt!', text: `${student.displayName} vào lớp, hạn ${expiry.toLocaleDateString('vi-VN')}.`, timer: 2200, showConfirmButton: false });
        } catch {
            Swal.fire('Lỗi', 'Không thể duyệt học sinh. Thử lại.', 'error');
        }
    };

    const handleExtendExpiry = async (student) => {
        const { value: months } = await Swal.fire({
            title: `Gia hạn: ${student.displayName}`,
            html: `<div style="margin-bottom:8px;font-size:0.9rem;color:#64748b">Chọn thời hạn mới (tính từ hôm nay):</div>
                   <select id="swal-expiry" class="swal2-input" style="margin:0;height:40px">
                     ${EXPIRY_OPTIONS.map(o => `<option value="${o.months}">${o.label}</option>`).join('')}
                   </select>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Gia hạn',
            cancelButtonText: 'Hủy',
            preConfirm: () => {
                const v = document.getElementById('swal-expiry').value;
                return v ? parseInt(v) : null;
            },
        });
        if (!months) return;
        const expiry = addMonths(months);
        try {
            await updateDoc(doc(db, 'users', student.uid), { teacherExpiry: expiry });
            setStudents(prev => prev.map(s => s.uid === student.uid ? { ...s, teacherExpiry: { toDate: () => expiry } } : s));
            Swal.fire({ icon: 'success', title: 'Đã gia hạn!', text: `Hết hạn: ${expiry.toLocaleDateString('vi-VN')}`, timer: 2000, showConfirmButton: false });
        } catch {
            Swal.fire('Lỗi', 'Không thể gia hạn. Thử lại.', 'error');
        }
    };

    const handleRejectStudent = async (student) => {
        const r = await Swal.fire({
            title: 'Từ chối yêu cầu?',
            html: `Từ chối <b>${student.displayName}</b> tham gia lớp?`,
            icon: 'question', showCancelButton: true,
            confirmButtonText: 'Từ chối', confirmButtonColor: '#ef4444', cancelButtonText: 'Hủy',
        });
        if (!r.isConfirmed) return;
        try {
            await updateDoc(doc(db, 'users', student.uid), {
                pendingTeacherId: deleteField(),
                pendingTeacherName: deleteField(),
            });
            setPendingStudents(prev => prev.filter(s => s.uid !== student.uid));
        } catch {
            Swal.fire('Lỗi', 'Không thể từ chối. Thử lại.', 'error');
        }
    };

    const handleImportSharedExam = async (sharedExam) => {
        if (!hasTeacherAccess) {
            Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn. Liên hệ admin để gia hạn.', 'warning');
            return;
        }
        const result = await Swal.fire({
            title: 'Nhập đề từ thư viện?',
            html: `Tạo một bản nháp riêng từ <b>${sharedExam.title}</b> để bạn chỉnh sửa và phát hành cho lớp của mình.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Nhập vào kho đề',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#2563eb',
        });
        if (!result.isConfirmed) return;

        setImportingSharedId(sharedExam.id);
        try {
            const imported = await importSharedExamToTeacher({ sharedExamId: sharedExam.id, user });
            await loadStats();
            Swal.fire({ icon: 'success', title: 'Đã nhập đề', text: 'Bản sao nháp đã được thêm vào kho đề của bạn.', timer: 1600, showConfirmButton: false });
            navigate(`/teacher/exam/${imported.examId}`);
        } catch (error) {
            console.error('import shared exam failed', error);
            Swal.fire('Không thể nhập đề', error.message, 'error');
        } finally {
            setImportingSharedId(null);
        }
    };

    const handleImportSampleExam = async (sampleExam) => {
        if (!hasTeacherAccess) {
            Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn. Liên hệ admin để gia hạn.', 'warning');
            return;
        }

        const result = await Swal.fire({
            title: 'Nhập đề mẫu hệ thống?',
            html: `Tạo một bản nháp riêng từ <b>${sampleExam.title}</b> để bạn sửa nhanh theo lớp của mình.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Nhập đề mẫu',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#2563eb',
        });
        if (!result.isConfirmed) return;

        setImportingSampleId(sampleExam.id);
        try {
            const imported = await importBuiltInSampleExam({ sampleExamId: sampleExam.id, user });
            await loadStats();
            Swal.fire({ icon: 'success', title: 'Đã nhập đề mẫu', text: 'Bản nháp mới đã nằm trong kho đề của bạn.', timer: 1600, showConfirmButton: false });
            navigate(`/teacher/exam/${imported.examId}`);
        } catch (error) {
            console.error('import sample exam failed', error);
            Swal.fire('Không thể nhập đề mẫu', error.message, 'error');
        } finally {
            setImportingSampleId(null);
        }
    };

    // ===== Settings =====
    const handleUpdateSlug = async () => {
        const { value } = await Swal.fire({
            title: 'Đổi link lớp học',
            input: 'text',
            inputLabel: 'Nhập slug mới (chỉ chữ thường, số, dấu gạch ngang)',
            inputValue: slug || '',
            inputPlaceholder: 'vd: nguyen-van-a',
            showCancelButton: true,
            confirmButtonText: 'Cập nhật',
            cancelButtonText: 'Hủy',
            inputValidator: (val) => {
                if (!val || !/^[a-z0-9-]+$/.test(val)) return 'Slug chỉ gồm chữ thường, số và dấu gạch ngang';
            }
        });
        if (!value) return;
        await updateDoc(doc(db, 'users', user.uid), { teacherSlug: value });
        await refreshProfile();
        Swal.fire({ icon: 'success', title: 'Đã cập nhật!', text: `Link mới: /t/${value}`, timer: 2000, showConfirmButton: false });
    };

    const handleUpdateSchool = async () => {
        const { value } = await Swal.fire({
            title: 'Cập nhật tên trường',
            input: 'text',
            inputValue: userProfile?.schoolName || '',
            inputPlaceholder: 'VD: THPT Nguyễn Huệ',
            showCancelButton: true,
            confirmButtonText: 'Cập nhật',
            cancelButtonText: 'Hủy',
        });
        if (value === undefined) return;
        await updateDoc(doc(db, 'users', user.uid), { schoolName: value.trim() || null });
        await refreshProfile();
        Swal.fire({ icon: 'success', title: 'Đã cập nhật!', timer: 1500, showConfirmButton: false });
    };

    const handleRequestPlanChange = async () => {
        if (isAdminView || !user?.uid) return;

        if (hasPendingPlanRequest) {
            setActiveTab('settings');
            Swal.fire('Đang chờ duyệt', 'Bạn đã có một yêu cầu nâng cấp hoặc gia hạn đang chờ admin xử lý.', 'info');
            return;
        }

        const defaultType = isPaidPlan || computedTeacherStatus === 'expired'
            ? TEACHER_PLAN_REQUEST_TYPES.RENEWAL
            : TEACHER_PLAN_REQUEST_TYPES.UPGRADE;
        const durationOptions = TEACHER_PLAN_DURATION_OPTIONS.map((months) => {
            const selected = months === 12 ? 'selected' : '';
            return `<option value="${months}" ${selected}>${formatTeacherPlanDuration(months)}</option>`;
        }).join('');

        const result = await Swal.fire({
            title: 'Yêu cầu nâng cấp / gia hạn',
            width: 760,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Gửi yêu cầu',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#2563eb',
            html: `
                <div style="display:grid;gap:14px;text-align:left;">
                    <div style="padding:12px 14px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;line-height:1.6;">
                        <div><strong>Gói hiện tại:</strong> ${catalogAccessSummary.packageLabel}</div>
                        <div>${catalogAccessSummary.subjectsText} · ${catalogAccessSummary.gradesText}</div>
                        <div style="margin-top:6px;font-size:0.85rem;">Dùng form này để báo admin rằng bạn muốn nâng cấp hoặc gia hạn. Admin sẽ xử lý ngay trong tab quản trị.</div>
                    </div>
                    <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:12px;">
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px;">Loại yêu cầu</label>
                            <select id="swal-plan-request-type" class="swal2-select" style="width:100%;margin:0;">
                                <option value="${TEACHER_PLAN_REQUEST_TYPES.UPGRADE}" ${defaultType === TEACHER_PLAN_REQUEST_TYPES.UPGRADE ? 'selected' : ''}>Nâng cấp gói</option>
                                <option value="${TEACHER_PLAN_REQUEST_TYPES.RENEWAL}" ${defaultType === TEACHER_PLAN_REQUEST_TYPES.RENEWAL ? 'selected' : ''}>Gia hạn thuê bao</option>
                            </select>
                        </div>
                        <div>
                            <label style="display:block;font-weight:700;margin-bottom:6px;">Thời hạn mong muốn</label>
                            <select id="swal-plan-request-months" class="swal2-select" style="width:100%;margin:0;">
                                ${durationOptions}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style="display:block;font-weight:700;margin-bottom:6px;">Ghi chú cho admin</label>
                        <textarea id="swal-plan-request-note" class="swal2-textarea" style="width:100%;margin:0;min-height:120px;" placeholder="Ví dụ: Tôi muốn gia hạn 1 năm và giữ nguyên quyền truy cập kho hiện tại."></textarea>
                    </div>
                </div>
            `,
            preConfirm: () => {
                const requestType = document.getElementById('swal-plan-request-type')?.value || TEACHER_PLAN_REQUEST_TYPES.UPGRADE;
                const requestedMonths = parseInt(document.getElementById('swal-plan-request-months')?.value || '0', 10);
                const note = document.getElementById('swal-plan-request-note')?.value || '';

                if (!requestedMonths || requestedMonths < 1) {
                    Swal.showValidationMessage('Cần chọn thời hạn mong muốn.');
                    return false;
                }

                return { requestType, requestedMonths, note };
            },
        });

        if (!result.isConfirmed || !result.value) return;

        setSubmittingPlanRequest(true);
        try {
            await createTeacherPlanRequest({
                user,
                userProfile,
                requestType: result.value.requestType,
                requestedMonths: result.value.requestedMonths,
                note: result.value.note,
            });
            await loadPlanRequests();
            setActiveTab('settings');
            Swal.fire({ icon: 'success', title: 'Đã gửi yêu cầu', text: 'Admin sẽ thấy yêu cầu này ngay trong dashboard quản trị.', timer: 1800, showConfirmButton: false });
        } catch (error) {
            console.error('create plan request failed', error);
            Swal.fire('Không thể gửi yêu cầu', error.message, 'error');
        } finally {
            setSubmittingPlanRequest(false);
        }
    };

    const openPlanRequestPanel = () => {
        setSearch('');
        if (hasPendingPlanRequest) {
            setActiveTab('settings');
            return;
        }
        handleRequestPlanChange();
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải kho đề...</p></div>;

    return (
        <div className="dashboard-shell dashboard-shell-teacher">
            <section className="dashboard-hero dashboard-hero-teacher">
                <div className="dashboard-hero-main">
                    <div className="dashboard-hero-topline">
                        <span className="dashboard-hero-kicker">{isAdminView ? 'SYSTEM EXAM STUDIO' : 'TEACHER COMMAND CENTER'}</span>
                        <span className={`dashboard-hero-pill ${hasTeacherAccess ? 'good' : 'warn'}`}>
                            <i className={`bi bi-${hasTeacherAccess ? 'stars' : 'exclamation-diamond'}`}></i>
                            {teacherStatusLabel}
                        </span>
                    </div>
                    <h1>{isAdminView ? 'Kho đề hệ thống' : `Xin chào ${userProfile?.displayName || 'giáo viên'}`}</h1>
                    <p>
                        {isAdminView
                            ? 'Không gian dành cho super admin để rà soát, biên tập và giữ chuẩn thẩm mỹ cho kho đề hệ thống.'
                            : 'Soạn đề, điều phối lớp học và theo dõi tiến độ trong một command center sáng hơn, gọn hơn và dễ thao tác hơn.'}
                    </p>
                    <div className="dashboard-hero-chips">
                        <span className="dashboard-hero-pill neutral"><i className="bi bi-buildings"></i> {isAdminView ? 'Không gian quản trị kho đề' : (userProfile?.schoolName || 'Chưa cập nhật tên trường')}</span>
                        <span className="dashboard-hero-pill neutral"><i className="bi bi-grid-1x2"></i> Tab: {dashboardTabLabel}</span>
                        {portalUrl && <span className="dashboard-hero-pill neutral"><i className="bi bi-link-45deg"></i> /t/{slug}</span>}
                        {!isAdminView && pendingStudents.length > 0 && <span className="dashboard-hero-pill warn"><i className="bi bi-bell"></i> {pendingStudents.length} học sinh chờ duyệt</span>}
                        {!isAdminView && daysLeft !== null && daysLeft > 0 && <span className={`dashboard-hero-pill ${daysLeft <= 7 ? 'warn' : 'good'}`}><i className="bi bi-calendar3"></i> Còn {daysLeft} ngày</span>}
                    </div>
                    <div className="dashboard-hero-actions">
                        <Link to="/teacher/upload" className={`btn btn-primary ${!hasTeacherAccess ? 'btn-disabled' : ''}`} onClick={e => { if (!hasTeacherAccess) { e.preventDefault(); Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn.', 'warning'); } }}>
                            <i className="bi bi-plus-circle"></i> {isAdminView ? 'Soạn đề hệ thống' : 'Tạo đề mới'}
                        </Link>
                        <Link to="/teacher/studio" className="btn btn-outline">
                            <i className="bi bi-joystick"></i> {isAdminView ? 'Studio hệ thống' : 'Studio dạy học'}
                        </Link>
                        <Link to="/teacher/bank" className="btn btn-outline">
                            <i className="bi bi-database"></i> Ngân hàng câu
                        </Link>
                        {!isAdminView && (
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={openPlanRequestPanel}
                                disabled={submittingPlanRequest}
                            >
                                <i className="bi bi-credit-card"></i> {hasPendingPlanRequest ? 'Theo dõi yêu cầu gói' : (submittingPlanRequest ? 'Đang gửi...' : 'Nâng cấp / gia hạn')}
                            </button>
                        )}
                        {portalUrl && (
                            <button type="button" className="btn btn-outline" onClick={copyPortalLink}>
                                <i className="bi bi-clipboard"></i> Copy link lớp
                            </button>
                        )}
                    </div>
                </div>
                <div className="dashboard-hero-side">
                    <div className="dashboard-hero-metrics">
                        <div>
                            <span>Tổng đề</span>
                            <strong>{stats.total}</strong>
                            <small>kho đề hiện có</small>
                        </div>
                        <div>
                            <span>Đang mở</span>
                            <strong>{stats.active}</strong>
                            <small>sẵn sàng cho học sinh</small>
                        </div>
                        <div>
                            <span>{isAdminView ? 'Đã chia sẻ' : 'Học sinh'}</span>
                            <strong>{isAdminView ? stats.sharedExamCount : stats.studentCount}</strong>
                            <small>{isAdminView ? 'bộ đề hệ thống' : 'đang thuộc lớp'}</small>
                        </div>
                        <div>
                            <span>{isAdminView ? 'Lượt dùng' : 'Lượt thi'}</span>
                            <strong>{stats.totalSessions}</strong>
                            <small>hoạt động gần đây</small>
                        </div>
                    </div>
                </div>
            </section>

            {/* Subscription banner */}
            {isAdminView && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-journal-bookmark"></i> Đây là không gian kho đề của super admin. Không hiển thị học sinh hoặc dữ liệu làm bài của học sinh.
                </div>
            )}
            {!isAdminView && isFreePlan && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-info-circle"></i> Bạn đang ở gói Free: {freeTierLimitSummary}. Tháng này còn <strong>{premiumLiveUsage.remaining}</strong> lượt live game nâng cao. Có thể gửi yêu cầu nâng cấp trực tiếp trong dashboard.
                </div>
            )}
            {!isAdminView && daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 20 }}>
                    <i className="bi bi-exclamation-triangle"></i> Gói hết hạn trong <strong>{daysLeft} ngày</strong>. Nên gửi yêu cầu gia hạn ngay từ bây giờ.
                </div>
            )}
            {!isAdminView && computedTeacherStatus === 'expired' && (
                <div className="alert alert-danger" style={{ marginBottom: 20 }}>
                    <i className="bi bi-x-octagon"></i> Gói đã hết hạn. Không thể mở đề mới. Hãy gửi yêu cầu gia hạn để admin mở lại.
                </div>
            )}
            {!isAdminView && latestPlanRequest?.status === TEACHER_PLAN_REQUEST_STATUS.PENDING && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-hourglass-split"></i> Yêu cầu gần nhất của bạn đang chờ duyệt: <strong>{latestPlanRequest.requestedPlanLabel}</strong> · gửi {formatTimeAgo(latestPlanRequest.requestedAt)}.
                </div>
            )}
            {!isAdminView && latestPlanRequest?.status === TEACHER_PLAN_REQUEST_STATUS.REJECTED && latestPlanRequest.reviewNote && (
                <div className="alert alert-warning" style={{ marginBottom: 20 }}>
                    <i className="bi bi-chat-left-text"></i> Yêu cầu gần nhất đã bị từ chối: {latestPlanRequest.reviewNote}
                </div>
            )}

            {!isAdminView && (
                <div className="card teacher-upgrade-offer-card">
                    <div className="teacher-upgrade-offer-main">
                        <span className="teacher-upgrade-offer-kicker">Teacher Plus</span>
                        <h3>{teacherUpgradeCardTitle}</h3>
                        <p>{teacherUpgradeCardSummary}</p>
                        <div className="teacher-upgrade-offer-badges">
                            <span className={`stat-badge ${teacherStatusBadgeClass}`}>{teacherStatusLabel}</span>
                            <span className={`stat-badge ${catalogAccessSummary.badgeClass}`}>{catalogAccessSummary.badgeLabel}</span>
                            {latestPlanRequestStatus && <span className={`stat-badge ${latestPlanRequestStatus.className}`}>{latestPlanRequestStatus.label}</span>}
                        </div>
                        <div className="teacher-upgrade-offer-meta">
                            <span><strong>Kho hiện tại:</strong> {catalogAccessSummary.packageLabel}</span>
                            <span><strong>Quy trình:</strong> Gửi yêu cầu trong app, admin duyệt thủ công</span>
                            {subEnd && <span><strong>Hết hạn:</strong> {subEnd.toLocaleDateString('vi-VN')}</span>}
                            {!isPaidPlan && computedTeacherStatus !== 'expired' && <span><strong>Ngưỡng Free:</strong> {freeTierLimitSummary}</span>}
                        </div>
                    </div>

                    <div className="teacher-upgrade-offer-side">
                        <div className="teacher-upgrade-offer-price">
                            <span>Gói khuyến nghị</span>
                            <strong>200.000đ</strong>
                            <small>/ năm</small>
                        </div>
                        <div className="teacher-upgrade-offer-flow">
                            <span><i className="bi bi-send-check"></i> Gửi yêu cầu ngay trong hệ thống</span>
                            <span><i className="bi bi-shield-check"></i> Admin duyệt và kích hoạt thủ công</span>
                            <span><i className="bi bi-rocket-takeoff"></i> Thuê bao được mở ngay sau khi duyệt</span>
                        </div>
                        <div className="teacher-upgrade-offer-actions">
                            <button type="button" className="btn btn-primary" onClick={openPlanRequestPanel} disabled={submittingPlanRequest}>
                                <i className="bi bi-credit-card-2-front"></i> {hasPendingPlanRequest ? 'Theo dõi yêu cầu' : ((isPaidPlan || computedTeacherStatus === 'expired') ? 'Gia hạn gói' : 'Nâng cấp gói')}
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => {
                                    setActiveTab('settings');
                                    setSearch('');
                                }}
                            >
                                <i className="bi bi-clock-history"></i> Xem lịch sử
                            </button>
                        </div>
                    </div>

                    <div className="teacher-upgrade-offer-benefits">
                        {['Studio dạy học', 'Live game trên lớp', 'Ngân hàng câu & thư viện', 'Yêu cầu duyệt ngay trong app'].map((item) => (
                            <span key={item} className="teacher-upgrade-offer-benefit">
                                <i className="bi bi-check2-circle"></i> {item}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Pending student approval banner */}
            {!isAdminView && pendingStudents.length > 0 && (
                <div
                    className="dashboard-approval-banner"
                    onClick={() => { setActiveTab('students'); setSearch(''); }}
                    style={{
                        marginBottom: 16, padding: '12px 18px', borderRadius: 12,
                        background: 'linear-gradient(90deg,#fef3c7,#fde68a)',
                        border: '1.5px solid #f59e0b', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 12,
                    }}
                >
                    <i className="bi bi-bell-fill" style={{ color: '#d97706', fontSize: '1.2rem', flexShrink: 0 }}></i>
                    <div style={{ flex: 1 }}>
                        <strong style={{ color: '#92400e' }}>{pendingStudents.length} học sinh đang chờ bạn duyệt vào lớp</strong>
                        <div style={{ fontSize: '0.82rem', color: '#a16207', marginTop: 2 }}>Nhấn đây để duyệt ngay trong tab Học sinh</div>
                    </div>
                    <i className="bi bi-arrow-right-circle-fill" style={{ color: '#d97706', fontSize: '1.3rem', flexShrink: 0 }}></i>
                </div>
            )}

            {/* Portal link bar */}
            {portalUrl && (
                <div className="card dashboard-link-card" style={{ marginBottom: 20, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="bi bi-link-45deg" style={{ fontSize: '1.2rem', color: 'var(--primary)' }}></i>
                        <span style={{ fontSize: '0.9rem' }}>Link cho học sinh:</span>
                        <code style={{ fontSize: '0.85rem', background: 'var(--bg)', padding: '2px 8px', borderRadius: 4 }}>/t/{slug}</code>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={copyPortalLink}>
                        <i className="bi bi-clipboard"></i> Copy
                    </button>
                </div>
            )}

            <div className="stats-grid">
                <StatsCard icon="journal-text" label="Tổng đề" value={stats.total} color="primary" delay={0} />
                <StatsCard icon="broadcast" label="Đang mở" value={stats.active} color="success" delay={1} />
                <StatsCard icon={isAdminView ? 'box-arrow-up-right' : 'people-fill'} label={isAdminView ? 'Đã chia sẻ' : 'Học sinh'} value={isAdminView ? stats.sharedExamCount : stats.studentCount} color="cool" delay={2} />
                <StatsCard icon="bar-chart" label={isAdminView ? 'Lượt dùng' : 'Lượt thi'} value={stats.totalSessions} color="warm" delay={3} />
            </div>

            {/* Tab navigation */}
            <div className="tab-nav" style={{ marginBottom: 16 }}>
                <button className={`tab-btn ${activeTab === 'exams' ? 'active' : ''}`} onClick={() => { setActiveTab('exams'); setSearch(''); }}>
                    <i className="bi bi-journal-text"></i> Đề thi
                </button>
                {!isAdminView && (
                    <button className={`tab-btn ${activeTab === 'students' ? 'active' : ''}`} onClick={() => { setActiveTab('students'); setSearch(''); }}>
                        <i className="bi bi-people"></i> Học sinh ({stats.studentCount})
                        {pendingStudents.length > 0 && (
                            <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: '99px', fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px', verticalAlign: 'middle' }}>{pendingStudents.length}</span>
                        )}
                    </button>
                )}
                {!isAdminView && (
                    <button className={`tab-btn ${activeTab === 'library' ? 'active' : ''}`} onClick={() => { setActiveTab('library'); setSearch(''); }}>
                        <i className="bi bi-box-seam"></i> Thư viện dùng chung
                    </button>
                )}
                <button className={`tab-btn ${activeTab === 'guide' ? 'active' : ''}`} onClick={() => { setActiveTab('guide'); setSearch(''); }}>
                    <i className="bi bi-book"></i> Hướng dẫn
                </button>
                <button className={`tab-btn ${activeTab === 'bank' ? 'active' : ''}`} onClick={() => { setActiveTab('bank'); setSearch(''); }}>
                    <i className="bi bi-database"></i> Ngân hàng câu
                </button>
                {!isAdminView && (
                    <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); setSearch(''); }}>
                        <i className="bi bi-gear"></i> Cài đặt
                    </button>
                )}
            </div>

            {/* ===== EXAMS TAB ===== */}
            {activeTab === 'exams' && (
                <>
                    <div className="section-header">
                        <h2 className="section-title"><i className="bi bi-collection"></i> Kho Đề Thi</h2>
                        <Link to="/teacher/upload" className={`btn btn-primary ${!hasTeacherAccess ? 'btn-disabled' : ''}`} onClick={e => { if (!hasTeacherAccess) { e.preventDefault(); Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn.', 'warning'); } }}>
                            <i className="bi bi-cloud-arrow-up"></i> Tải lên đề mới
                        </Link>
                    </div>

                    <div className="filter-bar">
                        <div className="filter-tabs">
                            {[
                                { key: 'all', label: 'Tất cả', count: exams.length },
                                { key: 'active', label: 'Đang mở', count: stats.active },
                                { key: 'draft', label: 'Nháp', count: stats.draft },
                            ].map(t => (
                                <button key={t.key} className={`filter-tab ${filter === t.key ? 'active' : ''}`} onClick={() => setFilter(t.key)}>
                                    {t.label} <span className="filter-count">{t.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="search-box">
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm đề..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {tabLoading.exams ? (
                        <div className="loading-screen" style={{ minHeight: 220 }}>
                            <div className="spinner"></div>
                            <p>Đang tải đề thi...</p>
                        </div>
                    ) : exams.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-journal-plus"></i>
                            <p>Chưa có đề thi phù hợp.</p>
                            {exams.length === 0 && hasTeacherAccess && (
                                <Link to="/teacher/upload" className="btn btn-primary"><i className="bi bi-plus-lg"></i> Tạo đề đầu tiên</Link>
                            )}
                        </div>
                    ) : (
                        <>
                        <div className="dashboard-grid">
                            <AnimatePresence>
                                {exams.map((exam, idx) => (
                                    <motion.div key={exam.id} className={`exam-card exam-card--${exam.status}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: idx * 0.05 }} layout>
                                        {/* accent stripe */}
                                        <div className="exam-card-topbar" />
                                        {/* body */}
                                        <div style={{ padding: '16px 18px 14px' }}>
                                            {/* title + status */}
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div className="exam-title">{exam.title}</div>
                                                    {(exam.subject || exam.grade) && (
                                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>
                                                            {[exam.subject, exam.grade].filter(Boolean).join(' · ')}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className={`exam-status-chip ${exam.status}`}>
                                                    {exam.status === 'active'
                                                        ? <><i className="bi bi-circle-fill" style={{ fontSize: '0.42rem', verticalAlign: 'middle', marginRight: 4 }}></i>Đang mở</>
                                                        : 'Nháp'}
                                                </span>
                                            </div>
                                            {/* badges */}
                                            {(() => {
                                                const importBadge = getImportQualityBadge(exam.importQuality, exam.sourceFormat || 'manual');
                                                return (
                                                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
                                                        {isAdminView && exam.sharedPublished && <span className="stat-badge success"><i className="bi bi-box-arrow-up-right"></i> Chia sẻ</span>}
                                                        {!isAdminView && exam.sourceSharedExamId && <span className="stat-badge info"><i className="bi bi-box-arrow-in-down-right"></i> Thư viện</span>}
                                                        {exam.sourceFormat && <span className="stat-badge muted">{exam.sourceFormat}</span>}
                                                        <span className={`stat-badge ${importBadge.className}`}><i className={`bi bi-${importBadge.icon}`}></i> {importBadge.label}</span>
                                                    </div>
                                                );
                                            })()}
                                            {/* stats row */}
                                            <div className="exam-stats-row">
                                                <div className="exam-stat">
                                                    <i className="bi bi-question-circle-fill"></i>
                                                    <span>{exam.questionCount || 0}</span>
                                                    <small>câu</small>
                                                </div>
                                                <div className="exam-stat-divider" />
                                                <div className="exam-stat">
                                                    <i className="bi bi-clock-fill"></i>
                                                    <span>{exam.duration || 0}</span>
                                                    <small>phút</small>
                                                </div>
                                                <div className="exam-stat-divider" />
                                                <div className="exam-stat">
                                                    <i className="bi bi-people-fill"></i>
                                                    <span>{exam.sessionCount}</span>
                                                    <small>lượt</small>
                                                </div>
                                            </div>
                                            {/* quality + date */}
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                                <span><i className="bi bi-shield-check" style={{ color: 'var(--success)', marginRight: 3 }}></i>{formatImportQualitySummary(exam.importQuality, exam.sourceFormat || 'manual')}</span>
                                                <span><i className="bi bi-clock-history" style={{ marginRight: 3 }}></i>{formatTimeAgo(exam.createdAt)}</span>
                                            </div>
                                        </div>
                                        {/* footer actions */}
                                        <div className="exam-card-footer">
                                            <button className={`exam-action-btn ${exam.status === 'active' ? 'action-pause' : 'action-play'}`} onClick={() => toggleStatus(exam)}>
                                                <i className={`bi bi-${exam.status === 'active' ? 'pause-circle-fill' : 'play-circle-fill'}`}></i>
                                                {exam.status === 'active' ? 'Đóng' : 'Mở'}
                                            </button>
                                            <Link to={`/teacher/exam/${exam.id}`} className="exam-action-btn action-default">
                                                <i className="bi bi-pencil-square"></i> Chi tiết
                                            </Link>
                                            {!isAdminView && (
                                                <Link to={`/teacher/exam/${exam.id}/sessions`} className="exam-action-btn action-default">
                                                    <i className="bi bi-bar-chart-fill"></i> Kết quả
                                                </Link>
                                            )}
                                            {!isAdminView && (
                                                <Link
                                                    to={hasTeacherAccess ? `/teacher/exam/${exam.id}/live` : '#'}
                                                    className={`exam-action-btn action-live ${!hasTeacherAccess ? 'btn-disabled' : ''}`}
                                                    onClick={(event) => {
                                                        if (hasTeacherAccess) return;
                                                        event.preventDefault();
                                                        Swal.fire('Hết hạn', 'Teacher Plus đã hết hạn. Hãy gia hạn để tạo live room mới.', 'warning');
                                                    }}
                                                >
                                                    <i className="bi bi-broadcast"></i> Live
                                                </Link>
                                            )}
                                            <button className="exam-action-btn action-delete" onClick={() => handleDelete(exam.id, exam.title)}>
                                                <i className="bi bi-trash3-fill"></i>
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                        {hasMoreExams && (
                            <div style={{ marginTop: 16, textAlign: 'center' }}>
                                <button className="btn btn-outline" onClick={() => fetchExamPage(false, examCursor)} disabled={tabLoading.exams}>
                                    {tabLoading.exams ? 'Đang tải...' : 'Xem thêm đề'}
                                </button>
                            </div>
                        )}
                        </>
                    )}
                </>
            )}

            {/* ===== STUDENTS TAB ===== */}
            {!isAdminView && activeTab === 'students' && (
                <div>
                    {/* ── PENDING APPROVAL SECTION ── */}
                    {pendingStudents.length > 0 && (
                        <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #f59e0b', background: '#fffbeb' }}>
                            <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #fde68a' }}>
                                <i className="bi bi-bell-fill" style={{ color: '#d97706' }}></i>
                                <strong style={{ color: '#92400e' }}>Chờ duyệt vào lớp ({pendingStudents.length})</strong>
                                <span style={{ fontSize: '0.8rem', color: '#a16207', marginLeft: 4 }}>— Duyệt để học sinh thấy đề thi và thi được</span>
                            </div>
                            <div style={{ padding: '10px 18px' }}>
                                {pendingStudents.map(s => (
                                    <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #fef3c7' }}>
                                        {s.photoURL
                                            ? <img src={s.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} referrerPolicy="no-referrer" />
                                            : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>{(s.displayName || '?')[0]}</div>
                                        }
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.displayName || 'Học sinh'}</div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.email}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                            <button className="btn btn-sm btn-success" onClick={() => handleApproveStudent(s)}>
                                                <i className="bi bi-check-lg"></i> Duyệt
                                            </button>
                                            <button className="btn btn-sm btn-danger-soft" onClick={() => handleRejectStudent(s)}>
                                                <i className="bi bi-x-lg"></i> Từ chối
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="filter-bar" style={{ marginBottom: 16 }}>
                        <div className="search-box" style={{ flex: 1 }}>
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm học sinh..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {tabLoading.students ? (
                        <div className="loading-screen" style={{ minHeight: 220 }}>
                            <div className="spinner"></div>
                            <p>Đang tải học sinh...</p>
                        </div>
                    ) : students.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-people"></i>
                            <p>Chưa có học sinh phù hợp.</p>
                            {students.length === 0 && portalUrl && (
                                <div style={{ marginTop: 12 }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 8 }}>Chia sẻ link cho học sinh:</p>
                                    <button className="btn btn-primary" onClick={copyPortalLink}><i className="bi bi-clipboard"></i> Copy link lớp</button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="card">
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Học sinh</th>
                                            <th>Email</th>
                                            <th>Bài đã thi</th>
                                            <th>Hạn lớp</th>
                                            <th>Trạng thái</th>
                                            <th style={{ textAlign: 'right' }}>Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {students.map((s, idx) => (
                                            <tr key={s.uid} style={{ opacity: s.blocked ? 0.6 : 1 }}>
                                                <td>{idx + 1}</td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        {s.photoURL && <img src={s.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} referrerPolicy="no-referrer" />}
                                                        <span style={{ fontWeight: 600 }}>{s.displayName || 'Ẩn danh'}</span>
                                                    </div>
                                                </td>
                                                <td><small style={{ color: 'var(--text-muted)' }}>{s.email}</small></td>
                                                <td>{s.quizCount || 0}</td>
                                                <td>
                                                    {(() => {
                                                        const exp = formatExpiry(s.teacherExpiry);
                                                        if (!exp) return <span className="stat-badge muted">Không giới hạn</span>;
                                                        if (exp.expired) return <span className="stat-badge expired"><i className="bi bi-clock-history"></i> Hết hạn</span>;
                                                        if (exp.warn) return <span className="stat-badge warning"><i className="bi bi-exclamation-triangle"></i> {exp.label}</span>;
                                                        return <span className="stat-badge info">{exp.label}</span>;
                                                    })()}
                                                </td>
                                                <td>
                                                    {s.blocked
                                                        ? <span className="stat-badge expired"><i className="bi bi-lock"></i> Khóa</span>
                                                        : <span className="stat-badge active">Hoạt động</span>
                                                    }
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                        <Link className="btn btn-sm btn-outline" to={`/teacher/student/${s.uid}/preview`} title="Xem giao diện học sinh">
                                                            <i className="bi bi-display"></i>
                                                        </Link>
                                                        <Link className="btn btn-sm btn-outline" to={`/teacher/student/${s.uid}`} title="Chi tiết học sinh">
                                                            <i className="bi bi-eye"></i>
                                                        </Link>
                                                        <button className="btn btn-sm btn-outline" onClick={() => handleExtendExpiry(s)} title="Gia hạn">
                                                            <i className="bi bi-calendar-plus"></i>
                                                        </button>
                                                        <button className={`btn btn-sm ${s.blocked ? 'btn-success-soft' : 'btn-warning-soft'}`} onClick={() => handleBlockStudent(s)} title={s.blocked ? 'Mở khóa' : 'Khóa'}>
                                                            <i className={`bi bi-${s.blocked ? 'unlock' : 'lock'}`}></i>
                                                        </button>
                                                        <button className="btn btn-sm btn-danger-soft" onClick={() => handleRemoveStudent(s)} title="Xóa khỏi lớp">
                                                            <i className="bi bi-person-x"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    {hasMoreStudents && (
                        <div style={{ marginTop: 16, textAlign: 'center' }}>
                            <button className="btn btn-outline" onClick={() => fetchStudentPage(false, studentCursor)} disabled={tabLoading.students}>
                                {tabLoading.students ? 'Đang tải...' : 'Xem thêm học sinh'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {!isAdminView && activeTab === 'library' && (
                <div>
                    <div className="section-header">
                        <h2 className="section-title"><i className="bi bi-box-seam"></i> Kho đề tham khảo</h2>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Tách riêng đề mẫu Toán, đề mẫu Tiếng Anh và thư viện chia sẻ để giáo viên thao tác gọn hơn.</span>
                    </div>

                    <div className="filter-bar">
                        <div className="search-box" style={{ flex: 1 }}>
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm trong kho đề mẫu và thư viện..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    <div className="library-mode-tabs">
                        {LIBRARY_VIEWS.map((item) => (
                            <button key={item.id} type="button" className={`library-mode-tab ${libraryView === item.id ? 'active' : ''}`} onClick={() => setLibraryView(item.id)}>
                                <i className={`bi bi-${item.icon}`}></i>
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>

                    {libraryView !== 'shared' ? (
                        <div className="library-panel">
                            <div className="library-section-head">
                                <div>
                                    <div className="library-section-kicker">Kho đề mẫu hệ thống</div>
                                    <h3>{libraryView === 'english' ? 'Bộ đề mẫu Tiếng Anh' : 'Bộ đề mẫu Toán'}</h3>
                                    <p>
                                        {libraryView === 'english'
                                            ? 'Dành cho giáo viên Tiếng Anh cần đề có passage, section, tag nhóm và cấu trúc part rõ ràng.'
                                            : 'Dành cho giáo viên Toán cần một bộ đề sạch, gọn và có thể sửa nhanh theo chương hoặc theo lớp.'}
                                    </p>
                                </div>
                                <span className="stat-badge warm">{filteredSampleLibraryExams.length} đề</span>
                            </div>

                            {filteredSampleLibraryExams.length === 0 ? (
                                <div className="empty-state compact">
                                    <i className="bi bi-journal-x"></i>
                                    <p>Không tìm thấy đề mẫu phù hợp với từ khóa hiện tại.</p>
                                </div>
                            ) : (
                                <div className="dashboard-grid">
                                    {filteredSampleLibraryExams.map((item, idx) => (
                                        <motion.div key={item.id} className="exam-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
                                            <div className="exam-card-header">
                                                <div>
                                                    <div className="exam-title">{item.title}</div>
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                        {item.subject && <span className="stat-badge info">{item.subject}</span>}
                                                        {item.grade && <span className="stat-badge muted">{item.grade}</span>}
                                                        <span className="stat-badge warm">Mẫu hệ thống</span>
                                                    </div>
                                                </div>
                                                <span className={`stat-badge ${item.sampleCategory === 'english' ? 'trial' : 'success'}`}>{item.sampleCategoryLabel}</span>
                                            </div>
                                            <p className="library-card-summary">{item.summary}</p>
                                            <div className="exam-meta">
                                                <span><i className="bi bi-question-circle"></i> {item.questionCount || 0} câu</span>
                                                <span><i className="bi bi-clock"></i> {item.duration || 0} phút</span>
                                                <span><i className="bi bi-shuffle"></i> Trộn trong phần</span>
                                            </div>
                                            <div className="library-card-highlights">
                                                {(item.highlights || []).slice(0, 3).map((highlight) => (
                                                    <span key={highlight} className="stat-badge muted">{highlight}</span>
                                                ))}
                                            </div>
                                            <div className="exam-date"><i className="bi bi-person-badge"></i> Thi Online biên soạn sẵn</div>
                                            <div className="exam-date"><i className="bi bi-calendar3"></i> {formatTimeAgo(item.updatedAt || item.publishedAt)}</div>
                                            <div className="exam-actions">
                                                <button className="btn btn-sm btn-primary" onClick={() => handleImportSampleExam(item)} disabled={importingSampleId === item.id}>
                                                    <i className="bi bi-box-arrow-in-down-right"></i>
                                                    {importingSampleId === item.id ? ' Đang nhập...' : ' Nhập đề mẫu'}
                                                </button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="library-panel">
                            <div className="library-section-head" style={{ marginBottom: 16 }}>
                                <div>
                                    <div className="library-section-kicker">Thư viện dùng chung</div>
                                    <h3>Đề được super admin phát hành</h3>
                                    <p>Đây là các đề đã được xuất bản vào thư viện chung. Giáo viên có thể nhập về kho riêng, chỉnh sửa và phát hành lại theo lớp của mình.</p>
                                </div>
                            </div>

                            {tabLoading.library ? (
                                <div className="loading-screen" style={{ minHeight: 220 }}>
                                    <div className="spinner"></div>
                                    <p>Đang tải thư viện...</p>
                                </div>
                            ) : sharedExams.length === 0 ? (
                                <div className="empty-state">
                                    <i className="bi bi-journal-bookmark"></i>
                                    <p>Chưa có đề nào trong thư viện dùng chung. Bạn vẫn có thể dùng ngay các bộ đề mẫu ở hai tab bên cạnh.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="dashboard-grid">
                                        {sharedExams.map((item, idx) => (
                                            <motion.div key={item.id} className="exam-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
                                                <div className="exam-card-header">
                                                    <div>
                                                        <div className="exam-title">{item.title}</div>
                                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                                            {item.subject && <span className="stat-badge info">{item.subject}</span>}
                                                            {item.grade && <span className="stat-badge muted">{item.grade}</span>}
                                                            {item.sourceFormat && <span className="stat-badge muted">{item.sourceFormat}</span>}
                                                        </div>
                                                    </div>
                                                    <span className="stat-badge success">Thư viện</span>
                                                </div>
                                                <div className="exam-meta">
                                                    <span><i className="bi bi-question-circle"></i> {item.questionCount || 0} câu</span>
                                                    <span><i className="bi bi-clock"></i> {item.duration || 0} phút</span>
                                                    <span><i className="bi bi-arrow-down-circle"></i> {item.importCount || 0} lượt nhập</span>
                                                </div>
                                                <div className="exam-date"><i className="bi bi-person-badge"></i> {item.ownerAdminName || 'Super admin'}</div>
                                                <div className="exam-date"><i className="bi bi-calendar3"></i> {formatTimeAgo(item.updatedAt || item.publishedAt)}</div>
                                                <div className="exam-actions">
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleImportSharedExam(item)} disabled={importingSharedId === item.id}>
                                                        <i className="bi bi-box-arrow-in-down-right"></i>
                                                        {importingSharedId === item.id ? ' Đang nhập...' : ' Nhập vào kho đề'}
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                    {hasMoreShared && (
                                        <div style={{ marginTop: 16, textAlign: 'center' }}>
                                            <button className="btn btn-outline" onClick={() => fetchSharedPage(false, sharedCursor)} disabled={tabLoading.library}>
                                                {tabLoading.library ? 'Đang tải...' : 'Xem thêm đề thư viện'}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ===== GUIDE TAB ===== */}
            {activeTab === 'guide' && (
                <div style={{ maxWidth: 860 }}>
                    <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, #eff6ff 0%, #fff7ed 100%)', border: '1px solid rgba(99,102,241,0.14)' }}>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4f46e5', marginBottom: 6 }}>Trang riêng cho giáo viên</div>
                                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>Mở playbook đầy đủ: từ chưa có gì đến xây ngân hàng bài bản</h3>
                                    <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 640 }}>
                                        Trang riêng này gom lại bản đồ hệ thống, lộ trình xây bank và ví dụ nghiệp vụ thật theo từng bước để giáo viên hoặc super admin dùng làm tài liệu onboarding.
                                    </p>
                                </div>
                                <Link to="/teacher/guide" className="btn btn-primary">
                                    <i className="bi bi-box-arrow-up-right"></i> Mở trang HDSD GV
                                </Link>
                            </div>
                        </div>
                    </div>

                    <h2 style={{ fontSize: '1.35rem', marginBottom: 6 }}><i className="bi bi-journal-bookmark-fill"></i> Hướng dẫn sử dụng đầy đủ</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 24 }}>Đọc một lần là dùng được — không cần xem video.</p>

                    {/* ── MỤC LỤC ── */}
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div style={{ padding: '16px 20px' }}>
                            <p style={{ fontWeight: 700, marginBottom: 10, color: 'var(--primary)' }}><i className="bi bi-list-ul"></i> Mục lục nhanh</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '4px 16px', fontSize: '0.88rem' }}>
                                {[
                                    ['1','Đăng nhập & học sinh tham gia'],
                                    ['2','Tạo đề thi (nhập từ file)'],
                                    ['3','Soạn đề thủ công'],
                                    ['4','Quản lý đề thi'],
                                    ['5','Kích hoạt & chia sẻ link thi'],
                                    ['6','Phát sóng Live (5 chế độ)'],
                                    ['7','Xem kết quả & chứng chỉ'],
                                    ['8','Ngân hàng câu hỏi'],
                                    ['9','Thư viện đề mẫu'],
                                    ['10','Cài đặt tài khoản'],
                                    ['11','Format file DOCX/TXT/XLSX'],
                                ].map(([n, label]) => (
                                    <a key={n} href={`#guide-sec-${n}`} style={{ color: 'var(--primary)', textDecoration: 'none', padding: '3px 0', display: 'flex', gap: 6 }}>
                                        <span style={{ background: 'var(--primary-bg,#eef2ff)', borderRadius: 4, padding: '0 6px', fontWeight: 700, fontSize: '0.78rem', minWidth: 22, textAlign: 'center' }}>{n}</span>
                                        {label}
                                    </a>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #1 — ĐĂNG NHẬP & HỌC SINH THAM GIA
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-1" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-1-circle me-2"></i>Đăng nhập & Học sinh tham gia lớp</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <div style={{ background: 'var(--bg,#f8fafc)', padding: 14, borderRadius: 8, borderLeft: '3px solid var(--primary)' }}>
                                <strong>Giáo viên đăng ký tài khoản:</strong>
                                <ol style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 2, fontSize: '0.9rem' }}>
                                    <li>Truy cập <strong>thi-online-nhc.web.app</strong> → nhấn <strong>"Đăng nhập với Google"</strong></li>
                                    <li>Chọn tài khoản Google cá nhân → nhấn <strong>"Tôi muốn đăng ký Giáo viên"</strong></li>
                                    <li>Nhập tên trường → nhấn <strong>"Gửi yêu cầu duyệt"</strong></li>
                                    <li>Chờ Admin duyệt (thường trong ngày). Khi được duyệt sẽ vào được trang Dashboard.</li>
                                </ol>
                            </div>
                            <div style={{ background: 'var(--bg,#f8fafc)', padding: 14, borderRadius: 8, borderLeft: '3px solid #10b981' }}>
                                <strong>Tạo link lớp để học sinh vào thi:</strong>
                                <ol style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 2, fontSize: '0.9rem' }}>
                                    <li>Vào tab <strong>Cài đặt</strong> → mục <strong>"Link lớp học sinh"</strong> → nhấn <strong>"Chỉnh sửa slug"</strong></li>
                                    <li>Nhập slug (VD: <code>nguyen-van-a</code>) → lưu lại</li>
                                    <li>Link lớp sẽ là: <code>thi-online-nhc.web.app/t/nguyen-van-a</code></li>
                                    <li>Gửi link này cho học sinh. Học sinh bấm link → đăng nhập Google → nhấn <strong>"Tham gia lớp"</strong>.</li>
                                </ol>
                                <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', marginTop: 8 }}>
                                    ⚠️ <strong>Slug chỉ dùng chữ thường, số và dấu gạch ngang</strong> (VD: <code>toan-12a1</code>). Không dùng dấu cách hay ký tự đặc biệt.
                                </div>
                            </div>
                            <div style={{ background: '#fee2e2', padding: '10px 14px', borderRadius: 8, fontSize: '0.88rem' }}>
                                <i className="bi bi-x-circle" style={{ color: '#dc2626' }}></i> <strong> Sai:</strong> Học sinh dùng link <code>thi-online-nhc.web.app</code> thẳng → sẽ thấy trang GV, không thi được.
                                <br/><i className="bi bi-check-circle" style={{ color: '#059669' }}></i> <strong> Đúng:</strong> Học sinh dùng link <code>/t/ten-slug</code> của GV.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #2 — TẠO ĐỀ TỪ FILE
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-2" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#0891b2,#0e7490)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-2-circle me-2"></i>Tạo đề thi từ file (DOCX / TXT / XLSX)</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2.2, fontSize: '0.9rem' }}>
                                <li>Thanh điều hướng → nhấn <strong>"Tạo đề"</strong> (hoặc <strong>"Soạn đề"</strong>)</li>
                                <li>Kéo file hoặc nhấn vùng tải lên → chọn file <code>.docx</code>, <code>.txt</code>, hoặc <code>.xlsx</code></li>
                                <li>Hệ thống tự phân tích → xem trước danh sách câu hỏi nhận được</li>
                                <li>Kiểm tra cột <strong>"Loại"</strong> mỗi câu (Trắc nghiệm / Đúng–Sai / Trả lời ngắn)</li>
                                <li>Nếu có câu nhận sai → nhấn nút <strong>Sửa</strong> để chỉnh lại trước khi lưu</li>
                                <li>Nhấn <strong>"Lưu đề"</strong> — đề được tạo ở trạng thái <code>Nháp</code></li>
                            </ol>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div style={{ background: '#d1fae5', padding: '10px 12px', borderRadius: 8, fontSize: '0.85rem' }}>
                                    ✅ <strong>File DOCX được khuyên dùng</strong><br/>Hỗ trợ hình ảnh nhúng, gạch chân đáp án, LaTeX.
                                </div>
                                <div style={{ background: '#fef3c7', padding: '10px 12px', borderRadius: 8, fontSize: '0.85rem' }}>
                                    ⚠️ <strong>Lưu ý size file</strong><br/>Tối đa 20 MB. File có nhiều ảnh lớn nên nén ảnh trước.
                                </div>
                            </div>
                            <div style={{ background: '#fee2e2', padding: '10px 14px', borderRadius: 8, fontSize: '0.88rem' }}>
                                <i className="bi bi-x-circle" style={{ color: '#dc2626' }}></i> <strong> Sai:</strong> Gửi file <code>.doc</code> (định dạng Word cũ) — hệ thống <u>không nhận</u>.
                                <br/><i className="bi bi-check-circle" style={{ color: '#059669' }}></i> <strong> Đúng:</strong> Mở file trong Word → <em>Lưu dưới dạng</em> → chọn <code>.docx</code> rồi mới tải lên.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #3 — SOẠN ĐỀ THỦ CÔNG
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-3" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#7c3aed,#6d28d9)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-3-circle me-2"></i>Soạn / Chỉnh sửa câu hỏi thủ công</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                Sau khi đề được tạo, vào trang chi tiết đề → nhấn tab <strong>"Câu hỏi"</strong> → chọn từng câu để chỉnh sửa.
                            </p>
                            <div style={{ display: 'grid', gap: 8, fontSize: '0.88rem' }}>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Chỉnh nội dung câu hỏi:</strong> nhấn <i className="bi bi-pencil"></i> kế câu → chỉnh text hoặc bổ sung công thức LaTeX bằng bảng ký hiệu toán bên cạnh.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Đổi đáp án đúng:</strong> với câu Trắc nghiệm — nhấn vào chữ cái đáp án muốn chọn đúng. Với Đúng/Sai — toggle từng ô D/S.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Thêm hình ảnh:</strong> nhấn nút <i className="bi bi-image"></i> → tải ảnh lên hoặc dán URL. Chọn kích thước và căn chỉnh.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Thêm lời giải:</strong> nhấn nút <strong>"+ Lời giải"</strong> bên dưới mỗi câu → nhập giải thích → lưu. Lời giải hiển thị cho HS sau khi nộp bài.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Thêm câu mới:</strong> cuộn xuống cuối danh sách câu hỏi → nhấn <strong>"+ Thêm câu hỏi"</strong> → chọn loại câu.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Kéo sắp xếp lại thứ tự câu:</strong> giữ và kéo biểu tượng <i className="bi bi-grip-vertical"></i> ở đầu mỗi câu.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #8b5cf6' }}>
                                    <strong>Đề nhiều phần / passage:</strong> nếu file có các tag phần như <code>&lt;g_khongtron_lay5&gt;</code> hoặc <code>&lt;g_codinh_lay3&gt;</code> thì hệ thống sẽ hiểu là mỗi phần chỉ lấy <em>k</em> câu, có thể giữ nguyên thứ tự trong phần và cố định vị trí phần.
                                </div>
                            </div>
                            <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
                                💡 <strong>Mẹo:</strong> Nhấn <strong>"Xem trước"</strong> (nút <i className="bi bi-eye"></i>) để thấy đúng giao diện học sinh sẽ thi.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #4 — QUẢN LÝ ĐỀ THI
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-4" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#0f766e,#0d9488)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-4-circle me-2"></i>Quản lý đề thi — Cài đặt</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Từ Kho đề → nhấn vào tên đề → vào trang Chi tiết đề thi. Nhấn tab <strong>"Cài đặt"</strong>.</p>
                            <div style={{ display: 'grid', gap: 8, fontSize: '0.88rem' }}>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong><i className="bi bi-clock"></i> Thời gian làm bài (phút):</strong> từ 10 đến 180. Sau khi hết giờ hệ thống tự nộp bài.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong><i className="bi bi-arrow-repeat"></i> Số lần thi tối đa:</strong> 1 = học sinh chỉ thi được 1 lần. Đặt 99 = không giới hạn (dùng khi ôn tập).
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong><i className="bi bi-shuffle"></i> Xáo trộn câu hỏi / đáp án:</strong> Bật khi muốn mỗi HS nhận đề khác nhau, chống quay cóp.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong><i className="bi bi-check2-square"></i> Hiện kết quả chi tiết:</strong> Bật = HS thấy câu đúng/sai và lời giải ngay sau khi nộp. Tắt = chỉ thấy điểm tổng.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong><i className="bi bi-shield-lock"></i> Chống gian lận:</strong> Bật = HS bị cảnh cáo khi thoát khỏi tab. Sau N cảnh cáo tự nộp bài. Có thể bật thêm <em>"Yêu cầu toàn màn hình"</em>.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong><i className="bi bi-stars"></i> Gamification:</strong> Chọn preset trải nghiệm (Học thuật / Gamified / Trung tính). Điều chỉnh điểm cơ bản, thưởng combo, thưởng tốc độ.
                                </div>
                            </div>
                            <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
                                ⚠️ Nhớ nhấn <strong>"Lưu cài đặt"</strong> sau khi thay đổi. Cài đặt chỉ có tác dụng với lần thi <em>tiếp theo</em>, không ảnh hưởng bài đang làm.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #5 — KÍCH HOẠT & CHIA SẺ LINK THI
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-5" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#b45309,#d97706)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-5-circle me-2"></i>Kích hoạt đề & Chia sẻ link thi cho học sinh</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2.2, fontSize: '0.9rem' }}>
                                <li>Vào trang chi tiết đề → nhấn nút <strong style={{color:'#059669'}}>"Kích hoạt"</strong> (màu xanh). Đề từ <code>Nháp</code> chuyển sang <code>Đang mở</code>.</li>
                                <li>Học sinh đã tham gia lớp sẽ thấy đề trong trang lớp của mình (<code>/t/slug</code>).</li>
                                <li>Nhấn <strong>"Sao chép link lớp"</strong> (ở trang Dashboard hoặc Cài đặt) → gửi cho HS qua Zalo/Messenger.</li>
                            </ol>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.87rem' }}>
                                <div style={{ background: '#d1fae5', padding: '10px 12px', borderRadius: 8 }}>
                                    ✅ <strong>Đề Đang mở</strong>: HS vào link lớp thấy đề và bấm "Bắt đầu thi" được.
                                </div>
                                <div style={{ background: '#fef3c7', padding: '10px 12px', borderRadius: 8 }}>
                                    ⚠️ <strong>Đề Nháp</strong>: HS vào link lớp <u>không thấy</u> đề này. GV mới xem được.
                                </div>
                            </div>
                            <div style={{ background: '#fee2e2', padding: '10px 14px', borderRadius: 8, fontSize: '0.88rem' }}>
                                <i className="bi bi-x-circle" style={{ color: '#dc2626' }}></i> <strong> Sai khi dùng:</strong> Để đề ở Nháp rồi hỏi "sao HS không thi được?" — Phải kích hoạt trước.
                                <br/><i className="bi bi-info-circle" style={{ color: '#2563eb' }}></i> Muốn <strong>đóng đề</strong> (không cho thi thêm) → nhấn <strong>"Đóng"</strong> trên cùng trang. Đề trở về Nháp, kết quả cũ vẫn giữ nguyên.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #6 — LIVE CLASSROOM
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-6" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#be123c,#e11d48)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-6-circle me-2"></i>Phát sóng Live — 5 chế độ</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
                            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2.2, fontSize: '0.9rem' }}>
                                <li>Từ trang Chi tiết đề → nhấn nút <strong style={{color:'#e11d48'}}><i className="bi bi-broadcast"></i> Phát sóng Live</strong></li>
                                <li>Chọn chế độ phù hợp (xem bên dưới) → nhấn <strong>"Bắt đầu phòng"</strong></li>
                                <li>Màn hình GV hiện <strong>mã phòng 6 chữ số</strong> — đọc cho HS nhập vào trang thi học sinh</li>
                                <li>Chờ HS vào phòng (hiện trong danh sách) → nhấn <strong>"Bắt đầu"</strong> khi đủ</li>
                                <li>Mỗi câu: GV nhấn <strong>"Lộ đáp án"</strong> → rồi <strong>"Câu tiếp"</strong> đến hết</li>
                            </ol>

                            {[
                                { name: 'Classic Live', icon: 'play-circle', color: '#6366f1', bg: '#eef2ff',
                                  desc: 'Tất cả HS thi cùng lúc. Chấm điểm sau khi GV lộ đáp án. Có bảng xếp hạng realtime. Phù hợp tổng kết, ôn tập cả lớp.' },
                                { name: 'Đua tốc độ', icon: 'lightning', color: '#d97706', bg: '#fef3c7',
                                  desc: 'Giống Classic nhưng trả lời nhanh hơn = nhiều điểm hơn. Giới hạn 10 giây/câu. Tạo không khí thi đua sôi nổi.' },
                                { name: 'Rung chuông vàng', icon: 'bell', color: '#059669', bg: '#d1fae5',
                                  desc: 'Sai là bị LOẠI ngay. Người cuối cùng còn lại thắng. Phù hợp cuối học kỳ, hội thi. Tối thiểu 4 học sinh.' },
                                { name: 'Ai là triệu phú', icon: 'trophy', color: '#9333ea', bg: '#f3e8ff',
                                  desc: 'Không giới hạn thời gian. HS có thể dùng trợ giúp 50/50 (loại 2 đáp án sai). Không áp lực, phù hợp ôn thi quan trọng.' },
                                { name: 'Trình chiếu', icon: 'easel2', color: '#0891b2', bg: '#cffafe',
                                  desc: 'GV chiếu câu hỏi từng cái, bấm lộ đáp án khi muốn. Không chấm điểm. Dùng để giảng bài, chữa đề, ôn luyện.' },
                            ].map(m => (
                                <div key={m.name} style={{ background: m.bg, border: `1.5px solid ${m.color}30`, padding: '12px 16px', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                    <i className={`bi bi-${m.icon}`} style={{ color: m.color, fontSize: '1.4rem', marginTop: 2, flexShrink: 0 }}></i>
                                    <div>
                                        <strong style={{ color: m.color }}>{m.name}</strong>
                                        <p style={{ margin: '4px 0 0', fontSize: '0.87rem', color: 'var(--text-secondary,#64748b)', lineHeight: 1.6 }}>{m.desc}</p>
                                    </div>
                                </div>
                            ))}

                            <div style={{ background: '#fee2e2', padding: '10px 14px', borderRadius: 8, fontSize: '0.88rem' }}>
                                <i className="bi bi-x-circle" style={{ color: '#dc2626' }}></i> <strong> Lỗi thường gặp:</strong> HS nhập mã phòng sai → kiểm tra lại chữ hoa/thường (mã toàn IN HOA).
                                <br/>⏱ GV <strong>phải ở trên trang Live</strong> suốt buổi — nếu GV thoát, phòng sẽ kết thúc, HS không thi tiếp được.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #7 — XEM KẾT QUẢ & CHỨNG CHỈ
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-7" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#1d4ed8,#2563eb)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-7-circle me-2"></i>Xem kết quả thi & In chứng chỉ</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <div style={{ fontSize: '0.9rem', display: 'grid', gap: 8 }}>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #2563eb' }}>
                                    <strong>Xem kết quả từng bài:</strong> Trang Chi tiết đề → <strong>"Xem kết quả thi"</strong> → danh sách tất cả bài nộp, điểm, thời gian.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #2563eb' }}>
                                    <strong>Xem từng câu HS làm:</strong> Click vào tên HS trong danh sách → xem chi tiết từng câu đúng/sai, thời gian mỗi câu.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #2563eb' }}>
                                    <strong>Xuất Excel:</strong> Nút <i className="bi bi-file-earmark-excel"></i> → tải file .xlsx với toàn bộ kết quả lớp.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #2563eb' }}>
                                    <strong>In chứng chỉ:</strong> Click vào tên HS → nhấn nút <strong>"In chứng chỉ"</strong> → in hoặc lưu PDF trực tiếp từ trình duyệt.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #2563eb' }}>
                                    <strong>Xem học sinh (tab HS):</strong> Trong Dashboard → tab <strong>"Học sinh"</strong> → thấy điểm trung bình, số bài đã làm của từng HS trong lớp.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #8 — NGÂN HÀNG CÂU HỎI
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-8" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#5b21b6,#7c3aed)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-8-circle me-2"></i>Ngân hàng câu hỏi</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                Ngân hàng gom <strong>toàn bộ câu hỏi</strong> từ mọi đề của bạn vào một chỗ — hỗ trợ lọc, gom nhóm và tái sử dụng để tạo đề mới nhanh.
                            </p>
                            <div style={{ display: 'grid', gap: 8, fontSize: '0.88rem' }}>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                                    <strong>Lọc câu hỏi:</strong> chọn loại câu (Trắc nghiệm / Đúng–Sai / Điền / Tự luận), độ khó, môn, chương. Các bộ lọc kết hợp được với nhau.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                                    <strong>Gom nhóm theo chương:</strong> nhấn nút <i className="bi bi-collection"></i> (góc trên phải) → chuyển sang chế độ nhóm — câu được gộp theo Môn + Chương.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                                    <strong>Gán chương / độ khó:</strong> nhấn icon <i className="bi bi-pencil-square"></i> trên thẻ câu → nhập tên chương (VD: <em>Chương 2 – Hàm số</em>) → chọn độ khó → Lưu.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                                    <strong>Chọn câu thủ công → tạo đề:</strong> tick chọn từng câu → nhấn <strong>"Tạo đề từ N câu"</strong> → nhập tiêu đề → xong.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                                    <strong>Tạo đề tự động:</strong> nhấn <strong>"Tạo đề tự động"</strong> → chọn chế độ:
                                    <ul style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.9 }}>
                                        <li><em>Giữ bộ câu cố định</em>: hệ thống chốt sẵn 1 bộ câu từ ma trận, học sinh chỉ bị xáo thứ tự câu và đáp án như hiện tại.</li>
                                        <li><em>Mỗi học sinh một bộ</em>: mỗi học sinh được bốc 1 bộ riêng từ ngân hàng, nhưng bài đang làm dở vẫn giữ nguyên snapshot.</li>
                                        <li><em>Mỗi lượt thi bốc lại</em>: cùng một học sinh nếu thi lần 2, lần 3 sẽ được bốc bộ câu mới theo đúng ma trận.</li>
                                    </ul>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid #7c3aed' }}>
                                    <strong>Cách khai báo ma trận:</strong>
                                    <ol style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.9 }}>
                                        <li>Chọn môn, khối và nguồn ngân hàng mặc định.</li>
                                        <li>Thêm từng dòng ma trận: nhập <em>số câu</em> + <em>loại câu</em> + <em>độ khó</em> + <em>chương</em> + <em>nguồn riêng</em> nếu cần.</li>
                                        <li>Nhìn cột <em>Khả dụng</em>: nếu thiếu câu, hệ thống báo ngay trước khi tạo đề.</li>
                                        <li>Tạo đề xong thì vào Chi tiết đề để chỉnh thời gian, số lượt thi, chống gian lận rồi mới kích hoạt.</li>
                                    </ol>
                                </div>
                            </div>
                            <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
                                💡 Gán chương đúng từ đầu giúp vừa lọc nhanh câu hỏi, vừa dùng được ma trận đề ngẫu nhiên theo chương mà không phải chọn thủ công từng câu.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #9 — THƯ VIỆN ĐỀ MẪU
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-9" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#047857,#059669)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}><i className="bi bi-9-circle me-2"></i>Thư viện đề mẫu</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Tab <strong>"Thư viện"</strong> trong Dashboard có 3 nguồn đề:</p>
                            <div style={{ display: 'grid', gap: 8, fontSize: '0.88rem' }}>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong>Đề mẫu Toán / Tiếng Anh:</strong> Do hệ thống cung cấp sẵn. Nhấn <strong>"Dùng đề này"</strong> → đề được sao chép vào kho của bạn, có thể chỉnh sửa tự do.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong>Thư viện dùng chung:</strong> Đề do GV khác chia sẻ. Nhấn <strong>"Nhập vào kho"</strong> → có bản copy riêng, không ảnh hưởng bản gốc.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                    <strong>Đóng góp đề của mình:</strong> Trong trang Chi tiết đề → nhấn <strong>"Đưa vào thư viện"</strong>. GV khác thấy và có thể dùng đề của bạn.
                                </div>
                            </div>
                            <div style={{ background: '#d1fae5', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
                                ✅ Nhập đề từ thư viện <strong>không xóa bản gốc</strong> — bạn nhận một bản sao độc lập, thoải mái chỉnh sửa.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #10 — CÀI ĐẶT TÀI KHOẢN
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-10" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#374151,#4b5563)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>🔟 Cài đặt tài khoản</h3>
                        </div>
                        <div style={{ padding: 20, display: 'grid', gap: 8, fontSize: '0.88rem' }}>
                            <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                <strong>Tên trường:</strong> Nhấn <strong>"Chỉnh sửa"</strong> → nhập tên trường → lưu. Tên trường hiển thị trên chứng chỉ và trang lớp học sinh.
                            </div>
                            <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                <strong>Link lớp (slug):</strong> Slug là phần cuối URL lớp. VD slug <code>toan-12a</code> → link <code>.../t/toan-12a</code>. Đổi slug được bất kỳ lúc nào, link cũ sẽ hết hiệu lực.
                            </div>
                            <div style={{ background: 'var(--bg)', padding: '10px 14px', borderRadius: 8 }}>
                                <strong>Quản lý học sinh (tab HS):</strong> Nhấn <i className="bi bi-lock"></i> để khóa HS (không cho thi). Nhấn <i className="bi bi-trash"></i> để xóa khỏi lớp (HS vẫn có thể tham gia lại bằng link).
                            </div>
                            <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 8 }}>
                                ⚠️ Hệ thống dùng tài khoản Google — <strong>không có mật khẩu riêng</strong>. Nếu mất tài khoản Google thì mất luôn tài khoản GV.
                            </div>
                        </div>
                    </div>

                    {/* ══════════════════════════════════════════
                        #11 — FORMAT FILE
                    ══════════════════════════════════════════ */}
                    <div id="guide-sec-11" className="card" style={{ marginBottom: 20 }}>
                        <div style={{ background: 'linear-gradient(90deg,#1e40af,#2563eb)', padding: '10px 20px', borderRadius: '12px 12px 0 0' }}>
                            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>📄 Format file DOCX / TXT / XLSX</h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <div style={{ background: 'var(--info-bg,#eff6ff)', padding: 12, borderRadius: 8, fontSize: '0.9rem', marginBottom: 16 }}>
                                <strong>Quy tắc chung:</strong>
                                <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 2 }}>
                                    <li>Mỗi câu bắt đầu bằng <code>Câu X:</code> (X = 1, 2, 3...)</li>
                                    <li>Đáp án đúng: gạch chân trong Word (<kbd>Ctrl+U</kbd>) hoặc ghi dòng <code>Đáp án: X</code></li>
                                    <li>Lời giải (tùy chọn): dòng <code>Lời giải: ...</code> sau đáp án</li>
                                    <li>LaTeX: inline <code>$x^2$</code>, block <code>$$\frac&#123;a&#125;&#123;b&#125;$$</code></li>
                                </ul>
                            </div>

                            <div style={{ display: 'grid', gap: 14 }}>
                                {/* MCQ */}
                                <div>
                                    <p style={{ fontWeight: 700, color: '#1e40af', marginBottom: 6 }}>① Trắc nghiệm A. B. C. D.</p>
                                    <div style={{ background: '#1e293b', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: '0.82rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{`Câu 1: Thủ đô Việt Nam là?
A. TP. HCM
B. Hà Nội
C. Đà Nẵng
D. Huế
Đáp án: B`}</div>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 6 }}>Dùng <strong>A. B. C. D.</strong> (chữ HOA + dấu chấm). Tối thiểu 2 phương án.</p>
                                </div>
                                {/* T/F */}
                                <div>
                                    <p style={{ fontWeight: 700, color: '#059669', marginBottom: 6 }}>② Đúng / Sai a) b) c) d)</p>
                                    <div style={{ background: '#1e293b', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: '0.82rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{`Câu 2: Xét tính đúng/sai:
a) Số nguyên tố là số chia hết cho 1 và chính nó
b) Số 1 là số nguyên tố
c) Số 2 là số nguyên tố chẵn duy nhất
d) Mọi số lẻ đều là số nguyên tố
Đáp án: DSDS`}</div>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 6 }}>Dùng <strong>a) b) c) d)</strong> (thường + ngoặc). Đáp án: chuỗi D/S, VD: <code>DDSD</code>.</p>
                                </div>
                                {/* Short answer */}
                                <div>
                                    <p style={{ fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>③ Trả lời ngắn / Điền số</p>
                                    <div style={{ background: '#1e293b', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: '0.82rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{`Câu 3: 12 × 8 = ?
Đáp án: 96`}</div>
                                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 6 }}>Không có A/B/C/D hay a/b/c/d. Hệ thống nhận diện tự động.</p>
                                </div>
                            </div>

                            <div style={{ marginTop: 16, background: '#fee2e2', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
                                <strong>Những lỗi phổ biến cần tránh:</strong>
                                <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 2 }}>
                                    <li>Dùng <code>a.</code> hoặc <code>A)</code> — phải đúng định dạng: MCQ dùng <code>A.</code>, Đ/S dùng <code>a)</code></li>
                                    <li>Câu Đúng/Sai chỉ có 3 mệnh đề — phải đủ <strong>4 mệnh đề</strong> a) b) c) d)</li>
                                    <li>Đánh số câu không liên tục (Câu 1, Câu 3, Câu 5...) — phải liên tục từ 1</li>
                                    <li>File <code>.doc</code> cũ — phải lưu lại thành <code>.docx</code></li>
                                </ul>
                            </div>
                        </div>
                    </div>

                </div>
            )}

            {/* OLD GUIDE CONTENT REMOVED */}
            {showLegacyGuide && (
                <div>
                        {/* Overview */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 12, color: 'var(--primary)' }}><i className="bi bi-info-circle"></i> Tổng quan</h3>
                            <p style={{ lineHeight: 1.7, marginBottom: 12 }}>
                                Hệ thống hỗ trợ <strong>3 loại câu hỏi</strong> và nhiều nguồn nhập — Word <strong>.docx</strong>, văn bản <strong>.txt</strong>, bảng <strong>.xlsx/.xls</strong> và LaTeX <strong>.tex</strong>. Với DOCX, ảnh nhúng sẽ được lấy tự động; các định dạng còn lại có thể chèn ảnh sau khi import.
                            </p>
                            <div style={{ background: 'var(--info-bg)', padding: 12, borderRadius: 8, fontSize: '0.9rem' }}>
                                <strong>Quy tắc chung:</strong>
                                <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 2 }}>
                                    <li>Mỗi câu bắt đầu bằng <code>Câu X:</code> (X = 1, 2, 3...)</li>
                                    <li><strong>Đáp án đúng</strong> đánh dấu bằng 1 trong 2 cách:
                                        <br/>• <u>Gạch chân</u> đáp án đúng trong Word (chuẩn tron-de)
                                        <br/>• Ghi dòng <code>Đáp án: X</code> sau câu hỏi
                                    </li>
                                    <li><strong>Lời giải</strong> (tùy chọn): thêm dòng <code>Lời giải: ...</code> sau đáp án</li>
                                    <li>Hỗ trợ hình ảnh chèn trực tiếp, công thức LaTeX <code>$...$</code></li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Type 1: Multiple choice A.B.C.D. */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient">
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-1-circle me-2"></i>Phần I — Trắc nghiệm nhiều lựa chọn (A. B. C. D.)
                            </h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>Phương án bắt đầu bằng <strong>A.</strong> <strong>B.</strong> <strong>C.</strong> <strong>D.</strong> (chữ HOA + dấu chấm). Đánh dấu đáp án đúng bằng <u>gạch chân</u> hoặc dòng "Đáp án:".</p>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`Câu 1: Phương trình nào có nghiệm x = 2?
A. $x^2 - 4 = 0$
B. $x^2 + 4 = 0$
C. $x^2 - 2x + 2 = 0$
D. $2x^2 + 1 = 0$
Đáp án: A
Lời giải: $x^2 - 4 = (x-2)(x+2) = 0$ nên x = 2 hoặc x = -2.

Câu 2: Thủ đô của Việt Nam là:
A. TP. Hồ Chí Minh
B. Đà Nẵng
C. Hà Nội
D. Huế
Đáp án: C`}
                            </div>
                            <div style={{ marginTop: 12, background: 'var(--success-bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem' }}>
                                <i className="bi bi-lightbulb" style={{ color: 'var(--success)' }}></i> <strong>Cách khác:</strong> Trong Word, <u>gạch chân</u> dòng đáp án đúng thay vì ghi "Đáp án: X". Cả hai cách đều được hỗ trợ.
                            </div>
                        </div>
                    </div>

                    {/* Type 2: True/False a)b)c)d) */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient" style={{ background: 'var(--gradient-success)' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-2-circle me-2"></i>Phần II — Đúng / Sai (a) b) c) d))
                            </h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
                                Mệnh đề bắt đầu bằng <strong>a)</strong> <strong>b)</strong> <strong>c)</strong> <strong>d)</strong> (chữ thường + ngoặc đóng).
                                Mỗi mệnh đề có thể Đúng (D) hoặc Sai (S).
                            </p>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`Câu 3: Cho hàm số $y = x^2 + 2x - 3$. Xét tính đúng/sai:
a) Hàm số đồng biến trên $(0; +\\infty)$
b) Hàm số có giá trị nhỏ nhất là $-4$
c) Đồ thị cắt trục Ox tại 2 điểm
d) Hàm số nghịch biến trên $(-\\infty; -1)$
Đáp án: DDDS
Lời giải: a) Đúng vì $y' = 2x+2 > 0$ khi $x > 0$.
b) Đúng: $y_{min} = -4$ tại $x = -1$.
c) Đúng: $\\Delta = 16 > 0$.
d) Sai: nghịch biến trên $(-\\infty; -1)$ đúng, nhưng...`}
                            </div>
                            <div style={{ marginTop: 12, background: 'var(--warning-bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem' }}>
                                <i className="bi bi-exclamation-triangle" style={{ color: 'var(--warning)' }}></i> <strong>Chú ý:</strong>
                                <br/>• Dùng <strong>a) b) c) d)</strong> (chữ thường + ngoặc) — KHÁC với A. B. C. D. của trắc nghiệm
                                <br/>• <code>Đáp án: DDDS</code> = a) Đúng, b) Đúng, c) Đúng, d) Sai
                                <br/>• Hoặc <u>gạch chân</u> mệnh đề Đúng trong Word
                            </div>
                        </div>
                    </div>

                    {/* Type 3: Short answer */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient" style={{ background: 'var(--gradient-cool)' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-3-circle me-2"></i>Phần III — Trả lời ngắn
                            </h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
                                Không có phương án A/B/C/D hay a/b/c/d. Chỉ cần câu hỏi + dòng <code>Đáp án:</code> chứa giá trị đúng.
                            </p>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`Câu 5: Tính giá trị biểu thức $2x + 3$ khi $x = 5$.
Đáp án: 13
Lời giải: $2(5) + 3 = 10 + 3 = 13$

Câu 6: Cho tam giác vuông có hai cạnh góc vuông
3cm và 4cm. Cạnh huyền bằng bao nhiêu cm?
Đáp án: 5
Lời giải: Áp dụng Pytago: $\\sqrt{3^2 + 4^2} = \\sqrt{25} = 5$`}
                            </div>
                        </div>
                    </div>

                    {/* Lời giải section */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 12, color: 'var(--success)' }}><i className="bi bi-lightbulb"></i> Lời giải (tùy chọn)</h3>
                            <p style={{ lineHeight: 1.7, marginBottom: 12 }}>
                                Sau mỗi câu, thêm dòng <code>Lời giải:</code> để giải thích. Lời giải hiển thị cho học sinh sau khi nộp bài.
                            </p>
                            <div style={{ display: 'grid', gap: 8 }}>
                                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem', borderLeft: '3px solid var(--success)' }}>
                                    Từ khóa nhận dạng: <code>Lời giải:</code> hoặc <code>Giải:</code> hoặc <code>Giải thích:</code>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem', borderLeft: '3px solid var(--info)' }}>
                                    Lời giải có thể nhiều dòng — tất cả nội dung sau "Lời giải:" đến câu tiếp theo sẽ được gom lại.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem', borderLeft: '3px solid var(--accent)' }}>
                                    Hỗ trợ công thức LaTeX và hình ảnh trong lời giải.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tips & advanced */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 16, color: 'var(--accent)' }}><i className="bi bi-stars"></i> Mẹo nâng cao</h3>
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--primary)' }}>
                                    <strong>Cách phân biệt loại câu</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        • <strong>A. B. C. D.</strong> (HOA + chấm) → Trắc nghiệm<br/>
                                        • <strong>a) b) c) d)</strong> (thường + ngoặc) → Đúng/Sai<br/>
                                        • Không có phương án, chỉ <code>Đáp án:</code> → Trả lời ngắn
                                    </p>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--success)' }}>
                                    <strong>Đánh dấu đáp án bằng gạch chân</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        Trong Word, bôi đen đáp án đúng → nhấn <kbd>Ctrl+U</kbd> để gạch chân.
                                        Hệ thống tự nhận biết — không cần ghi "Đáp án: X".
                                        Với Đúng/Sai: gạch chân mệnh đề Đúng, không gạch = Sai.
                                    </p>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
                                    <strong>Công thức & hình ảnh</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        Inline: <code>$x^2 + y^2$</code> — Block: <code>$$\frac&#123;a&#125;&#123;b&#125;$$</code><br/>
                                        Hình ảnh: chèn trực tiếp trong Word, tự động trích xuất.
                                    </p>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--danger)' }}>
                                    <strong>Lưu ý quan trọng</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        • File chỉ nhận .docx (không phải .doc cũ) — tối đa 20MB<br/>
                                        • Đánh số câu liên tục: Câu 1, Câu 2, Câu 3...<br/>
                                        • Trắc nghiệm phải có ít nhất 2 phương án<br/>
                                        • Đúng/Sai phải có đúng 4 mệnh đề a) b) c) d)
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Complete template */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 12 }}><i className="bi bi-file-earmark-text"></i> Mẫu đề hoàn chỉnh (3 phần)</h3>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: 500, overflow: 'auto' }}>
{`Câu 1: Số nào sau đây là số nguyên tố?
A. 4
B. 9
C. 7
D. 15
Đáp án: C
Lời giải: 7 chỉ chia hết cho 1 và chính nó.

Câu 2: $\\sin(90°)$ bằng:
A. 0
B. 1
C. -1
D. $\\frac{1}{2}$
Đáp án: B

Câu 3: Nước là hợp chất gồm:
A. Hydro và Oxy
B. Hydro và Nitơ
C. Oxy và Carbon
D. Nitơ và Oxy
Đáp án: A

Câu 4: Xét tính đúng/sai các mệnh đề sau:
a) $\\sqrt{4} = 2$
b) $\\sqrt{9} = \\pm 3$
c) $\\sqrt{0} = 0$
d) $\\sqrt{-1}$ không xác định trong $\\mathbb{R}$
Đáp án: DSDD
Lời giải: b) Sai vì $\\sqrt{9} = 3$ (chỉ lấy giá trị dương).

Câu 5: Nhiệt độ sôi của nước ở áp suất tiêu chuẩn
là bao nhiêu °C?
Đáp án: 100
Lời giải: Ở 1 atm, nước sôi ở 100°C.`}
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 12 }}>
                                Copy mẫu trên vào Word (.docx), chỉnh sửa theo đề của bạn, lưu và tải lên.
                            </p>
                        </div>
                    </div>
                </div>
            )}
            {/* END OLD GUIDE CONTENT */}

            {/* ===== SETTINGS TAB ===== */}
            {!isAdminView && activeTab === 'settings' && (
                <div style={{ maxWidth: 980, display: 'grid', gap: 16 }}>
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}><i className="bi bi-person-circle"></i> Thông tin</h3>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Tên hiển thị</div>
                                    <div className="settings-value">{userProfile?.displayName}</div>
                                </div>
                            </div>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Email</div>
                                    <div className="settings-value">{userProfile?.email}</div>
                                </div>
                            </div>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Tên trường / Tổ chức</div>
                                    <div className="settings-value">{userProfile?.schoolName || <em style={{ color: 'var(--text-muted)' }}>Chưa đặt</em>}</div>
                                </div>
                                <button className="btn btn-sm btn-outline" onClick={handleUpdateSchool}>
                                    <i className="bi bi-pencil"></i> Sửa
                                </button>
                            </div>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Link lớp học</div>
                                    <div className="settings-value">{portalUrl || <em style={{ color: 'var(--text-muted)' }}>Chưa có</em>}</div>
                                </div>
                                <button className="btn btn-sm btn-outline" onClick={handleUpdateSlug}>
                                    <i className="bi bi-pencil"></i> Sửa
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}><i className="bi bi-credit-card"></i> Gói đăng ký</h3>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Trạng thái</div>
                                    <div className="settings-value">
                                        <span className={`stat-badge ${teacherStatusBadgeClass}`}>{teacherStatusLabel}</span>
                                    </div>
                                </div>
                            </div>

                            {userProfile?.subscriptionMonths && (
                                <div className="settings-row">
                                    <div>
                                        <div className="settings-label">Gói</div>
                                        <div className="settings-value">{userProfile.subscriptionMonths} tháng</div>
                                    </div>
                                </div>
                            )}

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Gói truy cập kho</div>
                                    <div className="settings-value">
                                        <span className={`stat-badge ${catalogAccessSummary.badgeClass}`}>{catalogAccessSummary.badgeLabel}</span>
                                        <span className="teacher-package-note">{catalogAccessSummary.packageLabel}</span>
                                    </div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>
                                        {catalogAccessSummary.subjectsText} · {catalogAccessSummary.gradesText}
                                    </div>
                                </div>
                            </div>

                            {subEnd && (
                                <div className="settings-row">
                                    <div>
                                        <div className="settings-label">Hết hạn</div>
                                        <div className="settings-value">
                                            {subEnd.toLocaleDateString('vi-VN')}
                                            {daysLeft > 0 && <small style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({daysLeft} ngày)</small>}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Yêu cầu gần nhất</div>
                                    <div className="settings-value">
                                        {planRequestLoading ? (
                                            <span>Đang tải...</span>
                                        ) : latestPlanRequest ? (
                                            <>
                                                <span className={`stat-badge ${latestPlanRequestStatus.className}`}>{latestPlanRequestStatus.label}</span>
                                                <span className="teacher-package-note">{latestPlanRequest.requestedPlanLabel}</span>
                                            </>
                                        ) : (
                                            <span>Chưa có yêu cầu nào</span>
                                        )}
                                    </div>
                                    {latestPlanRequest && (
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>
                                            Gửi {formatTimeAgo(latestPlanRequest.requestedAt)}
                                            {latestPlanRequest.approvedUntil?.toDate && latestPlanRequest.status === TEACHER_PLAN_REQUEST_STATUS.APPROVED
                                                ? ` · được duyệt tới ${latestPlanRequest.approvedUntil.toDate().toLocaleDateString('vi-VN')}`
                                                : ''}
                                        </div>
                                    )}
                                </div>
                                <button className={`btn btn-sm ${hasPendingPlanRequest ? 'btn-outline' : 'btn-primary'}`} onClick={handleRequestPlanChange} disabled={submittingPlanRequest || hasPendingPlanRequest}>
                                    <i className="bi bi-send"></i> {hasPendingPlanRequest ? 'Đang chờ admin' : (submittingPlanRequest ? 'Đang gửi...' : 'Gửi yêu cầu')}
                                </button>
                            </div>

                            {!planRequestLoading && planRequests.length > 0 && (
                                <div className="teacher-plan-request-list">
                                    {planRequests.slice(0, 3).map((requestItem) => {
                                        const statusMeta = getTeacherPlanRequestStatusMeta(requestItem.status);
                                        const typeMeta = getTeacherPlanRequestTypeMeta(requestItem.requestType);
                                        return (
                                            <div key={requestItem.id} className="teacher-plan-request-card">
                                                <div className="teacher-plan-request-head">
                                                    <div className="teacher-plan-request-title">{requestItem.requestedPlanLabel}</div>
                                                    <div className="teacher-plan-request-badges">
                                                        <span className={`stat-badge ${typeMeta.className}`}>{typeMeta.label}</span>
                                                        <span className={`stat-badge ${statusMeta.className}`}>{statusMeta.label}</span>
                                                    </div>
                                                </div>
                                                <div className="teacher-plan-request-meta">
                                                    {formatTeacherPlanDuration(requestItem.requestedMonths)} · {requestItem.requestedCatalogPackage || 'Giữ gói hiện tại'} · {formatTimeAgo(requestItem.requestedAt)}
                                                </div>
                                                {requestItem.note && <div className="teacher-plan-request-note">{requestItem.note}</div>}
                                                {requestItem.reviewNote && requestItem.status !== TEACHER_PLAN_REQUEST_STATUS.PENDING && (
                                                    <div className="teacher-plan-request-review">Phản hồi admin: {requestItem.reviewNote}</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 12 }}>
                                Không cần nhắn tay ngoài hệ thống nữa: bạn có thể gửi yêu cầu nâng cấp hoặc gia hạn ngay tại đây, rồi admin duyệt trực tiếp trong dashboard.
                            </p>
                        </div>
                    </div>

                    <AISettingsPanel
                        userId={user?.uid}
                        heading="AI BYOK cho giáo viên"
                        description="Tự mang API key Gemini, Groq hoặc DeepSeek để dùng các tính năng AI chi phí thấp trong trình duyệt hiện tại. Key không được đẩy lên máy chủ."
                    />
                </div>
            )}

            {/* ===== QUESTION BANK TAB ===== */}
            {activeTab === 'bank' && (
                <div>
                    <div className="section-header" style={{ marginBottom: 16 }}>
                        <div>
                            <h2 className="section-title"><i className="bi bi-database-fill"></i> Ngân hàng câu hỏi</h2>
                            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>Tổng hợp tất cả câu hỏi từ mọi đề của bạn — lọc, chọn, và tạo đề nhanh.</p>
                        </div>
                        <Link to="/teacher/bank" className="btn btn-primary">
                            <i className="bi bi-box-arrow-up-right"></i> Mở ngân hàng đầy đủ
                        </Link>
                    </div>
                    <div className="empty-state" style={{ padding: 40 }}>
                        <i className="bi bi-database" style={{ fontSize: '3rem', opacity: 0.3 }}></i>
                        <p>Nhấn "Mở ngân hàng đầy đủ" để xem, lọc và tạo đề từ tất cả câu hỏi.</p>
                        <Link to="/teacher/bank" className="btn btn-primary"><i className="bi bi-database"></i> Mở ngân hàng câu hỏi</Link>
                    </div>
                </div>
            )}
        </div>
    );
}
