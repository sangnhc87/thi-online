import React, { useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import {
    AI_PROVIDER_CATALOG,
    clearAISettings,
    estimateRequestCostVnd,
    getActiveAIProvider,
    getProviderBudgetStatus,
    loadAISettings,
    loadAIUsage,
    loadOcrKeys,
    maskApiKey,
    normalizeAISettings,
    saveAISettings,
    saveOcrKeys,
    validateApiKeyFormat,
    validateMistralOcrKey,
} from '../utils/aiSettings';

export default function AISettingsPanel({ userId, heading = 'AI BYOK', description = 'API key được giữ cục bộ trong trình duyệt hiện tại, không đẩy lên Firestore.' }) {
    const [settings, setSettings] = useState(() => normalizeAISettings({}));
    const [usage, setUsage] = useState(() => loadAIUsage(userId));
    const [saving, setSaving] = useState(false);
    const [revealKeys, setRevealKeys] = useState({});
    const [ocrKeys, setOcrKeys] = useState(() => loadOcrKeys(userId));
    const [revealMistral, setRevealMistral] = useState(false);
    const [savingOcr, setSavingOcr] = useState(false);

    useEffect(() => {
        setSettings(loadAISettings(userId));
        setUsage(loadAIUsage(userId));
        setOcrKeys(loadOcrKeys(userId));
    }, [userId]);

    const activeProvider = useMemo(() => getActiveAIProvider(settings), [settings]);

    const updateProvider = (providerId, nextPatch) => {
        setSettings((previous) => normalizeAISettings({
            ...previous,
            providers: {
                ...previous.providers,
                [providerId]: {
                    ...previous.providers[providerId],
                    ...nextPatch,
                },
            },
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const enabledProviders = Object.entries(settings.providers).filter(([, provider]) => provider.enabled);
            for (const [providerId, provider] of enabledProviders) {
                const validation = validateApiKeyFormat(providerId, provider.apiKey);
                if (!validation.valid) {
                    Swal.fire('API key chưa hợp lệ', `${AI_PROVIDER_CATALOG[providerId].label}: ${validation.message}`, 'warning');
                    setSaving(false);
                    return;
                }
            }

            const saved = saveAISettings(userId, settings);
            setSettings(saved);
            setUsage(loadAIUsage(userId));
            Swal.fire({
                icon: 'success',
                title: 'Đã lưu cấu hình AI',
                text: 'Các key chỉ nằm trong trình duyệt hiện tại của bạn.',
                timer: 1600,
                showConfirmButton: false,
            });
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        const result = await Swal.fire({
            title: 'Xóa toàn bộ cấu hình AI?',
            text: 'Key và usage estimate cục bộ trên trình duyệt này sẽ bị xóa.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Xóa cấu hình',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#ef4444',
        });
        if (!result.isConfirmed) return;
        clearAISettings(userId);
        setSettings(loadAISettings(userId));
        setUsage(loadAIUsage(userId));
        Swal.fire({ icon: 'success', title: 'Đã xóa cấu hình AI', timer: 1500, showConfirmButton: false });
    };

    const handleSaveOcrKey = async () => {
        setSavingOcr(true);
        try {
            const validation = validateMistralOcrKey(ocrKeys.mistral);
            if (ocrKeys.mistral && !validation.valid) {
                Swal.fire('Key chưa hợp lệ', validation.message, 'warning');
                return;
            }
            saveOcrKeys(userId, ocrKeys);
            Swal.fire({ icon: 'success', title: 'Đã lưu Mistral OCR key', timer: 1400, showConfirmButton: false });
        } finally {
            setSavingOcr(false);
        }
    };

    const handleValidateProvider = (providerId) => {
        const provider = settings.providers[providerId];
        const validation = validateApiKeyFormat(providerId, provider.apiKey);
        Swal.fire({
            icon: validation.valid ? 'success' : 'warning',
            title: AI_PROVIDER_CATALOG[providerId].label,
            text: validation.message,
        });
    };

    return (
        <div className="card ai-settings-card">
            <div className="card-header">
                <div>
                    <h3><i className="bi bi-cpu"></i> {heading}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>{description}</p>
                </div>
                <div className="ai-settings-summary">
                    <span className={`stat-badge ${activeProvider ? 'active' : 'muted'}`}>
                        {activeProvider ? `Đang ưu tiên ${AI_PROVIDER_CATALOG[activeProvider.providerId].label}` : 'Chưa bật provider nào'}
                    </span>
                </div>
            </div>

            <div className="card-body" style={{ display: 'grid', gap: 18 }}>
                <div className="alert alert-info" style={{ marginBottom: 0 }}>
                    <i className="bi bi-shield-lock"></i> API key chỉ lưu trong localStorage của trình duyệt hiện tại. Nếu đổi máy hoặc xóa dữ liệu trình duyệt, bạn sẽ phải nhập lại key.
                </div>

                <div className="ai-global-grid">
                    <div>
                        <label className="form-label">Provider mặc định</label>
                        <select className="form-select" value={settings.activeProvider} onChange={(event) => setSettings((previous) => normalizeAISettings({ ...previous, activeProvider: event.target.value }))}>
                            {Object.values(AI_PROVIDER_CATALOG).map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">Trần chi phí / tháng (VND)</label>
                        <input className="form-input" type="number" min={0} value={settings.monthlyBudgetVnd} onChange={(event) => setSettings((previous) => normalizeAISettings({ ...previous, monthlyBudgetVnd: Number(event.target.value) }))} />
                    </div>
                    <div>
                        <label className="form-label">Giới hạn lượt gọi / ngày</label>
                        <input className="form-input" type="number" min={1} value={settings.dailyRequestLimit} onChange={(event) => setSettings((previous) => normalizeAISettings({ ...previous, dailyRequestLimit: Number(event.target.value) }))} />
                    </div>
                    <div>
                        <label className="form-label">Độ dài prompt tối đa</label>
                        <input className="form-input" type="number" min={500} value={settings.promptMaxChars} onChange={(event) => setSettings((previous) => normalizeAISettings({ ...previous, promptMaxChars: Number(event.target.value) }))} />
                    </div>
                </div>

                <div className="ai-usage-strip">
                    <span className="stat-badge muted"><i className="bi bi-calendar-day"></i> Hôm nay: {usage.currentDay.requests || 0} lượt</span>
                    <span className="stat-badge muted"><i className="bi bi-calendar3"></i> Tháng này: {usage.currentMonth.requests || 0} lượt</span>
                    <span className="stat-badge warm"><i className="bi bi-cash-stack"></i> Ước tính tháng: {(usage.currentMonth.estimatedCostVnd || 0).toLocaleString('vi-VN')} đ</span>
                </div>

                <div className="ai-provider-grid">
                    {Object.values(AI_PROVIDER_CATALOG).map((provider) => {
                        const providerSettings = settings.providers[provider.id];
                        const budgetStatus = getProviderBudgetStatus(settings, usage, provider.id);
                        const estimatedCost = estimateRequestCostVnd(provider.id, providerSettings.model);
                        const validation = validateApiKeyFormat(provider.id, providerSettings.apiKey);
                        return (
                            <div key={provider.id} className={`ai-provider-card${providerSettings.enabled ? ' enabled' : ''}`}>
                                <div className="ai-provider-head">
                                    <div>
                                        <div className="ai-provider-title">{provider.label}</div>
                                        <div className="ai-provider-subtitle">{provider.vendor}</div>
                                    </div>
                                    <label className="ai-switch">
                                        <input type="checkbox" checked={providerSettings.enabled} onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })} />
                                        <span>Bật</span>
                                    </label>
                                </div>

                                <div className="ai-provider-fields">
                                    <div>
                                        <label className="form-label">Model</label>
                                        <select className="form-select" value={providerSettings.model} onChange={(event) => updateProvider(provider.id, { model: event.target.value })}>
                                            {provider.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                                        </select>
                                        <div className="ai-helper-text">{provider.models.find((item) => item.id === providerSettings.model)?.costHint}</div>
                                    </div>

                                    <div>
                                        <label className="form-label">API key</label>
                                        <div className="ai-secret-row">
                                            <input
                                                className="form-input"
                                                type={revealKeys[provider.id] ? 'text' : 'password'}
                                                value={providerSettings.apiKey}
                                                placeholder={provider.keyPlaceholder}
                                                onChange={(event) => updateProvider(provider.id, { apiKey: event.target.value })}
                                            />
                                            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRevealKeys((previous) => ({ ...previous, [provider.id]: !previous[provider.id] }))}>
                                                <i className={`bi bi-${revealKeys[provider.id] ? 'eye-slash' : 'eye'}`}></i>
                                            </button>
                                        </div>
                                        <div className="ai-helper-text">{providerSettings.apiKey ? `Đang lưu cục bộ: ${maskApiKey(providerSettings.apiKey)}` : 'Chưa cấu hình key'}</div>
                                    </div>

                                    <div>
                                        <label className="form-label">Trần chi phí riêng / tháng (VND)</label>
                                        <input className="form-input" type="number" min={0} value={providerSettings.monthlyLimitVnd} onChange={(event) => updateProvider(provider.id, { monthlyLimitVnd: Number(event.target.value) })} />
                                    </div>
                                </div>

                                <div className="ai-provider-footer">
                                    <span className={`stat-badge ${validation.valid ? 'active' : 'warning'}`}>{validation.valid ? 'Key format ổn' : validation.message}</span>
                                    <span className={`stat-badge ${budgetStatus.overBudget ? 'expired' : 'muted'}`}>Đã dùng: {budgetStatus.used.toLocaleString('vi-VN')} / {budgetStatus.monthlyLimit.toLocaleString('vi-VN')} đ</span>
                                    <span className="stat-badge info">Ước tính mỗi lần: ~{estimatedCost.toLocaleString('vi-VN')} đ</span>
                                    <button type="button" className="btn btn-outline btn-sm" onClick={() => handleValidateProvider(provider.id)}>
                                        <i className="bi bi-patch-check"></i> Kiểm tra format
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="ai-actions-row">
                    <button className="btn btn-outline" onClick={handleReset}><i className="bi bi-trash3"></i> Xóa cấu hình cục bộ</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}><i className="bi bi-save"></i> {saving ? 'Đang lưu...' : 'Lưu cấu hình AI'}</button>
                </div>

                {/* Mistral OCR — separate OCR key for PDF scanning */}
                <div className="ai-ocr-section">
                    <div className="ai-ocr-header">
                        <div>
                            <h4><i className="bi bi-file-earmark-pdf"></i> Mistral OCR — Nhận dạng PDF</h4>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', margin: 0 }}>
                                Key riêng dùng để quét chữ trong file PDF đề thi. Miễn phí 1.000 trang/tháng — tự nhập key của bạn tại
                                {' '}<a href="https://console.mistral.ai" target="_blank" rel="noopener noreferrer">console.mistral.ai</a>
                            </p>
                        </div>
                        <span className={`stat-badge ${validateMistralOcrKey(ocrKeys.mistral).valid ? 'active' : 'muted'}`}>
                            {validateMistralOcrKey(ocrKeys.mistral).valid ? 'Key đã cấu hình' : 'Chưa có key'}
                        </span>
                    </div>
                    <div className="ai-ocr-fields">
                        <div className="ai-secret-row">
                            <input
                                className="form-input"
                                type={revealMistral ? 'text' : 'password'}
                                value={ocrKeys.mistral}
                                placeholder="Nhập Mistral API key..."
                                onChange={(e) => setOcrKeys((prev) => ({ ...prev, mistral: e.target.value }))}
                            />
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRevealMistral((v) => !v)}>
                                <i className={`bi bi-${revealMistral ? 'eye-slash' : 'eye'}`}></i>
                            </button>
                            <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveOcrKey} disabled={savingOcr}>
                                <i className="bi bi-save"></i> {savingOcr ? '...' : 'Lưu'}
                            </button>
                        </div>
                        <div className="ai-helper-text">
                            {ocrKeys.mistral
                                ? `Đang lưu cục bộ: ${maskApiKey(ocrKeys.mistral)} — dùng cho chức năng Import từ PDF`
                                : 'Nếu không có key Mistral, bạn vẫn có thể dùng Gemini để đọc PDF trực tiếp (cần key Gemini).'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}