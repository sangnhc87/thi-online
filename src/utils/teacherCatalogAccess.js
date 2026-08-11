export const TEACHER_PACKAGE_TYPES = {
    FULL_CATALOG: 'full_catalog',
    SINGLE_SUBJECT: 'single_subject',
    MULTI_SUBJECT: 'multi_subject',
    CUSTOM: 'custom',
};

export const MAX_TEACHER_ACCESS_PAIRS = 30;

function uniqueSortedList(values = []) {
    return [...new Set(
        values
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right, 'vi'));
}

export function buildCatalogPairKey(subject = '', grade = '') {
    return `${subject}::${grade}`;
}

export function buildCatalogPairs(subjects = [], grades = []) {
    const normalizedSubjects = uniqueSortedList(subjects);
    const normalizedGrades = uniqueSortedList(grades);

    return normalizedSubjects.flatMap((subject) => normalizedGrades.map((grade) => ({
        subject,
        grade,
        key: buildCatalogPairKey(subject, grade),
    })));
}

function getDefaultPackageLabel(packageType, subjects = [], grades = []) {
    switch (packageType) {
        case TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT:
            return subjects[0] ? `Gói ${subjects[0]}` : 'Gói môn';
        case TEACHER_PACKAGE_TYPES.MULTI_SUBJECT:
            return `Gói liên môn (${subjects.length} môn)`;
        case TEACHER_PACKAGE_TYPES.CUSTOM:
            return `Gói tuỳ chỉnh (${subjects.length} môn / ${grades.length} khối)`;
        default:
            return 'Toàn bộ kho';
    }
}

export function buildTeacherCatalogAccessPayload({
    packageType = TEACHER_PACKAGE_TYPES.FULL_CATALOG,
    approvedSubjects = [],
    approvedGrades = [],
    packageLabel = '',
}) {
    const normalizedType = Object.values(TEACHER_PACKAGE_TYPES).includes(packageType)
        ? packageType
        : TEACHER_PACKAGE_TYPES.FULL_CATALOG;

    if (normalizedType === TEACHER_PACKAGE_TYPES.FULL_CATALOG) {
        return {
            accessPackageType: TEACHER_PACKAGE_TYPES.FULL_CATALOG,
            accessPackageLabel: packageLabel.trim() || getDefaultPackageLabel(TEACHER_PACKAGE_TYPES.FULL_CATALOG),
            approvedSubjects: [],
            approvedGrades: [],
            approvedAccessPairs: [],
            catalogPairCount: 0,
        };
    }

    const normalizedSubjects = uniqueSortedList(approvedSubjects);
    const normalizedGrades = uniqueSortedList(approvedGrades);

    if (!normalizedSubjects.length) {
        throw new Error('Cần chọn ít nhất 1 môn để cấp quyền.');
    }

    if (!normalizedGrades.length) {
        throw new Error('Cần chọn ít nhất 1 khối để cấp quyền.');
    }

    if (normalizedType === TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT && normalizedSubjects.length !== 1) {
        throw new Error('Gói môn chỉ được chọn đúng 1 môn.');
    }

    const approvedPairs = buildCatalogPairs(normalizedSubjects, normalizedGrades);
    if (approvedPairs.length > MAX_TEACHER_ACCESS_PAIRS) {
        throw new Error(`Gói hiện tại có ${approvedPairs.length} tổ hợp môn-khối. Giới hạn an toàn là ${MAX_TEACHER_ACCESS_PAIRS}; hãy thu hẹp lại hoặc chuyển sang toàn bộ kho.`);
    }

    return {
        accessPackageType: normalizedType,
        accessPackageLabel: packageLabel.trim() || getDefaultPackageLabel(normalizedType, normalizedSubjects, normalizedGrades),
        approvedSubjects: normalizedSubjects,
        approvedGrades: normalizedGrades,
        approvedAccessPairs: approvedPairs.map((pair) => pair.key),
        catalogPairCount: approvedPairs.length,
    };
}

