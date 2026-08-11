export const TEACHER_STATUS = {
    PENDING: 'pending',
    FREE: 'free',
    TRIAL: 'trial',
    ACTIVE: 'active',
    EXPIRED: 'expired',
};

export const FREE_TEACHER_LIMITS = {
    maxStudents: 50,
    maxActiveExams: 5,
    maxPremiumLiveLaunchesPerMonth: 2,
};

export const PREMIUM_LIVE_MODES = ['golden_bell', 'speed', 'millionaire'];

function toDateValue(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeTeacherStatus(status, { preserveLegacyTrial = false } = {}) {
    switch (status) {
        case TEACHER_STATUS.TRIAL:
            return preserveLegacyTrial ? TEACHER_STATUS.TRIAL : TEACHER_STATUS.FREE;
        case TEACHER_STATUS.FREE:
        case TEACHER_STATUS.ACTIVE:
        case TEACHER_STATUS.EXPIRED:
        case TEACHER_STATUS.PENDING:
            return status;
        default:
            return status || TEACHER_STATUS.PENDING;
    }
}

export function getTeacherComputedStatus(userProfile = {}, options = {}) {
    if (!userProfile) return null;
    if (userProfile.role === 'admin') return TEACHER_STATUS.ACTIVE;
    if (userProfile.role === 'pending_teacher') return TEACHER_STATUS.PENDING;
    if (userProfile.role !== 'teacher') return normalizeTeacherStatus(userProfile.teacherStatus, options);

    const rawStatus = userProfile.teacherStatus || TEACHER_STATUS.PENDING;

    if (rawStatus === TEACHER_STATUS.ACTIVE) {
        const endDate = toDateValue(userProfile.subscriptionEnd);
        if (!endDate || endDate <= new Date()) return TEACHER_STATUS.EXPIRED;
        return TEACHER_STATUS.ACTIVE;
    }

    return normalizeTeacherStatus(rawStatus, options);
}

export function hasTeacherWorkspaceAccess(userProfile = {}) {
    if (!userProfile) return false;
    if (userProfile.role === 'admin') return true;
    if (userProfile.role !== 'teacher') return false;

    const status = getTeacherComputedStatus(userProfile);
    return status === TEACHER_STATUS.FREE || status === TEACHER_STATUS.ACTIVE;
}

export function isTeacherPaidPlan(userProfile = {}) {
    if (!userProfile) return false;
    if (userProfile.role === 'admin') return true;
    if (userProfile.role !== 'teacher') return false;
    return getTeacherComputedStatus(userProfile) === TEACHER_STATUS.ACTIVE;
}

export function isTeacherFreePlan(userProfile = {}) {
    if (!userProfile || userProfile.role !== 'teacher') return false;
    return getTeacherComputedStatus(userProfile) === TEACHER_STATUS.FREE;
}

export function getTeacherStatusMeta(input, options = {}) {
    const status = typeof input === 'string'
        ? normalizeTeacherStatus(input, options)
        : getTeacherComputedStatus(input, options);

    switch (status) {
        case TEACHER_STATUS.PENDING:
            return { status, label: 'Chờ duyệt', badgeClass: 'pending' };
        case TEACHER_STATUS.FREE:
        case TEACHER_STATUS.TRIAL:
            return { status: TEACHER_STATUS.FREE, label: 'Gói Free', badgeClass: 'trial' };
        case TEACHER_STATUS.ACTIVE:
            return { status, label: 'Teacher Plus', badgeClass: 'active' };
        case TEACHER_STATUS.EXPIRED:
            return { status, label: 'Hết hạn', badgeClass: 'expired' };
        default:
            return { status: status || TEACHER_STATUS.PENDING, label: status || 'N/A', badgeClass: 'muted' };
    }
}

function getMonthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getTeacherPremiumLiveUsage(teacherStats = {}, date = new Date()) {
    const monthKey = getMonthKey(date);
    const count = teacherStats?.premiumLiveUsageMonth === monthKey
        ? Number(teacherStats?.premiumLiveUsageCount || 0)
        : 0;

    return {
        monthKey,
        count,
        limit: FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth,
        remaining: Math.max(0, FREE_TEACHER_LIMITS.maxPremiumLiveLaunchesPerMonth - count),
    };
}

export function isPremiumLiveMode(mode = '') {
    return PREMIUM_LIVE_MODES.includes(mode);
}