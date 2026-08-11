import {
    AI_PROVIDER_CATALOG,
    estimateRequestCostVnd,
    getActiveAIProvider,
    getProviderBudgetStatus,
    loadAISettings,
    loadAIUsage,
    recordAIUsage,
    validateApiKeyFormat,
} from './aiSettings';

export const QUESTION_AI_ACTIONS = [
    { id: 'generate', label: 'Sinh câu mới', description: 'Tạo câu hỏi mới theo dạng câu hiện tại.' },
    { id: 'improve', label: 'Nâng cấp câu hiện tại', description: 'Viết lại để rõ hơn, hay hơn, sạch hơn.' },
    { id: 'remix', label: 'Biến tấu tương tự', description: 'Tạo một phiên bản mới cùng mức độ và cùng dạng.' },
    { id: 'explain', label: 'Viết lời giải', description: 'Bổ sung đáp án và giải thích ngắn gọn, rõ ràng.' },
];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function cleanText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function ensureDailyAndBudgetLimits(settings, usage, activeProvider, estimatedCostVnd, promptLength) {
    if (!activeProvider) {
        throw new Error('Chưa có provider AI đang hoạt động. Hãy vào Teacher Dashboard để nhập key và bật provider.');
    }

    if (promptLength > settings.promptMaxChars) {
        throw new Error(`Prompt đang dài ${promptLength} ký tự, vượt trần ${settings.promptMaxChars} ký tự trong cấu hình AI hiện tại.`);
    }

    const dayRequests = usage.currentDay?.requests || 0;
    if (dayRequests >= settings.dailyRequestLimit) {
        throw new Error(`Đã chạm giới hạn ${settings.dailyRequestLimit} lượt gọi AI trong ngày.`);
    }

    const monthCost = usage.currentMonth?.estimatedCostVnd || 0;
    if (settings.monthlyBudgetVnd > 0 && monthCost + estimatedCostVnd > settings.monthlyBudgetVnd) {
        throw new Error('Đã chạm trần chi phí AI theo tháng bạn đã đặt.');
    }

    const providerBudget = getProviderBudgetStatus(settings, usage, activeProvider.providerId);
    if (providerBudget.monthlyLimit > 0 && providerBudget.used + estimatedCostVnd > providerBudget.monthlyLimit) {
        throw new Error(`Provider ${AI_PROVIDER_CATALOG[activeProvider.providerId].label} đã chạm trần chi phí riêng theo tháng.`);
    }
}

function normalizeChoiceText(choice) {
    if (typeof choice === 'string') return cleanText(choice);
    return cleanText(choice?.text || choice?.content || choice?.label || choice?.option);
}

function buildMcqChoices(rawChoices = []) {
    const normalizedSource = Array.isArray(rawChoices) ? rawChoices : [];
    const size = Math.max(4, Math.min(normalizedSource.length || 4, LETTERS.length));
    return Array.from({ length: size }, (_, index) => ({
        letter: LETTERS[index],
        text: normalizeChoiceText(normalizedSource[index]),
        html: '',
    }));
}

function buildTfChoices(rawChoices = []) {
    const normalizedSource = Array.isArray(rawChoices) ? rawChoices : [];
    const size = Math.max(4, Math.min(normalizedSource.length || 4, LETTERS.length));
    return Array.from({ length: size }, (_, index) => ({
        letter: LETTERS[index],
        text: normalizeChoiceText(normalizedSource[index]),
        html: '',
    }));
}

function normalizeCorrectLetter(value, choices) {
    const nextValue = cleanText(value).toUpperCase().slice(0, 1);
    if (choices.some((choice) => choice.letter === nextValue)) return nextValue;
    return choices[0]?.letter || 'A';
}

function normalizeTfAnswer(value, choiceCount) {
    const normalized = cleanText(value).toUpperCase().replace(/[^DS]/g, '');
    return (normalized || 'S'.repeat(choiceCount)).padEnd(choiceCount, 'S').slice(0, choiceCount);
}

