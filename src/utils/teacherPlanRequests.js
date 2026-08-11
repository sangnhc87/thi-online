import {
    addDoc,
    collection,
    doc,
    getDocs,
    limit,
    orderBy,
    runTransaction,
    query,
    Timestamp,
    where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { logAuditEvent } from './audit';
import {
    buildTeacherCatalogAccessPayload,
    getTeacherCatalogAccessSummary,
    TEACHER_PACKAGE_TYPES,
} from './teacherCatalogAccess';

export const TEACHER_PLAN_REQUEST_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
};

export const TEACHER_PLAN_REQUEST_TYPES = {
    UPGRADE: 'upgrade',
    RENEWAL: 'renewal',
};

export const TEACHER_PLAN_DURATION_OPTIONS = [1, 3, 6, 12, 24, 36];

export function formatTeacherPlanDuration(months = 0) {
    const normalized = Number(months) || 0;
    if (!normalized) return '0 tháng';
    if (normalized % 12 === 0) {
        const years = normalized / 12;
        return years === 1 ? '1 năm' : `${years} năm`;
    }
    return `${normalized} tháng`;
}

export function buildTeacherPlanRequestLabel(requestType, requestedMonths) {
    const typeLabel = requestType === TEACHER_PLAN_REQUEST_TYPES.RENEWAL ? 'Gia hạn' : 'Nâng cấp';
    return `${typeLabel} ${formatTeacherPlanDuration(requestedMonths)}`;
}

export function getTeacherPlanRequestStatusMeta(status) {
    switch (status) {
        case TEACHER_PLAN_REQUEST_STATUS.PENDING:
            return { label: 'Chờ duyệt', className: 'pending', icon: 'hourglass-split' };
        case TEACHER_PLAN_REQUEST_STATUS.APPROVED:
            return { label: 'Đã duyệt', className: 'active', icon: 'check-circle' };
        case TEACHER_PLAN_REQUEST_STATUS.REJECTED:
            return { label: 'Từ chối', className: 'expired', icon: 'x-circle' };
        default:
            return { label: status || 'Không rõ', className: 'muted', icon: 'question-circle' };
    }
}

export function getTeacherPlanRequestTypeMeta(requestType) {
    switch (requestType) {
        case TEACHER_PLAN_REQUEST_TYPES.RENEWAL:
            return { label: 'Gia hạn', className: 'warm', icon: 'arrow-repeat' };
        case TEACHER_PLAN_REQUEST_TYPES.UPGRADE:
        default:
            return { label: 'Nâng cấp', className: 'info', icon: 'rocket-takeoff' };
    }
}

function getActorName(actor = {}) {
    return actor.displayName || actor.email || 'Người dùng';
}

function normalizeRequestedMonths(requestedMonths) {
    const normalized = Number(requestedMonths);
    if (!Number.isFinite(normalized) || normalized < 1 || normalized > 120) {
        throw new Error('Thời hạn yêu cầu phải từ 1 đến 120 tháng.');
    }
    return Math.round(normalized);
}

function normalizeRequestType(requestType) {
    return Object.values(TEACHER_PLAN_REQUEST_TYPES).includes(requestType)
        ? requestType
        : TEACHER_PLAN_REQUEST_TYPES.UPGRADE;
}

function resolveSubscriptionEnd(teacher = {}, months = 0) {
    let baseDate = new Date();
    if (teacher.subscriptionEnd) {
        const currentEnd = teacher.subscriptionEnd.toDate
            ? teacher.subscriptionEnd.toDate()
            : new Date(teacher.subscriptionEnd);
        if (currentEnd > baseDate) baseDate = currentEnd;
    }

    const nextEnd = new Date(baseDate);
    nextEnd.setMonth(nextEnd.getMonth() + months);
    return nextEnd;
}

function buildPlanRequestQueryConstraints(maxResults = 10) {
    return [orderBy('requestedAt', 'desc'), limit(maxResults)];
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    return new Date(value).getTime();
}

export async function loadTeacherPlanRequests(teacherId, { maxResults = 10 } = {}) {
    if (!teacherId) return [];

    const snapshot = await getDocs(query(
        collection(db, 'teacherPlanRequests'),
        where('teacherId', '==', teacherId),
    ));

    return snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((left, right) => toMillis(right.requestedAt) - toMillis(left.requestedAt))
        .slice(0, maxResults);
}

