// Streak calculation utilities

import { getTodayKey } from './formatters';

export function calculateStreak(lastActiveDate, currentStreak) {
    if (!lastActiveDate) return 0;

    const today = getTodayKey();
    const yesterday = getYesterdayKey();

    if (lastActiveDate === today) return currentStreak || 1;
    if (lastActiveDate === yesterday) return (currentStreak || 0) + 1;
    return 1; // streak broken, restart at 1
}

export function isStreakActive(lastActiveDate) {
    if (!lastActiveDate) return false;
    const today = getTodayKey();
    const yesterday = getYesterdayKey();
    return lastActiveDate === today || lastActiveDate === yesterday;
}

export function getStreakLevel(streak) {
    if (streak >= 30) return { level: 'legendary', label: 'Bất Diệt', color: '#f59e0b', glow: true };
    if (streak >= 14) return { level: 'epic', label: 'Bão Lửa', color: '#ef4444', glow: true };
    if (streak >= 7) return { level: 'hot', label: 'Ngọn Lửa', color: '#f97316', glow: false };
    if (streak >= 3) return { level: 'warm', label: 'Lửa Nhỏ', color: '#fb923c', glow: false };
    if (streak >= 1) return { level: 'start', label: 'Bắt đầu', color: '#a78bfa', glow: false };
    return { level: 'none', label: 'Chưa có', color: '#9ca3af', glow: false };
}

function getYesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Scoring: compute weighted score for leaderboard ranking
export function computeRankScore(sessions) {
    if (!sessions || sessions.length === 0) return 0;
    let totalWeighted = 0;
    let count = 0;
    for (const s of sessions) {
        if (s.total > 0) {
            const pct = s.score / s.total;
            // Weight recent quizzes more
            totalWeighted += pct * 100;
            count++;
        }
    }
    return count > 0 ? Math.round(totalWeighted / count) : 0;
}
