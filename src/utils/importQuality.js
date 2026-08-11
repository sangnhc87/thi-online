export function getQuestionImportIssues(question = {}) {
    const issues = [];

    if (!question.content_text?.trim()) issues.push('Thiếu nội dung');
    if (question.type === 'mcq' && (question.choices || []).length < 2) issues.push('Cần >= 2 đáp án');
    if (question.type === 'mcq' && !question.correct_answer) issues.push('Chưa chọn đáp án đúng');
    if (question.type === 'tf' && !question.correct_answer) issues.push('Chưa đánh dấu Đ/S');
    if (question.type === 'short_answer' && !question.correct_answer) issues.push('Thiếu đáp án');

    return issues;
}

export function normalizeImportHistory(history = []) {
    if (!Array.isArray(history)) return [];

    return history
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
            id: entry.id || null,
            kind: entry.kind || 'updated',
            actorId: entry.actorId || null,
            actorName: entry.actorName || null,
            actorRole: entry.actorRole || null,
            at: entry.at || null,
            note: entry.note || null,
            summary: entry.summary || null,
            score: Number(entry.score) || 0,
            status: entry.status || null,
            warningCount: Number(entry.warningCount) || 0,
            invalidQuestions: Number(entry.invalidQuestions) || 0,
            warningSamples: Array.isArray(entry.warningSamples) ? entry.warningSamples.slice(0, 3) : [],
            sourceFormat: entry.sourceFormat || 'manual',
        }));
}

export function buildImportHistoryEntry({
    kind = 'updated',
    actorId = null,
    actorName = null,
    actorRole = null,
    at = null,
    note = null,
    report = null,
    sourceFormat = 'manual',
}) {
    const normalizedReport = normalizeImportQuality(report, sourceFormat);

    return {
        id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        actorId,
        actorName,
        actorRole,
        at,
        note,
        summary: formatImportQualitySummary(normalizedReport, sourceFormat),
        score: normalizedReport.score,
        status: normalizedReport.status,
        warningCount: normalizedReport.warningCount,
        invalidQuestions: normalizedReport.invalidQuestions,
        warningSamples: normalizedReport.warningSamples.slice(0, 3),
        sourceFormat: normalizedReport.sourceFormat || sourceFormat,
    };
}

export function appendImportHistoryEntry(history = [], entry = null, limit = 12) {
    if (!entry) return normalizeImportHistory(history).slice(0, limit);
    return [entry, ...normalizeImportHistory(history)].slice(0, limit);
}

export function getImportHistoryLabel(entry = {}) {
    switch (entry.kind) {
        case 'import_created': return 'Nhập đề mới';
        case 'manual_created': return 'Tạo đề thủ công';
        case 'reviewed': return 'Đã rà soát';
        case 'question_saved': return 'Cập nhật câu hỏi';
        case 'question_added': return 'Thêm câu hỏi';
        case 'question_deleted': return 'Xóa câu hỏi';
        case 'settings_updated': return 'Cập nhật cài đặt';
        default: return 'Cập nhật import';
    }
}

export function buildImportQualityReport({
    questions = [],
    warningCount = 0,
    warningSamples = [],
    sourceFormat = 'manual',
    imageCount = 0,
    teacherReviewed = false,
    teacherReviewedAt = null,
    teacherReviewedBy = null,
    teacherReviewedName = null,
}) {
    const issueQuestions = (questions || [])
        .map((question, index) => ({
            number: question.number || index + 1,
            issues: getQuestionImportIssues(question),
        }))
        .filter((item) => item.issues.length > 0)
        .slice(0, 8);

    const questionCount = questions.length;
    const invalidQuestions = issueQuestions.length;
    const validQuestions = Math.max(0, questionCount - invalidQuestions);
    const reviewRecommended = sourceFormat !== 'manual' || warningCount > 0 || invalidQuestions > 0;
    const publishBlocked = invalidQuestions > 0;

    let score = 100;
    score -= invalidQuestions * 18;
    score -= warningCount * 5;
    score -= imageCount > 20 ? Math.min(8, Math.floor(imageCount / 10)) : 0;
    if (sourceFormat !== 'manual') score -= 4;
    score = Math.max(35, Math.min(100, score));

    const status = teacherReviewed && !publishBlocked
        ? 'teacher_verified'
        : publishBlocked
            ? 'risky'
            : reviewRecommended
                ? 'needs_review'
                : 'stable';

    return {
        parserVersion: 'import-quality-v1',
        sourceFormat,
        questionCount,
        validQuestions,
        invalidQuestions,
        warningCount,
        warningSamples: (warningSamples || []).slice(0, 5),
        imageCount,
        issueQuestions,
        reviewRecommended,
        publishBlocked,
        teacherReviewed: Boolean(teacherReviewed && !publishBlocked),
        teacherReviewedAt: teacherReviewed && !publishBlocked ? teacherReviewedAt : null,
        teacherReviewedBy: teacherReviewed && !publishBlocked ? teacherReviewedBy : null,
        teacherReviewedName: teacherReviewed && !publishBlocked ? teacherReviewedName : null,
        score,
        status,
    };
}