function extractJsonPayload(rawText) {
    const source = cleanText(rawText);
    const fencedMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = cleanText(fencedMatch?.[1] || source);

    try {
        return JSON.parse(candidate);
    } catch {
        const firstBrace = candidate.indexOf('{');
        const lastBrace = candidate.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
        }
        throw new Error('AI khong tra ve JSON hop le.');
    }
}

function extractProviderText(providerId, payload) {
    if (providerId === 'gemini') {
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        const text = parts.map((part) => part?.text || '').join('\n').trim();
        if (!text) {
            const blockReason = payload?.promptFeedback?.blockReason;
            throw new Error(blockReason ? `Gemini từ chối yêu cầu: ${blockReason}` : 'Gemini không trả về nội dung.');
        }
        return text;
    }

    const text = payload?.choices?.[0]?.message?.content;
    if (!text) {
        throw new Error(`${AI_PROVIDER_CATALOG[providerId]?.label || 'AI'} không trả về nội dung hợp lệ.`);
    }
    return text;
}

async function requestProviderCompletion({ providerId, model, apiKey, systemPrompt, userPrompt }) {
    let url = '';
    let headers = { 'Content-Type': 'application/json' };
    let body = null;

    if (providerId === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature: 0.25,
                topP: 0.9,
                maxOutputTokens: 2048,
            },
        };
    } else if (providerId === 'groq') {
        url = 'https://api.groq.com/openai/v1/chat/completions';
        headers = { ...headers, Authorization: `Bearer ${apiKey}` };
        body = {
            model,
            temperature: 0.25,
            max_tokens: 1600,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        };
    } else if (providerId === 'deepseek') {
        url = 'https://api.deepseek.com/chat/completions';
        headers = { ...headers, Authorization: `Bearer ${apiKey}` };
        body = {
            model,
            temperature: 0.25,
            max_tokens: 1600,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        };
    } else {
        throw new Error('Provider AI không được hỗ trợ.');
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const rawText = await response.text();
    let parsed = null;
    try {
        parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
        parsed = null;
    }

    if (!response.ok) {
        const providerMessage = parsed?.error?.message || parsed?.message || rawText || `HTTP ${response.status}`;
        throw new Error(providerMessage);
    }

    return extractProviderText(providerId, parsed || {});
}

function buildQuestionSnapshot(question = {}, questionType = 'mcq') {
    return {
        type: questionType,
        stem: cleanText(question.content_text),
        choices: Array.isArray(question.choices) ? question.choices.map((choice) => ({ letter: choice.letter, text: cleanText(choice.text) })) : [],
        correctAnswer: cleanText(question.correct_answer),
        explanation: cleanText(question.explanation),
    };
}

function buildPrompt({ action, brief, exam = {}, question = {}, preferredType = 'mcq' }) {
    const actionLabel = QUESTION_AI_ACTIONS.find((item) => item.id === action)?.label || action;
    const currentQuestion = buildQuestionSnapshot(question, preferredType);
    const schemaHint = preferredType === 'mcq'
        ? 'choices phai co dung 4 lua chon; correctAnswer la mot chu cai A-D.'
        : preferredType === 'tf'
            ? 'choices phai co 4 menh de ngan; correctAnswer la chuoi D/S co do dai bang so lua chon, vi du "DDSS".'
            : preferredType === 'short_answer'
                ? 'choices de rong; correctAnswer la dap an ngan chap nhan khi cham.'
                : 'choices de rong; correctAnswer la rubric/nguyen tac cham diem ngan gon.';

    return [
        `Tac vu: ${actionLabel}.`,
        'Ngu canh de thi:',
        JSON.stringify({
            title: cleanText(exam.title),
            subject: cleanText(exam.subject),
            grade: cleanText(exam.grade),
            duration: exam.duration || null,
            questionType: preferredType,
        }, null, 2),
        'Cau hien tai:',
        JSON.stringify(currentQuestion, null, 2),
        'Yeu cau bo sung cua giao vien:',
        cleanText(brief) || 'Khong co ghi chu bo sung. Hay giu muc do phu hop va cach dat cau hoi ro rang, de dung trong lop hoc.',
        'Tra ve duy nhat mot JSON object voi cac truong: stem, choices, correctAnswer, explanation.',
        schemaHint,
        'Khong them markdown, khong them giai thich ngoai JSON, khong them code fence.',
    ].join('\n\n');
}

