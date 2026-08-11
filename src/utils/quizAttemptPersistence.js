const QUIZ_ATTEMPT_PREFIX = 'thi-online-active-quiz';

function storageAvailable() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getAttemptStorageKey(userId, examId) {
    return `${QUIZ_ATTEMPT_PREFIX}:${userId}:${examId}`;
}

export function loadQuizAttemptState(userId, examId) {
    if (!storageAvailable() || !userId || !examId) return null;

    try {
        const raw = window.localStorage.getItem(getAttemptStorageKey(userId, examId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.userId !== userId || parsed?.examId !== examId) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function saveQuizAttemptState(userId, examId, payload) {
    if (!storageAvailable() || !userId || !examId) return null;

    const nextValue = {
        ...payload,
        userId,
        examId,
        savedAtMs: Date.now(),
    };
    window.localStorage.setItem(getAttemptStorageKey(userId, examId), JSON.stringify(nextValue));
    return nextValue;
}

export function markQuizAttemptReloadPending(userId, examId) {
    const current = loadQuizAttemptState(userId, examId);
    if (!current) return null;
    return saveQuizAttemptState(userId, examId, {
        ...current,
        pendingReloadViolation: true,
    });
}

export function clearQuizAttemptState(userId, examId) {
    if (!storageAvailable() || !userId || !examId) return;
    window.localStorage.removeItem(getAttemptStorageKey(userId, examId));
}
