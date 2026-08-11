/**
 * PdfImportLabPage.jsx — PDF → Đề thi Lab
 * Route: /teacher/pdf-import
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { loadOcrKeys, saveOcrKeys, loadAISettings, getGeminiApiKey, getGeminiModel } from '../utils/aiSettings';
import {
    parsePdfWithMistralOcr,
    extractQuestionsWithChat,
    parsePdfQuestionsWithGemini,
    parsePdfAiResponse,
} from '../utils/aiAuthoring';

const OCR_PROVIDERS = [
    { id: 'mistral', label: 'Mistral OCR', icon: '🟡', desc: '$2 / 1000 trang · PDF, ảnh, bảng, LaTeX', color: '#f59e0b' },
    { id: 'gemini', label: 'Gemini PDF trực tiếp', icon: '🔵', desc: 'Free tier · 1 bước', color: '#3b82f6' },
];

const CHAT_PROVIDERS = [
    { id: 'mistral', label: 'Mistral Chat', icon: '🟡', models: [
        { id: 'mistral-small-latest', label: 'Mistral Small (nhanh, rẻ)' },
        { id: 'mistral-medium-2505', label: 'Mistral Medium (cân bằng)' },
        { id: 'mistral-large-latest', label: 'Mistral Large (mạnh nhất)' },
    ]},
    { id: 'gemini', label: 'Gemini', icon: '🔵', models: [
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash ✦ (khuyên dùng)' },
        { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (tiết kiệm)' },
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (suy luận sâu)' },
    ]},
    { id: 'groq', label: 'Groq ⚡', icon: '⚡', models: [
        { id: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B (free tier)' },
        { id: 'llama3-70b-8192', label: 'LLaMA 3 70B' },
        { id: 'mixtral-8x7b-32768', label: 'Mixtral 8×7B' },
    ]},
    { id: 'deepseek', label: 'DeepSeek', icon: '🌊', models: [
        { id: 'deepseek-chat', label: 'DeepSeek Chat V3' },
        { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner R1' },
    ]},
];

const KEY_URLS = { groq: 'https://console.groq.com/keys', deepseek: 'https://platform.deepseek.com/api_keys', gemini: 'https://aistudio.google.com/app/apikey', mistral: 'https://console.mistral.ai/api-keys' };
const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Tự luận ngắn', essay: 'Tự luận' };
const TYPE_BG = { mcq: '#dbeafe', tf: '#fef3c7', short_answer: '#d1fae5', essay: '#f3e8ff' };
const TYPE_FG = { mcq: '#1e40af', tf: '#92400e', short_answer: '#065f46', essay: '#6b21a8' };
const STEPS = [
    { id: 'upload', label: 'Chọn PDF', icon: 'bi-file-earmark-arrow-up' },
    { id: 'ocr', label: 'OCR', icon: 'bi-eye' },
    { id: 'parse', label: 'AI Parse', icon: 'bi-cpu' },
    { id: 'review', label: 'Kiểm tra', icon: 'bi-check2-all' },
];

function loadStoredKeys(uid) {
    const ocrKeys = loadOcrKeys(uid);
    const aiSettings = loadAISettings(uid);
    return { mistral: ocrKeys?.mistral || '', gemini: getGeminiApiKey(aiSettings) || '', groq: '', deepseek: '' };
}

function StepBar({ current }) {
    const ci = STEPS.findIndex((s) => s.id === current);
    return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            {STEPS.map((s, i) => (
                <React.Fragment key={s.id}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.95rem', fontWeight: 700, transition: 'all 0.25s',
                            background: i < ci ? '#22c55e' : i === ci ? '#fff' : 'rgba(255,255,255,0.18)',
                            color: i < ci ? '#fff' : i === ci ? '#4f46e5' : 'rgba(255,255,255,0.55)',
                            boxShadow: i === ci ? '0 0 0 3px rgba(255,255,255,0.35)' : 'none',
                        }}>
                            {i < ci ? <i className="bi bi-check-lg" /> : <i className={`bi ${s.icon}`} />}
                        </div>
                        <span style={{
                            fontSize: '0.72rem', fontWeight: i === ci ? 700 : 500,
                            color: i < ci ? '#86efac' : i === ci ? '#fff' : 'rgba(255,255,255,0.5)',
                            whiteSpace: 'nowrap',
                        }}>{s.label}</span>
                    </div>
                    {i < STEPS.length - 1 && (
                        <div style={{ flex: 1, height: 3, minWidth: 24, marginBottom: 20, background: i < ci ? '#22c55e' : 'rgba(255,255,255,0.2)', borderRadius: 2 }} />
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}

function DebugPanel({ title, content, icon = 'bi-code-slash' }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    return (
        <div style={{ border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
            <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#1e293b', border: 'none', cursor: 'pointer' }}>
                <i className={`bi ${icon}`} style={{ color: '#64748b' }} />
                <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1' }}>{title}</span>
                {content && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{content.length.toLocaleString('vi')} ký tự</span>}
                <i className={`bi bi-chevron-${open ? 'up' : 'down'}`} style={{ color: '#64748b' }} />
            </button>
            {open && (
                <div style={{ background: '#0f172a', padding: '12px 16px', position: 'relative' }}>
                    <button onClick={() => { navigator.clipboard.writeText(content || ''); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
                        style={{ position: 'absolute', top: 10, right: 12, background: '#1e293b', color: copied ? '#22c55e' : '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', cursor: 'pointer' }}>
                        <i className={`bi bi-${copied ? 'check2' : 'clipboard'}`} /> {copied ? 'Copied' : 'Copy'}
                    </button>
                    <pre style={{ color: '#e2e8f0', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: 380, overflowY: 'auto', paddingRight: 60 }}>{content || '(trống)'}</pre>
                </div>
            )}
        </div>
    );
}

function KeyInput({ label, note, url, placeholder, value, onChange }) {
    const [show, setShow] = useState(false);
    const ok = value && value.length > 20;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>{label}</span>
                {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#6366f1' }}>lấy key →</a>}
            </div>
            {note && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{note}</span>}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.trim())}
                    style={{ flex: 1, border: `1.5px solid ${ok ? '#22c55e' : '#e2e8f0'}`, borderRadius: 8, padding: '7px 10px', fontSize: '0.82rem', fontFamily: 'monospace', background: '#f8fafc', color: '#1e293b', outline: 'none' }} />
                <button onClick={() => setShow((s) => !s)} style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#64748b' }}>
                    <i className={`bi bi-eye${show ? '-slash' : ''}`} />
                </button>
                {ok && <i className="bi bi-check-circle-fill" style={{ color: '#22c55e', fontSize: '1.1rem' }} />}
            </div>
        </div>
    );
}

function QuestionCard({ item, index, onChange, onToggle }) {
    const { question: q, included } = item;
    const bg = TYPE_BG[q.type] || '#dbeafe';
    const fg = TYPE_FG[q.type] || '#1e40af';
    const set = (field, val) => onChange(index, { ...q, [field]: val });
    return (
        <div style={{ background: '#fff', border: `1.5px solid ${included ? '#e2e8f0' : '#f1f5f9'}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, opacity: included ? 1 : 0.38, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, cursor: 'pointer', minWidth: 80 }}>
                    <input type="checkbox" checked={included} onChange={() => onToggle(index)} style={{ width: 16, height: 16, accentColor: '#6366f1' }} />
                    Câu {index + 1}
                </label>
                <span style={{ background: bg, color: fg, fontSize: '0.75rem', fontWeight: 700, padding: '2px 10px', borderRadius: 20 }}>{TYPE_LABELS[q.type] || q.type}</span>
                <select value={q.type} disabled={!included} onChange={(e) => set('type', e.target.value)}
                    style={{ fontSize: '0.78rem', border: '1px solid #e2e8f0', borderRadius: 7, padding: '3px 8px', background: '#f8fafc', cursor: 'pointer' }}>
                    {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                    <input type="number" min={0.25} step={0.25} value={q.points || 1} disabled={!included} onChange={(e) => set('points', parseFloat(e.target.value) || 1)}
                        style={{ width: 56, textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 7, padding: '3px 6px', fontSize: '0.85rem' }} />
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>điểm</span>
                </div>
                {q.image_url && (
                    <a href={q.image_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', padding: '2px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: 20, textDecoration: 'none' }}>
                        <i className="bi bi-image" /> Ảnh
                    </a>
                )}
            </div>
            <textarea value={q.content_text} disabled={!included} placeholder="Nội dung câu hỏi..."
                rows={Math.max(2, Math.ceil((q.content_text || '').length / 90))} onChange={(e) => set('content_text', e.target.value)}
                style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: '0.87rem', fontFamily: 'inherit', resize: 'vertical', background: '#f8fafc', color: '#1e293b', boxSizing: 'border-box' }} />
            {q.type === 'mcq' && q.choices?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {q.choices.map((c, ci) => (
                        <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="radio" name={`r-${index}`} checked={q.correct_answer === c.letter} disabled={!included} onChange={() => set('correct_answer', c.letter)} style={{ accentColor: '#22c55e', width: 16, height: 16 }} />
                            <span style={{ fontWeight: 700, color: '#6366f1', width: 20 }}>{c.letter}.</span>
                            <input value={c.text} disabled={!included} onChange={(e) => { const cs = q.choices.map((x, i) => i === ci ? { ...x, text: e.target.value } : x); set('choices', cs); }}
                                style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: '0.84rem', background: '#f8fafc' }} />
                        </div>
                    ))}
                </div>
            )}
            {q.type === 'tf' && q.choices?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {q.choices.map((c, ci) => {
                        const tfVal = (q.correct_answer || '')[ci] || 'S';
                        return (
                            <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: tfVal === 'D' ? '#16a34a' : '#dc2626', width: 38, padding: '2px 6px', background: tfVal === 'D' ? '#dcfce7' : '#fee2e2', borderRadius: 6, textAlign: 'center', cursor: 'pointer' }}
                                    onClick={() => { if (!included) return; const arr = (q.correct_answer || 'S'.repeat(q.choices.length)).split(''); arr[ci] = tfVal === 'D' ? 'S' : 'D'; set('correct_answer', arr.join('')); }}>
                                    {tfVal === 'D' ? 'Đúng' : 'Sai'}
                                </span>
                                <span style={{ fontWeight: 700, color: '#64748b', width: 20 }}>{c.letter}.</span>
                                <input value={c.text} disabled={!included} onChange={(e) => { const cs = q.choices.map((x, i) => i === ci ? { ...x, text: e.target.value } : x); set('choices', cs); }}
                                    style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: '0.84rem', background: '#f8fafc' }} />
                            </div>
                        );
                    })}
                </div>
            )}
            {q.type === 'short_answer' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#065f46', whiteSpace: 'nowrap' }}>Đáp án:</span>
                    <input value={q.correct_answer || ''} disabled={!included} placeholder="Đáp án mẫu..." onChange={(e) => set('correct_answer', e.target.value)}
                        style={{ flex: 1, border: '1px solid #86efac', borderRadius: 6, padding: '5px 8px', fontSize: '0.84rem', background: '#f0fdf4' }} />
                </div>
            )}
            {q.explanation && (
                <textarea value={q.explanation} disabled={!included} placeholder="Lời giải..." rows={2} onChange={(e) => set('explanation', e.target.value)}
                    style={{ width: '100%', border: '1px solid #fed7aa', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', fontFamily: 'inherit', resize: 'vertical', background: '#fffbeb', boxSizing: 'border-box' }} />
            )}
        </div>
    );
}

export default function PdfImportLabPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [apiKeys, setApiKeys] = useState(() => loadStoredKeys(user?.uid));
    const [ocrMode, setOcrMode] = useState('mistral');
    const [chatProvider, setChatProvider] = useState('mistral');
    const [chatModel, setChatModel] = useState('mistral-small-latest');
    const VALID_GEMINI_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'];
    const [geminiOcrModel, setGeminiOcrModel] = useState(() => {
        const saved = getGeminiModel(loadAISettings(user?.uid));
        return VALID_GEMINI_MODELS.includes(saved) ? saved : 'gemini-3-flash-preview';
    });
    const [pdfFile, setPdfFile] = useState(null);
    const [step, setStep] = useState('upload');
    const [progressLabel, setProgressLabel] = useState('');
    const [progressPct, setProgressPct] = useState(0);
    const [ocrMarkdown, setOcrMarkdown] = useState('');
    const [rawAiJson, setRawAiJson] = useState('');
    const [imageCount, setImageCount] = useState(0);
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');
    const [dragging, setDragging] = useState(false);

    useEffect(() => { if (apiKeys.mistral) saveOcrKeys(user?.uid, { mistral: apiKeys.mistral }); }, [apiKeys.mistral, user?.uid]);
    useEffect(() => { const cat = CHAT_PROVIDERS.find((p) => p.id === chatProvider); if (cat) setChatModel(cat.models[0].id); }, [chatProvider]);

    const uploadOcrImage = useCallback(async (imgId, base64Data) => {
        const bin = atob(base64Data);
        const ab = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) ab[i] = bin.charCodeAt(i);
        const ext = (imgId.split('.').pop() || 'jpeg').replace('jpg', 'jpeg');
        const blob = new Blob([ab], { type: `image/${ext}` });
        const sRef = ref(storage, `pdf-ocr/${user?.uid}/${Date.now()}_${imgId}`);
        await uploadBytes(sRef, blob);
        return getDownloadURL(sRef);
    }, [user?.uid]);

    const handleDrop = (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files?.[0]; if (f?.type === 'application/pdf') setPdfFile(f); };

    const run = useCallback(async () => {
        if (!pdfFile) return;
        setError(''); setOcrMarkdown(''); setRawAiJson(''); setItems([]); setImageCount(0);
        const mk = apiKeys.mistral, gk = apiKeys.gemini, ck = apiKeys[chatProvider];
        try {
            let rawText = '';
            if (ocrMode === 'gemini') {
                if (!gk) { setError('Nhập Gemini API key trước.'); return; }
                setStep('ocr'); setProgressLabel('Gửi PDF lên Gemini... (có thể retry nếu quá tải)'); setProgressPct(30);
                rawText = await parsePdfQuestionsWithGemini(pdfFile, gk, geminiOcrModel);
                setRawAiJson(rawText); setOcrMarkdown('(Gemini xử lý PDF trực tiếp)'); setProgressPct(90);
            } else {
                if (!mk) { setError('Nhập Mistral API key trước.'); return; }
                setStep('ocr'); setProgressLabel('Upload PDF → Mistral Files API...'); setProgressPct(10);
                const { markdown, imageCount: ic } = await parsePdfWithMistralOcr(pdfFile, mk, uploadOcrImage);
                setOcrMarkdown(markdown); setImageCount(ic);
                setProgressLabel('OCR xong. AI đang trích xuất câu hỏi...'); setProgressPct(55);
                if (!ck) { setError(`Nhập API key cho ${chatProvider}.`); setStep('upload'); return; }
                setStep('parse');
                rawText = await extractQuestionsWithChat({
                    ocrMarkdown: markdown,
                    provider: chatProvider,
                    apiKey: ck,
                    model: chatModel,
                    onChunkProgress: (done, total) => {
                        if (total <= 1) return;
                        setProgressLabel(`AI trích xuất... phần ${done + 1}/${total} (tài liệu dài, đang chia nhỏ)`);
                        setProgressPct(55 + Math.round((done / total) * 30));
                    },
                });
                setRawAiJson(rawText); setProgressPct(88);
            }
            setProgressLabel('Phân tích JSON...'); setProgressPct(95);
            const parsed = parsePdfAiResponse(rawText);
            setItems(parsed.map((q) => ({ question: q, included: true })));
            setStep('review'); setProgressPct(100); setProgressLabel('');
        } catch (e) {
            console.error('[PdfImportLab]', e);
            setError(e.message || 'Lỗi không xác định.');
            setStep('upload'); setProgressPct(0); setProgressLabel('');
        }
    }, [pdfFile, apiKeys, ocrMode, chatProvider, chatModel, geminiOcrModel, uploadOcrImage]);

    const handleChange = (i, q) => setItems((p) => p.map((it, x) => x === i ? { ...it, question: q } : it));
    const handleToggle = (i) => setItems((p) => p.map((it, x) => x === i ? { ...it, included: !it.included } : it));

    const handleSendToEditor = () => {
        const sel = items.filter((it) => it.included).map((it) => it.question);
        if (!sel.length) { setError('Chưa chọn câu nào.'); return; }
        navigate('/teacher/upload', { state: { pdfImportQuestions: sel } });
    };

    const handleExportJson = () => {
        const sel = items.filter((it) => it.included).map((it) => it.question);
        if (!sel.length) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(sel, null, 2)], { type: 'application/json' }));
        a.download = `${(pdfFile?.name || 'export').replace('.pdf', '')}_questions.json`;
        a.click();
    };

    const included = items.filter((it) => it.included).length;
    const isRunning = step === 'ocr' || step === 'parse';
    const chatCat = CHAT_PROVIDERS.find((p) => p.id === chatProvider);

    return (
        <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
            <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #0891b2 100%)', padding: '28px 24px 24px' }}>
                <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <button onClick={() => navigate(-1)}
                            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexShrink: 0 }}>
                            <i className="bi bi-arrow-left" /> Quay lại
                        </button>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                <i className="bi bi-file-earmark-pdf-fill" style={{ fontSize: '1.5rem', color: '#fff' }} />
                                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#fff' }}>PDF → Đề thi</h1>
                            </div>
                            <p style={{ margin: 0, color: 'rgba(255,255,255,0.8)', fontSize: '0.85rem' }}>OCR nhận dạng · AI trích xuất · Kiểm tra & chỉnh sửa · Đưa vào soạn đề</p>
                        </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', borderRadius: 14, padding: '12px 20px', border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }}>
                        <StepBar current={step} />
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 100px', display: 'flex', flexDirection: 'column', gap: 18 }}>

                <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', background: '#fafbfc', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                            <i className="bi bi-magic" /> Phương thức OCR
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {OCR_PROVIDERS.map((p) => (
                                <button key={p.id} onClick={() => setOcrMode(p.id)}
                                    style={{ padding: '6px 16px', borderRadius: 30, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: ocrMode === p.id ? p.color : '#fff', color: ocrMode === p.id ? '#fff' : '#64748b', border: `1.5px solid ${ocrMode === p.id ? p.color : '#e2e8f0'}`, boxShadow: ocrMode === p.id ? `0 2px 8px ${p.color}55` : 'none' }}>
                                    {p.icon} {p.label}
                                </button>
                            ))}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{OCR_PROVIDERS.find((p) => p.id === ocrMode)?.desc}</span>
                    </div>
                    <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <KeyInput label="🟡 Mistral API key" note="Dùng cho OCR nhận dạng PDF" url="https://console.mistral.ai/api-keys" placeholder="Dán Mistral key..." value={apiKeys.mistral} onChange={(v) => setApiKeys((k) => ({ ...k, mistral: v }))} />
                            {ocrMode === 'mistral' && (
                                <div style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <i className="bi bi-cpu" /> AI trích xuất câu hỏi (sau OCR)
                                    </div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                        {CHAT_PROVIDERS.map((p) => (
                                            <button key={p.id} onClick={() => setChatProvider(p.id)}
                                                style={{ padding: '4px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', background: chatProvider === p.id ? '#6366f1' : '#fff', color: chatProvider === p.id ? '#fff' : '#64748b', border: `1.5px solid ${chatProvider === p.id ? '#6366f1' : '#e2e8f0'}` }}>
                                                {p.icon} {p.label}
                                            </button>
                                        ))}
                                    </div>
                                    <select value={chatModel} onChange={(e) => setChatModel(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: '0.82rem', background: '#fff' }}>
                                        {chatCat?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                                    </select>
                                    {chatProvider !== 'mistral' && (
                                        <KeyInput label={`${chatCat?.icon} ${chatCat?.label} API key`} url={KEY_URLS[chatProvider]} placeholder={`Dán ${chatCat?.label} key...`} value={apiKeys[chatProvider] || ''} onChange={(v) => setApiKeys((k) => ({ ...k, [chatProvider]: v }))} />
                                    )}
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <KeyInput label="🔵 Gemini API key" note="PDF trực tiếp · Free tier · 1 bước" url="https://aistudio.google.com/app/apikey" placeholder="Dán Gemini key..." value={apiKeys.gemini} onChange={(v) => setApiKeys((k) => ({ ...k, gemini: v }))} />
                            {ocrMode === 'gemini' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Model Gemini</span>
                                    <select value={geminiOcrModel} onChange={(e) => setGeminiOcrModel(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: '0.82rem', background: '#fff' }}>
                                        <option value="gemini-3-flash-preview">gemini-3-flash-preview ✦ (khuyên dùng)</option>
                                        <option value="gemini-3.1-flash-lite-preview">gemini-3.1-flash-lite-preview (tiết kiệm)</option>
                                        <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (suy luận sâu)</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {!isRunning && step !== 'review' && (
                    <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}
                        onClick={() => !pdfFile && fileInputRef.current?.click()}
                        style={{ border: `2.5px dashed ${dragging ? '#6366f1' : pdfFile ? '#22c55e' : '#cbd5e1'}`, borderRadius: 16, padding: '36px 20px', textAlign: 'center', cursor: pdfFile ? 'default' : 'pointer', background: dragging ? '#eef2ff' : pdfFile ? '#f0fdf4' : '#fff', transition: 'all 0.2s', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                        <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f?.type === 'application/pdf') setPdfFile(f); e.target.value = ''; }} />
                        {pdfFile ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                                <i className="bi bi-file-earmark-pdf-fill" style={{ fontSize: '2.5rem', color: '#dc2626' }} />
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{pdfFile.name}</div>
                                    <div style={{ fontSize: '0.82rem', color: '#64748b' }}>{(pdfFile.size / 1024).toFixed(0)} KB</div>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); setPdfFile(null); }} style={{ marginLeft: 12, background: '#fee2e2', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>
                                    <i className="bi bi-x-lg" />
                                </button>
                            </div>
                        ) : (
                            <>
                                <i className="bi bi-cloud-arrow-up" style={{ fontSize: '3rem', color: '#94a3b8', display: 'block', marginBottom: 12 }} />
                                <p style={{ fontWeight: 700, margin: '0 0 4px', fontSize: '1.05rem', color: '#1e293b' }}>Kéo thả PDF vào đây hoặc nhấn để chọn</p>
                                <p style={{ margin: 0, fontSize: '0.84rem', color: '#94a3b8' }}>Hỗ trợ đề thi có ảnh · bảng · LaTeX · Đúng/Sai</p>
                            </>
                        )}
                    </div>
                )}

                {!isRunning && (
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        {step === 'review' && (
                            <button onClick={() => { setStep('upload'); setItems([]); setOcrMarkdown(''); setRawAiJson(''); }}
                                style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, fontSize: '0.88rem', color: '#475569' }}>
                                <i className="bi bi-arrow-counterclockwise" /> Đổi file / Chạy lại
                            </button>
                        )}
                        {pdfFile && (
                            <button onClick={run} disabled={isRunning}
                                style={{ padding: '10px 28px', borderRadius: 10, fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer', background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 14px rgba(79,70,229,0.35)' }}>
                                <i className="bi bi-cpu-fill" />{step === 'review' ? 'Chạy lại' : 'Bắt đầu nhận dạng'}
                            </button>
                        )}
                    </div>
                )}

                {isRunning && (
                    <div style={{ background: '#fff', borderRadius: 16, padding: '22px 24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                            <div style={{ width: 22, height: 22, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'pilspin 0.7s linear infinite', flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{progressLabel}</span>
                        </div>
                        <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: 'linear-gradient(90deg, #4f46e5, #7c3aed)', borderRadius: 4, width: `${progressPct}%`, transition: 'width 0.5s ease' }} />
                        </div>
                        <p style={{ marginTop: 8, fontSize: '0.8rem', color: '#94a3b8', margin: '8px 0 0' }}>{progressPct < 50 ? 'Upload & OCR — có thể mất 10–40 giây' : 'AI đang phân tích... Nếu Gemini quá tải sẽ tự retry (tối đa 4 lần, mỗi lần chờ ~8–16 giây)'}</p>
                        <style>{'@keyframes pilspin { to { transform: rotate(360deg); } }'}</style>
                    </div>
                )}

                {error && (
                    <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 12, padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-start', color: '#dc2626' }}>
                        <i className="bi bi-exclamation-triangle-fill" style={{ flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: '0.88rem', flex: 1 }}>{error}</span>
                        <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>✕</button>
                    </div>
                )}

                {ocrMarkdown && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}><i className="bi bi-bug" /> Debug output</span>
                            {imageCount > 0 && <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 20, padding: '2px 10px', fontSize: '0.78rem', fontWeight: 600 }}><i className="bi bi-images" /> {imageCount} ảnh đã upload</span>}
                        </div>
                        <DebugPanel title="OCR Markdown — kết quả nhận dạng thô" content={ocrMarkdown} icon="bi-markdown" />
                        <DebugPanel title="Raw AI JSON — phản hồi trước khi parse" content={rawAiJson} icon="bi-braces" />
                    </div>
                )}

                {step === 'review' && items.length > 0 && (
                    <>
                        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                            <div>
                                <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>{included}/{items.length} câu</span>
                                <span style={{ fontSize: '0.82rem', color: '#64748b', marginLeft: 8 }}>được chọn</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <button onClick={() => setItems((p) => p.map((it) => ({ ...it, included: true })))} style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>Chọn tất</button>
                                <button onClick={() => setItems((p) => p.map((it) => ({ ...it, included: false })))} style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>Bỏ tất</button>
                                <button onClick={handleExportJson} disabled={!included} style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}><i className="bi bi-download" /> Xuất JSON</button>
                                <button onClick={handleSendToEditor} disabled={!included} style={{ padding: '8px 20px', borderRadius: 10, fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', border: 'none', boxShadow: '0 3px 12px rgba(79,70,229,0.3)', display: 'flex', alignItems: 'center', gap: 7, opacity: included ? 1 : 0.5 }}>
                                    <i className="bi bi-pencil-square" /> Đưa vào soạn đề ({included})
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {items.map((it, i) => <QuestionCard key={i} item={it} index={i} onChange={handleChange} onToggle={handleToggle} />)}
                        </div>
                        <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, boxShadow: '0 -4px 20px rgba(0,0,0,0.06)', zIndex: 50 }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{included} câu sẽ được nhập</span>
                            <button onClick={handleSendToEditor} disabled={!included} style={{ padding: '10px 28px', borderRadius: 10, fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', border: 'none', boxShadow: '0 4px 14px rgba(79,70,229,0.35)', display: 'flex', alignItems: 'center', gap: 8, opacity: included ? 1 : 0.5 }}>
                                <i className="bi bi-pencil-square" /> Đưa vào soạn đề
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