function normalizeQuestionDraft(rawDraft = {}, { preferredType = 'mcq', currentQuestion = {} }) {
    const nextType = preferredType || 'mcq';
    const stem = cleanText(rawDraft.stem || rawDraft.question || rawDraft.content || currentQuestion.content_text);
    const explanation = cleanText(rawDraft.explanation || rawDraft.solution || currentQuestion.explanation);

    if (nextType === 'mcq') {
        const choices = buildMcqChoices(rawDraft.choices);
        return {
            type: 'mcq',
            content_text: stem,
            choices,
            correct_answer: normalizeCorrectLetter(rawDraft.correctAnswer || rawDraft.answer, choices),
            explanation,
        };
    }

    if (nextType === 'tf') {
        const choices = buildTfChoices(rawDraft.choices);
        return {
            type: 'tf',
            content_text: stem,
            choices,
            correct_answer: normalizeTfAnswer(rawDraft.correctAnswer || rawDraft.answer, choices.length),
            explanation,
        };
    }

    if (nextType === 'short_answer') {
        return {
            type: 'short_answer',
            content_text: stem,
            choices: [],
            correct_answer: cleanText(rawDraft.correctAnswer || rawDraft.answer || currentQuestion.correct_answer),
            explanation,
        };
    }

    return {
        type: 'essay',
        content_text: stem,
        choices: [],
        correct_answer: cleanText(rawDraft.correctAnswer || rawDraft.answer || currentQuestion.correct_answer),
        explanation,
    };
}

export function getAIQuestionAssistantStatus(userId) {
    if (!userId) {
        return {
            ready: false,
            label: 'Chưa đăng nhập',
            detail: 'Đăng nhập giáo viên để dùng BYOK AI.',
        };
    }

    const settings = loadAISettings(userId);
    const usage = loadAIUsage(userId);
    const activeProvider = getActiveAIProvider(settings);

    if (!activeProvider) {
        return {
            ready: false,
            label: 'Chưa bật provider',
            detail: 'Hãy vào Teacher Dashboard, bật một provider và nhập API key của chính bạn.',
        };
    }

    const validation = validateApiKeyFormat(activeProvider.providerId, activeProvider.apiKey);
    if (!validation.valid) {
        return {
            ready: false,
            label: 'Key chưa hợp lệ',
            detail: validation.message,
        };
    }

    const estimatedCostVnd = estimateRequestCostVnd(activeProvider.providerId, activeProvider.model);
    return {
        ready: true,
        providerId: activeProvider.providerId,
        providerLabel: AI_PROVIDER_CATALOG[activeProvider.providerId].label,
        model: activeProvider.model,
        estimatedCostVnd,
        label: `${AI_PROVIDER_CATALOG[activeProvider.providerId].label} · ${activeProvider.model}`,
        detail: `Hôm nay ${usage.currentDay?.requests || 0}/${settings.dailyRequestLimit} lượt · ước tính ~${estimatedCostVnd.toLocaleString('vi-VN')} đ/lần.`,
    };
}

