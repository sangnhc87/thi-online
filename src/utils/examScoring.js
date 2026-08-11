export const DEFAULT_TF_SCORING = {
    tf_1_4: 0.1,
    tf_2_4: 0.25,
    tf_3_4: 0.5,
    tf_4_4: 1.0,
};

export const TF_SCORING_PRESETS = [
    { id: 'bgd2025', label: 'BGD 2025 (0.1 · 0.25 · 0.5 · 1)', values: { tf_1_4: 0.1, tf_2_4: 0.25, tf_3_4: 0.5, tf_4_4: 1.0 } },
    { id: 'equal', label: 'Deu nhau (0.25 · 0.5 · 0.75 · 1)', values: { tf_1_4: 0.25, tf_2_4: 0.5, tf_3_4: 0.75, tf_4_4: 1.0 } },
    { id: 'all_or_nothing', label: 'Tat ca hoac khong (0 · 0 · 0 · 1)', values: { tf_1_4: 0, tf_2_4: 0, tf_3_4: 0, tf_4_4: 1.0 } },
    { id: 'custom', label: 'Tuy chinh', values: null },
];

export const DEFAULT_QUESTION_SCORING = {
    mcq: 0.25,
    short_answer: 0.5,
    essay: 2.0,
};

const DEFAULT_MCQ_CHOICES = ['A', 'B', 'C', 'D'];
const DEFAULT_TF_CHOICES = ['a', 'b', 'c', 'd'];

function clampNonNegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizeTfScoring(value = {}) {
    return {
        tf_1_4: clampNonNegativeNumber(value.tf_1_4, DEFAULT_TF_SCORING.tf_1_4),
        tf_2_4: clampNonNegativeNumber(value.tf_2_4, DEFAULT_TF_SCORING.tf_2_4),
        tf_3_4: clampNonNegativeNumber(value.tf_3_4, DEFAULT_TF_SCORING.tf_3_4),
        tf_4_4: clampNonNegativeNumber(value.tf_4_4, DEFAULT_TF_SCORING.tf_4_4),
    };
}

export function getTfPresetId(scoring = DEFAULT_TF_SCORING) {
    const normalized = normalizeTfScoring(scoring);
    const match = TF_SCORING_PRESETS.find((preset) => (
        preset.values
        && preset.values.tf_1_4 === normalized.tf_1_4
        && preset.values.tf_2_4 === normalized.tf_2_4
        && preset.values.tf_3_4 === normalized.tf_3_4
        && preset.values.tf_4_4 === normalized.tf_4_4
    ));
    return match?.id || 'custom';
}

export function normalizeQuestionScoring(value = {}) {
    return {
        mcq: clampNonNegativeNumber(value.mcq, DEFAULT_QUESTION_SCORING.mcq),
        short_answer: clampNonNegativeNumber(value.short_answer, DEFAULT_QUESTION_SCORING.short_answer),
        essay: clampNonNegativeNumber(value.essay, DEFAULT_QUESTION_SCORING.essay),
    };
}

export function normalizeTextAnswer(value) {
    return String(value || '').trim();
}

export function normalizeEssayAnswer(answer) {
    if (typeof answer === 'string') {
        return {
            text: normalizeTextAnswer(answer),
            attachments: [],
        };
    }

    if (!answer || typeof answer !== 'object') {
        return {
            text: '',
            attachments: [],
        };
    }

    return {
        text: normalizeTextAnswer(answer.text),
        attachments: Array.isArray(answer.attachments)
            ? answer.attachments.filter((attachment) => attachment && typeof attachment === 'object')
            : [],
    };
}

export function getQuestionMaxPoints(question = {}, questionScoring = DEFAULT_QUESTION_SCORING, tfScoring = DEFAULT_TF_SCORING) {
    const explicit = Number(question.points);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;

    if (question.type === 'tf') {
        return normalizeTfScoring(tfScoring).tf_4_4;
    }

    const normalized = normalizeQuestionScoring(questionScoring);
    return normalized[question.type] ?? 1;
}

function mapChoices(existingChoices = [], letters = DEFAULT_MCQ_CHOICES) {
    if (existingChoices.length > 0) {
        return existingChoices.map((choice, index) => ({
            ...choice,
            letter: letters[index] || choice.letter || String(index + 1),
        }));
    }
    return letters.map((letter) => ({ letter, text: '', html: '' }));
}

export function buildQuestionTypePatch(question = {}, newType = 'mcq', questionScoring = DEFAULT_QUESTION_SCORING, tfScoring = DEFAULT_TF_SCORING) {
    const normalizedQuestionScoring = normalizeQuestionScoring(questionScoring);
    const normalizedTfScoring = normalizeTfScoring(tfScoring);

    if (newType === 'mcq') {
        const choices = mapChoices(question.choices || [], DEFAULT_MCQ_CHOICES);
        const correctAnswer = choices.some((choice) => choice.letter === question.correct_answer) ? question.correct_answer : null;
        return {
            type: 'mcq',
            points: normalizedQuestionScoring.mcq,
            choices,
            correct_answer: correctAnswer,
        };
    }

    if (newType === 'tf') {
        const choiceLetters = (question.choices?.length ? question.choices.map((_, index) => DEFAULT_TF_CHOICES[index] || String(index + 1)) : DEFAULT_TF_CHOICES);
        const choices = mapChoices(question.choices || [], choiceLetters);
        const totalItems = choices.length;
        const currentAnswer = typeof question.correct_answer === 'string' ? question.correct_answer : '';
        const paddedAnswer = currentAnswer.padEnd(totalItems, 'S').slice(0, totalItems).replace(/[^DS]/g, 'S');
        return {
            type: 'tf',
            points: normalizedTfScoring.tf_4_4,
            choices,
            correct_answer: paddedAnswer || 'SSSS',
        };
    }

    if (newType === 'short_answer') {
        return {
            type: 'short_answer',
            points: normalizedQuestionScoring.short_answer,
            choices: [],
            correct_answer: typeof question.correct_answer === 'string' ? question.correct_answer : '',
        };
    }

    if (newType === 'essay') {
        return {
            type: 'essay',
            points: normalizedQuestionScoring.essay,
            choices: [],
            correct_answer: typeof question.correct_answer === 'string' ? question.correct_answer : '',
        };
    }

    return { type: newType };
}

