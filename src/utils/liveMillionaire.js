const BASE_PRIZE_AMOUNTS = [
    200000,
    400000,
    600000,
    1000000,
    2000000,
    3000000,
    6000000,
    10000000,
    14000000,
    22000000,
    30000000,
    40000000,
    60000000,
    85000000,
    150000000,
];

function roundPrize(amount) {
    if (amount >= 1000000) {
        return Math.round(amount / 1000000) * 1000000;
    }
    return Math.round(amount / 100000) * 100000;
}

function getPrizeAmounts(questionCount) {
    const safeCount = Math.max(0, Number(questionCount) || 0);
    if (safeCount === 0) return [];

    const nextAmounts = BASE_PRIZE_AMOUNTS.slice(0, safeCount);
    while (nextAmounts.length < safeCount) {
        const lastAmount = nextAmounts[nextAmounts.length - 1] || BASE_PRIZE_AMOUNTS[BASE_PRIZE_AMOUNTS.length - 1];
        nextAmounts.push(roundPrize(lastAmount * 1.35));
    }

    return nextAmounts;
}

function getCheckpointLevels(questionCount) {
    const safeCount = Math.max(0, Number(questionCount) || 0);
    if (safeCount < 3) return [];

    const levels = new Set();
    if (safeCount >= 5) levels.add(Math.ceil(safeCount / 3));
    if (safeCount >= 8) levels.add(Math.ceil((safeCount * 2) / 3));

    return [...levels]
        .filter((level) => level > 0 && level < safeCount)
        .sort((left, right) => left - right);
}

export function formatMillionairePrize(amount = 0) {
    return `${Number(amount || 0).toLocaleString('vi-VN')} đ`;
}

export function buildMillionaireLadder(questionCount = 0) {
    const amounts = getPrizeAmounts(questionCount);
    const checkpointLevels = getCheckpointLevels(questionCount);

    return amounts.map((amount, index) => ({
        level: index + 1,
        amount,
        label: formatMillionairePrize(amount),
        isCheckpoint: checkpointLevels.includes(index + 1),
    }));
}

export function isLiveAnswerCorrect(question = {}, answerPayload = null) {
    const answer = typeof answerPayload === 'object' && answerPayload !== null && 'answer' in answerPayload
        ? answerPayload.answer
        : answerPayload;

    if (question.type === 'mcq' || question.type === 'tf') {
        return answer === question.correct_answer;
    }

    if (question.type === 'short_answer') {
        return String(answer || '').trim().toLowerCase() === String(question.correct_answer || '').trim().toLowerCase();
    }

    return false;
}

export function buildAudiencePoll(question = {}, answerMap = {}) {
    const choices = question.choices || [];
    if (!choices.length) return null;

    const letters = choices.map((choice) => choice.letter);
    const counts = Object.fromEntries(letters.map((letter) => [letter, 0]));

    Object.values(answerMap || {}).forEach((payload) => {
        const answer = typeof payload === 'object' && payload !== null ? payload.answer : payload;
        if (letters.includes(answer)) counts[answer] += 1;
    });

    const totalVotes = Object.values(counts).reduce((sum, value) => sum + value, 0);
    let distribution = {};

    if (totalVotes > 0) {
        let used = 0;
        letters.forEach((letter, index) => {
            if (index === letters.length - 1) {
                distribution[letter] = Math.max(0, 100 - used);
                return;
            }
            const pct = Math.round((counts[letter] / totalVotes) * 100);
            distribution[letter] = pct;
            used += pct;
        });
    } else {
        const correctLetter = question.correct_answer;
        const wrongLetters = letters.filter((letter) => letter !== correctLetter);
        let remaining = 100;
        distribution = {};

        if (correctLetter && letters.includes(correctLetter)) {
            const correctShare = 48 + Math.floor(Math.random() * 24);
            distribution[correctLetter] = correctShare;
            remaining -= correctShare;
        }

        wrongLetters.forEach((letter, index) => {
            if (index === wrongLetters.length - 1) {
                distribution[letter] = Math.max(0, remaining);
                return;
            }
            const slotsLeft = wrongLetters.length - index;
            const maxShare = Math.max(6, Math.floor(remaining / slotsLeft) + 6);
            const share = Math.min(remaining, 6 + Math.floor(Math.random() * maxShare));
            distribution[letter] = share;
            remaining -= share;
        });

        letters.forEach((letter) => {
            if (distribution[letter] === undefined) distribution[letter] = 0;
        });
    }

    const winner = letters.reduce((best, letter) => (
        !best || distribution[letter] > distribution[best] ? letter : best
    ), letters[0] || null);

    return {
        distribution,
        winner,
        totalVotes,
        source: totalVotes > 0 ? 'live' : 'simulated',
    };
}

export function buildExpertHint(question = {}, audiencePoll = null) {
    const choices = question.choices || [];
    const recommended = question.correct_answer || choices[0]?.letter || null;
    if (!recommended) return null;

    const choiceText = choices.find((choice) => choice.letter === recommended)?.text || recommended;
    const audienceWinner = audiencePoll?.winner;
    const confidence = audienceWinner === recommended ? 92 : audiencePoll ? 78 : 84;

    const confText = confidence >= 90 ? 'rất cao' : confidence >= 80 ? 'khá cao' : 'trung bình';
    return {
        recommended,
        confidence,
        message: `Chuyên gia nghiêng về đáp án ${recommended} — "${choiceText}" (độ tin cậy ${confText})`,
    };
}

// Streak bonus for classic and speed modes
export function calcStreakBonus(streak = 0) {
    if (streak >= 5) return 100;
    if (streak >= 4) return 75;
    if (streak >= 3) return 50;
    return 0;
}

export function sortLiveLeaderboard(entries = [], mode = 'classic') {
    const normalized = [...entries];

    return normalized.sort((left, right) => {
        if (mode === 'millionaire') {
            if ((right.level || 0) !== (left.level || 0)) return (right.level || 0) - (left.level || 0);
            if ((right.score || 0) !== (left.score || 0)) return (right.score || 0) - (left.score || 0);
            if (Boolean(left.eliminated) !== Boolean(right.eliminated)) return Number(left.eliminated) - Number(right.eliminated);
            return (left.lastCorrectAtMs || Number.MAX_SAFE_INTEGER) - (right.lastCorrectAtMs || Number.MAX_SAFE_INTEGER);
        }

        if ((right.score || 0) !== (left.score || 0)) return (right.score || 0) - (left.score || 0);
        if ((right.correct || 0) !== (left.correct || 0)) return (right.correct || 0) - (left.correct || 0);
        return (right.streak || 0) - (left.streak || 0);
    });
}