import { BANK_SCOPE_PRIVATE, BANK_SCOPE_SYSTEM, getQuestionChapter } from './bank';

export const EXAM_DELIVERY_SOURCE_FIXED = 'fixed';
export const EXAM_DELIVERY_SOURCE_BANK = 'bank';

export const EXAM_DELIVERY_VARIANT_FIXED = 'fixed';
export const EXAM_DELIVERY_VARIANT_PER_STUDENT = 'per_student';
export const EXAM_DELIVERY_VARIANT_PER_ATTEMPT = 'per_attempt';

export const EXAM_DELIVERY_MODE_META = {
    [EXAM_DELIVERY_VARIANT_FIXED]: {
        label: 'Giữ bộ câu cố định',
        description: 'Tạo sẵn một bộ câu cố định, chỉ xáo thứ tự câu và đáp án khi học sinh vào làm.',
    },
    [EXAM_DELIVERY_VARIANT_PER_STUDENT]: {
        label: 'Mỗi học sinh một bộ',
        description: 'Mỗi học sinh được bốc một bộ câu riêng từ ngân hàng theo đúng ma trận đã khai báo.',
    },
    [EXAM_DELIVERY_VARIANT_PER_ATTEMPT]: {
        label: 'Mỗi lượt thi bốc lại',
        description: 'Mỗi lần thi mới của cùng một học sinh sẽ được bốc một bộ câu khác từ ngân hàng.',
    },
};

export const BANK_BLUEPRINT_SCOPE_OPTIONS = [
    { value: 'all', label: 'Mọi nguồn' },
    { value: BANK_SCOPE_PRIVATE, label: 'Ngân hàng cá nhân' },
    { value: BANK_SCOPE_SYSTEM, label: 'Ngân hàng hệ thống' },
];

export const BANK_BLUEPRINT_TYPE_OPTIONS = [
    { value: 'all', label: 'Tất cả loại' },
    { value: 'mcq', label: 'Trắc nghiệm' },
    { value: 'tf', label: 'Đúng/Sai' },
    { value: 'short_answer', label: 'Tự luận ngắn' },
    { value: 'essay', label: 'Tự luận' },
];

export const BANK_BLUEPRINT_DIFFICULTY_OPTIONS = [
    { value: 'all', label: 'Mọi độ khó' },
    { value: '1', label: 'Dễ' },
    { value: '2', label: 'Trung bình' },
    { value: '3', label: 'Khó' },
];

const NO_CHAPTER_VALUE = '__none__';

function sanitizeText(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function isAllowedScope(value) {
    return ['all', BANK_SCOPE_PRIVATE, BANK_SCOPE_SYSTEM].includes(value);
}

function normalizeVariantMode(value, fallback = EXAM_DELIVERY_VARIANT_FIXED) {
    if ([
        EXAM_DELIVERY_VARIANT_FIXED,
        EXAM_DELIVERY_VARIANT_PER_STUDENT,
        EXAM_DELIVERY_VARIANT_PER_ATTEMPT,
    ].includes(value)) {
        return value;
    }

    return fallback;
}

function normalizeCount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.floor(parsed));
}

