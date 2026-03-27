// Date & time formatters for Vietnamese locale

export function formatDate(timestamp) {
    if (!timestamp) return '—';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(timestamp) {
    if (!timestamp) return '—';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleDateString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
    return formatDate(timestamp);
}

export function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDurationLong(seconds) {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s} giây`;
    if (s === 0) return `${m} phút`;
    return `${m} phút ${s} giây`;
}

export function formatPercent(value, total) {
    if (!total) return '0%';
    return `${Math.round((value / total) * 100)}%`;
}

export function formatScore(score, total) {
    if (total === undefined) return String(score ?? 0);
    return `${score ?? 0}/${total}`;
}

export function getScoreColor(score, total) {
    if (!total) return 'muted';
    const pct = (score / total) * 100;
    if (pct >= 80) return 'success';
    if (pct >= 60) return 'primary';
    if (pct >= 40) return 'warning';
    return 'danger';
}

export function getScoreEmoji(score, total) {
    if (!total) return '';
    const pct = (score / total) * 100;
    if (pct === 100) return '🏆';
    if (pct >= 90) return '🌟';
    if (pct >= 80) return '🔥';
    if (pct >= 60) return '👍';
    if (pct >= 40) return '💪';
    return '📚';
}

export function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
