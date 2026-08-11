export const QUESTION_OPTION_LAYOUT_OPTIONS = [
    { value: '', label: 'Tu dong theo do dai dap an' },
    { value: '1x4', label: '1 cot (1x4)' },
    { value: '2x2', label: '2 cot (2x2)' },
    { value: '4x1', label: '4 cot (4x1)' },
];

const OPTION_LAYOUT_HINT_REGEX = /##(1x4|2x2|4x1)\s*/i;
const OPTION_LAYOUT_HINT_GLOBAL_REGEX = /##(1x4|2x2|4x1)\s*/gi;

export function normalizeQuestionOptionLayout(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1x4', '2x2', '4x1'].includes(normalized) ? normalized : null;
}

export function stripOptionLayoutHints(value = '') {
    return String(value || '').replace(OPTION_LAYOUT_HINT_GLOBAL_REGEX, '').trim();
}

export function extractOptionLayoutHint(...values) {
    for (const value of values) {
        const match = String(value || '').match(OPTION_LAYOUT_HINT_REGEX);
        if (match?.[1]) return match[1];
    }
    return null;
}

export function getQuestionOptionLayout(question = {}) {
    return normalizeQuestionOptionLayout(question.optionLayout)
        || extractOptionLayoutHint(question.content_text, question.content_html);
}

export function getQuestionOptionLayoutLabel(value) {
    switch (normalizeQuestionOptionLayout(value)) {
        case '1x4':
            return '1 cot';
        case '2x2':
            return '2 cot';
        case '4x1':
            return '4 cot';
        default:
            return 'Tu dong';
    }
}

export function applyQuestionOptionLayout(question = {}, nextLayout = null) {
    const cleanedQuestion = {
        ...question,
        content_text: stripOptionLayoutHints(question.content_text || ''),
        content_html: stripOptionLayoutHints(question.content_html || ''),
    };

    if (question.type !== 'mcq') {
        return {
            ...cleanedQuestion,
            optionLayout: null,
        };
    }

    return {
        ...cleanedQuestion,
        optionLayout: normalizeQuestionOptionLayout(nextLayout),
    };
}