function createRowId() {
    return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createBankBlueprintRow(overrides = {}) {
    return {
        id: overrides.id || createRowId(),
        count: normalizeCount(overrides.count ?? 1) || 1,
        type: overrides.type || 'all',
        difficulty: String(overrides.difficulty || 'all'),
        chapter: overrides.chapter || 'all',
        scope: isAllowedScope(overrides.scope) ? overrides.scope : 'all',
    };
}

export function normalizeBankBlueprintRow(row = {}, index = 0) {
    return {
        id: row.id || `row-${index + 1}`,
        count: normalizeCount(row.count),
        type: BANK_BLUEPRINT_TYPE_OPTIONS.some((option) => option.value === row.type) ? row.type : 'all',
        difficulty: BANK_BLUEPRINT_DIFFICULTY_OPTIONS.some((option) => option.value === String(row.difficulty)) ? String(row.difficulty) : 'all',
        chapter: row.chapter || 'all',
        scope: isAllowedScope(row.scope) ? row.scope : 'all',
    };
}

export function createDefaultExamDeliveryConfig(fallback = {}) {
    return {
        source: EXAM_DELIVERY_SOURCE_FIXED,
        variantMode: EXAM_DELIVERY_VARIANT_FIXED,
        bankPolicy: {
            subject: sanitizeText(fallback.subject),
            grade: sanitizeText(fallback.grade),
            scope: 'all',
            rows: [createBankBlueprintRow()],
        },
    };
}

export function normalizeExamDeliveryConfig(config = null, fallback = {}, options = {}) {
    const includeBankDefaults = options.includeBankDefaults !== false;
    const hasConfigObject = Boolean(config && typeof config === 'object');
    const source = hasConfigObject && config.source === EXAM_DELIVERY_SOURCE_BANK
        ? EXAM_DELIVERY_SOURCE_BANK
        : EXAM_DELIVERY_SOURCE_FIXED;
    const hasBankPolicy = Boolean(hasConfigObject && config.bankPolicy && typeof config.bankPolicy === 'object');
    const rawBankPolicy = hasBankPolicy ? config.bankPolicy : {};
    const fallbackVariant = source === EXAM_DELIVERY_SOURCE_BANK
        ? EXAM_DELIVERY_VARIANT_PER_STUDENT
        : EXAM_DELIVERY_VARIANT_FIXED;
    const variantMode = source === EXAM_DELIVERY_SOURCE_FIXED
        ? EXAM_DELIVERY_VARIANT_FIXED
        : normalizeVariantMode(config?.variantMode, fallbackVariant);

    const shouldKeepBankPolicy = hasBankPolicy || includeBankDefaults;
    const rows = shouldKeepBankPolicy
        ? (Array.isArray(rawBankPolicy.rows) && rawBankPolicy.rows.length > 0
            ? rawBankPolicy.rows.map((row, index) => normalizeBankBlueprintRow(row, index)).filter((row) => row.count > 0)
            : includeBankDefaults
                ? [createBankBlueprintRow()]
                : [])
        : [];

    return {
        source,
        variantMode,
        bankPolicy: shouldKeepBankPolicy
            ? {
                subject: sanitizeText(rawBankPolicy.subject) || sanitizeText(fallback.subject),
                grade: sanitizeText(rawBankPolicy.grade) || sanitizeText(fallback.grade),
                scope: isAllowedScope(rawBankPolicy.scope) ? rawBankPolicy.scope : 'all',
                rows,
            }
            : null,
    };
}

export function isDynamicBankDelivery(config = null) {
    const normalized = normalizeExamDeliveryConfig(config, {}, { includeBankDefaults: false });
    return normalized.source === EXAM_DELIVERY_SOURCE_BANK && normalized.variantMode !== EXAM_DELIVERY_VARIANT_FIXED;
}

export function usesBankBlueprint(config = null) {
    const normalized = normalizeExamDeliveryConfig(config, {}, { includeBankDefaults: false });
    return Boolean(normalized.bankPolicy && normalized.bankPolicy.rows.length > 0);
}

export function getExamDeliveryModeMeta(config = null) {
    const normalized = normalizeExamDeliveryConfig(config, {}, { includeBankDefaults: false });
    return EXAM_DELIVERY_MODE_META[normalized.variantMode] || EXAM_DELIVERY_MODE_META[EXAM_DELIVERY_VARIANT_FIXED];
}

export function computeBankBlueprintQuestionCount(config = null) {
    const normalized = normalizeExamDeliveryConfig(config, {}, { includeBankDefaults: false });
    if (!normalized.bankPolicy) return 0;
    return normalized.bankPolicy.rows.reduce((sum, row) => sum + normalizeCount(row.count), 0);
}

export function getExamQuestionCount(exam = null, questions = []) {
    if (Array.isArray(questions) && questions.length > 0) return questions.length;

    const safeExam = exam && typeof exam === 'object' ? exam : {};
    if (isDynamicBankDelivery(safeExam.deliveryConfig)) {
        return Number(safeExam.questionCount) || computeBankBlueprintQuestionCount(safeExam.deliveryConfig);
    }

    return Number(safeExam.questionCount) || 0;
}

function resolveEffectiveScope(policyScope = 'all', rowScope = 'all') {
    if (rowScope && rowScope !== 'all') return rowScope;
    return policyScope || 'all';
}

export function matchesBlueprintRow(item = {}, config = null, row = {}) {
    const normalized = normalizeExamDeliveryConfig(config, {}, { includeBankDefaults: false });
    const policy = normalized.bankPolicy || {};
    const chapter = getQuestionChapter(item);
    const effectiveScope = resolveEffectiveScope(policy.scope, row.scope);

    if (policy.subject && item.subject !== policy.subject) return false;
    if (policy.grade && item.grade !== policy.grade) return false;
    if (effectiveScope !== 'all' && item.scope !== effectiveScope) return false;
    if (row.type && row.type !== 'all' && item.type !== row.type) return false;
    if (row.difficulty && row.difficulty !== 'all' && String(item.difficulty || 1) !== String(row.difficulty)) return false;
    if (row.chapter && row.chapter !== 'all') {
        if (row.chapter === NO_CHAPTER_VALUE) {
            if (chapter) return false;
        } else if (chapter !== row.chapter) {
            return false;
        }
    }

    return true;
}

function shuffleWithRandom(items = [], random = Math.random) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(random() * (index + 1));
        [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
    }
    return next;
}

