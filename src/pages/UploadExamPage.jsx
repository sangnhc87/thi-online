import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { parseDocx, questionsToText, parseText } from '../utils/docxParser';

const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Tự luận ngắn', essay: 'Tự luận' };
const TYPE_COLORS = {
    mcq: { bg: '#dbeafe', color: '#1e40af' },
    tf: { bg: '#fef3c7', color: '#92400e' },
    short_answer: { bg: '#d1fae5', color: '#065f46' },
    essay: { bg: '#f3e8ff', color: '#6b21a8' },
};
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const MATH_GROUPS = [
    { label: 'Cơ bản', items: [
        { l: 'a/b', t: '\\frac{▫}{▫}' }, { l: '√x', t: '\\sqrt{▫}' }, { l: 'ⁿ√', t: '\\sqrt[▫]{▫}' },
        { l: 'x²', t: '{▫}^{2}' }, { l: 'xⁿ', t: '{▫}^{▫}' }, { l: 'xₙ', t: '{▫}_{▫}' },
        { l: '|x|', t: '\\left|▫\\right|' }, { l: '( )', t: '\\left(▫\\right)' }, { l: '[ ]', t: '\\left[▫\\right]' },
        { l: '{ }', t: '\\left\\{▫\\right\\}' }, { l: '±', t: '\\pm ' }, { l: '∓', t: '\\mp ' },
        { l: '×', t: '\\times ' }, { l: '÷', t: '\\div ' }, { l: '·', t: '\\cdot ' },
    ] },
    { label: 'Giải tích', items: [
        { l: '∑', t: '\\sum_{▫}^{▫}' }, { l: '∏', t: '\\prod_{▫}^{▫}' }, { l: '∫', t: '\\int_{▫}^{▫}' },
        { l: 'lim', t: '\\lim_{▫ \\to ▫}' }, { l: '∞', t: '\\infty ' }, { l: '∂', t: '\\partial ' },
        { l: 'd/dx', t: '\\frac{d}{dx}' }, { l: '→', t: '\\to ' }, { l: '∆', t: '\\Delta ' },
    ] },
    { label: 'So sánh', items: [
        { l: '≤', t: '\\leq ' }, { l: '≥', t: '\\geq ' }, { l: '≠', t: '\\neq ' },
        { l: '≈', t: '\\approx ' }, { l: '≡', t: '\\equiv ' }, { l: '∝', t: '\\propto ' },
        { l: '⇒', t: '\\Rightarrow ' }, { l: '⇔', t: '\\Leftrightarrow ' },
    ] },
    { label: 'Tập hợp', items: [
        { l: '∈', t: '\\in ' }, { l: '∉', t: '\\notin ' }, { l: '⊂', t: '\\subset ' },
        { l: '⊆', t: '\\subseteq ' }, { l: '∪', t: '\\cup ' }, { l: '∩', t: '\\cap ' },
        { l: '∅', t: '\\emptyset ' }, { l: '∀', t: '\\forall ' }, { l: '∃', t: '\\exists ' },
        { l: 'ℝ', t: '\\mathbb{R}' }, { l: 'ℕ', t: '\\mathbb{N}' }, { l: 'ℤ', t: '\\mathbb{Z}' },
    ] },
    { label: 'Hàm', items: [
        { l: 'sin', t: '\\sin ' }, { l: 'cos', t: '\\cos ' }, { l: 'tan', t: '\\tan ' },
        { l: 'log', t: '\\log ' }, { l: 'ln', t: '\\ln ' }, { l: 'e^x', t: 'e^{▫}' },
    ] },
    { label: 'Hy Lạp', items: [
        { l: 'α', t: '\\alpha ' }, { l: 'β', t: '\\beta ' }, { l: 'γ', t: '\\gamma ' },
        { l: 'δ', t: '\\delta ' }, { l: 'ε', t: '\\varepsilon ' }, { l: 'θ', t: '\\theta ' },
        { l: 'λ', t: '\\lambda ' }, { l: 'μ', t: '\\mu ' }, { l: 'π', t: '\\pi ' },
        { l: 'σ', t: '\\sigma ' }, { l: 'φ', t: '\\varphi ' }, { l: 'ω', t: '\\omega ' },
        { l: 'Ω', t: '\\Omega ' },
    ] },
    { label: 'Hình học', items: [
        { l: '°', t: '^{\\circ}' }, { l: '∠', t: '\\angle ' }, { l: '△', t: '\\triangle ' },
        { l: '⊥', t: '\\perp ' }, { l: '∥', t: '\\parallel ' },
        { l: '→v', t: '\\vec{▫}' }, { l: 'ā', t: '\\overline{▫}' },
    ] },
    { label: 'Ma trận', items: [
        { l: '(matrix)', t: '\\begin{pmatrix} ▫ & ▫ \\\\ ▫ & ▫ \\end{pmatrix}' },
        { l: '[matrix]', t: '\\begin{bmatrix} ▫ & ▫ \\\\ ▫ & ▫ \\end{bmatrix}' },
        { l: 'cases', t: '\\begin{cases} ▫ & ▫ \\\\ ▫ & ▫ \\end{cases}' },
    ] },
];

