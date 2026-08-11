import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, doc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { questionsToText } from '../utils/docxParser';
import { parseManualExamSource } from '../utils/importParsers';
import { MATH_GROUPS, MATH_WRAP_OPTIONS, DEFAULT_MATH_WRAP, wrapMathExpression, renderLatexContent as renderLatex } from '../utils/math';
import { extractResourceLinksFromHtml, mergeResourceLinks } from '../utils/resourceLinks';
import { DEFAULT_ANTI_CHEAT, normalizeAntiCheatSettings } from '../utils/examSecurity';
import {
    IMAGE_ALIGN_OPTIONS,
    IMAGE_SIZE_OPTIONS,
    DEFAULT_IMAGE_ALIGN,
    DEFAULT_IMAGE_SIZE,
    blobToDataUrl,
    buildImageTag,
    getStorageSafeImageName,
    optimizeImageFile,
} from '../utils/image';
import { buildExamSearchFields } from '../utils/search';
import { DEFAULT_GAMIFICATION, normalizeGamificationSettings } from '../utils/gamification';
import { buildExamAssetRefs, summarizeExamAssets } from '../utils/examAssets';
import { buildSectionTag, getChoiceDisplayContent, getQuestionSectionKey, getSectionDisplayTitle, groupQuestionsBySection, stripQuestionNumberPrefix } from '../utils/examSections';
import {
    DEFAULT_TF_SCORING,
    TF_SCORING_PRESETS,
    DEFAULT_QUESTION_SCORING,
    buildQuestionTypePatch,
    getQuestionMaxPoints,
    getTfPresetId,
    normalizeQuestionScoring,
    normalizeTfScoring,
} from '../utils/examScoring';
import {
    appendImportHistoryEntry,
    buildImportHistoryEntry,
    buildImportQualityReport,
    getImportQualityBadge,
    getQuestionImportIssues,
} from '../utils/importQuality';
import {
    applyQuestionOptionLayout,
    getQuestionOptionLayout,
    getQuestionOptionLayoutLabel,
    QUESTION_OPTION_LAYOUT_OPTIONS,
    stripOptionLayoutHints,
} from '../utils/questionLayout';
import { buildSyncExamToPrivateBankOperations, commitWriteOperations } from '../utils/bank';
import { DEFAULT_TAXONOMY, loadTaxonomyConfig, mergeTaxonomyOptions } from '../utils/taxonomy';
import { getTeacherCatalogAccess, getTeacherCatalogAccessSummary } from '../utils/teacherCatalogAccess';
import { getGeminiApiKey, getGeminiModel, loadAISettings, loadOcrKeys, saveOcrKeys } from '../utils/aiSettings';
import { extractQuestionsFromOcrText, extractQuestionsWithMistralChat, parsePdfAiResponse, parsePdfQuestionsWithGemini, parsePdfWithMistralOcr } from '../utils/aiAuthoring';

const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Tự luận ngắn', essay: 'Tự luận' };
const TYPE_COLORS = {
    mcq: { bg: '#dbeafe', color: '#1e40af' },
    tf: { bg: '#fef3c7', color: '#92400e' },
    short_answer: { bg: '#d1fae5', color: '#065f46' },
    essay: { bg: '#f3e8ff', color: '#6b21a8' },
};
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const CONICGV_URL = import.meta.env.VITE_CONICGV_URL || 'https://conicgv.web.app';
const IMPORT_FILE_ACCEPT = '.docx,.txt,.md,.xlsx,.xls,.tex,.latex,.json';
const MANUAL_SOURCE_TEMPLATE = String.raw`%%--Câu 1:--%%
\begin{ex}
Cho hàm số $f(x)=x^2+3x-2$. Tính đạo hàm của hàm số.
\choice
{\True $f'(x)=2x+3$}
{$f'(x)=x+3$}
{$f'(x)=2x-2$}
{$f'(x)=2x$}
\loigiai{Áp dụng công thức $(x^n)'=nx^{n-1}$ và $(ax+b)'=a$.}
\end{ex}`;

// ── Sample templates ─────────────────────────────────────────────────────────
const TXT_TEMPLATE = `Câu 1: Kết quả của 2 + 2 là?
A. 3
B. 4
C. 5
D. 6
Đáp án: B
Lời giải: 2 + 2 = 4

Câu 2: Tổng các góc trong tam giác bằng bao nhiêu độ?
A. 90°
B. 180°
C. 270°
D. 360°
Đáp án: B

Câu 3: Xét các mệnh đề về số nguyên tố.
a) Số 2 là số nguyên tố chẵn duy nhất
b) Số 1 là số nguyên tố
c) Mọi số nguyên tố > 2 đều lẻ
d) Số nguyên tố là số chia hết cho chính nó và 1
Đáp án: DSDD
Lời giải: Mệnh đề b) sai vì số 1 không phải số nguyên tố.

Câu 4: Năm Việt Nam gia nhập ASEAN?
Đáp án: 1995
Lời giải: Việt Nam gia nhập ASEAN ngày 28/7/1995.
Điểm: 1
`;

const JSON_TEMPLATE = {
    title: 'Đề thi mẫu (sửa tên này)',
    subject: 'Toán',
    duration: 45,
    questions: [
        {
            type: 'mcq',
            content: 'Câu trắc nghiệm: Kết quả của 2 + 2 là?',
            choices: [
                { letter: 'A', text: '3' },
                { letter: 'B', text: '4' },
                { letter: 'C', text: '5' },
                { letter: 'D', text: '6' },
            ],
            answer: 'B',
            explanation: '2 + 2 = 4',
            points: 1,
        },
        {
            type: 'mcq',
            content: 'Câu có ảnh URL: Hình bên là đường cong nào?',
            image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Parabola.svg/200px-Parabola.svg.png',
            choices: [
                { letter: 'A', text: 'Parabol' },
                { letter: 'B', text: 'Hypebol' },
                { letter: 'C', text: 'Elip' },
                { letter: 'D', text: 'Đường thẳng' },
            ],
            answer: 'A',
            points: 1,
        },
        {
            type: 'tf',
            content: 'Xét các mệnh đề về số nguyên tố.',
            choices: [
                { letter: 'a', text: 'Số 2 là số nguyên tố chẵn duy nhất' },
                { letter: 'b', text: 'Số 1 là số nguyên tố' },
                { letter: 'c', text: 'Mọi số nguyên tố > 2 đều lẻ' },
                { letter: 'd', text: 'Số nguyên tố là số chia hết cho chính nó và 1' },
            ],
            answer: 'DSDD',
        },
        {
            type: 'short_answer',
            content: 'Năm Việt Nam gia nhập ASEAN? (chỉ điền số)',
            answer: '1995',
            explanation: 'Việt Nam gia nhập ASEAN ngày 28/7/1995.',
            points: 1,
        },
    ],
};