export async function loadAdminTeacherPlanRequests({ maxResults = 200 } = {}) {
    const snapshot = await getDocs(query(
        collection(db, 'teacherPlanRequests'),
        ...buildPlanRequestQueryConstraints(maxResults),
    ));

    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function createTeacherPlanRequest({ user, userProfile, requestType, requestedMonths, note = '' }) {
    if (!user?.uid) throw new Error('Thiếu tài khoản giáo viên');
    if (userProfile?.role !== 'teacher') throw new Error('Chỉ giáo viên mới gửi được yêu cầu gói.');

    const existingRequests = await loadTeacherPlanRequests(user.uid, { maxResults: 5 });
    if (existingRequests.some((item) => item.status === TEACHER_PLAN_REQUEST_STATUS.PENDING)) {
        throw new Error('Bạn đang có một yêu cầu chờ duyệt. Vui lòng đợi admin phản hồi.');
    }

    const normalizedType = normalizeRequestType(requestType);
    const normalizedMonths = normalizeRequestedMonths(requestedMonths);
    const actorName = getActorName({
        displayName: userProfile?.displayName || user.displayName,
        email: user.email,
    });
    const accessSummary = getTeacherCatalogAccessSummary(userProfile);
    const now = Timestamp.now();

    const requestPayload = {
        teacherId: user.uid,
        teacherName: actorName,
        teacherEmail: user.email || null,
        schoolName: userProfile?.schoolName || null,
        teacherStatusSnapshot: userProfile?.teacherStatus || null,
        subscriptionEndSnapshot: userProfile?.subscriptionEnd || null,
        requestType: normalizedType,
        requestedMonths: normalizedMonths,
        requestedPlanLabel: buildTeacherPlanRequestLabel(normalizedType, normalizedMonths),
        requestedCatalogPackage: accessSummary.packageLabel,
        requestedCatalogSummary: accessSummary.shortText,
        note: note.trim() || null,
        status: TEACHER_PLAN_REQUEST_STATUS.PENDING,
        approvedMonths: null,
        approvedUntil: null,
        resolvedAt: null,
        resolvedById: null,
        resolvedByName: null,
        reviewNote: null,
        requestedAt: now,
        updatedAt: now,
    };

    const requestRef = await addDoc(collection(db, 'teacherPlanRequests'), requestPayload);
    await logAuditEvent({
        actorId: user.uid,
        actorRole: userProfile?.role || 'teacher',
        actorName,
        action: 'teacher.plan_request.create',
        targetType: 'teacherPlanRequest',
        targetId: requestRef.id,
        teacherId: user.uid,
        metadata: {
            requestType: normalizedType,
            requestedMonths: normalizedMonths,
            requestedPlanLabel: requestPayload.requestedPlanLabel,
        },
    }).catch((error) => console.error('audit log failed', error));

    return { id: requestRef.id, ...requestPayload };
}

export async function approveTeacherPlanRequest({ requestId, reviewer, approvedMonths, reviewNote = '' }) {
    if (!requestId) throw new Error('Thiếu yêu cầu cần duyệt');
    if (!reviewer?.uid) throw new Error('Thiếu tài khoản admin');

    const requestRef = doc(db, 'teacherPlanRequests', requestId);
    const reviewerName = getActorName(reviewer);
    const approval = await runTransaction(db, async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists()) throw new Error('Không tìm thấy yêu cầu gói');

        const requestData = { id: requestSnap.id, ...requestSnap.data() };
        if (requestData.status !== TEACHER_PLAN_REQUEST_STATUS.PENDING) {
            throw new Error('Yêu cầu này đã được xử lý trước đó.');
        }

        const teacherRef = doc(db, 'users', requestData.teacherId);
        const teacherSnap = await transaction.get(teacherRef);
        if (!teacherSnap.exists()) throw new Error('Không tìm thấy hồ sơ giáo viên');

        const teacher = teacherSnap.data();
        const normalizedMonths = normalizeRequestedMonths(approvedMonths || requestData.requestedMonths || 12);
        const nextEnd = resolveSubscriptionEnd(teacher, normalizedMonths);
        const now = Timestamp.now();
        const teacherPatch = {
            teacherStatus: 'active',
            subscriptionEnd: Timestamp.fromDate(nextEnd),
            subscriptionMonths: (Number(teacher.subscriptionMonths) || 0) + normalizedMonths,
        };

        if (typeof teacher.accessPackageType !== 'string' || !teacher.accessPackageType.trim()) {
            Object.assign(teacherPatch, buildTeacherCatalogAccessPayload({
                packageType: TEACHER_PACKAGE_TYPES.FULL_CATALOG,
            }));
        }

        transaction.update(teacherRef, teacherPatch);
        transaction.update(requestRef, {
            status: TEACHER_PLAN_REQUEST_STATUS.APPROVED,
            approvedMonths: normalizedMonths,
            approvedUntil: Timestamp.fromDate(nextEnd),
            resolvedAt: now,
            resolvedById: reviewer.uid,
            resolvedByName: reviewerName,
            reviewNote: reviewNote.trim() || null,
            updatedAt: now,
        });

        return {
            requestId,
            requestData,
            teacherId: requestData.teacherId,
            approvedMonths: normalizedMonths,
            approvedUntil: Timestamp.fromDate(nextEnd),
            approvedUntilIso: nextEnd.toISOString(),
        };
    });

    await logAuditEvent({
        actorId: reviewer.uid,
        actorRole: 'admin',
        actorName: reviewerName,
        action: 'teacher.plan_request.approve',
        targetType: 'teacherPlanRequest',
        targetId: requestId,
        teacherId: approval.teacherId,
        metadata: {
            teacherName: approval.requestData.teacherName || null,
            teacherEmail: approval.requestData.teacherEmail || null,
            approvedMonths: approval.approvedMonths,
            approvedUntil: approval.approvedUntilIso,
            requestType: approval.requestData.requestType || null,
        },
    }).catch((error) => console.error('audit log failed', error));

    return {
        requestId: approval.requestId,
        teacherId: approval.teacherId,
        approvedMonths: approval.approvedMonths,
        approvedUntil: approval.approvedUntil,
    };
}