export function normalizeImportQuality(report = null, sourceFormat = 'manual') {
    if (!report || typeof report !== 'object') {
        const reviewRecommended = sourceFormat !== 'manual';
        return {
            parserVersion: 'import-quality-v1',
            sourceFormat,
            questionCount: 0,
            validQuestions: 0,
            invalidQuestions: 0,
            warningCount: 0,
            warningSamples: [],
            imageCount: 0,
            issueQuestions: [],
            reviewRecommended,
            publishBlocked: false,
            teacherReviewed: false,
            teacherReviewedAt: null,
            teacherReviewedBy: null,
            teacherReviewedName: null,
            score: reviewRecommended ? 82 : 96,
            status: reviewRecommended ? 'needs_review' : 'stable',
        };
    }

    const normalized = {
        parserVersion: report.parserVersion || 'import-quality-v1',
        sourceFormat: report.sourceFormat || sourceFormat || 'manual',
        questionCount: Number(report.questionCount) || 0,
        validQuestions: Number(report.validQuestions) || 0,
        invalidQuestions: Number(report.invalidQuestions) || 0,
        warningCount: Number(report.warningCount) || 0,
        warningSamples: Array.isArray(report.warningSamples) ? report.warningSamples.slice(0, 5) : [],
        imageCount: Number(report.imageCount) || 0,
        issueQuestions: Array.isArray(report.issueQuestions) ? report.issueQuestions.slice(0, 8) : [],
        reviewRecommended: Boolean(report.reviewRecommended),
        publishBlocked: Boolean(report.publishBlocked),
        teacherReviewed: Boolean(report.teacherReviewed),
        teacherReviewedAt: report.teacherReviewedAt || null,
        teacherReviewedBy: report.teacherReviewedBy || null,
        teacherReviewedName: report.teacherReviewedName || null,
        score: Number(report.score) || 0,
        status: report.status || 'stable',
    };

    if (normalized.status === 'teacher_verified' && normalized.publishBlocked) {
        normalized.status = 'risky';
        normalized.teacherReviewed = false;
        normalized.teacherReviewedAt = null;
        normalized.teacherReviewedBy = null;
        normalized.teacherReviewedName = null;
    }

    return normalized;
}

export function getImportQualityBadge(report = null, sourceFormat = 'manual') {
    const normalized = normalizeImportQuality(report, sourceFormat);

    if (normalized.status === 'teacher_verified') {
        return { label: 'Đã kiểm', icon: 'shield-check', className: 'success' };
    }
    if (normalized.status === 'risky') {
        return { label: 'Rủi ro', icon: 'shield-exclamation', className: 'danger' };
    }
    if (normalized.status === 'needs_review') {
        return { label: 'Cần soát', icon: 'shield', className: 'warning' };
    }
    return { label: 'Ổn định', icon: 'shield-fill-check', className: 'info' };
}

export function formatImportQualitySummary(report = null, sourceFormat = 'manual') {
    const normalized = normalizeImportQuality(report, sourceFormat);
    const parts = [];

    if (normalized.questionCount > 0) {
        parts.push(`${normalized.validQuestions}/${normalized.questionCount} câu hợp lệ`);
    }
    if (normalized.warningCount > 0) {
        parts.push(`${normalized.warningCount} cảnh báo parser`);
    }
    if (normalized.imageCount > 0) {
        parts.push(`${normalized.imageCount} ảnh`);
    }
    if (parts.length === 0) {
        parts.push('Chưa có cảnh báo');
    }

    return parts.join(' · ');
}

export function blocksExamActivation(report = null, sourceFormat = 'manual') {
    return normalizeImportQuality(report, sourceFormat).publishBlocked;
}

export function shouldWarnBeforeActivation(report = null, sourceFormat = 'manual') {
    const normalized = normalizeImportQuality(report, sourceFormat);
    return !normalized.publishBlocked && normalized.reviewRecommended && !normalized.teacherReviewed;
}