function downloadTemplate(filename, content, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const GUIDE_TABS = [
    { id: 'start', icon: 'signpost-split', label: 'Bắt đầu nhanh' },
    { id: 'formats', icon: 'file-earmark-text', label: 'Chuẩn chung' },
    { id: 'json', icon: 'filetype-json', label: 'JSON + Ảnh' },
    { id: 'english', icon: 'translate', label: 'GV Tiếng Anh' },
    { id: 'latex', icon: 'bezier2', label: 'LaTeX / ConicGV' },
];
const ENGLISH_TAG_GUIDE = [
    { tag: '<g>', title: 'Nhóm có thể trộn', detail: 'Dùng cho passage hoặc dạng bài thông thường. Hệ thống giữ nguyên context và trộn câu, trộn đáp án trong nhóm.' },
    { tag: '<g_khongtron>', title: 'Giữ thứ tự câu', detail: 'Dùng khi câu hỏi phải đi theo đúng trình tự passage. Hệ thống giữ nguyên thứ tự câu, nhưng đáp án vẫn có thể được trộn.' },
    { tag: '<g_codinhdapan>', title: 'Giữ nguyên đáp án', detail: 'Dùng khi muốn trộn câu trong nhóm nhưng thứ tự A-B-C-D phải giữ nguyên như đề gốc.' },
    { tag: '<g_codinh>', title: 'Cố định vị trí nhóm', detail: 'Dùng khi cả phần phải nằm đúng vị trí trong đề. Bên trong nhóm vẫn áp dụng quy tắc trộn tương ứng của tag.' },
    { tag: '<g_codinhtoanbo>', title: 'Khóa toàn bộ', detail: 'Không trộn câu, không trộn đáp án, nhóm đứng yên tại vị trí hiện tại. Hợp với part đặc thù hoặc đề mẫu chuẩn.' },
    { tag: '<g_lay5>', title: 'Mỗi phần lấy k câu', detail: 'Ví dụ `lay5` nghĩa là khi phát đề chỉ lấy 5 câu từ phần này. Có thể ghép với tag khác như `<g_khongtron_lay5>` hoặc `<g_codinh_lay3>`.' },
    { tag: '<g_tf>', title: 'Phần Đúng / Sai', detail: 'Khai báo riêng phần Đúng/Sai để parser và giao diện hiển thị đúng kiểu câu hỏi.' },
    { tag: '<g_essay>', title: 'Phần viết / tự luận', detail: 'Dùng cho viết câu, viết đoạn, short answer hoặc essay. Hệ thống mặc định không trộn đáp án trong nhóm này.' },
];
const QUICKSTART_STEPS = [
    { id: 'pick', icon: 'file-earmark-arrow-up', title: 'Chọn file', detail: 'DOCX, TXT, Excel hoặc TEX tùy nguồn đề sẵn có.' },
    { id: 'parse', icon: 'cpu', title: 'Đợi parser', detail: 'Hệ thống đọc câu hỏi, ảnh, công thức và các section.' },
    { id: 'review', icon: 'shield-check', title: 'Rà nhanh', detail: 'Xem Khiên nhập đề và sửa ngay các câu bị đánh dấu.' },
    { id: 'save', icon: 'check2-square', title: 'Lưu và phát hành', detail: 'Đặt tiêu đề, môn, thời gian rồi lưu bản nháp hoặc lưu chính thức.' },
];
const QUICKSTART_GUIDE_AREAS = [
    { id: 'start', icon: 'signpost-split', title: 'Bắt đầu nhanh', detail: 'Cho giáo viên mới hoặc đang nhập đề lần đầu.' },
    { id: 'formats', icon: 'file-earmark-text', title: 'Chuẩn chung', detail: 'Cho đề trắc nghiệm, đúng/sai và tự luận ngắn.' },
    { id: 'english', icon: 'translate', title: 'GV Tiếng Anh', detail: 'Cho đề có passage, part, tag nhóm hoặc Question X.' },
    { id: 'latex', icon: 'bezier2', title: 'LaTeX / ConicGV', detail: 'Cho đề nhiều công thức hoặc soạn từ ConicGV.' },
];

export default function UploadExamPage() {
    const { user, userProfile } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [title, setTitle] = useState('');
    const [subject, setSubject] = useState('');
    const [grade, setGrade] = useState('');
    const [duration, setDuration] = useState(45);
    const [maxAttempts, setMaxAttempts] = useState(1);
    const [shuffleQuestions, setShuffleQuestions] = useState(true);
    const [shuffleChoices, setShuffleChoices] = useState(true);
    const [showResult, setShowResult] = useState(true);
    const [antiCheatEnabled, setAntiCheatEnabled] = useState(DEFAULT_ANTI_CHEAT.enabled);
    const [antiCheatRequireFullscreen, setAntiCheatRequireFullscreen] = useState(DEFAULT_ANTI_CHEAT.requireFullscreen);
    const [antiCheatMaxWarnings, setAntiCheatMaxWarnings] = useState(DEFAULT_ANTI_CHEAT.maxWarnings);
    const [gamification, setGamification] = useState(DEFAULT_GAMIFICATION);
    const [examType, setExamType] = useState('');
    const [scoreScale, setScoreScale] = useState('');
    const [questionScoring, setQuestionScoring] = useState(DEFAULT_QUESTION_SCORING);
    const [tfScoring, setTfScoring] = useState(DEFAULT_TF_SCORING);

    const [file, setFile] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [parseWarnings, setParseWarnings] = useState([]);
    const [importSourceFormat, setImportSourceFormat] = useState('manual');
    const [importSourceLabel, setImportSourceLabel] = useState('Soạn tay');
    const [questions, setQuestions] = useState(null);
    const [imageFiles, setImageFiles] = useState([]);
    const [imageMap, setImageMap] = useState({});
    const [activeQ, setActiveQ] = useState(0);
    const [editingQ, setEditingQ] = useState(-1);
    const [leftTab, setLeftTab] = useState('edit');
    const [sourceText, setSourceText] = useState('');
    const [saving, setSaving] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showExplIdx, setShowExplIdx] = useState(new Set());
    const [guideOpen, setGuideOpen] = useState(true);
    const [guideTab, setGuideTab] = useState('start');
    const [taxonomy, setTaxonomy] = useState(DEFAULT_TAXONOMY);
    const [entryMode, setEntryMode] = useState('upload');

    // PDF import state
    const [pdfFile, setPdfFile] = useState(null);
    const [pdfProcessing, setPdfProcessing] = useState(false);
    const [pdfReviewOpen, setPdfReviewOpen] = useState(false);
    const [pdfReviewItems, setPdfReviewItems] = useState([]); // {question, included, editing}
    const pdfInputRef = useRef(null);

    // Math sub-dialog
    const [mathTarget, setMathTarget] = useState(null);
    const [mathLatex, setMathLatex] = useState('');
    const [mathPaletteGroup, setMathPaletteGroup] = useState(0);
    const [mathWrapMode, setMathWrapMode] = useState(DEFAULT_MATH_WRAP);

    // Image upload
    const imgInputRef = useRef(null);
    const [imgTarget, setImgTarget] = useState(null); // { field: 'content'|'choice'|'explanation', cIdx? }

    const previewRefs = useRef([]);
    const editorRefs = useRef([]);
    const fieldRefs = useRef({});

    useEffect(() => {
        let active = true;
        loadTaxonomyConfig()
            .then((config) => {
                if (active) setTaxonomy(config);
            })
            .catch((error) => console.error('load taxonomy failed', error));

        return () => {
            active = false;
        };
    }, []);

    // ── Accept questions passed from PdfImportLabPage ───────────────────────
    useEffect(() => {
        const incoming = location.state?.pdfImportQuestions;
        if (!Array.isArray(incoming) || incoming.length === 0) return;
        // Normalize to editor format (add number, clear state)
        const normalized = incoming.map((q, i) => ({
            number: i + 1,
            type: q.type || 'mcq',
            content_text: q.content_text || '',
            content_html: q.content_text || '',
            choices: q.choices || [],
            correct_answer: q.correct_answer || null,
            explanation: q.explanation || '',
            explanation_html: q.explanation || '',
            points: q.points || 1,
            image_url: q.image_url || null,
        }));
        setQuestions(normalized);
        setImportSourceFormat('pdf');
        setImportSourceLabel('Import từ PDF');
        setActiveQ(0);
        setLeftTab('edit');
        // Clear location state to prevent re-import on refresh
        window.history.replaceState({}, '', window.location.pathname);
    }, [location.state]);


    const catalogAccess = useMemo(() => getTeacherCatalogAccess(userProfile, taxonomy), [taxonomy, userProfile]);
    const catalogAccessSummary = useMemo(() => getTeacherCatalogAccessSummary(userProfile, taxonomy), [taxonomy, userProfile]);
    const subjectOptions = useMemo(() => mergeTaxonomyOptions(catalogAccess.allowedSubjects, subject), [catalogAccess.allowedSubjects, subject]);
    const gradeOptions = useMemo(() => mergeTaxonomyOptions(catalogAccess.allowedGrades, grade), [catalogAccess.allowedGrades, grade]);

    // ═══ File handling ═══
    const handleParse = useCallback(async (f) => {
        if (!f) return;
        setParsing(true);
        setParseWarnings([]);
        try {
            const { parseImportedExamFile } = await import('../utils/importParsers');
            const result = await parseImportedExamFile(f);
            if (result.questions.length === 0) {
                Swal.fire('Không tìm thấy câu hỏi', 'Không phát hiện được câu hỏi hợp lệ trong file này.', 'warning');
                setParsing(false);
                return;
            }
            const importedQuestions = result.questions.map((question) => (
                applyQuestionOptionLayout(question, getQuestionOptionLayout(question))
            ));
            setQuestions(importedQuestions);
            setImageFiles(result.imageFiles);
            setImageMap(result.imageMap);
            setSourceText(questionsToText(importedQuestions));
            setImportSourceFormat(result.sourceFormat || 'manual');
            setImportSourceLabel(result.sourceLabel || f.name);
            // Auto-fill exam meta from JSON
            if (result.examMeta) {
                if (result.examMeta.title) setTitle(result.examMeta.title);
                if (result.examMeta.subject) setSubject(result.examMeta.subject);
                if (result.examMeta.duration) setDuration(Number(result.examMeta.duration));
            }
            // Warnings about images
            const warns = [...(result.warnings || [])];
            if (result.imageFiles?.length > 0) {
                const emfWmf = result.imageFiles.filter(f => /\.(emf|wmf)$/i.test(f.name));
                if (emfWmf.length > 0) warns.push(`${emfWmf.length} ảnh EMF/WMF (MathType) — trình duyệt có thể không hiển thị được`);
                warns.push(`Tìm thấy ${result.imageFiles.length} hình ảnh trong DOCX`);
            }
            const imgCount = importedQuestions.reduce((s, q) => {
                let c = (q.content_html || '').split('<img ').length - 1;
                (q.choices || []).forEach(ch => { c += (ch.html || '').split('<img ').length - 1; });
                return s + c;
            }, 0);
            if (imgCount > 0) warns.push(`${imgCount} hình ảnh được chèn vào câu hỏi`);
            setParseWarnings(warns);
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi đọc file', err.message, 'error');
        } finally { setParsing(false); }
    }, []);

    const handleFileChange = useCallback((f) => {
        if (!f) return;
        setFile(f);
        setQuestions(null);
        setEditingQ(-1);
        setParseWarnings([]);
        setEntryMode('upload');
        setImportSourceFormat('manual');
        setImportSourceLabel('Soạn tay');
        handleParse(f);
    }, [handleParse]);

    const loadQuestionsFromSource = useCallback((rawSource, { successTitle } = {}) => {
        const result = parseManualExamSource(rawSource);
        if (result.questions.length === 0) {
            Swal.fire(
                'Không tìm thấy câu hỏi',
                'Nguồn chưa đúng định dạng. Bạn có thể dùng văn bản kiểu Câu 1 / A. / Đáp án hoặc chuẩn \\begin{ex} ... \\end{ex}.',
                'warning',
            );
            return null;
        }

        const parsedQuestions = result.questions.map((question) => (
            applyQuestionOptionLayout(question, getQuestionOptionLayout(question))
        ));

        setQuestions(parsedQuestions);
        setFile(null);
        setEditingQ(-1);
        setActiveQ(0);
        setImageFiles([]);
        setImageMap({});
        setParseWarnings(result.warnings || []);
        setImportSourceFormat(result.sourceFormat || 'manual');
        setImportSourceLabel(result.sourceLabel || 'Soạn từ mã nguồn');
        setLeftTab('edit');
        setEntryMode('upload');

        Swal.fire({
            icon: 'success',
            title: successTitle || `Đã cập nhật ${parsedQuestions.length} câu`,
            text: result.warnings?.length ? `Có ${result.warnings.length} cảnh báo cần soát lại.` : undefined,
            timer: 1600,
            showConfirmButton: false,
        });

        return parsedQuestions;
    }, []);

    const startBlankDraft = useCallback(() => {
        const blankQuestion = applyQuestionOptionLayout({
            number: 1,
            type: 'mcq',
            content_text: '',
            content_html: '',
            choices: LETTERS.slice(0, 4).map((letter) => ({ letter, text: '', html: '' })),
            correct_answer: null,
            explanation: null,
            explanation_html: null,
        }, null);

        setQuestions([blankQuestion]);
        setFile(null);
        setEditingQ(0);
        setActiveQ(0);
        setImageFiles([]);
        setImageMap({});
        setParseWarnings([]);
        setImportSourceFormat('manual');
        setImportSourceLabel('Soạn tay');
        setSourceText(questionsToText([blankQuestion]));
        setLeftTab('edit');
        setEntryMode('upload');
    }, []);

    // ═══ PDF import ═══
    const handlePdfImport = useCallback(async (f) => {
        if (!f || f.type !== 'application/pdf') {
            Swal.fire('Định dạng không đúng', 'Chỉ hỗ trợ file PDF (.pdf)', 'warning');
            return;
        }
        setPdfFile(f);
        setPdfProcessing(true);

        try {
            const aiSettings = loadAISettings(user?.uid);
            const ocrKeys = loadOcrKeys(user?.uid);
            let mistralKey = ocrKeys?.mistral || '';
            const geminiKey = getGeminiApiKey(aiSettings);
            const geminiModel = getGeminiModel(aiSettings);

            // ── Inline key dialog if neither key is configured ──────────────
            if (!geminiKey && !mistralKey) {
                const { value: enteredKey, isConfirmed } = await Swal.fire({
                    title: 'Nhập Mistral API key',
                    html: `<p style="font-size:0.88rem;color:#555;margin-bottom:8px">
                        Lấy key miễn phí tại <a href="https://console.mistral.ai/api-keys" target="_blank">console.mistral.ai</a><br/>
                        Key sẽ được lưu cho lần sau. Dùng 1 key cho cả OCR + trích xuất câu hỏi.
                    </p>`,
                    input: 'password',
                    inputPlaceholder: 'Dán API key Mistral vào đây...',
                    inputAttributes: { autocomplete: 'off', style: 'font-family:monospace' },
                    confirmButtonText: 'Tiếp tục',
                    showCancelButton: true,
                    cancelButtonText: 'Huỷ',
                    preConfirm: (val) => {
                        if (!val || val.length < 20) {
                            Swal.showValidationMessage('Key không hợp lệ (quá ngắn)');
                            return false;
                        }
                        return val.trim();
                    },
                });
                if (!isConfirmed || !enteredKey) { setPdfProcessing(false); return; }
                mistralKey = enteredKey;
                saveOcrKeys(user?.uid, { mistral: enteredKey });
            }

            // ── Image upload callback → Firebase Storage ────────────────────
            const uploadOcrImage = async (imgId, base64Data) => {
                // base64Data is the image from Mistral OCR response (already base64)
                const byteString = atob(base64Data);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                const ext = imgId.split('.').pop() || 'jpg';
                const blob = new Blob([ab], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
                const path = `pdf-ocr/${user?.uid}/${Date.now()}_${imgId}`;
                const storageRef = ref(storage, path);
                await uploadBytes(storageRef, blob);
                return await getDownloadURL(storageRef);
            };

            let rawText = null;

            if (geminiKey) {
                // Gemini: PDF → questions in 1 call (still uses base64 inline_data)
                rawText = await parsePdfQuestionsWithGemini(f, geminiKey, geminiModel);
            } else {
                // Mistral: upload PDF → OCR (URL-based, no base64) → Mistral chat extraction
                const { markdown } = await parsePdfWithMistralOcr(f, mistralKey, uploadOcrImage);
                rawText = await extractQuestionsWithMistralChat(markdown, mistralKey);
            }

            const parsed = parsePdfAiResponse(rawText);
            if (parsed.length === 0) {
                Swal.fire('Không tìm thấy câu hỏi', 'AI không phát hiện được câu hỏi trong PDF này. Hãy thử file khác hoặc kiểm tra chất lượng PDF.', 'warning');
                setPdfProcessing(false);
                return;
            }

            setPdfReviewItems(parsed.map((q) => ({ question: q, included: true })));
            setPdfReviewOpen(true);
        } catch (err) {
            console.error('PDF import error:', err);
            Swal.fire('Lỗi đọc PDF', err.message || 'Không thể xử lý file PDF. Hãy thử lại.', 'error');
        } finally {
            setPdfProcessing(false);
        }
    }, [user]);

    // ═══ Question editing ═══
    const updateQ = useCallback((idx, updates) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== idx) return q;
            const updated = { ...q, ...updates };
            if ('content_text' in updates) {
                const imgs = extractImgTags(q.content_html);
                updated.content_html = richHtml(updates.content_text, imgs);
            }
            if ('explanation' in updates) {
                const imgs = extractImgTags(q.explanation_html);
                updated.explanation_html = updates.explanation ? richHtml(updates.explanation, imgs) : null;
            }
            return updated;
        }));
    }, []);

    const updateChoice = useCallback((qIdx, cIdx, updates) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const choices = q.choices.map((c, j) => {
                if (j !== cIdx) return c;
                const u = { ...c, ...updates };
                if ('text' in updates) {
                    const imgs = extractImgTags(c.html);
                    u.html = richHtml(updates.text, imgs);
                }
                return u;
            });
            return { ...q, choices };
        }));
    }, []);

    const setCorrectAnswer = useCallback((qIdx, answer) => {
        setQuestions(prev => prev.map((q, i) => i === qIdx ? { ...q, correct_answer: answer } : q));
    }, []);

    const addChoice = useCallback((qIdx) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const nextLetter = LETTERS[q.choices.length] || String(q.choices.length + 1);
            return { ...q, choices: [...q.choices, { letter: nextLetter, text: '', html: '' }] };
        }));
    }, []);

    const removeChoice = useCallback((qIdx, cIdx) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const choices = q.choices.filter((_, j) => j !== cIdx);
            let correct = q.correct_answer;
            if (q.type === 'mcq' && correct === q.choices[cIdx]?.letter) correct = null;
            return { ...q, choices, correct_answer: correct };
        }));
    }, []);

    const deleteQuestion = useCallback((idx) => {
        setQuestions(prev => {
            const updated = prev.filter((_, i) => i !== idx);
            return updated.map((q, i) => ({ ...q, number: i + 1 }));
        });
        if (activeQ >= idx && activeQ > 0) setActiveQ(prev => prev - 1);
        if (editingQ === idx) setEditingQ(-1);
    }, [activeQ, editingQ]);

    const changeType = useCallback((idx, newType) => {
        setQuestions((prev) => prev.map((question, questionIndex) => {
            if (questionIndex !== idx) return question;
            return applyQuestionOptionLayout({
                ...question,
                ...buildQuestionTypePatch(question, newType, questionScoring, tfScoring),
            }, newType === 'mcq' ? getQuestionOptionLayout(question) : null);
        }));
    }, [questionScoring, tfScoring]);

    const setQuestionOptionLayout = useCallback((idx, nextLayout) => {
        setQuestions((prev) => prev.map((question, questionIndex) => {
            if (questionIndex !== idx) return question;
            return applyQuestionOptionLayout(question, nextLayout);
        }));
    }, []);

    // ═══ Toolbar actions for textarea ═══
    const wrapSelection = useCallback((fieldKey, before, after) => {
        const ta = fieldRefs.current[fieldKey];
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const selected = val.slice(start, end);
        const newVal = val.slice(0, start) + before + selected + after + val.slice(end);
        // Determine which field to update
        if (fieldKey === 'q-content') {
            updateQ(editingQ, { content_text: newVal });
        } else if (fieldKey === 'q-expl') {
            updateQ(editingQ, { explanation: newVal });
        } else if (fieldKey.startsWith('q-c')) {
            const ci = parseInt(fieldKey.slice(3));
            updateChoice(editingQ, ci, { text: newVal });
        }
        // Restore selection after update
        setTimeout(() => {
            ta.focus();
            ta.selectionStart = start + before.length;
            ta.selectionEnd = start + before.length + selected.length;
        }, 10);
    }, [editingQ, updateQ, updateChoice]);

    const insertAtLineStart = useCallback((fieldKey, prefix) => {
        const ta = fieldRefs.current[fieldKey];
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        // Add prefix to each line in the selection (or current line)
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = val.indexOf('\n', end);
        const actualEnd = lineEnd === -1 ? val.length : lineEnd;
        const block = val.slice(lineStart, actualEnd);
        const lines = block.split('\n');
        const prefixed = lines.map((line, i) => {
            if (prefix === '1. ') return `${i + 1}. ${line}`;
            return prefix + line;
        }).join('\n');
        const newVal = val.slice(0, lineStart) + prefixed + val.slice(actualEnd);
        if (fieldKey === 'q-content') updateQ(editingQ, { content_text: newVal });
        else if (fieldKey === 'q-expl') updateQ(editingQ, { explanation: newVal });
        else if (fieldKey.startsWith('q-c')) updateChoice(editingQ, parseInt(fieldKey.slice(3)), { text: newVal });
        setTimeout(() => { ta.focus(); }, 10);
    }, [editingQ, updateQ, updateChoice]);

    const askImageInsertOptions = useCallback(async () => {
        const sizeOptionsHtml = IMAGE_SIZE_OPTIONS.map((option) => `<option value="${option.id}" ${option.id === DEFAULT_IMAGE_SIZE ? 'selected' : ''}>${option.label}</option>`).join('');
        const alignOptionsHtml = IMAGE_ALIGN_OPTIONS.map((option) => `<option value="${option.id}" ${option.id === DEFAULT_IMAGE_ALIGN ? 'selected' : ''}>${option.label}</option>`).join('');

        const result = await Swal.fire({
            title: 'Chèn ảnh',
            html: `
                <div style="display:grid;gap:12px;text-align:left">
                    <label style="display:grid;gap:6px">
                        <span style="font-size:0.85rem;font-weight:600">Kích thước</span>
                        <select id="swal-image-size" class="swal2-select" style="display:flex;width:100%;margin:0">${sizeOptionsHtml}</select>
                    </label>
                    <label style="display:grid;gap:6px">
                        <span style="font-size:0.85rem;font-weight:600">Vị trí</span>
                        <select id="swal-image-align" class="swal2-select" style="display:flex;width:100%;margin:0">${alignOptionsHtml}</select>
                    </label>
                    <small style="color:#64748b">Ảnh tải mới sẽ được nén sang WebP nếu có thể để nhẹ hơn.</small>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Chèn ảnh',
            cancelButtonText: 'Hủy',
            focusConfirm: false,
            preConfirm: () => {
                const popup = Swal.getPopup();
                return {
                    size: popup.querySelector('#swal-image-size')?.value || DEFAULT_IMAGE_SIZE,
                    align: popup.querySelector('#swal-image-align')?.value || DEFAULT_IMAGE_ALIGN,
                };
            },
        });

        return result.isConfirmed ? result.value : null;
    }, []);

    const appendImageTags = useCallback((target, imgTags) => {
        const i = editingQ;
        if (i < 0 || !target || !imgTags) return;

        if (target.field === 'content') {
            setQuestions(prev => prev.map((q, qi) => {
                if (qi !== i) return q;
                return { ...q, content_html: (q.content_html || '') + imgTags };
            }));
            return;
        }

        if (target.field === 'choice' && target.cIdx != null) {
            setQuestions(prev => prev.map((q, qi) => {
                if (qi !== i) return q;
                const choices = q.choices.map((c, j) => j === target.cIdx ? { ...c, html: (c.html || '') + imgTags } : c);
                return { ...q, choices };
            }));
            return;
        }

        if (target.field === 'explanation') {
            setQuestions(prev => prev.map((q, qi) => {
                if (qi !== i) return q;
                return { ...q, explanation_html: (q.explanation_html || '') + imgTags };
            }));
        }
    }, [editingQ]);

    // ═══ Image upload ═══
    const handleImageUpload = useCallback(async (e) => {
        const files = Array.from(e.target.files || []);
        const target = imgTarget;
        if (!files.length || editingQ < 0 || !target) return;

        const insertOptions = await askImageInsertOptions();
        if (!insertOptions) {
            setImgTarget(null);
            if (imgInputRef.current) imgInputRef.current.value = '';
            return;
        }

        const uploaded = [];
        const batchId = Date.now();
        for (const [index, file] of files.entries()) {
            if (!file.type.startsWith('image/')) continue;
            if (file.size > 5 * 1024 * 1024) {
                Swal.fire('Ảnh quá lớn', `${file.name} vượt quá 5MB`, 'warning');
                continue;
            }
            const optimized = await optimizeImageFile(file, { fileName: file.name });
            const dataUrl = await blobToDataUrl(optimized.blob);
            uploaded.push({
                id: `manual_${batchId}_${index}_${optimized.name}`,
                dataUrl,
                name: optimized.name,
                blob: optimized.blob,
                mime: optimized.mime,
            });
        }
        if (uploaded.length === 0) {
            setImgTarget(null);
            if (imgInputRef.current) imgInputRef.current.value = '';
            return;
        }

        // Add to imageFiles for later upload
        setImageFiles(prev => [...prev, ...uploaded.map(u => ({
            rId: u.id,
            name: u.name, blob: u.blob, mime: u.mime,
        }))]);

        // Insert <img> tag into html and update imageMap
        const imgTags = uploaded.map(u => buildImageTag(u.dataUrl, insertOptions)).join('');
        setImageMap(prev => {
            const n = { ...prev };
            uploaded.forEach(u => { n[u.id] = u.dataUrl; });
            return n;
        });

        appendImageTags(target, imgTags);
        setImgTarget(null);
        if (imgInputRef.current) imgInputRef.current.value = '';
    }, [appendImageTags, askImageInsertOptions, editingQ, imgTarget]);

    const triggerImgUpload = useCallback((field, cIdx) => {
        setImgTarget({ field, cIdx });
        setTimeout(() => imgInputRef.current?.click(), 50);
    }, []);

    // ═══ Remove image ═══
    const removeImage = useCallback((qIdx, field, cIdx, imgIdx) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const removeNth = (html, n) => {
                let count = 0;
                return html.replace(/<img [^>]*>/g, (match) => {
                    if (count++ === n) return '';
                    return match;
                });
            };
            if (field === 'content') return { ...q, content_html: removeNth(q.content_html, imgIdx) };
            if (field === 'choice') {
                const choices = q.choices.map((c, j) => j === cIdx ? { ...c, html: removeNth(c.html, imgIdx) } : c);
                return { ...q, choices };
            }
            if (field === 'explanation') return { ...q, explanation_html: removeNth(q.explanation_html, imgIdx) };
            return q;
        }));
    }, []);

    // ═══ Math sub-dialog ═══
    const openMath = useCallback((field, cIdx) => {
        setMathTarget({ field, cIdx });
        setMathLatex('');
        setMathPaletteGroup(0);
        setMathWrapMode(DEFAULT_MATH_WRAP);
    }, []);

    const insertMathSymbol = useCallback((latex) => {
        setMathLatex(prev => {
            const ph = '\u25AB';
            const idx = prev.indexOf(ph);
            if (idx >= 0) return prev.slice(0, idx) + latex + prev.slice(idx + 1);
            return prev + latex;
        });
    }, []);

    const confirmMath = useCallback(() => {
        if (!mathTarget || editingQ < 0 || !mathLatex.trim()) return;
        const i = editingQ;
        const tex = wrapMathExpression(mathLatex, mathWrapMode);
        if (mathTarget.field === 'content') {
            const q = questions[i];
            const ta = fieldRefs.current['q-content'];
            const old = q.content_text || '';
            const pos = ta?.selectionStart ?? old.length;
            updateQ(i, { content_text: old.slice(0, pos) + tex + old.slice(pos) });
        } else if (mathTarget.field === 'choice') {
            const c = questions[i].choices[mathTarget.cIdx];
            const ta = fieldRefs.current['q-c' + mathTarget.cIdx];
            const old = c.text || '';
            const pos = ta?.selectionStart ?? old.length;
            updateChoice(i, mathTarget.cIdx, { text: old.slice(0, pos) + tex + old.slice(pos) });
        } else if (mathTarget.field === 'explanation') {
            const q = questions[i];
            const ta = fieldRefs.current['q-expl'];
            const old = q.explanation || '';
            const pos = ta?.selectionStart ?? old.length;
            updateQ(i, { explanation: old.slice(0, pos) + tex + old.slice(pos) });
        }
        setMathTarget(null);
        setMathLatex('');
        setMathWrapMode(DEFAULT_MATH_WRAP);
    }, [mathTarget, editingQ, mathLatex, mathWrapMode, questions, updateQ, updateChoice]);

    // ═══ Explanation toggle ═══
    const toggleExplanation = useCallback((idx) => {
        setShowExplIdx(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx); else next.add(idx);
            return next;
        });
    }, []);

    // ═══ Source mode ═══
    const applySource = useCallback(() => {
        loadQuestionsFromSource(sourceText);
    }, [loadQuestionsFromSource, sourceText]);

    useEffect(() => {
        if (leftTab === 'source' && questions) setSourceText(questionsToText(questions));
    }, [leftTab, questions]);

    // ═══ Validation ═══
    const getIssues = useCallback((q) => {
        return getQuestionImportIssues(q);
    }, []);

    const stats = useMemo(() => {
        if (!questions) return null;
        const total = questions.length;
        const byType = {};
        let valid = 0;
        for (const q of questions) {
            byType[q.type] = (byType[q.type] || 0) + 1;
            if (getIssues(q).length === 0) valid++;
        }
        return { total, byType, valid, invalid: total - valid };
    }, [questions, getIssues]);

    const importQualityReport = useMemo(() => buildImportQualityReport({
        questions: questions || [],
        warningCount: parseWarnings.length,
        warningSamples: parseWarnings,
        sourceFormat: importSourceFormat || 'manual',
        imageCount: imageFiles?.length || 0,
    }), [imageFiles, importSourceFormat, parseWarnings, questions]);
    const importQualityBadge = getImportQualityBadge(importQualityReport, importSourceFormat || 'manual');
    const sectionGroups = useMemo(() => groupQuestionsBySection(questions || []), [questions]);
    const explicitSectionGroups = useMemo(() => sectionGroups.filter((group) => group.meta.explicit), [sectionGroups]);

    const updateSectionGroupSettings = useCallback((groupKey, patch = {}) => {
        setQuestions((previous) => previous.map((question, index) => {
            if (getQuestionSectionKey(question, index, previous) !== groupKey) return question;

            const nextQuestion = {
                ...question,
                sectionShuffleQuestions: patch.sectionShuffleQuestions ?? question.sectionShuffleQuestions ?? true,
                sectionShuffleChoices: patch.sectionShuffleChoices ?? question.sectionShuffleChoices ?? (question.type !== 'essay'),
                sectionFixedPosition: patch.sectionFixedPosition ?? question.sectionFixedPosition ?? false,
                sectionQuestionLimit: patch.sectionQuestionLimit == null || patch.sectionQuestionLimit === ''
                    ? null
                    : Math.max(0, Number(patch.sectionQuestionLimit) || 0),
            };

            return {
                ...nextQuestion,
                sectionTag: buildSectionTag(nextQuestion),
                sectionTitle: nextQuestion.sectionTitle || getSectionDisplayTitle(nextQuestion),
            };
        }));
    }, []);

    const renderGuideContent = () => {
        if (guideTab === 'json') {
            return (
                <>
                    <div className="upload-guide-meta">
                        <span><i className="bi bi-filetype-json"></i> Import file <b>.json</b> để nhập đề nhanh từ hệ thống khác hoặc từ dữ liệu lập trình.</span>
                        <span><i className="bi bi-images"></i> Hỗ trợ ảnh qua <b>image_url</b> (link ảnh) hoặc <b>image</b> (base64 data:image/...).</span>
                        <span><i className="bi bi-magic"></i> Hệ thống tự điền Tên đề, Môn học, Thời gian nếu JSON có các trường đó.</span>
                    </div>
                    <div className="upload-template-bar">
                        <span className="upload-template-label"><i className="bi bi-download"></i> File mẫu:</span>
                        <button type="button" className="btn btn-sm btn-outline upload-tpl-btn"
                            onClick={() => downloadTemplate('de-mau.json', JSON.stringify(JSON_TEMPLATE, null, 2), 'application/json')}>
                            <i className="bi bi-filetype-json"></i> Tải JSON mẫu
                        </button>
                        <a href="/templates/millionaire/millionaire-live-template.json" target="_blank" rel="noreferrer" className="btn btn-sm btn-outline upload-tpl-btn">
                            <i className="bi bi-gem"></i> JSON millionaire 12 câu
                        </a>
                        <a href="/templates/millionaire/huong-dan-ai-la-trieu-phu.html" target="_blank" rel="noreferrer" className="btn btn-sm btn-outline upload-tpl-btn">
                            <i className="bi bi-journal-richtext"></i> Xem HDSD millionaire
                        </a>
                        <span className="upload-template-hint">Mở, sửa theo đúng cấu trúc rồi import lên.</span>
                    </div>
                    <div className="upload-guide-grid two-col">
                        <div className="upload-guide-card">
                            <h5><i className="bi bi-list-check"></i> Cấu trúc file JSON cơ bản</h5>
                            <pre className="upload-guide-code" style={{fontSize:'0.78rem'}}>{`{
  "title": "Tên đề thi",
  "subject": "Toán",
  "duration": 45,
  "questions": [
    {
      "type": "mcq",
      "content": "Nội dung câu hỏi",
      "choices": [
        { "letter": "A", "text": "Đáp án A" },
        { "letter": "B", "text": "Đáp án B" },
        { "letter": "C", "text": "Đáp án C" },
        { "letter": "D", "text": "Đáp án D" }
      ],
      "answer": "A",
      "explanation": "Lời giải (tuỳ chọn)",
      "points": 1
    }
  ]
}`}</pre>
                        </div>
                        <div className="upload-guide-card highlight">
                            <h5><i className="bi bi-images"></i> Cách chèn ảnh trong JSON</h5>
                            <p style={{marginBottom:8}}>Ảnh trong JSON <b>không upload</b> lên Storage — mà dùng link trực tiếp. Có 2 cách:</p>
                            <pre className="upload-guide-code" style={{fontSize:'0.78rem'}}>{`// Cách 1 — URL ảnh từ internet hoặc CDN:
{
  "content": "Câu hỏi có ảnh",
  "image_url": "https://example.com/hinh.png",
  ...
}

// Cách 2 — Ảnh nhúng base64:
{
  "content": "Câu hỏi",
  "image": "data:image/png;base64,iVBOR...",
  ...
}

// Ảnh trong đáp án (choices):
{
  "letter": "A",
  "text": "Mô tả",
  "image_url": "https://example.com/a.png"
}`}</pre>
                            <div className="upload-guide-note subtle" style={{marginTop:10}}>
                                <i className="bi bi-exclamation-triangle"></i>
                                <span>Nếu URL ảnh bị xoá hoặc server chặn CORS, ảnh sẽ không hiển thị khi học sinh làm bài. Nên upload ảnh lên Firebase Storage hoặc Cloudinary trước.</span>
                            </div>
                        </div>
                    </div>
                    <div className="upload-guide-grid two-col">
                        <div className="upload-guide-card">
                            <h5><i className="bi bi-diagram-3"></i> Các kiểu câu hỏi hỗ trợ</h5>
                            <ul className="upload-guide-list">
                                <li><b>"type": "mcq"</b> — Trắc nghiệm. <code>choices</code> + <code>answer</code> là chữ cái (A/B/C/D).</li>
                                <li><b>"type": "tf"</b> — Đúng/Sai. <code>choices</code> dùng chữ thường a/b/c/d, <code>answer</code> là chuỗi như <code>"DSDD"</code>.</li>
                                <li><b>"type": "short_answer"</b> — Tự luận ngắn. Không cần <code>choices</code>, chỉ cần <code>answer</code>.</li>
                                <li><b>"type": "essay"</b> — Tự luận dài. <code>answer</code> tuỳ chọn.</li>
                            </ul>
                        </div>
                        <div className="upload-guide-card">
                            <h5><i className="bi bi-check2-all"></i> Tên trường linh hoạt</h5>
                            <p style={{marginBottom:6}}>Parser nhận nhiều tên trường khác nhau để dễ tích hợp:</p>
                            <ul className="upload-guide-list">
                                <li><code>content</code> / <code>question</code> / <code>text</code> / <code>stem</code></li>
                                <li><code>answer</code> / <code>correct_answer</code> / <code>correctAnswer</code></li>
                                <li><code>explanation</code> / <code>solution</code> / <code>explain</code></li>
                                <li><code>choices</code> / <code>options</code> / <code>answers</code></li>
                                <li><code>points</code> / <code>score</code> — điểm mỗi câu (mặc định 1)</li>
                                <li>Mảng chuỗi đơn giản trong choices: <code>["A", "B", "C"]</code></li>
                            </ul>
                        </div>
                    </div>
                </>
            );
        }

        if (guideTab === 'formats') {
            return (
                <>
                    <div className="upload-guide-meta">
                        <span><i className="bi bi-filetype-docx"></i> DOCX là lựa chọn tốt nhất nếu đề có ảnh, công thức hoặc passage phức tạp.</span>
                        <span><i className="bi bi-filetype-txt"></i> TXT / MD hợp với đề văn bản gọn, copy từ Word, Google Docs hoặc Zalo.</span>
                        <span><i className="bi bi-file-earmark-spreadsheet"></i> Excel hợp với ngân hàng câu hỏi đã tách cột nội dung, đáp án và lời giải.</span>
                        <span><i className="bi bi-bezier2"></i> TEX hợp với đề Toán, Lý, Hóa cần công thức đẹp và đồng bộ.</span>
                        <span><i className="bi bi-filetype-json"></i> <b>JSON</b> hợp với đề xuất từ hệ thống khác hoặc lập trình viên; câu hỏi có ảnh URL được hỗ trợ.</span>
                    </div>
                    <div className="upload-template-bar">
                        <span className="upload-template-label"><i className="bi bi-download"></i> Tải file mẫu:</span>
                        <button type="button" className="btn btn-sm btn-outline upload-tpl-btn"
                            onClick={() => downloadTemplate('de-mau.txt', TXT_TEMPLATE, 'text/plain;charset=utf-8')}>
                            <i className="bi bi-filetype-txt"></i> TXT mẫu
                        </button>
                        <button type="button" className="btn btn-sm btn-outline upload-tpl-btn"
                            onClick={() => downloadTemplate('de-mau.json', JSON.stringify(JSON_TEMPLATE, null, 2), 'application/json')}>
                            <i className="bi bi-filetype-json"></i> JSON mẫu (có ảnh URL)
                        </button>
                        <span className="upload-template-hint">Mở file mẫu, sửa theo đúng cấu trúc rồi import lên.</span>
                    </div>
                    <div className="upload-guide-grid two-col">
                        <div className="upload-guide-card">
                            <h5><i className="bi bi-check2-square"></i> Quy tắc để parser đọc ổn định nhất</h5>
                            <ul className="upload-guide-list">
                                <li>Mỗi câu bắt đầu bằng <b>Câu 1:</b>, <b>Câu 2.</b>, <b>Question 1</b> hoặc <b>(Q12)</b>.</li>
                                <li>Trắc nghiệm nên viết theo từng dòng A., B., C., D. để parser nhận dạng ổn định.</li>
                                <li>Đáp án đúng có thể đánh dấu bằng gạch chân trong DOCX hoặc viết dòng <b>Đáp án: A</b>.</li>
                                <li>Lời giải nên để riêng một dòng <b>Lời giải:</b> để hiển thị đẹp ở trang kết quả.</li>
                                <li>Nếu cần ảnh, ưu tiên chèn trong DOCX; hệ thống sẽ upload và tối ưu khi lưu.</li>
                            </ul>
                        </div>
                        <div className="upload-guide-card highlight">
                            <h5><i className="bi bi-shield-check"></i> Sau khi import, giáo viên cần kiểm gì?</h5>
                            <ol className="upload-guide-list ordered">
                                <li>Xem <b>Khiên nhập đề</b> để biết có bao nhiêu câu hợp lệ và bao nhiêu cảnh báo.</li>
                                <li>Mở nhanh 3-5 câu đầu, 3-5 câu cuối và các câu có ảnh, công thức hoặc lời giải.</li>
                                <li>Nếu thấy sai đáp án, sửa ngay trong editor rồi mới mở đề cho học sinh.</li>
                                <li>Nếu cần, hãy lưu bản nháp trước; hệ thống sẽ giữ lịch sử import và lịch sử rà soát.</li>
                            </ol>
                        </div>
                    </div>
                    <div className="format-cols compact">
                        <div className="format-col"><h5>Trắc nghiệm</h5><pre>{'Câu 1: Nội dung\nA. Đáp án A\nB. Đáp án B\nC. Đáp án C\nD. Đáp án D\nĐáp án: B'}</pre></div>
                        <div className="format-col"><h5>Đúng / Sai</h5><pre>{'Câu 2: Nội dung\na) Mệnh đề 1\nb) Mệnh đề 2\nc) Mệnh đề 3\nd) Mệnh đề 4\nĐáp án: DSDD'}</pre></div>
                        <div className="format-col"><h5>Tự luận ngắn</h5><pre>{'Câu 3: Nội dung\nĐáp án: 42\nLời giải: Chi tiết...\nĐiểm: 1'}</pre></div>
                    </div>
                    <div className="upload-guide-note">
                        <i className="bi bi-lightbulb"></i>
                        <span><b>Mẹo:</b> Nếu giáo viên đang có sẵn một đề Word hoàn chỉnh, cứ import DOCX trước. TXT và Excel phù hợp hơn khi ngân hàng đề đã được chuẩn hóa.</span>
                    </div>
                </>
            );
        }

        if (guideTab === 'english') {
            return (
                <>
                    <div className="upload-guide-hero english">
                        <div>
                            <div className="upload-guide-kicker">Khu riêng cho giáo viên Tiếng Anh</div>
                            <h5>Nhập đề theo passage / part / section mà không làm vỡ cấu trúc khi trộn</h5>
                            <p>Đặt context, đoạn văn, hướng dẫn hoặc heading ngay sau thẻ mở nhóm. Parser sẽ giữ nguyên context và chỉ trộn trong từng nhóm theo đúng quy tắc tag.</p>
                        </div>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => document.getElementById('file-input')?.click()}>
                            <i className="bi bi-upload"></i> Thử import đề Anh
                        </button>
                    </div>
                    <div className="upload-guide-grid english-tags">
                        {ENGLISH_TAG_GUIDE.map((item) => (
                            <div key={item.tag} className="upload-guide-card tag-card">
                                <div className="upload-guide-tag">{item.tag}</div>
                                <h5>{item.title}</h5>
                                <p>{item.detail}</p>
                            </div>
                        ))}
                    </div>
                    <div className="upload-guide-grid two-col">
                        <div className="upload-guide-card">
                            <h5><i className="bi bi-list-ol"></i> Cách gõ đề Anh để parser đọc đúng</h5>
                            <ol className="upload-guide-list ordered">
                                <li>Mở nhóm bằng thẻ như <b>{'<g>'}</b> hoặc <b>{'<g_khongtron>'}</b>.</li>
                                <li>Đặt passage, heading hoặc instruction ngay sau thẻ mở nhóm.</li>
                                <li>Mỗi câu bắt đầu bằng <b>Question 1</b>, <b>Question 2</b> hoặc <b>(Q12)</b>.</li>
                                <li>Đóng nhóm bằng thẻ đóng tương ứng như <b>{'</g>'}</b>.</li>
                                <li>Nếu có nhiều part, lặp lại từng nhóm một cách độc lập.</li>
                            </ol>
                        </div>
                        <div className="upload-guide-card highlight">
                            <h5><i className="bi bi-shuffle"></i> Khi học sinh làm bài, hệ thống xử lý ra sao?</h5>
                            <ul className="upload-guide-list">
                                <li>Không trộn passage hoặc context sang nhóm khác.</li>
                                <li>Mặc định chỉ trộn câu và đáp án <b>trong từng phần</b>, không trộn liên nhóm.</li>
                                <li>Trang kết quả và chức năng chấm lại vẫn đúng vì session lưu snapshot thứ tự đáp án đã giao.</li>
                                <li>Nếu giáo viên dùng tag cố định, hệ thống sẽ tôn trọng quy tắc đó khi phát đề.</li>
                            </ul>
                        </div>
                    </div>
                    <div className="upload-guide-code-card">
                        <div className="upload-guide-code-head">
                            <strong>Ví dụ đề Anh nên copy gần như mẫu này</strong>
                            <span>Passage + câu hỏi + tag đóng nhóm</span>
                        </div>
                        <pre className="upload-guide-code">{`<g>\nRead the following passage and choose the best answer.\n\nQuestion 1. What is the main idea of the passage?\nA. ...\nB. ...\nC. ...\nD. ...\n\nQuestion 2. The word "it" in paragraph 2 refers to ...\nA. ...\nB. ...\nC. ...\nD. ...\n</g>\n\n<g_khongtron>\nMark the following statements True or False based on the notice.\n\n(Q12) Students must submit the form before Friday.\na) True\nb) False\n</g_khongtron>`}</pre>
                    </div>
                    <div className="upload-guide-note">
                        <i className="bi bi-info-circle"></i>
                        <span><b>Lưu ý:</b> Nếu đề Anh chưa có tag nhóm, hệ thống vẫn import được; nhưng nên thêm tag nếu giáo viên muốn giữ đúng passage / part khi trộn đề.</span>
                    </div>
                </>
            );
        }

        if (guideTab === 'latex') {
            return (
                <>
                    <div className="upload-guide-grid two-col">
                        <div className="upload-guide-card highlight">
                            <h5><i className="bi bi-bezier2"></i> Luồng nhanh với ConicGV</h5>
                            <ol className="upload-guide-list ordered">
                                <li>Soạn nội dung, công thức hoặc hình vẽ trên ConicGV.</li>
                                <li>Export ra file <b>.tex</b>.</li>
                                <li>Kéo thả trực tiếp vào đây để parser đọc thành câu hỏi.</li>
                                <li>Kiểm tra lại một vài công thức và canh hàng trước khi lưu.</li>
                            </ol>
                            <a href={CONICGV_URL} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm upload-guide-link-btn">
                                <i className="bi bi-box-arrow-up-right"></i> Mở ConicGV
                            </a>
                        </div>
                        <div className="upload-guide-card">
                            <h5><i className="bi bi-calculator"></i> Khi nào nên dùng TEX?</h5>
                            <ul className="upload-guide-list">
                                <li>Khi đề có nhiều công thức, biểu thức canh hàng hoặc ký hiệu khoa học.</li>
                                <li>Khi giáo viên muốn giữ một nguồn đề đồng bộ giữa ConicGV và thi-online.</li>
                                <li>Khi cần chỉnh sửa bằng mã nguồn thay vì kéo thả từ Word.</li>
                            </ul>
                            <div className="upload-guide-note subtle">
                                <i className="bi bi-image"></i>
                                <span>Ảnh tải lên trong editor vẫn được tối ưu WebP khi lưu, kể cả với đề TEX.</span>
                            </div>
                        </div>
                    </div>
                </>
            );
        }

        return (
            <>
                <div className="upload-guide-meta">
                    <span><i className="bi bi-file-earmark-check"></i> Chấp nhận .docx, .txt, .xlsx/.xls, .tex, .json</span>
                    <span><i className="bi bi-images"></i> DOCX có thể đọc kèm ảnh, công thức và passage</span>
                    <span><i className="bi bi-shield-check"></i> Sau khi import, xem Khiên nhập đề trước khi mở cho học sinh</span>
                </div>
                <div className="upload-template-bar">
                    <span className="upload-template-label"><i className="bi bi-download"></i> Tải file mẫu:</span>
                    <button type="button" className="btn btn-sm btn-outline upload-tpl-btn"
                        onClick={() => downloadTemplate('de-mau.txt', TXT_TEMPLATE, 'text/plain;charset=utf-8')}>
                        <i className="bi bi-filetype-txt"></i> TXT
                    </button>
                    <button type="button" className="btn btn-sm btn-outline upload-tpl-btn"
                        onClick={() => downloadTemplate('de-mau.json', JSON.stringify(JSON_TEMPLATE, null, 2), 'application/json')}>
                        <i className="bi bi-filetype-json"></i> JSON (có ảnh URL)
                    </button>
                    <a href="/templates/millionaire/millionaire-live-template.txt" target="_blank" rel="noreferrer" className="btn btn-sm btn-outline upload-tpl-btn">
                        <i className="bi bi-gem"></i> Millionaire TXT 12 câu
                    </a>
                    <a href="/templates/millionaire/huong-dan-ai-la-trieu-phu.html" target="_blank" rel="noreferrer" className="btn btn-sm btn-outline upload-tpl-btn">
                        <i className="bi bi-journal-richtext"></i> HDSD ready check + award stage
                    </a>
                </div>
                <div className="upload-guide-hero start">
                    <div>
                        <div className="upload-guide-kicker">Luồng nhập đề ngắn gọn</div>
                        <h5>Giảm đọc hướng dẫn dài, chỉ giữ các quyết định giáo viên cần làm ngay</h5>
                        <p>Thay vì hai khối chữ cao và nặng, giao diện này gom lại thành 4 bước thao tác và 4 khu hướng dẫn để giáo viên nhìn là biết bắt đầu từ đâu.</p>
                    </div>
                    <div className="upload-guide-tag">4 bước / 4 khu thao tác</div>
                </div>
                <div className="upload-guide-flow">
                    {QUICKSTART_STEPS.map((step, index) => (
                        <div key={step.id} className="upload-guide-step">
                            <div className="upload-guide-step-top">
                                <span className="upload-guide-step-index">{index + 1}</span>
                                <i className={`bi bi-${step.icon}`}></i>
                            </div>
                            <strong>{step.title}</strong>
                            <p>{step.detail}</p>
                        </div>
                    ))}
                </div>
                <div className="upload-guide-tab-grid">
                    {QUICKSTART_GUIDE_AREAS.map((item) => (
                        <div key={item.id} className="upload-guide-pick-card">
                            <div className="upload-guide-pick-title"><i className={`bi bi-${item.icon}`}></i> {item.title}</div>
                            <p>{item.detail}</p>
                        </div>
                    ))}
                </div>
                <div className="upload-guide-note">
                    <i className="bi bi-arrow-right-circle"></i>
                    <span><b>Gợi ý nhanh:</b> Nếu đây là đề Tiếng Anh có passage, hãy vào ngay tab <b>GV Tiếng Anh</b> để dùng đúng mẫu và đúng bộ tag.</span>
                </div>
            </>
        );
    };

    // ═══ Save ═══
    const handleSave = async () => {
        if (!title.trim()) {
            Swal.fire('Thiếu tiêu đề', 'Nhập tiêu đề đề thi trước khi lưu.', 'warning');
            setShowSettings(true);
            return;
        }
        if (!questions?.length) return;

        if (importQualityReport.invalidQuestions > 0) {
            const confirmation = await Swal.fire({
                title: 'Khiên nhập đề đang cảnh báo',
                html: `Hệ thống phát hiện <b>${importQualityReport.invalidQuestions} câu</b> còn lỗi cấu trúc. Bạn vẫn có thể lưu để tiếp tục sửa, nhưng đề sẽ ở trạng thái draft và không nên mở cho học sinh ngay.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Lưu bản nháp an toàn',
                cancelButtonText: 'Quay lại sửa tiếp',
                confirmButtonColor: '#f59e0b',
            });
            if (!confirmation.isConfirmed) return;
        }

        setSaving(true);
        try {
            Swal.fire({ title: 'Đang lưu đề thi...', html: '<p>Tải hình ảnh & lưu câu hỏi...</p>', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const storageUrlMap = {};
            const uploadedAssetRefs = [];
            if (imageFiles?.length > 0) {
                for (const img of imageFiles) {
                    const optimized = await optimizeImageFile(img.blob, { fileName: img.name });
                    const imgRef = ref(storage, 'exams/' + user.uid + '/' + Date.now() + '_' + getStorageSafeImageName(optimized.name));
                    await uploadBytes(imgRef, optimized.blob, { contentType: optimized.mime });
                    const url = await getDownloadURL(imgRef);
                    const dataUrl = imageMap[img.rId];
                    if (dataUrl) storageUrlMap[dataUrl] = url;
                    uploadedAssetRefs.push({
                        path: imgRef.fullPath,
                        url,
                        size: optimized.blob.size,
                        mime: optimized.mime,
                        uploadedAt: Timestamp.now(),
                    });
                }
            }
            // Also upload manually added images
            const allHtml = questions.map(q => [q.content_html, q.explanation_html, ...(q.choices || []).map(c => c.html)].join('')).join('');
            const dataUrlMatches = allHtml.match(/src="(data:image\/[^"]+)"/g) || [];
            for (const m of dataUrlMatches) {
                const du = m.slice(5, -1);
                if (storageUrlMap[du]) continue;
                const resp = await fetch(du);
                const blob = await resp.blob();
                const optimized = await optimizeImageFile(blob, { fileName: 'manual-upload.png' });
                const imgRef = ref(storage, 'exams/' + user.uid + '/' + Date.now() + '_' + getStorageSafeImageName(optimized.name));
                await uploadBytes(imgRef, optimized.blob, { contentType: optimized.mime });
                const url = await getDownloadURL(imgRef);
                storageUrlMap[du] = url;
                uploadedAssetRefs.push({
                    path: imgRef.fullPath,
                    url,
                    size: optimized.blob.size,
                    mime: optimized.mime,
                    uploadedAt: Timestamp.now(),
                });
            }
            const replUrls = (html) => {
                if (!html) return html;
                for (const [d, s] of Object.entries(storageUrlMap)) html = html.replaceAll(d, s);
                return html;
            };
            const qs = questions.map((question, idx) => {
                const q = applyQuestionOptionLayout(question, getQuestionOptionLayout(question));
                const contentHtml = replUrls(q.content_html);
                const explanationHtml = replUrls(q.explanation_html);
                const choices = (q.choices || []).map(c => ({ letter: c.letter, text: c.text, html: replUrls(c.html) }));
                const sectionContextHtml = replUrls(q.sectionContextHtml || null);
                const resourceLinks = mergeResourceLinks(
                    q.resourceLinks || [],
                    extractResourceLinksFromHtml(contentHtml || '', { scope: 'question', source: 'content_html' }),
                    extractResourceLinksFromHtml(explanationHtml || '', { scope: 'question', source: 'explanation_html' }),
                    ...choices.map((choice) => extractResourceLinksFromHtml(choice.html || '', { scope: 'question', source: 'choice_html' })),
                );
                const sectionResourceLinks = mergeResourceLinks(
                    q.sectionResourceLinks || [],
                    extractResourceLinksFromHtml(sectionContextHtml || '', { scope: 'section', source: 'section_html' }),
                );
                return {
                    number: q.number,
                    type: q.type,
                    points: getQuestionMaxPoints(q, questionScoring, tfScoring),
                    optionLayout: q.optionLayout,
                    content_text: q.content_text,
                    content_html: contentHtml,
                    choices,
                    correct_answer: q.correct_answer,
                    explanation: q.explanation,
                    explanation_html: explanationHtml,
                    order: idx + 1,
                    sectionId: q.sectionId || null,
                    sectionOrder: q.sectionOrder ?? null,
                    sectionTag: q.sectionTag ? buildSectionTag(q) : null,
                    sectionTitle: q.sectionTitle || null,
                    sectionContextText: q.sectionContextText || null,
                    sectionContextHtml,
                    sectionShuffleQuestions: q.sectionShuffleQuestions ?? null,
                    sectionShuffleChoices: q.sectionShuffleChoices ?? null,
                    sectionFixedPosition: q.sectionFixedPosition ?? null,
                    sectionQuestionLimit: q.sectionQuestionLimit ?? null,
                    resourceLinks,
                    sectionResourceLinks,
                };
            });
            const assetRefs = buildExamAssetRefs({ questions: qs, uploadedAssets: uploadedAssetRefs });
            const assetSummary = summarizeExamAssets(assetRefs, { storageReused: false });
            const createdAt = Timestamp.now();
            const importHistory = appendImportHistoryEntry([], buildImportHistoryEntry({
                kind: importSourceFormat === 'manual' ? 'manual_created' : 'import_created',
                actorId: user.uid,
                actorName: user.displayName || user.email,
                actorRole: 'teacher',
                at: createdAt,
                note: importSourceLabel || 'Soan tay',
                report: importQualityReport,
                sourceFormat: importSourceFormat || 'manual',
            }));
            const teacherName = user.displayName || user.email;
            if (!catalogAccess.hasFullCatalogAccess) {
                const subjectAllowed = !subject.trim() || subjectOptions.includes(subject.trim());
                const gradeAllowed = !grade.trim() || gradeOptions.includes(grade.trim());
                if (!subjectAllowed || !gradeAllowed) {
                    Swal.fire('Ngoài gói đã cấp', 'Môn hoặc khối của đề không nằm trong gói truy cập hiện tại của bạn.', 'warning');
                    setSaving(false);
                    return;
                }
            }
            const examRef = doc(collection(db, 'exams'));
            const examPayload = {
                title: title.trim(),
                subject: subject.trim() || null,
                grade: grade.trim() || null,
                teacherId: user.uid,
                teacherName,
                duration: Number(duration),
                questionCount: qs.length,
                maxAttempts: Number(maxAttempts),
                shuffleQuestions,
                shuffleChoices,
                showResult,
                examType: examType || null,
                scoreScale: scoreScale || null,
                questionScoring: normalizeQuestionScoring(questionScoring),
                tfScoring: normalizeTfScoring(tfScoring),
                antiCheat: normalizeAntiCheatSettings({
                    enabled: antiCheatEnabled,
                    requireFullscreen: antiCheatRequireFullscreen,
                    maxWarnings: antiCheatMaxWarnings,
                }),
                gamification: normalizeGamificationSettings(gamification),
                ...buildExamSearchFields({
                    title: title.trim(),
                    subject: subject.trim(),
                    grade: grade.trim(),
                    teacherName,
                }),
                sourceFormat: importSourceFormat || 'manual',
                sourceLabel: importSourceLabel || 'Soạn tay',
                bankSyncEnabled: true,
                importQuality: importQualityReport,
                importHistory,
                assetRefs,
                assetSummary,
                status: 'draft',
                createdAt,
            };
            const questionRefs = qs.map(() => doc(collection(db, 'exams', examRef.id, 'questions')));
            const questionsWithIds = qs.map((question, index) => ({
                id: questionRefs[index].id,
                ...question,
            }));
            const writeOperations = [
                { type: 'set', ref: examRef, data: examPayload },
                ...questionRefs.map((questionRef, index) => ({
                    type: 'set',
                    ref: questionRef,
                    data: qs[index],
                })),
                ...buildSyncExamToPrivateBankOperations({
                    ownerId: user.uid,
                    ownerName: teacherName,
                    exam: { id: examRef.id, ...examPayload },
                    questions: questionsWithIds,
                    actorId: user.uid,
                    actorName: teacherName,
                }),
            ];
            await commitWriteOperations(writeOperations);
            Swal.fire({
                icon: 'success', title: 'Tạo đề thành công!',
                html: '<b>' + title + '</b> — ' + qs.length + ' câu hỏi<br><small style="color:#888">Trạng thái: Nháp</small>',
                confirmButtonColor: '#5b5ea6',
            });
            navigate('/teacher');
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi', err.message, 'error');
        } finally { setSaving(false); }
    };

    // Editing Q
    const eq = editingQ >= 0 && questions ? questions[editingQ] : null;

    // ═══ Mini toolbar component ═══
    const EditorToolbar = ({ fieldKey, onMath, onImage }) => (
        <div className="ed-toolbar">
            <button type="button" className="ed-tb-btn textual" title="In đậm **text**" onClick={() => wrapSelection(fieldKey, '**', '**')}>
                <span className="ed-tb-glyph">B</span>
            </button>
            <button type="button" className="ed-tb-btn textual" title="In nghiêng *text*" onClick={() => wrapSelection(fieldKey, '*', '*')}>
                <span className="ed-tb-glyph italic">I</span>
            </button>
            <button type="button" className="ed-tb-btn textual" title="Gạch chân" onClick={() => wrapSelection(fieldKey, '<u>', '</u>')}>
                <span className="ed-tb-glyph underline">U</span>
            </button>
            <button type="button" className="ed-tb-btn textual" title="Gạch ngang" onClick={() => wrapSelection(fieldKey, '~~', '~~')}>
                <span className="ed-tb-glyph strike">S</span>
            </button>
            <span className="ed-tb-sep" />
            <button type="button" className="ed-tb-btn textual compact" title="Căn giữa" onClick={() => wrapSelection(fieldKey, '<center>', '</center>')}>
                <span className="ed-tb-glyph small">Căn</span>
            </button>
            <button type="button" className="ed-tb-btn textual compact" title="Danh sách •" onClick={() => insertAtLineStart(fieldKey, '• ')}>
                <span className="ed-tb-glyph">•</span>
            </button>
            <button type="button" className="ed-tb-btn textual compact" title="Danh sách 1." onClick={() => insertAtLineStart(fieldKey, '1. ')}>
                <span className="ed-tb-glyph small">1.</span>
            </button>
            <span className="ed-tb-sep" />
            <button type="button" className="ed-tb-btn textual compact" title="Tô sáng" onClick={() => wrapSelection(fieldKey, '<mark>', '</mark>')}>
                <span className="ed-tb-glyph small">HL</span>
            </button>
            <button type="button" className="ed-tb-btn textual" title="Chỉ số trên" onClick={() => wrapSelection(fieldKey, '<sup>', '</sup>')}>
                x<sup style={{fontSize:'0.6em'}}>²</sup>
            </button>
            <button type="button" className="ed-tb-btn textual" title="Chỉ số dưới" onClick={() => wrapSelection(fieldKey, '<sub>', '</sub>')}>
                x<sub style={{fontSize:'0.6em'}}>₂</sub>
            </button>
            <span className="ed-tb-sep" />
            <button type="button" className="ed-tb-btn accent" title="Chèn công thức" onClick={onMath}>
                <i className="bi bi-calculator"></i> <span className="ed-tb-label">Σ Công thức</span>
            </button>
            <button type="button" className="ed-tb-btn accent" title="Chèn hình ảnh" onClick={onImage}>
                <i className="bi bi-image"></i> <span className="ed-tb-label">Ảnh</span>
            </button>
        </div>
    );

    // ═══ Image gallery component ═══
    const ImageGallery = ({ html, field, cIdx, qIdx }) => {
        const imgs = extractImgTags(html);
        if (imgs.length === 0) return null;
        return (
            <div className="ed-img-gallery">
                {imgs.map((img, j) => (
                    <div key={j} className="ed-img-item">
                        <div className="ed-img-preview" dangerouslySetInnerHTML={{ __html: img }} />
                        <button className="ed-img-remove" onClick={() => removeImage(qIdx, field, cIdx, j)} title="Xóa ảnh">
                            <i className="bi bi-x-circle-fill"></i>
                        </button>
                    </div>
                ))}
            </div>
        );
    };

    // Hidden file input for images
    const imgInput = <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />;

    // ═══ STEP 1: Upload ═══
    if (!questions) {
        return (
            <div className="upload-step">
                {imgInput}
                <div className="upload-step-inner">
                    <div className="upload-hero">
                        <i className="bi bi-file-earmark-word-fill"></i>
                        <h1>Tạo đề thi từ file hoặc soạn trực tiếp</h1>
                        <p>Hỗ trợ Word (.docx), văn bản (.txt), bảng (.xlsx/.xls), LaTeX (.tex) và mã nguồn PDV3 / ex ngay trong trình biên tập</p>
                    </div>
                    <div className="upload-dropzone"
                        onClick={() => document.getElementById('file-input').click()}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                        onDragLeave={e => e.currentTarget.classList.remove('dragover')}
                        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) handleFileChange(f); }}>
                        {parsing ? (
                            <div className="upload-parsing">
                                <span className="spinner" style={{ width: 40, height: 40 }}></span>
                                <p style={{ marginTop: 16, fontWeight: 600 }}>Đang phân tích <b>{file?.name}</b>...</p>
                                <small style={{ color: 'var(--text-muted)' }}>Trích xuất câu hỏi, đáp án, hình ảnh và công thức theo chuẩn phù hợp</small>
                            </div>
                        ) : (
                            <>
                                <i className="bi bi-cloud-arrow-up-fill"></i>
                                <p className="upload-main-text">{file ? file.name : 'Kéo thả file vào đây'}</p>
                                <span className="upload-sub-text">hoặc bấm để chọn file</span>
                            </>
                        )}
                    </div>
                    <input id="file-input" type="file" accept={IMPORT_FILE_ACCEPT}
                        onChange={e => { if (e.target.files[0]) handleFileChange(e.target.files[0]); }}
                        style={{ display: 'none' }} />
                    <input ref={pdfInputRef} type="file" accept=".pdf" style={{ display: 'none' }}
                        onChange={e => { if (e.target.files[0]) { handlePdfImport(e.target.files[0]); e.target.value = ''; } }} />
                    <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-outline" onClick={startBlankDraft}>
                                <i className="bi bi-pencil-square"></i> Tạo đề trống để soạn tay
                            </button>
                            <button type="button" className="btn btn-outline pdf-import-btn" onClick={() => pdfInputRef.current?.click()} disabled={pdfProcessing}>
                                {pdfProcessing
                                    ? <><span className="spinner" style={{ width: 14, height: 14 }}></span> Đang đọc PDF...</>
                                    : <><i className="bi bi-file-earmark-pdf-fill"></i> Import từ PDF</>}
                            </button>
                            <button
                                type="button"
                                className={`btn ${entryMode === 'source' ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => {
                                    setEntryMode((prev) => prev === 'source' ? 'upload' : 'source');
                                    if (!sourceText.trim()) setSourceText(MANUAL_SOURCE_TEMPLATE);
                                }}
                            >
                                <i className="bi bi-code-square"></i> Soạn từ mã nguồn
                            </button>
                        </div>

                        {entryMode === 'source' && (
                            <div className="upload-format-info" style={{ marginTop: 0 }}>
                                <div style={{ display: 'grid', gap: 12 }}>
                                    <div className="upload-guide-toolbar" style={{ gap: 12 }}>
                                        <div>
                                            <h4><i className="bi bi-code-slash"></i> Soạn trực tiếp trong hệ thống</h4>
                                            <p>Dán văn bản thường kiểu <b>Câu 1 / A. / Đáp án</b> hoặc chuẩn <b>PDV3 / ex</b> với <b>\\begin{'{'}ex{'}'}</b>, <b>\\choice</b>, <b>\\choiceTF</b>, <b>\\shortans</b>.</p>
                                        </div>
                                        <button type="button" className="btn btn-outline btn-sm upload-guide-toggle" onClick={() => setSourceText(MANUAL_SOURCE_TEMPLATE)}>
                                            <i className="bi bi-layers"></i> Nạp mẫu PDV3
                                        </button>
                                    </div>

                                    <textarea
                                        className="ee-source-textarea"
                                        style={{ minHeight: 260 }}
                                        value={sourceText}
                                        onChange={(e) => setSourceText(e.target.value)}
                                        spellCheck={false}
                                        placeholder={'Câu 1: Nội dung...\nA. ...\nB. ...\nĐáp án: A\n\nhoặc chuẩn \\begin{ex} ... \\end{ex}'}
                                    />

                                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                        <button type="button" className="btn btn-primary" onClick={applySource}>
                                            <i className="bi bi-magic"></i> Phân tích và mở trình biên tập
                                        </button>
                                        <button type="button" className="btn btn-outline" onClick={() => setSourceText('')}>
                                            <i className="bi bi-eraser"></i> Xóa trắng
                                        </button>
                                    </div>

                                    <small style={{ color: 'var(--text-muted)' }}>
                                        Chế độ này lấy ý tưởng từ PDV3 Studio: nhập nguồn, phân tích nhanh rồi chuyển sang editor câu hỏi hiện có của hệ thống.
                                    </small>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="upload-format-info upload-guide-center">
                        <div className="upload-guide-toolbar">
                            <div>
                                <h4><i className="bi bi-book"></i> HDSD nhập đề cho giáo viên</h4>
                                <p>Chọn đúng tab theo kiểu đề đang soạn. Giao diện này đã được tách lại theo từng nhu cầu để giáo viên nhìn một lần là biết bắt đầu từ đâu.</p>
                            </div>
                            <button type="button" className="btn btn-outline btn-sm upload-guide-toggle" onClick={() => setGuideOpen((prev) => !prev)}>
                                <i className={`bi bi-chevron-${guideOpen ? 'up' : 'down'}`}></i>
                                {guideOpen ? 'Thu gọn HDSD' : 'Mở HDSD'}
                            </button>
                        </div>

                        {guideOpen && (
                            <div className="upload-guide-body">
                                <div className="upload-guide-tabs" role="tablist" aria-label="Huong dan nhap de">
                                    {GUIDE_TABS.map((tab) => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={guideTab === tab.id}
                                            className={`upload-guide-tab ${guideTab === tab.id ? 'active' : ''} ${tab.id === 'english' ? 'english' : ''}`}
                                            onClick={() => setGuideTab(tab.id)}
                                        >
                                            <i className={`bi bi-${tab.icon}`}></i>
                                            <span>{tab.label}</span>
                                        </button>
                                    ))}
                                </div>

                                <div className="upload-guide-content">
                                    {renderGuideContent()}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ═══ STEP 2: Editor ═══
    return (
        <div className="exam-editor">
            {imgInput}
            {/* Header */}
            <div className="ee-header">
                <div className="ee-header-left">
                    <button className="btn btn-sm btn-ghost" onClick={() => { setQuestions(null); setFile(null); setEditingQ(-1); }} title="Quay lại">
                        <i className="bi bi-arrow-left"></i>
                    </button>
                    <input type="text" className="ee-title-input" placeholder="Nhập tiêu đề đề thi..." value={title} onChange={e => setTitle(e.target.value)} />
                </div>
                <div className="ee-header-right">
                    <button className="btn btn-sm btn-ghost" onClick={() => setShowSettings(!showSettings)} title="Cài đặt">
                        <i className="bi bi-gear"></i> Cài đặt
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !title.trim()}>
                        {saving ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span> Lưu...</> : <><i className="bi bi-check-lg"></i> Lưu đề thi</>}
                    </button>
                </div>
            </div>

            <AnimatePresence>
                {showSettings && (
                    <motion.div className="ee-settings" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                        <div className="ee-settings-grid">
                            <label>Loai de <select className="form-select-sm" value={examType} onChange={e => setExamType(e.target.value)}>
                                <option value="">—</option>
                                <option value="Kiem tra mieng">Kiem tra mieng</option>
                                <option value="Kiem tra 15 phut">Kiem tra 15 phut</option>
                                <option value="Kiem tra 1 tiet">Kiem tra 1 tiet</option>
                                <option value="Kiem tra giua ky">Kiem tra giua ky</option>
                                <option value="Kiem tra cuoi ky">Kiem tra cuoi ky</option>
                                <option value="Thi thu">Thi thu</option>
                                <option value="Bai luyen tap">Bai luyen tap</option>
                                <option value="Bai tap ve nha">Bai tap ve nha</option>
                            </select></label>
                            <label>Thang diem <select className="form-select-sm" value={scoreScale} onChange={e => setScoreScale(e.target.value)}>
                                <option value="">Dung diem goc</option>
                                <option value="10">Thang 10</option>
                                <option value="100">Thang 100</option>
                            </select></label>
                            <label>Môn <select className="form-select-sm" value={subject} onChange={e => setSubject(e.target.value)}>
                                <option value="">—</option>
                                {subjectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select></label>
                            <label>Lớp <select className="form-select-sm" value={grade} onChange={e => setGrade(e.target.value)}>
                                <option value="">—</option>
                                {gradeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select></label>
                            {!catalogAccess.hasFullCatalogAccess && (
                                <div className="ee-access-note">
                                    <i className="bi bi-shield-lock"></i> Gói hiện tại: {catalogAccessSummary.packageLabel} · {catalogAccessSummary.subjectsText} · {catalogAccessSummary.gradesText}
                                </div>
                            )}
                            <label>Thời gian <input type="number" className="form-input-sm" min="1" max="180" value={duration} onChange={e => setDuration(e.target.value)} /> phút</label>
                            <label>Số lần thi <input type="number" className="form-input-sm" min="1" max="10" value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} /></label>
                            <label className="ee-toggle"><input type="checkbox" checked={shuffleQuestions} onChange={e => setShuffleQuestions(e.target.checked)} /> Xáo câu hỏi</label>
                            <label className="ee-toggle"><input type="checkbox" checked={shuffleChoices} onChange={e => setShuffleChoices(e.target.checked)} /> Xáo đáp án</label>
                            <label className="ee-toggle"><input type="checkbox" checked={showResult} onChange={e => setShowResult(e.target.checked)} /> Hiện kết quả</label>
                            <label className="ee-toggle"><input type="checkbox" checked={antiCheatEnabled} onChange={e => setAntiCheatEnabled(e.target.checked)} /> Chống gian lận</label>
                            <label className="ee-toggle"><input type="checkbox" checked={antiCheatRequireFullscreen} onChange={e => setAntiCheatRequireFullscreen(e.target.checked)} disabled={!antiCheatEnabled} /> Yêu cầu toàn màn hình</label>
                            <label>Số cảnh cáo <input type="number" className="form-input-sm" min="1" max="10" value={antiCheatMaxWarnings} onChange={e => setAntiCheatMaxWarnings(e.target.value)} disabled={!antiCheatEnabled} /></label>
                            <label>Chế độ thi <select className="form-select-sm" value={gamification.mode} onChange={e => setGamification(prev => normalizeGamificationSettings({ ...prev, mode: e.target.value }))}>
                                <option value="classic">Classic Focus</option>
                                <option value="arcade">Arcade / Quizizz</option>
                            </select></label>
                            <label className="ee-toggle"><input type="checkbox" checked={gamification.liveLeaderboard} onChange={e => setGamification(prev => normalizeGamificationSettings({ ...prev, liveLeaderboard: e.target.checked }))} /> BXH lớp tạm tính</label>
                            <label className="ee-toggle"><input type="checkbox" checked={gamification.streakBonus} onChange={e => setGamification(prev => normalizeGamificationSettings({ ...prev, streakBonus: e.target.checked }))} /> Thưởng combo</label>
                            <label className="ee-toggle"><input type="checkbox" checked={gamification.speedBonus} onChange={e => setGamification(prev => normalizeGamificationSettings({ ...prev, speedBonus: e.target.checked }))} /> Thưởng tốc độ</label>
                            <label className="ee-toggle"><input type="checkbox" checked={gamification.showQuestionNavigator} onChange={e => setGamification(prev => normalizeGamificationSettings({ ...prev, showQuestionNavigator: e.target.checked }))} /> Thanh chọn câu</label>
                            <label>Điểm cơ bản/câu <input type="number" className="form-input-sm" min="50" max="300" value={gamification.pointsPerCorrect} onChange={e => setGamification(prev => normalizeGamificationSettings({ ...prev, pointsPerCorrect: e.target.value }))} /></label>
                            <label>Diem trac nghiem <input type="number" className="form-input-sm" min="0" step="0.05" value={questionScoring.mcq} onChange={e => setQuestionScoring(prev => normalizeQuestionScoring({ ...prev, mcq: e.target.value }))} /></label>
                            <label>Diem dien dap an <input type="number" className="form-input-sm" min="0" step="0.05" value={questionScoring.short_answer} onChange={e => setQuestionScoring(prev => normalizeQuestionScoring({ ...prev, short_answer: e.target.value }))} /></label>
                            <label>Diem tu luan <input type="number" className="form-input-sm" min="0" step="0.25" value={questionScoring.essay} onChange={e => setQuestionScoring(prev => normalizeQuestionScoring({ ...prev, essay: e.target.value }))} /></label>
                            <label>Preset D/S <select className="form-select-sm" value={getTfPresetId(tfScoring)} onChange={e => {
                                const preset = TF_SCORING_PRESETS.find((item) => item.id === e.target.value);
                                if (preset?.values) setTfScoring(preset.values);
                            }}>
                                {TF_SCORING_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                            </select></label>
                            <label>DS 1/4 <input type="number" className="form-input-sm" min="0" step="0.05" value={tfScoring.tf_1_4} onChange={e => setTfScoring(prev => normalizeTfScoring({ ...prev, tf_1_4: e.target.value }))} /></label>
                            <label>DS 2/4 <input type="number" className="form-input-sm" min="0" step="0.05" value={tfScoring.tf_2_4} onChange={e => setTfScoring(prev => normalizeTfScoring({ ...prev, tf_2_4: e.target.value }))} /></label>
                            <label>DS 3/4 <input type="number" className="form-input-sm" min="0" step="0.05" value={tfScoring.tf_3_4} onChange={e => setTfScoring(prev => normalizeTfScoring({ ...prev, tf_3_4: e.target.value }))} /></label>
                            <label>DS 4/4 <input type="number" className="form-input-sm" min="0" step="0.05" value={tfScoring.tf_4_4} onChange={e => setTfScoring(prev => normalizeTfScoring({ ...prev, tf_4_4: e.target.value }))} /></label>
                        </div>
                        <div className="integration-callout" style={{ marginTop: 12 }}>
                            <div>
                                <strong><i className="bi bi-stars"></i> Live mode theo từng đề</strong>
                                <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)' }}>
                                    Arcade mode bật HUD hiện đại, combo, thanh chọn câu và bảng xếp hạng lớp tạm tính ngay trong lúc làm bài.
                                </p>
                            </div>
                            <a href={CONICGV_URL} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
                                <i className="bi bi-bezier"></i> Soạn trên ConicGV
                            </a>
                        </div>
                        <div className="alert alert-info" style={{ marginTop: 12 }}>
                            <i className="bi bi-image"></i>
                            Ảnh tải mới sẽ tự tối ưu sang WebP nếu trình duyệt hỗ trợ; khi chèn có thể chọn kích thước và canh vị trí.
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Compact status bar (replaces massive overview cards) ── */}
            <div className="ee-status-bar">
                <div className={`ee-sq-badge ${importQualityBadge.className}`}>
                    <i className={`bi bi-${importQualityBadge.icon}`}></i>
                    <strong>{importQualityReport.score}/100</strong>
                    <span className="ee-sq-label">{importQualityBadge.label}</span>
                </div>
                <div className="ee-status-chips">
                    <span className="ee-sc total"><i className="bi bi-list-ol"></i> {stats.total} câu</span>
                    <span className="ee-sc ok"><i className="bi bi-check-circle-fill"></i> {stats.valid} hợp lệ</span>
                    {stats.invalid > 0 && <span className="ee-sc err"><i className="bi bi-exclamation-triangle-fill"></i> {stats.invalid} lỗi</span>}
                    {sectionGroups.length > 1 && <span className="ee-sc"><i className="bi bi-diagram-3"></i> {sectionGroups.length} phần</span>}
                    {Object.entries(stats.byType).map(([type, count]) => (
                        <span key={type} className="ee-sc" style={{ background: TYPE_COLORS[type]?.bg, color: TYPE_COLORS[type]?.color }}>
                            {TYPE_LABELS[type]} · {count}
                        </span>
                    ))}
                </div>
                <div className="ee-status-sep"></div>
                <span className="ee-source-chip"><i className="bi bi-file-earmark-text"></i> {importSourceLabel}</span>
                {parseWarnings.length > 0 && (
                    <span className="ee-warn-chip">
                        <i className="bi bi-exclamation-circle"></i> {parseWarnings.length} cảnh báo parser
                    </span>
                )}
                {importQualityReport.issueQuestions.length > 0 && (
                    <span className="ee-warn-chip err" title={importQualityReport.issueQuestions.map(x => `Câu ${x.number}: ${x.issues.join(', ')}`).join(' | ')}>
                        <i className="bi bi-shield-exclamation"></i> {importQualityReport.issueQuestions.length} câu cần sửa
                    </span>
                )}
            </div>

            {explicitSectionGroups.length > 0 && (
                <div className="card" style={{ marginTop: 12, marginBottom: 14, border: '1px solid #e2e8f0' }}>
                    <div className="card-body" style={{ display: 'grid', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div>
                                <strong><i className="bi bi-diagram-3"></i> Cấu hình từng phần của đề</strong>
                                <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                    Mỗi phần có thể lấy k câu, trộn trong phần, trộn đáp án và giữ cố định vị trí phần khi phát đề cho học sinh.
                                </div>
                            </div>
                            <span className="stat-badge info">{explicitSectionGroups.length} phần</span>
                        </div>

                        <div style={{ display: 'grid', gap: 10 }}>
                            {explicitSectionGroups.map((group, index) => {
                                const sampleQuestion = group.questions[0] || {};
                                const currentLimit = Number(group.meta.questionLimit) || 0;
                                return (
                                    <div key={group.key} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                            <div>
                                                <strong>Phần {index + 1}: {group.meta.title || getSectionDisplayTitle(sampleQuestion)}</strong>
                                                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                                    Tag: <span className="stat-badge muted">{buildSectionTag(sampleQuestion)}</span> · Nguồn có {group.questions.length} câu
                                                </div>
                                            </div>
                                            <div className="ed-field" style={{ marginBottom: 0 }}>
                                                <label className="ed-label">Lấy k câu trong phần</label>
                                                <input
                                                    type="number"
                                                    className="ed-cinput"
                                                    min={0}
                                                    max={group.questions.length}
                                                    value={currentLimit || ''}
                                                    placeholder={`0 = lấy hết ${group.questions.length}`}
                                                    onChange={(event) => updateSectionGroupSettings(group.key, { sectionQuestionLimit: event.target.value })}
                                                    style={{ width: 170 }}
                                                />
                                            </div>
                                        </div>

                                        <div className="toggle-group" style={{ marginTop: 0 }}>
                                            <label className="toggle-label">
                                                <input
                                                    type="checkbox"
                                                    checked={group.meta.shuffleQuestions !== false}
                                                    onChange={(event) => updateSectionGroupSettings(group.key, { sectionShuffleQuestions: event.target.checked })}
                                                />
                                                <span className="toggle-switch"></span>
                                                <span>Hoán vị câu trong phần</span>
                                            </label>
                                            <label className="toggle-label">
                                                <input
                                                    type="checkbox"
                                                    checked={group.meta.shuffleChoices !== false}
                                                    onChange={(event) => updateSectionGroupSettings(group.key, { sectionShuffleChoices: event.target.checked })}
                                                />
                                                <span className="toggle-switch"></span>
                                                <span>Hoán vị đáp án trong phần</span>
                                            </label>
                                            <label className="toggle-label">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(group.meta.fixedPosition)}
                                                    onChange={(event) => updateSectionGroupSettings(group.key, { sectionFixedPosition: event.target.checked })}
                                                />
                                                <span className="toggle-switch"></span>
                                                <span>Cố định vị trí phần</span>
                                            </label>
                                        </div>

                                        <div className="upload-guide-note subtle" style={{ marginTop: 0 }}>
                                            <i className="bi bi-info-circle"></i>
                                            <span>
                                                {currentLimit > 0
                                                    ? `Khi phát đề, hệ thống sẽ lấy ${Math.min(currentLimit, group.questions.length)} câu từ phần này.${group.meta.shuffleQuestions !== false ? ' Các câu sẽ được xáo trong phần trước khi chốt bộ câu.' : ' Vì đang tắt xáo câu, hệ thống sẽ lấy theo thứ tự hiện tại của phần.'}`
                                                    : 'Đang để lấy toàn bộ câu trong phần này.'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            <div className="ee-body">
                {/* LEFT: Question list */}
                <div className="ee-left">
                    <div className="ee-left-tabs">
                        <button className={'ee-tab' + (leftTab === 'edit' ? ' active' : '')} onClick={() => setLeftTab('edit')}>
                            <i className="bi bi-list-ol"></i> Danh sách
                        </button>
                        <button className={'ee-tab' + (leftTab === 'source' ? ' active' : '')} onClick={() => setLeftTab('source')}>
                            <i className="bi bi-code-slash"></i> Mã nguồn
                        </button>
                    </div>
                    <div className="ee-left-content">
                        {leftTab === 'edit' ? (
                            <div className="ee-question-list">
                                {questions.map((q, i) => {
                                    const issues = getIssues(q);
                                    const hasImgs = (q.content_html || '').includes('<img ');
                                    const questionLayout = q.type === 'mcq' ? getQuestionOptionLayout(q) : null;
                                    const sectionKey = getQuestionSectionKey(q, i, questions);
                                    const prevSectionKey = i > 0 ? getQuestionSectionKey(questions[i - 1], i - 1, questions) : null;
                                    const showSectionIntro = sectionKey !== '__default' && sectionKey !== prevSectionKey;
                                    return (
                                        <React.Fragment key={`${sectionKey}_${i}`}>
                                            {showSectionIntro && (
                                                <div className="section-context-card compact" style={{ marginBottom: 8 }}>
                                                    <div className="section-context-head">
                                                        <strong>{getSectionDisplayTitle(q)}</strong>
                                                        {q.sectionTag && <span className="stat-badge muted">{q.sectionTag}</span>}
                                                    </div>
                                                    {q.sectionContextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(q.sectionContextHtml) }} />}
                                                </div>
                                            )}
                                        <div ref={el => editorRefs.current[i] = el}
                                            className={'eq-card' + (activeQ === i ? ' active' : '') + (issues.length ? ' has-issues' : ' valid')}
                                            onClick={() => { setEditingQ(i); setActiveQ(i); previewRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
                                            <div className="eq-header">
                                                <span className="eq-num">Câu {q.number}</span>
                                                <span className="eq-type-badge" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color }}>
                                                    {TYPE_LABELS[q.type]}
                                                </span>
                                                {questionLayout && (
                                                    <span className="eq-type-badge" style={{ background: '#ecfeff', color: '#0f766e' }}>
                                                        {getQuestionOptionLayoutLabel(questionLayout)}
                                                    </span>
                                                )}
                                                {hasImgs && <i className="bi bi-image eq-img-icon" title="Có hình ảnh"></i>}
                                                {issues.length === 0
                                                    ? <i className="bi bi-check-circle-fill eq-valid-icon"></i>
                                                    : <i className="bi bi-exclamation-triangle-fill eq-issue-icon" title={issues.join(', ')}></i>}
                                                <div className="eq-actions">
                                                    <button className="eq-btn danger" onClick={e => { e.stopPropagation(); deleteQuestion(i); }} title="Xóa">
                                                        <i className="bi bi-trash3"></i>
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="eq-compact">
                                                <p className="eq-preview-text">{stripOptionLayoutHints(q.content_text || '').slice(0, 120)}{stripOptionLayoutHints(q.content_text || '').length > 120 ? '...' : ''}</p>
                                                {q.choices.length > 0 && (
                                                    <div className="eq-choices-inline">
                                                        {q.choices.map((c, j) => (
                                                            <span key={j} className={'eq-choice-pill' + (q.correct_answer === c.letter || (q.type === 'tf' && q.correct_answer?.[j] === 'D') ? ' correct' : '')}>
                                                                {q.type === 'tf' ? c.letter + ')' : c.letter + '.'} {(c.text || '').slice(0, 30)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {issues.length > 0 && <div className="eq-issues">{issues.map((iss, j) => <span key={j}>{'\u26A0'} {iss}</span>)}</div>}
                                            </div>
                                        </div>
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="ee-source">
                                <textarea className="ee-source-textarea" value={sourceText} onChange={e => setSourceText(e.target.value)} spellCheck={false} />
                                <button className="btn btn-accent btn-sm" onClick={applySource} style={{ marginTop: 8, width: '100%' }}>
                                    <i className="bi bi-arrow-repeat"></i> Áp dụng thay đổi
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Preview */}
                <div className="ee-right">
                    <div className="ee-right-header">
                        <i className="bi bi-eye"></i> Xem trước (góc nhìn học sinh)
                    </div>
                    <div className="ee-preview-list">
                        {questions.map((q, i) => {
                            const issues = getIssues(q);
                            const explOpen = showExplIdx.has(i);
                            const hasExpl = q.explanation || q.explanation_html;
                            const questionLayout = q.type === 'mcq' ? getQuestionOptionLayout(q) : null;
                            const sectionKey = getQuestionSectionKey(q, i, questions);
                            const prevSectionKey = i > 0 ? getQuestionSectionKey(questions[i - 1], i - 1, questions) : null;
                            const showSectionIntro = sectionKey !== '__default' && sectionKey !== prevSectionKey;
                            return (
                                <React.Fragment key={`preview_${sectionKey}_${i}`}>
                                    {showSectionIntro && (
                                        <div className="section-context-card preview-mode">
                                            <div className="section-context-head">
                                                <strong>{getSectionDisplayTitle(q)}</strong>
                                                {q.sectionTag && <span className="stat-badge muted">{q.sectionTag}</span>}
                                            </div>
                                            {q.sectionContextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(q.sectionContextHtml) }} />}
                                        </div>
                                    )}
                                <div ref={el => previewRefs.current[i] = el}
                                    className={'ep-card' + (activeQ === i ? ' active' : '')}
                                    onClick={() => { setActiveQ(i); editorRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
                                    <div className="ep-header">
                                        <span className="ep-num">Câu {q.number}</span>
                                        <span className="ep-type" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color }}>
                                            {TYPE_LABELS[q.type]}
                                        </span>
                                        {questionLayout && <span className="stat-badge muted">{getQuestionOptionLayoutLabel(questionLayout)}</span>}
                                        <span className="stat-badge warm">{getQuestionMaxPoints(q, questionScoring, tfScoring)}đ</span>
                                        <button className="ep-edit-btn" onClick={e => { e.stopPropagation(); setEditingQ(i); setActiveQ(i); }} title="Chỉnh sửa">
                                            <i className="bi bi-pencil"></i>
                                        </button>
                                    </div>
                                    <div className="ep-content" dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(q.content_html || escHtml(q.content_text)), q, i)) }} />
                                    {q.type === 'mcq' && q.choices.length > 0 && (
                                        <div className="ep-choices">
                                            {q.choices.map((c, j) => (
                                                <div key={j} className={'ep-choice' + (q.correct_answer === c.letter ? ' correct' : '')}>
                                                    <span className="ep-radio">{q.correct_answer === c.letter ? '\u25CF' : '\u25CB'}</span>
                                                    <span className="ep-letter">{c.letter}.</span>
                                                    <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, q.type, j)) }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {q.type === 'tf' && q.choices.length > 0 && (
                                        <div className="ep-choices">
                                            {q.choices.map((c, j) => (
                                                <div key={j} className={'ep-choice' + (q.correct_answer?.[j] === 'D' ? ' correct' : '')}>
                                                    <span className={'ep-tf-badge' + (q.correct_answer?.[j] === 'D' ? ' true' : ' false')}>{q.correct_answer?.[j] === 'D' ? '\u0110' : 'S'}</span>
                                                    <span className="ep-letter">{c.letter})</span>
                                                    <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, q.type, j)) }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {q.type === 'short_answer' && q.correct_answer && (
                                        <div className="ep-answer"><i className="bi bi-pencil-square"></i> Đáp án: <b>{q.correct_answer}</b></div>
                                    )}
                                    {q.type === 'essay' && q.correct_answer && (
                                        <div className="ep-answer" style={{ color: '#7c3aed' }}><i className="bi bi-journal-richtext"></i> Gợi ý chấm: <b>{q.correct_answer}</b></div>
                                    )}
                                    {hasExpl && (
                                        <div className="ep-expl-wrap">
                                            <button className={'ep-expl-toggle' + (explOpen ? ' open' : '')} onClick={e => { e.stopPropagation(); toggleExplanation(i); }}>
                                                <i className={'bi bi-' + (explOpen ? 'chevron-up' : 'lightbulb')}></i>
                                                {explOpen ? 'Ẩn lời giải' : 'Xem lời giải'}
                                            </button>
                                            <AnimatePresence>
                                                {explOpen && (
                                                    <motion.div className="ep-explanation"
                                                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                                        style={{ overflow: 'hidden' }}>
                                                        <div className="ep-expl-content" dangerouslySetInnerHTML={{ __html: renderLatex(q.explanation_html || escHtml(q.explanation || '')) }} />
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    )}
                                    {!hasExpl && <div className="ep-no-expl"><i className="bi bi-lightbulb"></i> Chưa có lời giải</div>}
                                    {issues.length > 0 && <div className="ep-issues">{issues.map((iss, j) => <span key={j}>{'\u26A0'} {iss}</span>)}</div>}
                                </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ══════ EDIT DIALOG ══════ */}
            <AnimatePresence>
                {eq && (
                    <motion.div className="ed-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={(e) => { if (e.target === e.currentTarget) setEditingQ(-1); }}>
                        <motion.div className="ed-dialog" initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0, scale: 0.97 }}
                            transition={{ type: 'spring', damping: 28, stiffness: 400 }}>
                            {/* Header */}
                            <div className="ed-head">
                                <div className="ed-head-left">
                                    <span className="ed-head-num">Câu {eq.number}</span>
                                    <select value={eq.type} onChange={e => changeType(editingQ, e.target.value)} className="ed-type-select">
                                        <option value="mcq">Trắc nghiệm</option>
                                        <option value="tf">Đúng/Sai</option>
                                        <option value="short_answer">Tự luận ngắn</option>
                                        <option value="essay">Tự luận</option>
                                    </select>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                                        <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Điểm</label>
                                        <input type="number" min="0" step="0.05" value={eq.points ?? getQuestionMaxPoints(eq, questionScoring, tfScoring)} onChange={e => updateQ(editingQ, { points: parseFloat(e.target.value) || 0 })} style={{ width: 64, padding: '2px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.85rem', textAlign: 'center' }} />
                                    </div>
                                    {getIssues(eq).length === 0
                                        ? <span className="ed-status ok"><i className="bi bi-check-circle-fill"></i> Hợp lệ</span>
                                        : <span className="ed-status warn"><i className="bi bi-exclamation-triangle-fill"></i> {getIssues(eq).join(', ')}</span>}
                                </div>
                                <div className="ed-head-right">
                                    <button type="button" className="ed-nav-btn" disabled={editingQ <= 0} onClick={() => setEditingQ(editingQ - 1)} title="Câu trước">
                                        <span className="ed-nav-glyph" aria-hidden="true">&lsaquo;</span>
                                        <span className="ed-nav-text">Trước</span>
                                    </button>
                                    <span className="ed-nav-label">{editingQ + 1} / {questions.length}</span>
                                    <button type="button" className="ed-nav-btn" disabled={editingQ >= questions.length - 1} onClick={() => setEditingQ(editingQ + 1)} title="Câu sau">
                                        <span className="ed-nav-text">Sau</span>
                                        <span className="ed-nav-glyph" aria-hidden="true">&rsaquo;</span>
                                    </button>
                                    <button type="button" className="ed-close" onClick={() => setEditingQ(-1)} title="Đóng">
                                        <span className="ed-nav-glyph" aria-hidden="true">&times;</span>
                                        <span className="ed-nav-text">Đóng</span>
                                    </button>
                                </div>
                            </div>

                            <div className="ed-body">
                                {/* Left: Form */}
                                <div className="ed-form">
                                    {/* Content */}
                                    <div className="ed-section">
                                        <label className="ed-label"><i className="bi bi-card-text"></i> Nội dung câu hỏi</label>
                                        <EditorToolbar fieldKey="q-content"
                                            onMath={() => openMath('content')}
                                            onImage={() => triggerImgUpload('content')} />
                                        <textarea
                                            ref={el => fieldRefs.current['q-content'] = el}
                                            value={eq.content_text || ''}
                                            onChange={e => updateQ(editingQ, { content_text: e.target.value })}
                                            rows={Math.max(3, Math.min(10, (eq.content_text || '').split('\n').length + 1))}
                                            className="ed-textarea" placeholder="Nhập nội dung câu hỏi..." />
                                        <ImageGallery html={eq.content_html} field="content" qIdx={editingQ} />
                                    </div>

                                    {/* Choices */}
                                    {(eq.type === 'mcq' || eq.type === 'tf') && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-list-check"></i> Đáp án {eq.type === 'mcq' && <small>(chọn đáp án đúng)</small>}</label>
                                            {eq.type === 'mcq' && (
                                                <div className="ed-layout-row">
                                                    <label className="ed-layout-label"><i className="bi bi-grid-3x2-gap"></i> Bố cục hiển thị</label>
                                                    <select className="ed-layout-select" value={getQuestionOptionLayout(eq) || ''} onChange={e => setQuestionOptionLayout(editingQ, e.target.value)}>
                                                        {QUESTION_OPTION_LAYOUT_OPTIONS.map((option) => (
                                                            <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                    <small className="ed-layout-hint">Điện thoại vẫn tự gộp về 1 cột để dễ bấm.</small>
                                                </div>
                                            )}
                                            <div className="ed-choices">
                                                {eq.choices.map((c, j) => {
                                                    const isCorrect = eq.type === 'mcq' ? eq.correct_answer === c.letter : eq.correct_answer?.[j] === 'D';
                                                    const choiceImgs = extractImgTags(c.html);
                                                    return (
                                                        <div key={j} className={'ed-choice' + (isCorrect ? ' correct' : '')}>
                                                            <div className="ed-choice-main">
                                                                {eq.type === 'mcq' ? (
                                                                    <label className="ed-radio">
                                                                        <input type="radio" name="ed-correct" checked={eq.correct_answer === c.letter}
                                                                            onChange={() => setCorrectAnswer(editingQ, c.letter)} />
                                                                        <span className={'ed-dot' + (isCorrect ? ' on' : '')} />
                                                                    </label>
                                                                ) : (
                                                                    <button className={'ed-tf' + (isCorrect ? ' on' : '')}
                                                                        onClick={() => {
                                                                            const arr = (eq.correct_answer || 'SSSS').split('');
                                                                            arr[j] = arr[j] === 'D' ? 'S' : 'D';
                                                                            setCorrectAnswer(editingQ, arr.join(''));
                                                                        }}>
                                                                        {isCorrect ? '\u0110' : 'S'}
                                                                    </button>
                                                                )}
                                                                <span className="ed-cletter">{eq.type === 'tf' ? c.letter + ')' : c.letter + '.'}</span>
                                                                <input type="text"
                                                                    ref={el => fieldRefs.current['q-c' + j] = el}
                                                                    value={c.text || ''}
                                                                    onChange={e => updateChoice(editingQ, j, { text: e.target.value })}
                                                                    className="ed-cinput" placeholder="Nội dung đáp án..." />
                                                                <button type="button" className="ed-mini" onClick={() => openMath('choice', j)} title="Công thức">&Sigma;</button>
                                                                <button type="button" className="ed-mini" onClick={() => triggerImgUpload('choice', j)} title="Ảnh">Ảnh</button>
                                                                <button type="button" className="ed-mini danger" onClick={() => removeChoice(editingQ, j)} title="Xóa">&times;</button>
                                                            </div>
                                                            {choiceImgs.length > 0 && (
                                                                <div className="ed-choice-imgs">
                                                                    {choiceImgs.map((img, k) => (
                                                                        <div key={k} className="ed-img-item small">
                                                                            <div className="ed-img-preview" dangerouslySetInnerHTML={{ __html: img }} />
                                                                            <button className="ed-img-remove" onClick={() => removeImage(editingQ, 'choice', j, k)} title="Xóa ảnh">
                                                                                <i className="bi bi-x-circle-fill"></i>
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <button className="ed-add-choice" onClick={() => addChoice(editingQ)}>
                                                <i className="bi bi-plus-circle"></i> Thêm đáp án
                                            </button>
                                        </div>
                                    )}

                                    {/* Short answer */}
                                    {eq.type === 'short_answer' && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-check2-circle"></i> Đáp án</label>
                                            <input type="text" value={eq.correct_answer || ''} onChange={e => setCorrectAnswer(editingQ, e.target.value)}
                                                className="ed-cinput full" placeholder="Nhập đáp án..." />
                                        </div>
                                    )}

                                    {eq.type === 'essay' && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-journal-richtext"></i> Huong dan cham / dap an goi y <small>(khong bat buoc)</small></label>
                                            <textarea value={eq.correct_answer || ''} onChange={e => setCorrectAnswer(editingQ, e.target.value)}
                                                rows={4} className="ed-textarea" placeholder="Nhập rubic, dàn ý hoặc tiêu chí chấm..." />
                                        </div>
                                    )}

                                    {/* Explanation */}
                                    <div className="ed-section ed-expl">
                                        <label className="ed-label"><i className="bi bi-lightbulb"></i> Lời giải <small>(không bắt buộc)</small></label>
                                        <EditorToolbar fieldKey="q-expl"
                                            onMath={() => openMath('explanation')}
                                            onImage={() => triggerImgUpload('explanation')} />
                                        <textarea
                                            ref={el => fieldRefs.current['q-expl'] = el}
                                            value={eq.explanation || ''}
                                            onChange={e => updateQ(editingQ, { explanation: e.target.value })}
                                            rows={3} className="ed-textarea" placeholder="Giải thích chi tiết cho câu này..." />
                                        <ImageGallery html={eq.explanation_html} field="explanation" qIdx={editingQ} />
                                    </div>
                                </div>

                                {/* Right: Live preview */}
                                <div className="ed-preview">
                                    <div className="ed-preview-label"><i className="bi bi-eye"></i> Xem trước</div>
                                    <div className="ed-preview-card">
                                        <div className="ed-p-head">
                                            <span className="ep-num">Câu {eq.number}</span>
                                            <span className="ep-type" style={{ background: TYPE_COLORS[eq.type]?.bg, color: TYPE_COLORS[eq.type]?.color }}>
                                                {TYPE_LABELS[eq.type]}
                                            </span>
                                            {eq.type === 'mcq' && getQuestionOptionLayout(eq) && <span className="stat-badge muted">{getQuestionOptionLayoutLabel(getQuestionOptionLayout(eq))}</span>}
                                        </div>
                                        <div className="ed-p-content" dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(eq.content_html || escHtml(eq.content_text)), eq, editingQ)) }} />
                                        {eq.type === 'mcq' && eq.choices.length > 0 && (
                                            <div className="ep-choices">
                                                {eq.choices.map((c, j) => (
                                                    <div key={j} className={'ep-choice' + (eq.correct_answer === c.letter ? ' correct' : '')}>
                                                        <span className="ep-radio">{eq.correct_answer === c.letter ? '\u25CF' : '\u25CB'}</span>
                                                        <span className="ep-letter">{c.letter}.</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, eq.type, j)) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {eq.type === 'tf' && eq.choices.length > 0 && (
                                            <div className="ep-choices">
                                                {eq.choices.map((c, j) => (
                                                    <div key={j} className={'ep-choice' + (eq.correct_answer?.[j] === 'D' ? ' correct' : '')}>
                                                        <span className={'ep-tf-badge' + (eq.correct_answer?.[j] === 'D' ? ' true' : ' false')}>{eq.correct_answer?.[j] === 'D' ? '\u0110' : 'S'}</span>
                                                        <span className="ep-letter">{c.letter})</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, eq.type, j)) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {eq.type === 'short_answer' && eq.correct_answer && (
                                            <div className="ep-answer"><i className="bi bi-pencil-square"></i> Đáp án: <b>{eq.correct_answer}</b></div>
                                        )}
                                        {eq.type === 'essay' && eq.correct_answer && (
                                            <div className="ep-answer" style={{ color: '#7c3aed' }}><i className="bi bi-journal-richtext"></i> Gợi ý chấm: <b>{eq.correct_answer}</b></div>
                                        )}
                                        {(eq.explanation || eq.explanation_html) ? (
                                            <div className="ed-p-expl">
                                                <div className="ed-p-expl-head"><i className="bi bi-lightbulb-fill"></i> Lời giải</div>
                                                <div className="ed-p-expl-body" dangerouslySetInnerHTML={{ __html: renderLatex(eq.explanation_html || escHtml(eq.explanation || '')) }} />
                                            </div>
                                        ) : (
                                            <div className="ed-p-no-expl"><i className="bi bi-lightbulb"></i> Chưa có lời giải — thêm ở bên trái</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ═══ MATH SUB-DIALOG ═══ */}
            <AnimatePresence>
                {mathTarget && (
                    <motion.div className="math-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setMathTarget(null)} style={{ zIndex: 1100 }}>
                        <motion.div className="math-dialog" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            onClick={e => e.stopPropagation()}>
                            <div className="math-dialog-head">
                                <h3><i className="bi bi-calculator"></i> Chèn công thức toán</h3>
                                <button className="math-close" onClick={() => setMathTarget(null)}><i className="bi bi-x-lg"></i></button>
                            </div>
                            <div className="math-palette">
                                <div className="math-palette-tabs">
                                    {MATH_GROUPS.map((g, gi) => (
                                        <button key={gi} className={'math-tab' + (mathPaletteGroup === gi ? ' active' : '')}
                                            onClick={() => setMathPaletteGroup(gi)}>{g.label}</button>
                                    ))}
                                </div>
                                <div className="math-palette-grid">
                                    {MATH_GROUPS[mathPaletteGroup].items.map((item, ii) => (
                                        <button key={ii} className="math-sym-btn" title={item.t}
                                            onClick={() => insertMathSymbol(item.t)}>{item.l}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="math-input-area">
                                <label>LaTeX</label>
                                <textarea value={mathLatex} onChange={e => setMathLatex(e.target.value)}
                                    placeholder={'Nhập LaTeX: \\frac{1}{2}, \\sqrt{x}, x^{2},...'}
                                    rows={3} autoFocus />
                            </div>
                            <div className="math-wrap-area">
                                <label>Kiểu chèn</label>
                                <div className="math-wrap-options">
                                    {MATH_WRAP_OPTIONS.map((option) => (
                                        <button key={option.id} type="button" className={'math-wrap-btn' + (mathWrapMode === option.id ? ' active' : '')}
                                            onClick={() => setMathWrapMode(option.id)}>{option.label}</button>
                                    ))}
                                </div>
                                <small>Inline: \(...\) hoặc $...$ . Khối: \[...\] hoặc $$...$$.</small>
                            </div>
                            <div className="math-live">
                                <label>Xem trước</label>
                                <div className="math-live-render" dangerouslySetInnerHTML={{
                                    __html: mathLatex.trim() ? (() => {
                                        try { return katex.renderToString(mathLatex.replace(/\u25AB/g, '\\square '), { displayMode: true, throwOnError: false }); }
                                        catch { return '<span style="color:#e53e3e">Lỗi cú pháp</span>'; }
                                    })() : '<span style="color:#999">Bấm ký hiệu hoặc nhập LaTeX...</span>'
                                }} />
                            </div>
                            <div className="math-dialog-foot">
                                <button className="btn btn-ghost btn-sm" onClick={() => setMathTarget(null)}>Huỷ</button>
                                <button className="btn btn-primary btn-sm" onClick={confirmMath} disabled={!mathLatex.trim()}>
                                    <i className="bi bi-plus-lg"></i> Chèn
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* PDF Review Modal */}
            {pdfReviewOpen && (
                <div className="pdf-review-overlay">
                    <div className="pdf-review-modal">
                        <div className="pdf-review-header">
                            <div>
                                <h2><i className="bi bi-file-earmark-pdf-fill"></i> Kết quả nhận dạng PDF</h2>
                                <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.87rem' }}>
                                    {pdfFile?.name} — {pdfReviewItems.filter((i) => i.included).length}/{pdfReviewItems.length} câu được chọn
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <button className="btn btn-outline btn-sm" onClick={() => setPdfReviewItems((prev) => prev.map((it) => ({ ...it, included: true })))}>
                                    <i className="bi bi-check-all"></i> Chọn tất
                                </button>
                                <button className="btn btn-outline btn-sm" onClick={() => setPdfReviewItems((prev) => prev.map((it) => ({ ...it, included: false })))}>
                                    Bỏ chọn tất
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => setPdfReviewOpen(false)}>
                                    <i className="bi bi-x-lg"></i>
                                </button>
                            </div>
                        </div>

                        <div className="pdf-review-body">
                            {pdfReviewItems.map((item, idx) => (
                                <div key={idx} className={`pdf-review-card${item.included ? '' : ' excluded'}`}>
                                    <div className="pdf-review-card-head">
                                        <label className="pdf-review-check">
                                            <input type="checkbox" checked={item.included} onChange={(e) => {
                                                const v = e.target.checked;
                                                setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, included: v } : it));
                                            }} />
                                            <span>Câu {idx + 1}</span>
                                        </label>
                                        <select className="form-select" style={{ maxWidth: 140 }} value={item.question.type}
                                            onChange={(e) => setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, question: { ...it.question, type: e.target.value } } : it))}>
                                            <option value="mcq">Trắc nghiệm</option>
                                            <option value="tf">Đúng/Sai</option>
                                            <option value="short_answer">Tự luận ngắn</option>
                                            <option value="essay">Tự luận</option>
                                        </select>
                                        <input type="number" className="form-input" style={{ width: 72 }} min={0.25} step={0.25}
                                            value={item.question.points} placeholder="Điểm"
                                            onChange={(e) => setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, question: { ...it.question, points: Number(e.target.value) } } : it))} />
                                    </div>

                                    <textarea className="pdf-review-content" rows={3}
                                        value={item.question.content_text}
                                        placeholder="Nội dung câu hỏi..."
                                        onChange={(e) => setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, question: { ...it.question, content_text: e.target.value, content_html: e.target.value } } : it))} />

                                    {(item.question.type === 'mcq' || item.question.type === 'tf') && (
                                        <div className="pdf-review-choices">
                                            {item.question.choices.map((c, ci) => (
                                                <div key={ci} className="pdf-review-choice-row">
                                                    <input type="radio" name={`pdf-correct-${idx}`}
                                                        checked={item.question.correct_answer === c.letter}
                                                        onChange={() => setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, question: { ...it.question, correct_answer: c.letter } } : it))}
                                                        title="Đáp án đúng" />
                                                    <span className="pdf-choice-letter">{c.letter}.</span>
                                                    <input className="form-input" value={c.text}
                                                        onChange={(e) => {
                                                            const txt = e.target.value;
                                                            setPdfReviewItems((prev) => prev.map((it, i) => {
                                                                if (i !== idx) return it;
                                                                const choices = it.question.choices.map((ch, j) => j === ci ? { ...ch, text: txt } : ch);
                                                                return { ...it, question: { ...it.question, choices } };
                                                            }));
                                                        }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {(item.question.type === 'short_answer') && (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                                            <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Đáp án:</span>
                                            <input className="form-input" value={item.question.correct_answer || ''}
                                                onChange={(e) => setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, question: { ...it.question, correct_answer: e.target.value } } : it))} />
                                        </div>
                                    )}

                                    {item.question.explanation && (
                                        <div className="pdf-review-explanation">
                                            <span className="pdf-expl-label">Lời giải:</span>
                                            <textarea rows={2} className="pdf-review-content" value={item.question.explanation}
                                                onChange={(e) => setPdfReviewItems((prev) => prev.map((it, i) => i === idx ? { ...it, question: { ...it.question, explanation: e.target.value, explanation_html: e.target.value } } : it))} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="pdf-review-footer">
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.87rem' }}>
                                Hãy kiểm tra và sửa các câu nếu cần trước khi nhập.
                            </span>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button className="btn btn-outline" onClick={() => setPdfReviewOpen(false)}>Huỷ</button>
                                <button className="btn btn-primary" disabled={pdfReviewItems.filter((i) => i.included).length === 0}
                                    onClick={() => {
                                        const selected = pdfReviewItems.filter((i) => i.included).map((i, idx2) => ({
                                            ...i.question,
                                            number: idx2 + 1,
                                            content_html: i.question.content_text,
                                            explanation_html: i.question.explanation || '',
                                            choices: (i.question.choices || []).map((c) => ({ ...c, html: c.text })),
                                        }));
                                        setQuestions(selected);
                                        setImageFiles([]);
                                        setImageMap({});
                                        setParseWarnings([]);
                                        setImportSourceFormat('pdf');
                                        setImportSourceLabel(pdfFile?.name || 'PDF');
                                        setSourceText('');
                                        setEditingQ(-1);
                                        setActiveQ(0);
                                        setPdfReviewOpen(false);
                                        if (!title.trim() && pdfFile?.name) {
                                            setTitle(pdfFile.name.replace(/\.pdf$/i, '').slice(0, 80));
                                        }
                                        Swal.fire({
                                            icon: 'success',
                                            title: `Đã nhập ${selected.length} câu từ PDF`,
                                            text: 'Hãy soát lại câu hỏi, đặt tiêu đề và lưu đề thi.',
                                            timer: 2200,
                                            showConfirmButton: false,
                                        });
                                    }}>
                                    <i className="bi bi-check2-square"></i> Nhập {pdfReviewItems.filter((i) => i.included).length} câu được chọn
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══ Helpers ═══
function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function extractImgTags(html) {
    if (!html) return [];
    return html.match(/<img [^>]*>/g) || [];
}

function richHtml(text, preservedImgs) {
    let html = (text || '');
    // Bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Strikethrough ~~text~~
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    // Bullet lists: lines starting with • 
    html = html.replace(/^• (.+)$/gm, '<li style="list-style:disc;margin-left:20px">$1</li>');
    // Numbered lists: lines starting with N. 
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="list-style:decimal;margin-left:20px">$1</li>');
    // Escape HTML entities for remaining text (but preserve tags we added)
    // Newlines to <br>
    html = html.replace(/\n/g, '<br>');
    if (preservedImgs && preservedImgs.length > 0) {
        html += '<div class="preserved-imgs">' + preservedImgs.join('') + '</div>';
    }
    return html;
}
