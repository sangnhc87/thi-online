const AI_SETTINGS_PREFIX = 'thi-online-ai-settings';
const AI_USAGE_PREFIX = 'thi-online-ai-usage';
const OCR_KEYS_PREFIX = 'thi-online-ocr-keys';

export const AI_PROVIDER_CATALOG = {
    gemini: {
        id: 'gemini',
        label: 'Gemini',
        vendor: 'Google',
        keyPlaceholder: 'AIza...',
        models: [
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', costHint: 'Rẻ, nhanh, phù hợp soạn đề' },
            { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', costHint: 'Mạnh hơn, nên dùng có kiểm soát' },
        ],
    },
    groq: {
        id: 'groq',
        label: 'Groq',
        vendor: 'Groq',
        keyPlaceholder: 'gsk_...',
        models: [
            { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', costHint: 'Nhanh, hợp brainstorm và sinh nháp' },
            { id: 'qwen-qwq-32b', label: 'Qwen QwQ 32B', costHint: 'Suy luận ổn, chi phí vừa' },
        ],
    },
    deepseek: {
        id: 'deepseek',
        label: 'DeepSeek',
        vendor: 'DeepSeek',
        keyPlaceholder: 'sk-...',
        models: [
            { id: 'deepseek-chat', label: 'DeepSeek Chat', costHint: 'Rẻ, hợp tạo câu hỏi hàng loạt' },
            { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', costHint: 'Mạnh hơn, nên có trần usage' },
        ],
    },
};

export const DEFAULT_AI_SETTINGS = {
    activeProvider: 'gemini',
    dailyRequestLimit: 25,
    monthlyBudgetVnd: 50000,
    promptMaxChars: 12000,
    providers: {
        gemini: { enabled: false, model: 'gemini-2.5-flash', apiKey: '', monthlyLimitVnd: 20000 },
        groq: { enabled: false, model: 'llama-3.3-70b-versatile', apiKey: '', monthlyLimitVnd: 15000 },
        deepseek: { enabled: false, model: 'deepseek-chat', apiKey: '', monthlyLimitVnd: 15000 },
    },
};

const MODEL_COST_HINT_VND = {
    'gemini-2.5-flash': 120,
    'gemini-2.5-pro': 550,
    'llama-3.3-70b-versatile': 90,
    'qwen-qwq-32b': 130,
    'deepseek-chat': 80,
    'deepseek-reasoner': 240,
};

function storageAvailable() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getSettingsStorageKey(userId) {
    return `${AI_SETTINGS_PREFIX}:${userId || 'anonymous'}`;
}

function getUsageStorageKey(userId) {
    return `${AI_USAGE_PREFIX}:${userId || 'anonymous'}`;
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeProviderSettings(providerId, providerSettings = {}) {
    const defaultProvider = DEFAULT_AI_SETTINGS.providers[providerId];
    return {
        enabled: Boolean(providerSettings.enabled),
        model: providerSettings.model || defaultProvider.model,
        apiKey: providerSettings.apiKey || '',
        monthlyLimitVnd: clampNumber(providerSettings.monthlyLimitVnd, 0, 5000000, defaultProvider.monthlyLimitVnd),
    };
}

export function normalizeAISettings(settings = {}) {
    const activeProvider = AI_PROVIDER_CATALOG[settings.activeProvider] ? settings.activeProvider : DEFAULT_AI_SETTINGS.activeProvider;
    return {
        activeProvider,
        dailyRequestLimit: clampNumber(settings.dailyRequestLimit, 1, 1000, DEFAULT_AI_SETTINGS.dailyRequestLimit),
        monthlyBudgetVnd: clampNumber(settings.monthlyBudgetVnd, 0, 10000000, DEFAULT_AI_SETTINGS.monthlyBudgetVnd),
        promptMaxChars: clampNumber(settings.promptMaxChars, 500, 50000, DEFAULT_AI_SETTINGS.promptMaxChars),
        providers: Object.fromEntries(
            Object.keys(AI_PROVIDER_CATALOG).map((providerId) => [providerId, normalizeProviderSettings(providerId, settings.providers?.[providerId] || {})]),
        ),
    };
}

export function loadAISettings(userId) {
    if (!storageAvailable()) return normalizeAISettings(DEFAULT_AI_SETTINGS);
    try {
        const raw = window.localStorage.getItem(getSettingsStorageKey(userId));
        if (!raw) return normalizeAISettings(DEFAULT_AI_SETTINGS);
        return normalizeAISettings(JSON.parse(raw));
    } catch {
        return normalizeAISettings(DEFAULT_AI_SETTINGS);
    }
}

export function saveAISettings(userId, settings) {
    const normalized = normalizeAISettings(settings);
    if (storageAvailable()) {
        window.localStorage.setItem(getSettingsStorageKey(userId), JSON.stringify(normalized));
    }
    return normalized;
}

export function clearAISettings(userId) {
    if (storageAvailable()) {
        window.localStorage.removeItem(getSettingsStorageKey(userId));
        window.localStorage.removeItem(getUsageStorageKey(userId));
    }
}

export function maskApiKey(value = '') {
    if (!value) return 'Chưa cấu hình';
    if (value.length <= 8) return '••••••••';
    return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

export function validateApiKeyFormat(providerId, apiKey = '') {
    const trimmed = String(apiKey || '').trim();
    if (!trimmed) return { valid: false, message: 'Chưa nhập API key' };

    if (providerId === 'gemini') {
        return /^AIza[0-9A-Za-z\-_]{20,}$/.test(trimmed)
            ? { valid: true, message: 'Format key Gemini hợp lệ' }
            : { valid: false, message: 'Key Gemini thường bắt đầu bằng AIza...' };
    }

    if (providerId === 'groq') {
        return /^gsk_[0-9A-Za-z]{20,}$/.test(trimmed)
            ? { valid: true, message: 'Format key Groq hợp lệ' }
            : { valid: false, message: 'Key Groq thường bắt đầu bằng gsk_' };
    }

    if (providerId === 'deepseek') {
        return /^sk-[0-9A-Za-z]{16,}$/.test(trimmed)
            ? { valid: true, message: 'Format key DeepSeek hợp lệ' }
            : { valid: false, message: 'Key DeepSeek thường bắt đầu bằng sk-' };
    }

    return { valid: false, message: 'Provider không hợp lệ' };
}

function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

function getCurrentDayKey() {
    return new Date().toISOString().slice(0, 10);
}

export function loadAIUsage(userId) {
    if (!storageAvailable()) {
        return { currentMonth: { requests: 0, estimatedCostVnd: 0 }, currentDay: { requests: 0, estimatedCostVnd: 0 } };
    }
    try {
        const raw = window.localStorage.getItem(getUsageStorageKey(userId));
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            currentMonth: parsed[getCurrentMonthKey()] || { requests: 0, estimatedCostVnd: 0 },
            currentDay: parsed[getCurrentDayKey()] || { requests: 0, estimatedCostVnd: 0 },
        };
    } catch {
        return { currentMonth: { requests: 0, estimatedCostVnd: 0 }, currentDay: { requests: 0, estimatedCostVnd: 0 } };
    }
}

export function recordAIUsage(userId, providerId, estimatedCostVnd = 0) {
    if (!storageAvailable()) return loadAIUsage(userId);

    const key = getUsageStorageKey(userId);
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    const monthKey = getCurrentMonthKey();
    const dayKey = getCurrentDayKey();

    parsed[monthKey] = parsed[monthKey] || { requests: 0, estimatedCostVnd: 0, providerBreakdown: {} };
    parsed[dayKey] = parsed[dayKey] || { requests: 0, estimatedCostVnd: 0, providerBreakdown: {} };

    [monthKey, dayKey].forEach((bucketKey) => {
        parsed[bucketKey].requests += 1;
        parsed[bucketKey].estimatedCostVnd += estimatedCostVnd;
        parsed[bucketKey].providerBreakdown[providerId] = parsed[bucketKey].providerBreakdown[providerId] || { requests: 0, estimatedCostVnd: 0 };
        parsed[bucketKey].providerBreakdown[providerId].requests += 1;
        parsed[bucketKey].providerBreakdown[providerId].estimatedCostVnd += estimatedCostVnd;
    });

    window.localStorage.setItem(key, JSON.stringify(parsed));
    return loadAIUsage(userId);
}

export function estimateRequestCostVnd(providerId, modelId) {
    return MODEL_COST_HINT_VND[modelId] || MODEL_COST_HINT_VND[DEFAULT_AI_SETTINGS.providers[providerId]?.model] || 100;
}

export function getProviderBudgetStatus(settings = DEFAULT_AI_SETTINGS, usage = null, providerId = 'gemini') {
    const normalized = normalizeAISettings(settings);
    const currentUsage = usage || { currentMonth: { requests: 0, estimatedCostVnd: 0 }, currentDay: { requests: 0, estimatedCostVnd: 0 } };
    const provider = normalized.providers[providerId];
    const monthlyLimit = provider.monthlyLimitVnd || 0;
    const used = currentUsage.currentMonth?.providerBreakdown?.[providerId]?.estimatedCostVnd || 0;
    const remaining = Math.max(0, monthlyLimit - used);
    return {
        used,
        monthlyLimit,
        remaining,
        overBudget: monthlyLimit > 0 && used >= monthlyLimit,
    };
}

export function getActiveAIProvider(settings = DEFAULT_AI_SETTINGS) {
    const normalized = normalizeAISettings(settings);
    const provider = normalized.providers[normalized.activeProvider];
    if (!provider?.enabled || !provider.apiKey) return null;
    return {
        providerId: normalized.activeProvider,
        model: provider.model,
        apiKey: provider.apiKey,
    };
}

// ── OCR key storage (Mistral OCR — separate from LLM providers) ──────────────

function getOcrKeysStorageKey(userId) {
    return `${OCR_KEYS_PREFIX}:${userId || 'anonymous'}`;
}

export function loadOcrKeys(userId) {
    if (!storageAvailable()) return { mistral: '' };
    try {
        const raw = window.localStorage.getItem(getOcrKeysStorageKey(userId));
        return raw ? { mistral: '', ...JSON.parse(raw) } : { mistral: '' };
    } catch {
        return { mistral: '' };
    }
}

export function saveOcrKeys(userId, keys) {
    if (storageAvailable()) {
        window.localStorage.setItem(getOcrKeysStorageKey(userId), JSON.stringify(keys));
    }
}

export function validateMistralOcrKey(key) {
    const k = String(key || '').trim();
    if (!k) return { valid: false, message: 'Chưa nhập API key Mistral OCR' };
    if (k.length < 20) return { valid: false, message: 'Key quá ngắn — hãy kiểm tra lại' };
    return { valid: true, message: 'Format key ổn' };
}

/** Returns Gemini API key from provider settings if Gemini is configured (enabled or not) */
export function getGeminiApiKey(settings = DEFAULT_AI_SETTINGS) {
    const normalized = normalizeAISettings(settings);
    return normalized.providers?.gemini?.apiKey || '';
}

export function getGeminiModel(settings = DEFAULT_AI_SETTINGS) {
    const normalized = normalizeAISettings(settings);
    return normalized.providers?.gemini?.model || 'gemini-2.5-flash';
}