export default function UploadExamPage() {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [title, setTitle] = useState('');
    const [subject, setSubject] = useState('');
    const [grade, setGrade] = useState('');
    const [duration, setDuration] = useState(45);
    const [maxAttempts, setMaxAttempts] = useState(1);
    const [shuffleQuestions, setShuffleQuestions] = useState(true);
    const [shuffleChoices, setShuffleChoices] = useState(false);
    const [showResult, setShowResult] = useState(true);

    const [file, setFile] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [questions, setQuestions] = useState(null);
    const [imageFiles, setImageFiles] = useState([]);
    const [imageMap, setImageMap] = useState({});
    const [activeQ, setActiveQ] = useState(0);
    const [editingQ, setEditingQ] = useState(-1);
    const [leftTab, setLeftTab] = useState('edit');
    const [sourceText, setSourceText] = useState('');
    const [saving, setSaving] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    // Math dialog
    const [mathDialog, setMathDialog] = useState(null); // { qIdx, field, cIdx? }
    const [mathLatex, setMathLatex] = useState('');
    const [mathPaletteGroup, setMathPaletteGroup] = useState(0);

    const previewRefs = useRef([]);
    const editorRefs = useRef([]);
    const fieldRefs = useRef({}); // textarea refs for cursor insertion

    // ═══ File handling ═══
    const handleParse = useCallback(async (f) => {
        if (!f) return;
        setParsing(true);
        try {
            const result = await parseDocx(f);
            if (result.questions.length === 0) {
                Swal.fire('Không tìm thấy câu hỏi', 'Mỗi câu phải bắt đầu bằng "Câu 1:", "Câu 2:",...', 'warning');
                setParsing(false);
                return;
            }
            setQuestions(result.questions);
            setImageFiles(result.imageFiles);
            setImageMap(result.imageMap);
            setSourceText(questionsToText(result.questions));
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi đọc file', err.message, 'error');
        } finally {
            setParsing(false);
        }
    }, []);

    const handleFileChange = useCallback((f) => {
        if (!f) return;
        setFile(f);
        setQuestions(null);
        setEditingQ(-1);
        handleParse(f);
    }, [handleParse]);

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
        updateQ(idx, { type: newType });
    }, [updateQ]);

    // ═══ Math dialog ═══
    const openMath = useCallback((qIdx, field, cIdx) => {
        setMathDialog({ qIdx, field, cIdx });
        setMathLatex('');
        setMathPaletteGroup(0);
    }, []);

    const insertMathSymbol = useCallback((latex) => {
        setMathLatex(prev => {
            const placeholder = '\u25AB';
            const idx = prev.indexOf(placeholder);
            if (idx >= 0) return prev.slice(0, idx) + latex + prev.slice(idx + 1);
            return prev + latex;
        });
    }, []);

    const confirmMath = useCallback(() => {
        if (!mathDialog || !mathLatex.trim()) return;
        const { qIdx, field, cIdx } = mathDialog;
        const tex = '$$' + mathLatex.replace(/\u25AB/g, '') + '$$';

        if (field === 'content') {
            const q = questions[qIdx];
            const ta = fieldRefs.current[`q${qIdx}-content`];
            const old = q.content_text || '';
            const pos = ta?.selectionStart ?? old.length;
            updateQ(qIdx, { content_text: old.slice(0, pos) + tex + old.slice(pos) });
        } else if (field === 'choice') {
            const c = questions[qIdx].choices[cIdx];
            const ta = fieldRefs.current[`q${qIdx}-c${cIdx}`];
            const old = c.text || '';
            const pos = ta?.selectionStart ?? old.length;
            updateChoice(qIdx, cIdx, { text: old.slice(0, pos) + tex + old.slice(pos) });
        } else if (field === 'explanation') {
            const q = questions[qIdx];
            const ta = fieldRefs.current[`q${qIdx}-expl`];
            const old = q.explanation || '';
            const pos = ta?.selectionStart ?? old.length;
            updateQ(qIdx, { explanation: old.slice(0, pos) + tex + old.slice(pos) });
        }
        setMathDialog(null);
        setMathLatex('');
    }, [mathDialog, mathLatex, questions, updateQ, updateChoice]);

    // ═══ Source mode ═══
    const applySource = useCallback(() => {
        const parsed = parseText(sourceText);
        if (parsed.length === 0) {
            Swal.fire('Không tìm thấy câu hỏi', 'Định dạng không hợp lệ.', 'warning');
            return;
        }
        setQuestions(parsed);
        setEditingQ(-1);
        Swal.fire({ icon: 'success', title: 'Đã cập nhật ' + parsed.length + ' câu', timer: 1500, showConfirmButton: false });
    }, [sourceText]);

    useEffect(() => {
        if (leftTab === 'source' && questions) setSourceText(questionsToText(questions));
    }, [leftTab]);

    // ═══ Validation ═══
    const getIssues = useCallback((q) => {
        const issues = [];
        if (!q.content_text?.trim()) issues.push('Thiếu nội dung');
        if (q.type === 'mcq' && q.choices.length < 2) issues.push('Cần ≥ 2 đáp án');
        if (q.type === 'mcq' && !q.correct_answer) issues.push('Chưa chọn đáp án đúng');
        if (q.type === 'tf' && !q.correct_answer) issues.push('Chưa đánh dấu Đ/S');
        if (q.type === 'short_answer' && !q.correct_answer) issues.push('Thiếu đáp án');
        return issues;
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

    const scrollToPreview = (idx) => {
        setActiveQ(idx);
        previewRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    // ═══ Save ═══
    const handleSave = async () => {
        if (!title.trim()) {
            Swal.fire('Thiếu tiêu đề', 'Nhập tiêu đề đề thi trước khi lưu.', 'warning');
            setShowSettings(true);
            return;
        }
        if (!questions?.length) return;
        setSaving(true);
        try {
            Swal.fire({ title: 'Đang lưu đề thi...', html: '<p>Tải hình ảnh & lưu câu hỏi...</p>', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const storageUrlMap = {};
            if (imageFiles?.length > 0) {
                for (const img of imageFiles) {
                    const imgRef = ref(storage, 'exams/' + user.uid + '/' + Date.now() + '_' + img.name);
                    await uploadBytes(imgRef, img.blob, { contentType: img.mime });
                    const url = await getDownloadURL(imgRef);
                    const dataUrl = imageMap[img.rId];
                    if (dataUrl) storageUrlMap[dataUrl] = url;
                }
            }
            const replUrls = (html) => {
                if (!html) return html;
                for (const [d, s] of Object.entries(storageUrlMap)) html = html.replaceAll(d, s);
                return html;
            };
            const qs = questions.map((q, idx) => ({
                number: q.number, type: q.type,
                content_text: q.content_text, content_html: replUrls(q.content_html),
                choices: (q.choices || []).map(c => ({ letter: c.letter, text: c.text, html: replUrls(c.html) })),
                correct_answer: q.correct_answer,
                explanation: q.explanation, explanation_html: replUrls(q.explanation_html),
                order: idx + 1,
            }));
            const examRef = await addDoc(collection(db, 'exams'), {
                title: title.trim(), subject: subject.trim() || null, grade: grade.trim() || null,
                teacherId: user.uid, teacherName: user.displayName,
                duration: Number(duration), questionCount: qs.length, maxAttempts: Number(maxAttempts),
                shuffleQuestions, shuffleChoices, showResult,
                status: 'draft', createdAt: Timestamp.now(),
            });
            await Promise.all(qs.map(q => addDoc(collection(db, 'exams', examRef.id, 'questions'), q)));
            Swal.fire({
                icon: 'success', title: 'Tạo đề thành công!',
                html: '<b>' + title + '</b> — ' + qs.length + ' câu hỏi<br><small style="color:#888">Trạng thái: Nháp</small>',
                confirmButtonColor: '#5b5ea6',
            });
            navigate('/teacher');
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    // ═══ STEP 1: Upload ═══
    if (!questions) {
        return (
            <div className="upload-step">
                <div className="upload-step-inner">
                    <div className="upload-hero">
                        <i className="bi bi-file-earmark-word-fill"></i>
                        <h1>Tạo đề thi từ DOCX</h1>
                        <p>Chọn file Word (.docx) để tự động phân tích câu hỏi, đáp án, lời giải</p>
                    </div>
                    <div className="upload-dropzone"
                        onClick={() => document.getElementById('file-input').click()}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                        onDragLeave={e => e.currentTarget.classList.remove('dragover')}
                        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.docx')) handleFileChange(f); }}>
                        {parsing ? (
                            <div className="upload-parsing">
                                <span className="spinner" style={{ width: 40, height: 40 }}></span>
                                <p style={{ marginTop: 16, fontWeight: 600 }}>Đang phân tích <b>{file?.name}</b>...</p>
                                <small style={{ color: 'var(--text-muted)' }}>Trích xuất câu hỏi, đáp án, hình ảnh, công thức</small>
                            </div>
                        ) : (
                            <>
                                <i className="bi bi-cloud-arrow-up-fill"></i>
                                <p className="upload-main-text">{file ? file.name : 'Kéo thả file .docx vào đây'}</p>
                                <span className="upload-sub-text">hoặc bấm để chọn file</span>
                            </>
                        )}
                    </div>
                    <input id="file-input" type="file" accept=".docx"
                        onChange={e => { if (e.target.files[0]) handleFileChange(e.target.files[0]); }}
                        style={{ display: 'none' }} />
                    <div className="upload-format-info">
                        <h4><i className="bi bi-info-circle"></i> Định dạng chuẩn</h4>
                        <div className="format-cols">
                            <div className="format-col">
                                <h5>Trắc nghiệm</h5>
                                <pre>{'Câu 1: Nội dung\nA. Đáp án A\nB. Đáp án B (gạch chân)\nC. Đáp án C\nD. Đáp án D'}</pre>
                            </div>
                            <div className="format-col">
                                <h5>Đúng/Sai</h5>
                                <pre>{'Câu 2: Nội dung\na) Mệnh đề 1 (gạch chân=Đ)\nb) Mệnh đề 2\nc) Mệnh đề 3\nd) Mệnh đề 4'}</pre>
                            </div>
                            <div className="format-col">
                                <h5>Tự luận ngắn</h5>
                                <pre>{'Câu 3: Nội dung\nĐáp án: 42\nLời giải: Chi tiết...'}</pre>
                            </div>
                        </div>
                        <small><b>Công thức:</b> Hỗ trợ Equation Editor (OMML) & MathType. <b>Đáp án đúng:</b> Gạch chân trong Word hoặc dòng "Đáp án: X"</small>
                    </div>
                </div>
            </div>
        );
    }

    // ═══ STEP 2: Split-pane Editor ═══
    return (
        <div className="exam-editor">
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
                            <label>Môn <select className="form-select-sm" value={subject} onChange={e => setSubject(e.target.value)}>
                                <option value="">—</option><option>Toán</option><option>Vật lý</option><option>Hóa học</option>
                                <option>Sinh học</option><option>Tiếng Anh</option><option>Ngữ văn</option><option>Lịch sử</option>
                                <option>Địa lý</option><option>GDCD</option><option>Tin học</option><option>Khác</option>
                            </select></label>
                            <label>Lớp <select className="form-select-sm" value={grade} onChange={e => setGrade(e.target.value)}>
                                <option value="">—</option>{[10,11,12].map(g => <option key={g}>Lớp {g}</option>)}<option>Đại học</option>
                            </select></label>
                            <label>Thời gian <input type="number" className="form-input-sm" min="1" max="180" value={duration} onChange={e => setDuration(e.target.value)} /> phút</label>
                            <label>Số lần thi <input type="number" className="form-input-sm" min="1" max="10" value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} /></label>
                            <label className="ee-toggle"><input type="checkbox" checked={shuffleQuestions} onChange={e => setShuffleQuestions(e.target.checked)} /> Xáo câu hỏi</label>
                            <label className="ee-toggle"><input type="checkbox" checked={shuffleChoices} onChange={e => setShuffleChoices(e.target.checked)} /> Xáo đáp án</label>
                            <label className="ee-toggle"><input type="checkbox" checked={showResult} onChange={e => setShowResult(e.target.checked)} /> Hiện kết quả</label>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {stats && (
                <div className="ee-stats">
                    <span className="ee-stat total"><i className="bi bi-list-ol"></i> {stats.total} câu</span>
                    {Object.entries(stats.byType).map(([type, count]) => (
                        <span key={type} className="ee-stat" style={{ background: TYPE_COLORS[type]?.bg, color: TYPE_COLORS[type]?.color }}>
                            {TYPE_LABELS[type]} {count}
                        </span>
                    ))}
                    <span className="ee-stat valid"><i className="bi bi-check-circle"></i> {stats.valid} hợp lệ</span>
                    {stats.invalid > 0 && <span className="ee-stat invalid"><i className="bi bi-exclamation-triangle"></i> {stats.invalid} cần sửa</span>}
                </div>
            )}

            <div className="ee-body">
                {/* ═══ LEFT PANEL ═══ */}
                <div className="ee-left">
                    <div className="ee-left-tabs">
                        <button className={'ee-tab' + (leftTab === 'edit' ? ' active' : '')} onClick={() => setLeftTab('edit')}>
                            <i className="bi bi-pencil-square"></i> Chỉnh sửa
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
                                    const isEditing = editingQ === i;
                                    const isActive = activeQ === i;
                                    const qImgs = extractImgTags(q.content_html);
                                    return (
                                        <div key={i} ref={el => editorRefs.current[i] = el}
                                            className={'eq-card' + (isActive ? ' active' : '') + (isEditing ? ' editing' : '') + (issues.length ? ' has-issues' : ' valid')}
                                            onClick={() => scrollToPreview(i)}>
                                            {/* Card header */}
                                            <div className="eq-header">
                                                <span className="eq-num">Câu {q.number}</span>
                                                <span className="eq-type-badge" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color }}>
                                                    {TYPE_LABELS[q.type]}
                                                </span>
                                                {issues.length === 0
                                                    ? <i className="bi bi-check-circle-fill eq-valid-icon"></i>
                                                    : <i className="bi bi-exclamation-triangle-fill eq-issue-icon" title={issues.join(', ')}></i>}
                                                <div className="eq-actions">
                                                    <button className="eq-btn" onClick={e => { e.stopPropagation(); setEditingQ(isEditing ? -1 : i); }} title={isEditing ? 'Thu gọn' : 'Sửa'}>
                                                        <i className={'bi bi-' + (isEditing ? 'chevron-up' : 'pencil')}></i>
                                                    </button>
                                                    <button className="eq-btn danger" onClick={e => { e.stopPropagation(); deleteQuestion(i); }} title="Xóa">
                                                        <i className="bi bi-trash3"></i>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Collapsed view */}
                                            {!isEditing && (
                                                <div className="eq-compact">
                                                    <p className="eq-preview-text">{(q.content_text || '').slice(0, 120)}{(q.content_text || '').length > 120 ? '...' : ''}</p>
                                                    {q.choices.length > 0 && (
                                                        <div className="eq-choices-inline">
                                                            {q.choices.map((c, j) => (
                                                                <span key={j} className={'eq-choice-pill' + (q.correct_answer === c.letter || (q.type === 'tf' && q.correct_answer?.[j] === 'D') ? ' correct' : '')}>
                                                                    {q.type === 'tf' ? c.letter + ')' : c.letter + '.'} {(c.text || '').slice(0, 25)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {issues.length > 0 && <div className="eq-issues">{issues.map((iss, j) => <span key={j}>\u26A0 {iss}</span>)}</div>}
                                                </div>
                                            )}

                                            {/* ═══ EXPANDED EDIT PANEL ═══ */}
                                            {isEditing && (
                                                <div className="eq-edit" onClick={e => e.stopPropagation()}>
                                                    {/* Toolbar */}
                                                    <div className="eq-toolbar">
                                                        <select value={q.type} onChange={e => changeType(i, e.target.value)} className="eq-type-select">
                                                            <option value="mcq">Trắc nghiệm</option>
                                                            <option value="tf">Đúng/Sai</option>
                                                            <option value="short_answer">Tự luận ngắn</option>
                                                        </select>
                                                        <div className="eq-toolbar-sep" />
                                                        <button className="eq-toolbar-btn" onClick={() => openMath(i, 'content')} title="Chèn công thức toán">
                                                            <i className="bi bi-calculator"></i> Σ Công thức
                                                        </button>
                                                        <div className="eq-toolbar-hint">
                                                            <code>$$...$$</code> = inline
                                                        </div>
                                                    </div>

                                                    {/* Content editor */}
                                                    <div className="eq-section">
                                                        <label className="eq-label">Nội dung câu hỏi</label>
                                                        <textarea
                                                            ref={el => fieldRefs.current[`q${i}-content`] = el}
                                                            value={q.content_text || ''}
                                                            onChange={e => updateQ(i, { content_text: e.target.value })}
                                                            rows={Math.max(3, Math.min(10, (q.content_text || '').split('\n').length + 1))}
                                                            className="eq-textarea"
                                                            placeholder="Nhập nội dung câu hỏi..." />
                                                        {/* Mini live preview */}
                                                        {(q.content_html || q.content_text || '').length > 0 && (
                                                            <div className="eq-live-preview">
                                                                <span className="eq-live-label"><i className="bi bi-eye"></i> Preview</span>
                                                                <div className="eq-live-render" dangerouslySetInnerHTML={{
                                                                    __html: renderLatex(q.content_html || escHtml(q.content_text || ''))
                                                                }} />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Images from DOCX */}
                                                    {qImgs.length > 0 && (
                                                        <div className="eq-section eq-images">
                                                            <label className="eq-label"><i className="bi bi-image"></i> Hình ảnh ({qImgs.length})</label>
                                                            <div className="eq-image-grid">
                                                                {qImgs.map((img, j) => (
                                                                    <div key={j} className="eq-image-thumb" dangerouslySetInnerHTML={{ __html: img }} />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Choices */}
                                                    {(q.type === 'mcq' || q.type === 'tf') && (
                                                        <div className="eq-section">
                                                            <label className="eq-label">Đáp án</label>
                                                            <div className="eq-choices-edit-list">
                                                                {q.choices.map((c, j) => {
                                                                    const isCorrect = q.type === 'mcq' ? q.correct_answer === c.letter : q.correct_answer?.[j] === 'D';
                                                                    const cImgs = extractImgTags(c.html);
                                                                    return (
                                                                        <div key={j} className={'eq-choice-edit' + (isCorrect ? ' correct' : '')}>
                                                                            <div className="eq-choice-main">
                                                                                {q.type === 'mcq' ? (
                                                                                    <label className="eq-radio-wrap" title="Đáp án đúng">
                                                                                        <input type="radio" name={'correct-' + i}
                                                                                            checked={q.correct_answer === c.letter}
                                                                                            onChange={() => setCorrectAnswer(i, c.letter)} />
                                                                                        <span className={'eq-radio-dot' + (isCorrect ? ' checked' : '')} />
                                                                                    </label>
                                                                                ) : (
                                                                                    <button className={'eq-tf-btn' + (isCorrect ? ' true' : '')}
                                                                                        onClick={() => {
                                                                                            const arr = (q.correct_answer || 'SSSS').split('');
                                                                                            arr[j] = arr[j] === 'D' ? 'S' : 'D';
                                                                                            setCorrectAnswer(i, arr.join(''));
                                                                                        }}>
                                                                                        {isCorrect ? '\u0110' : 'S'}
                                                                                    </button>
                                                                                )}
                                                                                <span className="eq-choice-letter">{q.type === 'tf' ? c.letter + ')' : c.letter + '.'}</span>
                                                                                <input type="text"
                                                                                    ref={el => fieldRefs.current[`q${i}-c${j}`] = el}
                                                                                    value={c.text || ''}
                                                                                    onChange={e => updateChoice(i, j, { text: e.target.value })}
                                                                                    className="eq-choice-input"
                                                                                    placeholder="Nội dung..." />
                                                                                <button className="eq-mini-btn" onClick={() => openMath(i, 'choice', j)} title="Công thức">
                                                                                    <i className="bi bi-calculator"></i>
                                                                                </button>
                                                                                <button className="eq-mini-btn danger" onClick={() => removeChoice(i, j)} title="Xóa">
                                                                                    <i className="bi bi-x-lg"></i>
                                                                                </button>
                                                                            </div>
                                                                            {/* Choice inline preview */}
                                                                            {((c.text || '').includes('$$') || cImgs.length > 0) && (
                                                                                <div className="eq-choice-preview" dangerouslySetInnerHTML={{
                                                                                    __html: renderLatex(c.html || escHtml(c.text || ''))
                                                                                }} />
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                            <button className="eq-add-choice" onClick={() => addChoice(i)}>
                                                                <i className="bi bi-plus-circle"></i> Thêm đáp án
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Short answer */}
                                                    {q.type === 'short_answer' && (
                                                        <div className="eq-section">
                                                            <label className="eq-label">Đáp án</label>
                                                            <input type="text" value={q.correct_answer || ''}
                                                                onChange={e => setCorrectAnswer(i, e.target.value)}
                                                                className="eq-input" placeholder="Nhập đáp án..." />
                                                        </div>
                                                    )}

                                                    {/* Explanation */}
                                                    <div className="eq-section eq-expl-section">
                                                        <label className="eq-label">
                                                            <i className="bi bi-lightbulb"></i> Lời giải <small>(không bắt buộc)</small>
                                                            <button className="eq-mini-btn" onClick={() => openMath(i, 'explanation')} title="Công thức" style={{ marginLeft: 8 }}>
                                                                <i className="bi bi-calculator"></i>
                                                            </button>
                                                        </label>
                                                        <textarea
                                                            ref={el => fieldRefs.current[`q${i}-expl`] = el}
                                                            value={q.explanation || ''}
                                                            onChange={e => updateQ(i, { explanation: e.target.value })}
                                                            rows={2} className="eq-textarea"
                                                            placeholder="Giải thích chi tiết..." />
                                                        {(q.explanation || '').includes('$$') && (
                                                            <div className="eq-live-preview small">
                                                                <div className="eq-live-render" dangerouslySetInnerHTML={{
                                                                    __html: renderLatex(q.explanation_html || escHtml(q.explanation || ''))
                                                                }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
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

                {/* ═══ RIGHT PANEL — Preview ═══ */}
                <div className="ee-right">
                    <div className="ee-right-header">
                        <i className="bi bi-eye"></i> Xem trước (góc nhìn học sinh)
                    </div>
                    <div className="ee-preview-list">
                        {questions.map((q, i) => {
                            const issues = getIssues(q);
                            return (
                                <div key={i} ref={el => previewRefs.current[i] = el}
                                    className={'ep-card' + (activeQ === i ? ' active' : '')}
                                    onClick={() => { setActiveQ(i); setEditingQ(i); editorRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
                                    <div className="ep-header">
                                        <span className="ep-num">Câu {q.number}</span>
                                        <span className="ep-type" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color }}>
                                            {TYPE_LABELS[q.type]}
                                        </span>
                                    </div>
                                    <div className="ep-content" dangerouslySetInnerHTML={{ __html: renderLatex(q.content_html || escHtml(q.content_text)) }} />
                                    {q.type === 'mcq' && q.choices.length > 0 && (
                                        <div className="ep-choices">
                                            {q.choices.map((c, j) => (
                                                <div key={j} className={'ep-choice' + (q.correct_answer === c.letter ? ' correct' : '')}>
                                                    <span className="ep-radio">{q.correct_answer === c.letter ? '\u25CF' : '\u25CB'}</span>
                                                    <span className="ep-letter">{c.letter}.</span>
                                                    <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || escHtml(c.text)) }} />
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
                                                    <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || escHtml(c.text)) }} />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {q.type === 'short_answer' && q.correct_answer && (
                                        <div className="ep-answer"><i className="bi bi-pencil-square"></i> Đáp án: <b>{q.correct_answer}</b></div>
                                    )}
                                    {q.explanation_html && (
                                        <div className="ep-explanation">
                                            <i className="bi bi-lightbulb"></i>
                                            <span dangerouslySetInnerHTML={{ __html: renderLatex(q.explanation_html) }} />
                                        </div>
                                    )}
                                    {issues.length > 0 && (
                                        <div className="ep-issues">{issues.map((iss, j) => <span key={j}>\u26A0 {iss}</span>)}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ═══ MATH DIALOG ═══ */}
            <AnimatePresence>
                {mathDialog && (
                    <motion.div className="math-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setMathDialog(null)}>
                        <motion.div className="math-dialog" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            onClick={e => e.stopPropagation()}>
                            <div className="math-dialog-head">
                                <h3><i className="bi bi-calculator"></i> Chèn công thức toán</h3>
                                <button className="math-close" onClick={() => setMathDialog(null)}><i className="bi bi-x-lg"></i></button>
                            </div>

                            {/* Symbol palette */}
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
                                            onClick={() => insertMathSymbol(item.t)}>
                                            {item.l}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* LaTeX input */}
                            <div className="math-input-area">
                                <label>LaTeX</label>
                                <textarea value={mathLatex} onChange={e => setMathLatex(e.target.value)}
                                    placeholder={'Nhập LaTeX: \\frac{1}{2}, \\sqrt{x}, x^{2},...'}
                                    rows={3} autoFocus />
                            </div>

                            {/* Live preview */}
                            <div className="math-live">
                                <label>Xem trước</label>
                                <div className="math-live-render" dangerouslySetInnerHTML={{
                                    __html: mathLatex.trim() ? (() => {
                                        try {
                                            const clean = mathLatex.replace(/\u25AB/g, '\\square ');
                                            return katex.renderToString(clean, { displayMode: true, throwOnError: false });
                                        } catch { return '<span style="color:#e53e3e">Lỗi cú pháp LaTeX</span>'; }
                                    })() : '<span style="color:#999">Bấm ký hiệu hoặc nhập LaTeX...</span>'
                                }} />
                            </div>

                            <div className="math-dialog-foot">
                                <button className="btn btn-ghost btn-sm" onClick={() => setMathDialog(null)}>Huỷ</button>
                                <button className="btn btn-primary btn-sm" onClick={confirmMath} disabled={!mathLatex.trim()}>
                                    <i className="bi bi-plus-lg"></i> Chèn công thức
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ═══ Helpers ═══
function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function renderLatex(html) {
    if (!html) return '';
    return html.replace(/\$\$\$(.*?)\$\$\$/gs, (_, tex) => {
        try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch { return tex; }
    }).replace(/\$\$(.*?)\$\$/g, (_, tex) => {
        try { return katex.renderToString(tex, { throwOnError: false }); } catch { return tex; }
    });
}

function extractImgTags(html) {
    if (!html) return [];
    const m = html.match(/<img [^>]*>/g);
    return m || [];
}

function richHtml(text, preservedImgs) {
    let html = escHtml(text);
    if (preservedImgs && preservedImgs.length > 0) {
        html += '<div class="preserved-imgs">' + preservedImgs.join('') + '</div>';
    }
    return html;
}
