const PRESENTATION_SYNC_PREFIX = 'thi-online:presentation-sync';

export const PRESENTATION_ROLE_STANDALONE = 'standalone';
export const PRESENTATION_ROLE_PRESENTER = 'presenter';
export const PRESENTATION_ROLE_PROJECTOR = 'projector';

export function normalizePresentationRole(value) {
    if (value === PRESENTATION_ROLE_PRESENTER) return PRESENTATION_ROLE_PRESENTER;
    if (value === PRESENTATION_ROLE_PROJECTOR) return PRESENTATION_ROLE_PROJECTOR;
    return PRESENTATION_ROLE_STANDALONE;
}

export function buildPresentationSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getPresentationSyncChannelName(sessionId) {
    return `${PRESENTATION_SYNC_PREFIX}:${sessionId}`;
}

export function openPresentationSyncChannel(sessionId) {
    if (!sessionId || typeof BroadcastChannel === 'undefined') return null;
    return new BroadcastChannel(getPresentationSyncChannelName(sessionId));
}

export function getPresentationSnapshotStorageKey(sessionId) {
    return `${PRESENTATION_SYNC_PREFIX}:snapshot:${sessionId}`;
}

export function loadPresentationSnapshot(sessionId) {
    if (!sessionId || typeof window === 'undefined' || !window.localStorage) return null;

    try {
        const raw = window.localStorage.getItem(getPresentationSnapshotStorageKey(sessionId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function savePresentationSnapshot(sessionId, snapshot) {
    if (!sessionId || typeof window === 'undefined' || !window.localStorage) return;

    try {
        window.localStorage.setItem(getPresentationSnapshotStorageKey(sessionId), JSON.stringify(snapshot));
    } catch {
        // Ignore storage failures in locked-down browsers.
    }
}