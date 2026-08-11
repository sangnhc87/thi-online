export const DEFAULT_ANTI_CHEAT = {
    enabled: false,
    requireFullscreen: true,
    maxWarnings: 2,
};

export function normalizeAntiCheatSettings(input) {
    return {
        enabled: Boolean(input?.enabled),
        requireFullscreen: input?.requireFullscreen ?? DEFAULT_ANTI_CHEAT.requireFullscreen,
        maxWarnings: Math.max(1, Number(input?.maxWarnings || DEFAULT_ANTI_CHEAT.maxWarnings)),
    };
}