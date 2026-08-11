import { DEFAULT_QUESTION_SCORING, DEFAULT_TF_SCORING, evaluateQuestionAnswer, isQuestionAnswered } from './examScoring';

export const DEFAULT_GAMIFICATION = {
    mode: 'classic',
    liveLeaderboard: false,
    streakBonus: true,
    speedBonus: false,
    showQuestionNavigator: true,
    energyEffects: true,
    pointsPerCorrect: 100,
};

export function normalizeGamificationSettings(settings = {}) {
    const merged = {
        ...DEFAULT_GAMIFICATION,
        ...(settings || {}),
    };

    const mode = merged.mode === 'arcade' ? 'arcade' : 'classic';

    return {
        mode,
        liveLeaderboard: Boolean(merged.liveLeaderboard || mode === 'arcade'),
        streakBonus: merged.streakBonus !== false,
        speedBonus: Boolean(merged.speedBonus),
        showQuestionNavigator: merged.showQuestionNavigator !== false,
        energyEffects: merged.energyEffects !== false,
        pointsPerCorrect: clampNumber(merged.pointsPerCorrect, 50, 300, DEFAULT_GAMIFICATION.pointsPerCorrect),
    };
}

export function getGamificationPresetLabel(settings = {}) {
    const normalized = normalizeGamificationSettings(settings);
    return normalized.mode === 'arcade' ? 'Arcade / Live Quiz' : 'Classic Focus';
}

export function computeGameSummary({
    questions = [],
    answers = {},
    timeLeft = 0,
    durationMinutes = 0,
    settings = DEFAULT_GAMIFICATION,
    maxQuizStreak = 0,
}) {
    const normalized = normalizeGamificationSettings(settings);
    const answeredEntries = questions.map((question) => {
        const answer = answers[question.id];
        const evaluated = evaluateQuestionAnswer(question, answer, {
            questionScoring: DEFAULT_QUESTION_SCORING,
            tfScoring: DEFAULT_TF_SCORING,
        });
        return {
            questionId: question.id,
            answered: isQuestionAnswered(question, answer),
            isCorrect: Boolean(evaluated.isCorrect),
        };
    });

    const answeredCount = answeredEntries.filter((entry) => entry.answered).length;
    const correctCount = answeredEntries.filter((entry) => entry.isCorrect).length;
    const totalDurationSeconds = Math.max(1, Number(durationMinutes || 0) * 60);
    const timeFactor = Math.max(0, Math.min(1, timeLeft / totalDurationSeconds));

    const basePoints = correctCount * normalized.pointsPerCorrect;
    const streakBonusPoints = normalized.streakBonus ? Math.max(0, maxQuizStreak - 1) * 25 : 0;
    const speedBonusPoints = normalized.speedBonus ? Math.round(correctCount * 40 * timeFactor) : 0;

    return {
        answeredCount,
        correctCount,
        basePoints,
        streakBonusPoints,
        speedBonusPoints,
        totalGamePoints: basePoints + streakBonusPoints + speedBonusPoints,
    };
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}