export async function requestQuestionAIDraft({ userId, action = 'improve', brief = '', exam = {}, question = {}, preferredType = 'mcq' }) {
    const settings = loadAISettings(userId);
    const usage = loadAIUsage(userId);
    const activeProvider = getActiveAIProvider(settings);

    if (!activeProvider) {
        throw new Error('Chưa có provider AI đang hoạt động. Hãy bật Gemini, Groq hoặc DeepSeek bằng API key của chính bạn.');
    }

    const validation = validateApiKeyFormat(activeProvider.providerId, activeProvider.apiKey);
    if (!validation.valid) {
        throw new Error(validation.message);
    }

    const estimatedCostVnd = estimateRequestCostVnd(activeProvider.providerId, activeProvider.model);
    const systemPrompt = 'Bạn là trợ lý soạn đề cho giáo viên. Nhiệm vụ của bạn là trả về đúng một JSON object sạch, ngắn gọn, sử dụng tiếng Việt tự nhiên, trùng lặp tối thiểu, không chèn markdown.';
    const userPrompt = buildPrompt({ action, brief, exam, question, preferredType });

    ensureDailyAndBudgetLimits(settings, usage, activeProvider, estimatedCostVnd, userPrompt.length);

    const responseText = await requestProviderCompletion({
        providerId: activeProvider.providerId,
        model: activeProvider.model,
        apiKey: activeProvider.apiKey,
        systemPrompt,
        userPrompt,
    });

    const nextUsage = recordAIUsage(userId, activeProvider.providerId, estimatedCostVnd);
    const rawDraft = extractJsonPayload(responseText);
    const draft = normalizeQuestionDraft(rawDraft, { preferredType, currentQuestion: question });

    if (!draft.content_text) {
        throw new Error('AI chưa trả về nội dung câu hỏi hợp lệ. Hãy thử ghi rõ hơn yêu cầu.');
    }

    return {
        draft,
        providerId: activeProvider.providerId,
        providerLabel: AI_PROVIDER_CATALOG[activeProvider.providerId].label,
        model: activeProvider.model,
        estimatedCostVnd,
        usage: nextUsage,
    };
}

// ── PDF import — OCR + question extraction ────────────────────────────────────

