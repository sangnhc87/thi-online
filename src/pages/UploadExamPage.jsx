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
    const [parseWarnings, setParseWarnings] = useState([]);
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

    // Math sub-dialog
    const [mathTarget, setMathTarget] = useState(null);
    const [mathLatex, setMathLatex] = useState('');
    const [mathPaletteGroup, setMathPaletteGroup] = useState(0);

    // Image upload
    const imgInputRef = useRef(null);
    const [imgTarget, setImgTarget] = useState(null); // { field: 'content'|'choice'|'explanation', cIdx? }

    const previewRefs = useRef([]);
    const editorRefs = useRef([]);
    const fieldRefs = useRef({});

    // ═══ File handling ═══
    const handleParse = useCallback(async (f) => {
        if (!f) return;
        setParsing(true);
        setParseWarnings([]);
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
            // Warnings about images
            const warns = [];
            if (result.imageFiles?.length > 0) {
                const emfWmf = result.imageFiles.filter(f => /\.(emf|wmf)$/i.test(f.name));
                if (emfWmf.length > 0) warns.push(`${emfWmf.length} ảnh EMF/WMF (MathType) — trình duyệt có thể không hiển thị được`);
                warns.push(`Tìm thấy ${result.imageFiles.length} hình ảnh trong DOCX`);
            }
            const imgCount = result.questions.reduce((s, q) => {
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
        const selected = val.slice(start, end);
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

    // ═══ Image upload ═══
    const handleImageUpload = useCallback(async (e) => {
        const files = e.target.files;
        if (!files?.length || editingQ < 0 || !imgTarget) return;
        const uploaded = [];
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            if (file.size > 5 * 1024 * 1024) {
                Swal.fire('Ảnh quá lớn', `${file.name} vượt quá 5MB`, 'warning');
                continue;
            }
            const dataUrl = await new Promise((res) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.readAsDataURL(file);
            });
            uploaded.push({ dataUrl, name: file.name, blob: file, mime: file.type });
        }
        if (uploaded.length === 0) return;

        // Add to imageFiles for later upload
        setImageFiles(prev => [...prev, ...uploaded.map(u => ({
            rId: 'manual_' + Date.now() + '_' + u.name,
            name: u.name, blob: u.blob, mime: u.mime,
        }))]);

        // Insert <img> tag into html and update imageMap
        const i = editingQ;
        const imgTags = uploaded.map(u => `<img src="${u.dataUrl}" style="max-width:100%;vertical-align:middle;" />`).join('');
        setImageMap(prev => {
            const n = { ...prev };
            uploaded.forEach(u => { n['manual_' + u.name] = u.dataUrl; });
            return n;
        });

        if (imgTarget.field === 'content') {
            setQuestions(prev => prev.map((q, qi) => {
                if (qi !== i) return q;
                return { ...q, content_html: (q.content_html || '') + imgTags };
            }));
        } else if (imgTarget.field === 'choice' && imgTarget.cIdx != null) {
            setQuestions(prev => prev.map((q, qi) => {
                if (qi !== i) return q;
                const choices = q.choices.map((c, j) => j === imgTarget.cIdx ? { ...c, html: (c.html || '') + imgTags } : c);
                return { ...q, choices };
            }));
        } else if (imgTarget.field === 'explanation') {
            setQuestions(prev => prev.map((q, qi) => {
                if (qi !== i) return q;
                return { ...q, explanation_html: (q.explanation_html || '') + imgTags };
            }));
        }
        setImgTarget(null);
        if (imgInputRef.current) imgInputRef.current.value = '';
    }, [editingQ, imgTarget]);

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
        const tex = '$$' + mathLatex.replace(/\u25AB/g, '') + '$$';
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
    }, [mathTarget, editingQ, mathLatex, questions, updateQ, updateChoice]);

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
        const parsed = parseText(sourceText);
        if (parsed.length === 0) { Swal.fire('Không tìm thấy câu hỏi', 'Định dạng không hợp lệ.', 'warning'); return; }
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
            // Also upload manually added images
            const allHtml = questions.map(q => [q.content_html, q.explanation_html, ...(q.choices || []).map(c => c.html)].join('')).join('');
            const dataUrlMatches = allHtml.match(/src="(data:image\/[^"]+)"/g) || [];
            for (const m of dataUrlMatches) {
                const du = m.slice(5, -1);
                if (storageUrlMap[du]) continue;
                const resp = await fetch(du);
                const blob = await resp.blob();
                const imgRef = ref(storage, 'exams/' + user.uid + '/' + Date.now() + '_manual.png');
                await uploadBytes(imgRef, blob, { contentType: blob.type });
                const url = await getDownloadURL(imgRef);
                storageUrlMap[du] = url;
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
        } finally { setSaving(false); }
    };

    // Editing Q
    const eq = editingQ >= 0 && questions ? questions[editingQ] : null;

    // ═══ Mini toolbar component ═══
    const EditorToolbar = ({ fieldKey, onMath, onImage }) => (
        <div className="ed-toolbar">
            <button className="ed-tb-btn" title="In đậm **text**" onClick={() => wrapSelection(fieldKey, '**', '**')}>
                <i className="bi bi-type-bold"></i>
            </button>
            <button className="ed-tb-btn" title="In nghiêng *text*" onClick={() => wrapSelection(fieldKey, '*', '*')}>
                <i className="bi bi-type-italic"></i>
            </button>
            <button className="ed-tb-btn" title="Gạch chân" onClick={() => wrapSelection(fieldKey, '<u>', '</u>')}>
                <i className="bi bi-type-underline"></i>
            </button>
            <button className="ed-tb-btn" title="Gạch ngang" onClick={() => wrapSelection(fieldKey, '~~', '~~')}>
                <i className="bi bi-type-strikethrough"></i>
            </button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn" title="Căn giữa" onClick={() => wrapSelection(fieldKey, '<center>', '</center>')}>
                <i className="bi bi-text-center"></i>
            </button>
            <button className="ed-tb-btn" title="Danh sách •" onClick={() => insertAtLineStart(fieldKey, '• ')}>
                <i className="bi bi-list-ul"></i>
            </button>
            <button className="ed-tb-btn" title="Danh sách 1." onClick={() => insertAtLineStart(fieldKey, '1. ')}>
                <i className="bi bi-list-ol"></i>
            </button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn" title="Tô sáng" onClick={() => wrapSelection(fieldKey, '<mark>', '</mark>')}>
                <i className="bi bi-highlighter"></i>
            </button>
            <button className="ed-tb-btn" title="Chỉ số trên" onClick={() => wrapSelection(fieldKey, '<sup>', '</sup>')}>
                x<sup style={{fontSize:'0.6em'}}>²</sup>
            </button>
            <button className="ed-tb-btn" title="Chỉ số dưới" onClick={() => wrapSelection(fieldKey, '<sub>', '</sub>')}>
                x<sub style={{fontSize:'0.6em'}}>₂</sub>
            </button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn accent" title="Chèn công thức" onClick={onMath}>
                <i className="bi bi-calculator"></i> <span className="ed-tb-label">Σ Công thức</span>
            </button>
            <button className="ed-tb-btn accent" title="Chèn hình ảnh" onClick={onImage}>
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
                            <div className="format-col"><h5>Trắc nghiệm</h5><pre>{'Câu 1: Nội dung\nA. Đáp án A\nB. Đáp án B (gạch chân)\nC. Đáp án C\nD. Đáp án D'}</pre></div>
                            <div className="format-col"><h5>Đúng/Sai</h5><pre>{'Câu 2: Nội dung\na) Mệnh đề 1 (gạch chân=Đ)\nb) Mệnh đề 2\nc) Mệnh đề 3\nd) Mệnh đề 4'}</pre></div>
                            <div className="format-col"><h5>Tự luận ngắn</h5><pre>{'Câu 3: Nội dung\nĐáp án: 42\nLời giải: Chi tiết...'}</pre></div>
                        </div>
                        <small><b>Công thức:</b> Hỗ trợ Equation Editor (OMML) & MathType. <b>Đáp án đúng:</b> Gạch chân hoặc dòng "Đáp án: X"</small>
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

            {parseWarnings.length > 0 && (
                <div className="ee-warnings">
                    {parseWarnings.map((w, i) => (
                        <span key={i} className="ee-warn-item"><i className="bi bi-info-circle"></i> {w}</span>
                    ))}
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
                                    return (
                                        <div key={i} ref={el => editorRefs.current[i] = el}
                                            className={'eq-card' + (activeQ === i ? ' active' : '') + (issues.length ? ' has-issues' : ' valid')}
                                            onClick={() => { setEditingQ(i); setActiveQ(i); previewRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
                                            <div className="eq-header">
                                                <span className="eq-num">Câu {q.number}</span>
                                                <span className="eq-type-badge" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color }}>
                                                    {TYPE_LABELS[q.type]}
                                                </span>
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
                                                <p className="eq-preview-text">{(q.content_text || '').slice(0, 120)}{(q.content_text || '').length > 120 ? '...' : ''}</p>
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
                            return (
                                <div key={i} ref={el => previewRefs.current[i] = el}
                                    className={'ep-card' + (activeQ === i ? ' active' : '')}
                                    onClick={() => { setActiveQ(i); editorRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
                                    <div className="ep-header">
                                        <span className="ep-num">Câu {q.number}</span>
                                        <span className="ep-type" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color }}>
                                            {TYPE_LABELS[q.type]}
                                        </span>
                                        <button className="ep-edit-btn" onClick={e => { e.stopPropagation(); setEditingQ(i); setActiveQ(i); }} title="Chỉnh sửa">
                                            <i className="bi bi-pencil"></i>
                                        </button>
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
                                    </select>
                                    {getIssues(eq).length === 0
                                        ? <span className="ed-status ok"><i className="bi bi-check-circle-fill"></i> Hợp lệ</span>
                                        : <span className="ed-status warn"><i className="bi bi-exclamation-triangle-fill"></i> {getIssues(eq).join(', ')}</span>}
                                </div>
                                <div className="ed-head-right">
                                    <button className="ed-nav-btn" disabled={editingQ <= 0} onClick={() => setEditingQ(editingQ - 1)} title="Câu trước">
                                        <i className="bi bi-chevron-left"></i>
                                    </button>
                                    <span className="ed-nav-label">{editingQ + 1} / {questions.length}</span>
                                    <button className="ed-nav-btn" disabled={editingQ >= questions.length - 1} onClick={() => setEditingQ(editingQ + 1)} title="Câu sau">
                                        <i className="bi bi-chevron-right"></i>
                                    </button>
                                    <button className="ed-close" onClick={() => setEditingQ(-1)} title="Đóng"><i className="bi bi-x-lg"></i></button>
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
                                                                <button className="ed-mini" onClick={() => openMath('choice', j)} title="Công thức"><i className="bi bi-calculator"></i></button>
                                                                <button className="ed-mini" onClick={() => triggerImgUpload('choice', j)} title="Ảnh"><i className="bi bi-image"></i></button>
                                                                <button className="ed-mini danger" onClick={() => removeChoice(editingQ, j)} title="Xóa"><i className="bi bi-x-lg"></i></button>
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
                                        </div>
                                        <div className="ed-p-content" dangerouslySetInnerHTML={{ __html: renderLatex(eq.content_html || escHtml(eq.content_text)) }} />
                                        {eq.type === 'mcq' && eq.choices.length > 0 && (
                                            <div className="ep-choices">
                                                {eq.choices.map((c, j) => (
                                                    <div key={j} className={'ep-choice' + (eq.correct_answer === c.letter ? ' correct' : '')}>
                                                        <span className="ep-radio">{eq.correct_answer === c.letter ? '\u25CF' : '\u25CB'}</span>
                                                        <span className="ep-letter">{c.letter}.</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || escHtml(c.text)) }} />
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
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || escHtml(c.text)) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {eq.type === 'short_answer' && eq.correct_answer && (
                                            <div className="ep-answer"><i className="bi bi-pencil-square"></i> Đáp án: <b>{eq.correct_answer}</b></div>
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