export function isQuestionAnswered(question = {}, answer) {
    if (question.type === 'tf') {
        const totalItems = (question.choices || []).length || 4;
        return Array.isArray(answer) && answer.slice(0, totalItems).every((value) => value === 'D' || value === 'S');
    }
    if (question.type === 'short_answer') {
        return normalizeTextAnswer(answer).length > 0;
    }
    if (question.type === 'essay') {
        const normalizedEssay = normalizeEssayAnswer(answer);
        return normalizedEssay.text.length > 0 || normalizedEssay.attachments.length > 0;
    }
    return typeof answer === 'number';
}

export function evaluateTfAnswer(question = {}, tfItemAnswers = [], tfScoring = DEFAULT_TF_SCORING, questionScoring = DEFAULT_QUESTION_SCORING) {
    const normalizedTfScoring = normalizeTfScoring(tfScoring);
    const correctAnswer = String(question.correct_answer || '');
    const totalItems = correctAnswer.length || ((question.choices || []).length || 4);
    let correctItems = 0;

    for (let index = 0; index < totalItems; index += 1) {
        if (tfItemAnswers[index] === correctAnswer[index]) correctItems += 1;
    }

    const presetKey = `tf_${correctItems}_${totalItems}`;
    const presetEarned = correctItems === 0 ? 0 : Number(normalizedTfScoring[presetKey] ?? 0);
    const maxPoints = getQuestionMaxPoints(question, questionScoring, normalizedTfScoring);
    const baseMax = Math.max(normalizedTfScoring.tf_4_4, 0.0001);
    const earnedPoints = Number(((presetEarned / baseMax) * maxPoints).toFixed(4));

    return {
        correctItems,
        totalItems,
        maxPoints,
        earnedPoints,
        isCorrect: correctItems === totalItems,
    };
}

export function evaluateQuestionAnswer(question = {}, answer, examSettings = {}) {
    const questionScoring = normalizeQuestionScoring(examSettings.questionScoring);
    const tfScoring = normalizeTfScoring(examSettings.tfScoring);
    const maxPoints = getQuestionMaxPoints(question, questionScoring, tfScoring);

    if (question.type === 'tf') {
        const tfItemAnswers = Array.isArray(answer) ? answer : [];
        const tfResult = evaluateTfAnswer(question, tfItemAnswers, tfScoring, questionScoring);
        return {
            type: 'tf',
            tfItemAnswers,
            tfCorrectItems: tfResult.correctItems,
            totalItems: tfResult.totalItems,
            earnedPoints: tfResult.earnedPoints,
            maxPoints: tfResult.maxPoints,
            isCorrect: tfResult.isCorrect,
        };
    }

    if (question.type === 'short_answer') {
        const textAnswer = normalizeTextAnswer(answer);
        const normalizedCorrectAnswer = normalizeTextAnswer(question.correct_answer).toLowerCase();
        const isCorrect = textAnswer.length > 0 && normalizedCorrectAnswer.length > 0 && textAnswer.toLowerCase() === normalizedCorrectAnswer;
        return {
            type: 'short_answer',
            textAnswer,
            earnedPoints: isCorrect ? maxPoints : 0,
            maxPoints,
            isCorrect,
        };
    }

    if (question.type === 'essay') {
        const normalizedEssay = normalizeEssayAnswer(answer);
        return {
            type: 'essay',
            textAnswer: normalizedEssay.text,
            attachments: normalizedEssay.attachments,
            earnedPoints: 0,
            maxPoints,
            isCorrect: null,
            manualReviewPending: true,
        };
    }

    const selected = typeof answer === 'number' ? answer : null;
    const correctIdx = (question.choices || []).findIndex((choice) => choice.isCorrect || (question.correct_answer && choice.letter === question.correct_answer));
    const selectedChoice = selected !== null ? question.choices?.[selected] : null;
    const correctChoice = correctIdx >= 0 ? question.choices?.[correctIdx] : null;
    const selectedOriginLetter = selectedChoice ? (selectedChoice.originLetter || selectedChoice.letter || null) : null;
    const correctOriginLetter = correctChoice ? (correctChoice.originLetter || correctChoice.letter || null) : null;
    const isCorrect = Boolean(selectedOriginLetter && correctOriginLetter && selectedOriginLetter === correctOriginLetter);

    return {
        type: 'mcq',
        selected,
        selectedOriginLetter,
        correctIdx,
        correctOriginLetter,
        earnedPoints: isCorrect ? maxPoints : 0,
        maxPoints,
        isCorrect,
    };
}