function getItemUniqueKey(item = {}) {
    return item.id || item.sourceQuestionId || item.sourceBankItemId || `${item.sourceExamId || 'exam'}:${item.number || item.order || 0}`;
}

export function pickBankItemsForDelivery(items = [], config = null, options = {}) {
    const normalized = normalizeExamDeliveryConfig(config, {}, { includeBankDefaults: false });
    if (!normalized.bankPolicy || normalized.bankPolicy.rows.length === 0) {
        throw new Error('Ma trận ngân hàng đang trống. Hãy thêm ít nhất 1 dòng cấu hình.');
    }

    const random = typeof options.random === 'function' ? options.random : Math.random;
    let remaining = [...items];
    const picked = [];
    let pendingRows = normalized.bankPolicy.rows.map((row, index) => ({ row, index }));

    while (pendingRows.length > 0) {
        const rankedRows = pendingRows
            .map((entry) => ({
                ...entry,
                candidates: remaining.filter((item) => matchesBlueprintRow(item, normalized, entry.row)),
            }))
            .sort((left, right) => (
                left.candidates.length - right.candidates.length
                || right.row.count - left.row.count
                || left.index - right.index
            ));

        const current = rankedRows[0];
        if (current.candidates.length < current.row.count) {
            throw new Error(`Không đủ câu cho dòng ma trận ${current.index + 1}. Cần ${current.row.count}, hiện có ${current.candidates.length}.`);
        }

        const rowPicked = shuffleWithRandom(current.candidates, random).slice(0, current.row.count);
        picked.push(...rowPicked);
        const pickedKeys = new Set(rowPicked.map((item) => getItemUniqueKey(item)));
        remaining = remaining.filter((item) => !pickedKeys.has(getItemUniqueKey(item)));
        pendingRows = pendingRows.filter((entry) => entry.index !== current.index);
    }

    return shuffleWithRandom(picked, random);
}

export function getBankScopeLabel(scope = 'all') {
    if (scope === BANK_SCOPE_PRIVATE) return 'Ngân hàng cá nhân';
    if (scope === BANK_SCOPE_SYSTEM) return 'Ngân hàng hệ thống';
    return 'Mọi nguồn';
}

export function getDifficultyLabel(value = 'all') {
    if (String(value) === '1') return 'Dễ';
    if (String(value) === '2') return 'Trung bình';
    if (String(value) === '3') return 'Khó';
    return 'Mọi độ khó';
}

export function getChapterLabel(value = 'all') {
    if (value === NO_CHAPTER_VALUE) return 'Chưa phân chương';
    if (value === 'all' || !value) return 'Mọi chương';
    return value;
}

export function getBankBlueprintGuideSteps() {
    return [
        'Chọn 1 trong 3 mode phát đề phù hợp với mục tiêu kiểm tra.',
        'Khai báo ma trận theo số câu, loại câu, độ khó, chương và nguồn ngân hàng.',
        'Kiểm tra cột khả dụng để tránh thiếu câu khi mở đề cho học sinh.',
        'Nếu dùng đề động từ ngân hàng, chỉnh các cài đặt còn lại ở trang Chi tiết đề rồi mới kích hoạt.',
    ];
}