// readFileAsBase64 — still used by Gemini inline_data
async function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ── Mistral Files API helpers (multipart, no base64 in body) ──────────────────
async function uploadPdfToMistral(pdfFile, mistralKey) {
    const form = new FormData();
    form.append('file', pdfFile, pdfFile.name);
    form.append('purpose', 'ocr');
    const res = await fetch('https://api.mistral.ai/v1/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mistralKey}` },
        body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Upload PDF thất bại: ${data.message || res.status}`);
    return data.id;
}

async function getMistralFileUrl(fileId, mistralKey) {
    const res = await fetch(`https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}/url?expiry=1`, {
        headers: { Authorization: `Bearer ${mistralKey}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Lấy URL file Mistral thất bại: ${data.message || res.status}`);
    return data.url;
}

async function deleteMistralFile(fileId, mistralKey) {
    await fetch(`https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${mistralKey}` },
    }).catch(() => {}); // cleanup only, ignore errors
}

// ── Prompts ────────────────────────────────────────────────────────────────────
const PDF_EXTRACTION_SYSTEM = `Bạn là chuyên gia phân tích đề thi Việt Nam. Nhiệm vụ: đọc nội dung đề thi (văn bản OCR hoặc PDF) và trả về JSON array các câu hỏi, đầy đủ, chính xác.`;

const PDF_EXTRACTION_SCHEMA = `Trả về JSON object dạng {"questions": [...]} trong đó mỗi phần tử của mảng questions là:
{
  "type": "mcq" | "tf" | "short_answer" | "essay",
  "content_text": "Nội dung câu hỏi đầy đủ (không có số thứ tự)",
  "image_url": "URL ảnh nếu câu hỏi đề cập ảnh (lấy từ markdown ![...](url)), hoặc null",
  "choices": [{"letter":"A","text":"..."}, ...],
  "correct_answer": "A" | "DSSD" | "câu trả lời ngắn" | null,
  "explanation": "Lời giải chi tiết nếu có, hoặc null",
  "points": 1
}

PHÂN LOẠI ĐÚNG:
- "mcq" = trắc nghiệm 1 đáp án (đáp án A B C D hoặc nhiều hơn). correct_answer = 1 chữ cái hoa
- "tf" = Đúng/Sai nhiều mệnh đề (mệnh đề a b c d viết thường). correct_answer = chuỗi D/S, vd "DSSD"
- "short_answer" = tự luận ngắn, điền khuyết. Không có choices. correct_answer = đáp án mẫu nếu có
- "essay" = tự luận dài, phân tích, chứng minh. Không có choices. correct_answer = null

QUY TẮC:
- Giữ nguyên LaTeX: $x^2$, $\\frac{a}{b}$, $\\vec{AB}$
- Bỏ số thứ tự khỏi content_text: "Câu 1:", "1.", "Câu 1 (NB):" → bỏ đi
- Gộp phần dẫn câu ("Cho biết...", "Trong hình vẽ bên...") vào content_text
- Nếu đề KHÔNG có đáp án → correct_answer = null (không được đoán)
- Nếu markdown có ảnh liên quan câu hỏi → lấy URL đặt vào image_url
- points lấy từ đề (vd "(1 điểm)"), không có thì mặc định 1
- CHỈ trả về JSON object {"questions": [...]}, không thêm text hay markdown`;

/**
 * Upload PDF → signed URL → Mistral OCR (no base64 in body).
 * Extracts embedded images and uploads them via onImageUpload(id, base64) callback.
 * Returns { markdown: string, imageCount: number }
 */
export async function parsePdfWithMistralOcr(pdfFile, mistralKey, onImageUpload) {
    if (!mistralKey) throw new Error('Chưa nhập Mistral API key.');

    // 1. Upload via multipart (browser native, no base64 encoding in JS)
    const fileId = await uploadPdfToMistral(pdfFile, mistralKey);

    try {
        // 2. Get short-lived signed URL
        const signedUrl = await getMistralFileUrl(fileId, mistralKey);

        // 3. OCR via URL — Mistral downloads the PDF server-side
        const ocrRes = await fetch('https://api.mistral.ai/v1/ocr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${mistralKey}`,
            },
            body: JSON.stringify({
                model: 'mistral-ocr-latest',
                document: { type: 'document_url', document_url: signedUrl },
                include_image_base64: Boolean(onImageUpload),
            }),
        });

        const ocrText = await ocrRes.text();
        let ocrData = null;
        try { ocrData = JSON.parse(ocrText); } catch { ocrData = null; }

        if (!ocrRes.ok) {
            const msg = ocrData?.message || ocrData?.error?.message || `HTTP ${ocrRes.status}`;
            throw new Error(`Mistral OCR lỗi: ${msg}`);
        }

        const pages = ocrData?.pages || [];
        if (pages.length === 0) throw new Error('Mistral OCR không nhận dạng được nội dung trong PDF này.');

        // 4. Upload embedded images → Firebase Storage
        const imageUrlMap = {};
        if (onImageUpload) {
            for (const page of pages) {
                for (const img of (page.images || [])) {
                    if (img.id && img.image_base64) {
                        try {
                            const url = await onImageUpload(img.id, img.image_base64);
                            if (url) imageUrlMap[img.id] = url;
                        } catch (e) {
                            console.warn('[PDF] Image upload skipped:', img.id, e.message);
                        }
                    }
                }
            }
        }

        // 5. Build markdown, replace local image refs with storage URLs
        const markdown = pages.map((page) => {
            let md = page.markdown || '';
            for (const [imgId, url] of Object.entries(imageUrlMap)) {
                // Mistral refs: ![any-alt](img-id) — match any alt text, exact src
                const escapedId = imgId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                md = md.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escapedId}\\)`, 'g'), `![ảnh](${url})`);
            }
            return md;
        }).join('\n\n---\n\n');

        return { markdown, imageCount: Object.keys(imageUrlMap).length };
    } finally {
        await deleteMistralFile(fileId, mistralKey);
    }
}

/**
 * Use Mistral chat to extract questions from OCR markdown.
 * One Mistral key covers both OCR + extraction — no second provider needed.
 */
/**
 * Extract questions from OCR markdown using any supported chat provider.
 * provider: 'mistral' | 'groq' | 'gemini' | 'deepseek'
 * onChunkProgress: optional callback(chunkIndex, totalChunks) for UI updates
 */

/** Retry a fetch-based async fn up to maxAttempts times on retryable HTTP status codes. */
async function withRetry(fn, { maxAttempts = 6, retryOn = [429, 500, 503, 529], baseDelayMs = 10000 } = {}) {
    let lastStatus = null;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const { res, data } = await fn();
            if (retryOn.includes(res.status)) {
                lastStatus = res.status;
                const retryAfter = parseInt(res.headers?.get?.('retry-after') || '0', 10);
                const delay = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * Math.pow(1.8, attempt);
                console.warn(`[retry] HTTP ${res.status} — thử lại sau ${Math.round(delay / 1000)}s (lần ${attempt + 1}/${maxAttempts})`);
                lastErr = new Error(`HTTP ${res.status}`);
                if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return { res, data };
        } catch (e) {
            lastErr = e;
            if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(1.8, attempt)));
        }
    }
    if (lastStatus === 503 || lastStatus === 529) {
        throw new Error('Gemini đang quá tải (503), đã thử ' + maxAttempts + ' lần vẫn thất bại. Hãy thử lại sau vài phút, hoặc chuyển sang dùng Mistral OCR + Groq (miễn phí, ổn định hơn).');
    }
    throw lastErr;
}

/** Split OCR markdown (pages separated by \n\n---\n\n) into chunks ≤ maxChars each. */
function splitMarkdownIntoChunks(markdown, maxChars) {
    const pages = markdown.split('\n\n---\n\n');
    const chunks = [];
    let current = '';
    for (const page of pages) {
        const candidate = current ? `${current}\n\n---\n\n${page}` : page;
        if (candidate.length > maxChars && current.length > 0) {
            chunks.push(current);
            current = page;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [markdown.slice(0, maxChars)];
}

/** Call a single chat provider with one chunk of text. Returns raw response string. */
async function callProviderChat({ provider, apiKey, model, chunkText }) {
    const system = PDF_EXTRACTION_SYSTEM;
    const userMsg = `Hãy trích xuất toàn bộ câu hỏi từ đề thi dưới đây.\n${PDF_EXTRACTION_SCHEMA}\n\n=== NỘI DUNG ĐỀ THI ===\n${chunkText}`;

    if (provider === 'mistral') {
        const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: model || 'mistral-small-latest',
                temperature: 0.05, max_tokens: 32768,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Mistral chat lỗi: ${data.message || res.status}`);
        return data.choices?.[0]?.message?.content || '';
    }

    if (provider === 'groq') {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: model || 'llama-3.3-70b-versatile',
                temperature: 0.05, max_tokens: 8192,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Groq lỗi: ${data.error?.message || res.status}`);
        return data.choices?.[0]?.message?.content || '';
    }

    if (provider === 'gemini') {
        const activeModel = model || 'gemini-3-flash-preview';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const reqBody = JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: userMsg }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 65536, responseMimeType: 'application/json' },
        });
        const { res, data } = await withRetry(async () => {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody });
            const d = await r.json();
            return { res: r, data: d };
        });
        if (!res.ok) throw new Error(`Gemini lỗi: ${data?.error?.message || res.status}`);
        return extractProviderText('gemini', data);
    }

    if (provider === 'deepseek') {
        const res = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: model || 'deepseek-chat',
                temperature: 0.05, max_tokens: 8192,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`DeepSeek lỗi: ${data.error?.message || res.status}`);
        return data.choices?.[0]?.message?.content || '';
    }

    throw new Error(`Provider "${provider}" chưa được hỗ trợ.`);
}

export async function extractQuestionsWithChat({ ocrMarkdown, provider, apiKey, model, onChunkProgress }) {
    if (!apiKey) throw new Error(`Cần API key cho provider "${provider}".`);

    // Gemini has 1M-token context; others use 128K → safe char limits below
    const MAX_CHARS = provider === 'gemini' ? 200000 : 60000;

    const chunks = splitMarkdownIntoChunks(ocrMarkdown, MAX_CHARS);

    if (chunks.length === 1) {
        // Fast path: single call, return raw text as-is
        return callProviderChat({ provider, apiKey, model, chunkText: chunks[0] });
    }

    // Multi-chunk: extract from each chunk, merge raw question objects, re-serialize
    const allRaw = [];
    for (let i = 0; i < chunks.length; i++) {
        if (onChunkProgress) onChunkProgress(i, chunks.length);
        const rawText = await callProviderChat({ provider, apiKey, model, chunkText: chunks[i] });
        // Parse to array so we can merge; tolerate parse failures on partial chunks
        try {
            const parsed = parseRawJsonArray(rawText);
            allRaw.push(...parsed);
        } catch (e) {
            console.warn(`[PDF] Chunk ${i + 1}/${chunks.length} parse failed:`, e.message);
        }
    }
    if (onChunkProgress) onChunkProgress(chunks.length, chunks.length);

    if (allRaw.length === 0) {
        throw new Error('AI không trả về câu hỏi nào hợp lệ sau khi xử lý toàn bộ tài liệu.');
    }
    return JSON.stringify(allRaw);
}

/** Extract questions array from various AI response formats. */
function parseRawJsonArray(text) {
    // Try direct parse first
    let parsed = null;
    try { parsed = JSON.parse(text.trim()); } catch { /* fall through */ }

    // Handle {questions:[]} wrapper (from json_object response_format)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const arr = parsed.questions || parsed.items || parsed.data || parsed.results
            || Object.values(parsed).find(Array.isArray);
        if (Array.isArray(arr)) return arr;
    }
    if (Array.isArray(parsed)) return parsed;

    // Strip markdown fences and retry
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced?.[1] || text).trim();
    try {
        const r = JSON.parse(candidate);
        if (Array.isArray(r)) return r;
        if (r && typeof r === 'object') {
            const arr = r.questions || r.items || r.data || r.results
                || Object.values(r).find(Array.isArray);
            if (Array.isArray(arr)) return arr;
        }
    } catch { /* fall through */ }

    // Last resort: find outermost array brackets
    const s = candidate.indexOf('['), e = candidate.lastIndexOf(']');
    if (s >= 0 && e > s) return JSON.parse(candidate.slice(s, e + 1));
    throw new Error('Không tìm thấy JSON array trong phản hồi AI.');
}

export async function extractQuestionsWithMistralChat(ocrMarkdown, mistralKey) {
    return extractQuestionsWithChat({ ocrMarkdown, provider: 'mistral', apiKey: mistralKey, model: 'mistral-small-latest' });
}

/**
 * Send PDF directly to Gemini for question extraction (single call, uses base64 inline_data).
 * Returns raw response text (JSON array string).
 */
export async function parsePdfQuestionsWithGemini(pdfFile, apiKey, model) {
    if (!apiKey) throw new Error('Chưa cấu hình Gemini API key. Hãy vào phần cài đặt AI.');

    const base64Data = await readFileAsBase64(pdfFile);
    const activeModel = model || 'gemini-3-flash-preview';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
        contents: [{
            role: 'user',
            parts: [
                { inline_data: { mime_type: 'application/pdf', data: base64Data } },
                { text: `Hãy trích xuất toàn bộ câu hỏi trong file PDF đề thi này.\n${PDF_EXTRACTION_SCHEMA}` },
            ],
        }],
        systemInstruction: { parts: [{ text: PDF_EXTRACTION_SYSTEM }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 65536, responseMimeType: 'application/json' },
    };

    const reqBody = JSON.stringify(body);
    const { res: response, data: parsed } = await withRetry(async () => {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody });
        const text = await r.text();
        let d = null;
        try { d = text ? JSON.parse(text) : null; } catch { d = null; }
        return { res: r, data: d };
    });

    if (!response.ok) {
        const msg = parsed?.error?.message || `HTTP ${response.status}`;
        throw new Error(`Gemini PDF lỗi: ${msg}`);
    }

    return extractProviderText('gemini', parsed || {});
}

/**
 * Use active AI provider to parse raw OCR text into questions JSON string.
 * Used as fallback when only a non-Mistral provider is active.
 */
export async function extractQuestionsFromOcrText(ocrText, userId) {
    const settings = loadAISettings(userId);
    const usage = loadAIUsage(userId);
    const activeProvider = getActiveAIProvider(settings);

    if (!activeProvider) {
        throw new Error('Chưa có provider AI đang hoạt động. Hãy bật Gemini, Groq hoặc DeepSeek trong cài đặt AI.');
    }

    const userPrompt = `Phân tích văn bản đề thi sau và trích xuất toàn bộ câu hỏi.\n${PDF_EXTRACTION_SCHEMA}\n\nNội dung:\n${ocrText.slice(0, 14000)}`;
    const estimatedCostVnd = estimateRequestCostVnd(activeProvider.providerId, activeProvider.model);

    ensureDailyAndBudgetLimits(settings, usage, activeProvider, estimatedCostVnd, userPrompt.length);

    const responseText = await requestProviderCompletion({
        providerId: activeProvider.providerId,
        model: activeProvider.model,
        apiKey: activeProvider.apiKey,
        systemPrompt: PDF_EXTRACTION_SYSTEM,
        userPrompt,
    });

    recordAIUsage(userId, activeProvider.providerId, estimatedCostVnd);
    return responseText;
}

/**
 * Normalize a raw question object from AI PDF extraction into editor-compatible format.
 */
export function normalizePdfQuestion(raw, index) {
    const VALID_TYPES = ['mcq', 'tf', 'short_answer', 'essay'];
    const type = VALID_TYPES.includes(raw.type) ? raw.type : 'mcq';
    const contentText = cleanText(raw.content_text || raw.content || raw.question || '');

    let choices = [];
    if (type === 'mcq') {
        const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
        const size = Math.max(4, Math.min(rawChoices.length || 4, LETTERS.length));
        choices = Array.from({ length: size }, (_, i) => {
            const src = rawChoices[i];
            return {
                letter: LETTERS[i],
                text: cleanText(typeof src === 'string' ? src : (src?.text || src?.content || '')),
                html: '',
            };
        });
    } else if (type === 'tf') {
        const rawChoices = Array.isArray(raw.choices) ? raw.choices : [];
        const size = Math.max(2, rawChoices.length || 2);
        choices = Array.from({ length: size }, (_, i) => {
            const letter = String.fromCharCode(97 + i);
            const src = rawChoices[i];
            return {
                letter,
                text: cleanText(typeof src === 'string' ? src : (src?.text || src?.content || '')),
                html: '',
            };
        });
    }

    let correctAnswer = raw.correct_answer ?? raw.answer ?? null;
    if (correctAnswer !== null) correctAnswer = cleanText(String(correctAnswer));

    return {
        number: index + 1,
        type,
        content_text: contentText,
        content_html: contentText,
        image_url: raw.image_url || null,
        choices,
        correct_answer: correctAnswer,
        explanation: cleanText(raw.explanation || raw.solution || ''),
        explanation_html: cleanText(raw.explanation || raw.solution || ''),
        points: Number(raw.points) || 1,
    };
}

/**
 * Parse AI response text into array of normalized question objects.
 */
export function parsePdfAiResponse(responseText) {
    let raw = null;
    try { raw = parseRawJsonArray(responseText); } catch { raw = null; }
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('AI không trả về danh sách câu hỏi hợp lệ. Hãy thử lại hoặc kiểm tra định dạng PDF.');
    }
    return raw.map((item, i) => normalizePdfQuestion(item, i));
}