export async function rejectTeacherPlanRequest({ requestId, reviewer, reviewNote = '' }) {
    if (!requestId) throw new Error('Thiếu yêu cầu cần từ chối');
    if (!reviewer?.uid) throw new Error('Thiếu tài khoản admin');
    if (!reviewNote.trim()) throw new Error('Cần nhập lý do từ chối.');

    const requestRef = doc(db, 'teacherPlanRequests', requestId);
    const reviewerName = getActorName(reviewer);
    const rejection = await runTransaction(db, async (transaction) => {
        const requestSnap = await transaction.get(requestRef);
        if (!requestSnap.exists()) throw new Error('Không tìm thấy yêu cầu gói');

        const requestData = { id: requestSnap.id, ...requestSnap.data() };
        if (requestData.status !== TEACHER_PLAN_REQUEST_STATUS.PENDING) {
            throw new Error('Yêu cầu này đã được xử lý trước đó.');
        }

        const now = Timestamp.now();
        transaction.update(requestRef, {
            status: TEACHER_PLAN_REQUEST_STATUS.REJECTED,
            resolvedAt: now,
            resolvedById: reviewer.uid,
            resolvedByName: reviewerName,
            reviewNote: reviewNote.trim(),
            updatedAt: now,
        });

        return { id: requestId, ...requestData, status: TEACHER_PLAN_REQUEST_STATUS.REJECTED };
    });

    await logAuditEvent({
        actorId: reviewer.uid,
        actorRole: 'admin',
        actorName: reviewerName,
        action: 'teacher.plan_request.reject',
        targetType: 'teacherPlanRequest',
        targetId: requestId,
        teacherId: rejection.teacherId,
        metadata: {
            teacherName: rejection.teacherName || null,
            teacherEmail: rejection.teacherEmail || null,
            requestType: rejection.requestType || null,
            requestedMonths: rejection.requestedMonths || null,
        },
    }).catch((error) => console.error('audit log failed', error));

    return rejection;
}