export function getTeacherCatalogAccess(userProfile = {}, taxonomy = null) {
    const normalizedSubjects = uniqueSortedList(userProfile?.approvedSubjects || []);
    const normalizedGrades = uniqueSortedList(userProfile?.approvedGrades || []);
    const rawPackageType = typeof userProfile?.accessPackageType === 'string'
        ? userProfile.accessPackageType
        : null;
    const packageType = rawPackageType || TEACHER_PACKAGE_TYPES.FULL_CATALOG;
    const isLegacyFullAccess = userProfile?.role === 'teacher' && !rawPackageType;
    const hasFullCatalogAccess = userProfile?.role === 'admin'
        || packageType === TEACHER_PACKAGE_TYPES.FULL_CATALOG
        || isLegacyFullAccess;
    const taxonomySubjects = uniqueSortedList(taxonomy?.subjects || []);
    const taxonomyGrades = uniqueSortedList(taxonomy?.grades || []);

    return {
        packageType,
        packageLabel: typeof userProfile?.accessPackageLabel === 'string' && userProfile.accessPackageLabel.trim()
            ? userProfile.accessPackageLabel.trim()
            : getDefaultPackageLabel(packageType, normalizedSubjects, normalizedGrades),
        approvedSubjects: normalizedSubjects,
        approvedGrades: normalizedGrades,
        allowedSubjects: hasFullCatalogAccess
            ? (taxonomySubjects.length ? taxonomySubjects : normalizedSubjects)
            : (taxonomySubjects.length ? taxonomySubjects.filter((subject) => normalizedSubjects.includes(subject)) : normalizedSubjects),
        allowedGrades: hasFullCatalogAccess
            ? (taxonomyGrades.length ? taxonomyGrades : normalizedGrades)
            : (taxonomyGrades.length ? taxonomyGrades.filter((grade) => normalizedGrades.includes(grade)) : normalizedGrades),
        allowedPairs: hasFullCatalogAccess ? [] : buildCatalogPairs(normalizedSubjects, normalizedGrades),
        pairCount: hasFullCatalogAccess ? 0 : normalizedSubjects.length * normalizedGrades.length,
        hasFullCatalogAccess,
        isLegacyFullAccess,
    };
}

export function getTeacherCatalogAccessSummary(userProfile = {}, taxonomy = null) {
    const access = getTeacherCatalogAccess(userProfile, taxonomy);
    const badgeLabel = access.hasFullCatalogAccess
        ? 'Toàn bộ kho'
        : access.packageType === TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT
            ? 'Gói môn'
            : access.packageType === TEACHER_PACKAGE_TYPES.MULTI_SUBJECT
                ? 'Gói liên môn'
                : 'Tùy chỉnh';
    const badgeClass = access.hasFullCatalogAccess
        ? 'success'
        : access.packageType === TEACHER_PACKAGE_TYPES.SINGLE_SUBJECT
            ? 'info'
            : access.packageType === TEACHER_PACKAGE_TYPES.MULTI_SUBJECT
                ? 'trial'
                : 'muted';

    return {
        ...access,
        badgeLabel,
        badgeClass,
        subjectsText: access.hasFullCatalogAccess ? 'Mọi môn' : (access.approvedSubjects.join(', ') || 'Chưa cấp môn'),
        gradesText: access.hasFullCatalogAccess ? 'Mọi khối' : (access.approvedGrades.join(', ') || 'Chưa cấp khối'),
        shortText: access.hasFullCatalogAccess
            ? 'Toàn bộ môn · mọi khối'
            : `${access.approvedSubjects.length} môn · ${access.approvedGrades.length} khối`,
    };
}

export function matchesTeacherCatalogAccess(userProfile = {}, item = {}) {
    const access = getTeacherCatalogAccess(userProfile);
    if (access.hasFullCatalogAccess) return true;
    return Boolean(
        item?.subject
        && item?.grade
        && access.approvedSubjects.includes(item.subject)
        && access.approvedGrades.includes(item.grade),
    );
}