import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, updateDoc, deleteDoc, addDoc, writeBatch, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate } from '../utils/formatters';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';

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
        { l: 'a/b', t: '\\frac{▫}{▫}' }, { l: '√x', t: '\\sqrt{▫}' }, { l: 'x²', t: '{▫}^{2}' },
        { l: 'xⁿ', t: '{▫}^{▫}' }, { l: 'xₙ', t: '{▫}_{▫}' }, { l: '±', t: '\\pm ' },
        { l: '×', t: '\\times ' }, { l: '÷', t: '\\div ' }, { l: '·', t: '\\cdot ' },
    ] },
    { label: 'Giải tích', items: [
        { l: '∑', t: '\\sum_{▫}^{▫}' }, { l: '∫', t: '\\int_{▫}^{▫}' }, { l: 'lim', t: '\\lim_{▫ \\to ▫}' },
        { l: '∞', t: '\\infty ' }, { l: '→', t: '\\to ' },
    ] },
    { label: 'So sánh', items: [
        { l: '≤', t: '\\leq ' }, { l: '≥', t: '\\geq ' }, { l: '≠', t: '\\neq ' },
        { l: '≈', t: '\\approx ' }, { l: '⇒', t: '\\Rightarrow ' }, { l: '⇔', t: '\\Leftrightarrow ' },
    ] },
    { label: 'Hy Lạp', items: [
        { l: 'α', t: '\\alpha ' }, { l: 'β', t: '\\beta ' }, { l: 'π', t: '\\pi ' },
        { l: 'θ', t: '\\theta ' }, { l: 'Ω', t: '\\Omega ' },
    ] },
];

function renderLatex(html) {
    if (!html) return '';
    return html.replace(/\$\$\$(.*?)\$\$\$/gs, (_, tex) => {
        try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch { return tex; }
    }).replace(/\$\$(.*?)\$\$/g, (_, tex) => {
        try { return katex.renderToString(tex, { throwOnError: false }); } catch { return tex; }
    });
}
function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }
function extractImgTags(html) { return html ? (html.match(/<img [^>]*>/g) || []) : []; }
function richHtml(text, preservedImgs) {
    let html = (text || '');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/^• (.+)$/gm, '<li style="list-style:disc;margin-left:20px">$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li style="list-style:decimal;margin-left:20px">$1</li>');
    html = html.replace(/\n/g, '<br>');
    if (preservedImgs?.length > 0) html += preservedImgs.join('');
    return html;
}

export default function ExamDetailPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({});
    const [loading, setLoading] = useState(true);
    const [editingQ, setEditingQ] = useState(-1);
    const [savingQ, setSavingQ] = useState(false);
    const [mathTarget, setMathTarget] = useState(null);
    const [mathLatex, setMathLatex] = useState('');
    const [mathPaletteGroup, setMathPaletteGroup] = useState(0);
    const fieldRefs = useRef({});
    const imgInputRef = useRef(null);
    const [imgTarget, setImgTarget] = useState(null);

    useEffect(() => { loadData(); }, [examId]);

    const loadData = async () => {
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) { navigate('/teacher'); return; }
        const examData = { id: examDoc.id, ...examDoc.data() };
        setExam(examData);
        setForm({
            title: examData.title || '', subject: examData.subject || '', grade: examData.grade || '',
            duration: examData.duration || 45, maxAttempts: examData.maxAttempts || 1,
            shuffleQuestions: examData.shuffleQuestions ?? true, shuffleChoices: examData.shuffleChoices ?? false,
            showResult: examData.showResult ?? true,
        });
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        setQuestions(qSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || a.number || 0) - (b.order || b.number || 0)));
        setLoading(false);
    };

    const handleSave = async () => {
        await updateDoc(doc(db, 'exams', examId), {
            title: form.title.trim(), subject: form.subject || null, grade: form.grade || null,
            duration: Number(form.duration), maxAttempts: Number(form.maxAttempts),
            shuffleQuestions: form.shuffleQuestions, shuffleChoices: form.shuffleChoices, showResult: form.showResult,
        });
        setExam(prev => ({ ...prev, ...form }));
        setEditing(false);
        Swal.fire({ icon: 'success', title: 'Đã lưu!', timer: 1200, showConfirmButton: false });
    };

    const toggleStatus = async () => {
        const newStatus = exam.status === 'active' ? 'draft' : 'active';
        await updateDoc(doc(db, 'exams', examId), { status: newStatus });
        setExam(prev => ({ ...prev, status: newStatus }));
    };

    const deleteExam = async () => {
        const result = await Swal.fire({
            title: 'Xóa đề thi?', html: `<b>${exam.title}</b> và tất cả câu hỏi sẽ bị xóa vĩnh viễn.`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;
        const batch = writeBatch(db);
        questions.forEach(q => batch.delete(doc(db, 'exams', examId, 'questions', q.id)));
        batch.delete(doc(db, 'exams', examId));
        await batch.commit();
        Swal.fire({ icon: 'success', title: 'Đã xóa!', timer: 1200, showConfirmButton: false });
        navigate('/teacher');
    };

    const deleteQuestion = async (qId) => {
        const result = await Swal.fire({
            title: 'Xóa câu hỏi?', icon: 'warning', showCancelButton: true,
            confirmButtonColor: '#ef4444', confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;
        await deleteDoc(doc(db, 'exams', examId, 'questions', qId));
        const updated = questions.filter(q => q.id !== qId);
        setQuestions(updated);
        if (editingQ >= updated.length) setEditingQ(updated.length - 1);
        await updateDoc(doc(db, 'exams', examId), { questionCount: updated.length });
    };

    /* ═══ Rescore all sessions ═══ */
    const rescoreAllSessions = async () => {
        const confirm = await Swal.fire({
            title: 'Chấm lại tất cả?',
            html: 'Hệ thống sẽ tính lại điểm tất cả bài thi dựa trên đáp án hiện tại.',
            icon: 'question', showCancelButton: true, confirmButtonText: 'Chấm lại', cancelButtonText: 'Hủy',
        });
        if (!confirm.isConfirmed) return;

        Swal.fire({ title: 'Đang chấm lại...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        try {
            const sessionQ = query(collection(db, 'sessions'), where('examId', '==', examId));
            const sessionSnap = await getDocs(sessionQ);
            if (sessionSnap.empty) { Swal.fire({ icon: 'info', title: 'Chưa có bài thi nào', timer: 1500, showConfirmButton: false }); return; }

            // Build correct answer map from current questions
            const correctMap = {};
            questions.forEach(q => {
                if (q.type === 'mcq') {
                    const idx = (q.choices || []).findIndex(c => c.letter === q.correct_answer);
                    correctMap[q.id] = idx;
                } else if (q.type === 'tf') {
                    correctMap[q.id] = q.correct_answer; // e.g. "DDSS"
                } else if (q.type === 'short_answer') {
                    correctMap[q.id] = (q.correct_answer || '').trim().toLowerCase();
                }
            });

            const pointMap = {};
            questions.forEach(q => { pointMap[q.id] = q.points || 1; });
            const totalPoints = questions.reduce((sum, q) => sum + (q.points || 1), 0);

            let updated = 0;
            const batch = writeBatch(db);
            sessionSnap.docs.forEach(sessionDoc => {
                const data = sessionDoc.data();
                const answers = data.answers || [];
                let newScore = 0;
                const newAnswers = answers.map(a => {
                    const q = questions.find(q => q.id === a.questionId);
                    if (!q) return { ...a, isCorrect: false };
                    let isCorrect = false;
                    if (q.type === 'mcq') {
                        const correctIdx = correctMap[q.id];
                        isCorrect = a.selected === correctIdx;
                    } else if (q.type === 'tf') {
                        // TF answers stored differently - match stored answer
                        isCorrect = a.isCorrect; // keep for now if no recalc logic
                    } else if (q.type === 'short_answer') {
                        isCorrect = (a.textAnswer || '').trim().toLowerCase() === correctMap[q.id];
                    }
                    if (isCorrect) newScore += (q.points || 1);
                    return { ...a, isCorrect, correctIdx: correctMap[q.id] };
                });
                batch.update(sessionDoc.ref, { score: newScore, total: questions.length, totalPoints, answers: newAnswers });
                updated++;
            });
            await batch.commit();
            Swal.fire({ icon: 'success', title: `Đã chấm lại ${updated} bài thi!`, timer: 2000, showConfirmButton: false });
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi', err.message, 'error');
        }
    };

    /* ═══ Question editing helpers ═══ */
    const eq = editingQ >= 0 ? questions[editingQ] : null;

    const updateQ = useCallback((idx, updates) => {
        setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q));
    }, []);

    const updateChoice = useCallback((qIdx, cIdx, updates) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const choices = q.choices.map((c, j) => j === cIdx ? { ...c, ...updates } : c);
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

    const wrapSelection = useCallback((fieldKey, before, after) => {
        const ta = fieldRefs.current[fieldKey];
        if (!ta) return;
        const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
        const selected = val.slice(start, end);
        const newVal = val.slice(0, start) + before + selected + after + val.slice(end);
        if (fieldKey === 'q-content') updateQ(editingQ, { content_text: newVal });
        else if (fieldKey === 'q-expl') updateQ(editingQ, { explanation: newVal });
        else if (fieldKey.startsWith('q-c')) updateChoice(editingQ, parseInt(fieldKey.slice(3)), { text: newVal });
        setTimeout(() => { ta.focus(); ta.selectionStart = start + before.length; ta.selectionEnd = start + before.length + selected.length; }, 10);
    }, [editingQ, updateQ, updateChoice]);

    const insertAtLineStart = useCallback((fieldKey, prefix) => {
        const ta = fieldRefs.current[fieldKey];
        if (!ta) return;
        const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = val.indexOf('\n', end); const actualEnd = lineEnd === -1 ? val.length : lineEnd;
        const lines = val.slice(lineStart, actualEnd).split('\n');
        const prefixed = lines.map((line, i) => prefix === '1. ' ? `${i+1}. ${line}` : prefix + line).join('\n');
        const newVal = val.slice(0, lineStart) + prefixed + val.slice(actualEnd);
        if (fieldKey === 'q-content') updateQ(editingQ, { content_text: newVal });
        else if (fieldKey === 'q-expl') updateQ(editingQ, { explanation: newVal });
        else if (fieldKey.startsWith('q-c')) updateChoice(editingQ, parseInt(fieldKey.slice(3)), { text: newVal });
        setTimeout(() => { ta.focus(); }, 10);
    }, [editingQ, updateQ, updateChoice]);

    /* ═══ Image upload ═══ */
    const handleImageUpload = useCallback(async (e) => {
        const files = e.target.files;
        if (!files?.length || editingQ < 0 || !imgTarget) return;
        for (const file of files) {
            if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) continue;
            const imgRef = ref(storage, 'exams/' + user.uid + '/' + Date.now() + '_' + file.name);
            await uploadBytes(imgRef, file, { contentType: file.type });
            const url = await getDownloadURL(imgRef);
            const imgTag = `<img src="${url}" style="max-width:100%;vertical-align:middle;" />`;
            const i = editingQ;
            if (imgTarget.field === 'content') {
                setQuestions(prev => prev.map((q, qi) => qi !== i ? q : { ...q, content_html: (q.content_html || '') + imgTag }));
            } else if (imgTarget.field === 'choice' && imgTarget.cIdx != null) {
                setQuestions(prev => prev.map((q, qi) => {
                    if (qi !== i) return q;
                    const choices = q.choices.map((c, j) => j === imgTarget.cIdx ? { ...c, html: (c.html || '') + imgTag } : c);
                    return { ...q, choices };
                }));
            } else if (imgTarget.field === 'explanation') {
                setQuestions(prev => prev.map((q, qi) => qi !== i ? q : { ...q, explanation_html: (q.explanation_html || '') + imgTag }));
            }
        }
        setImgTarget(null);
        if (imgInputRef.current) imgInputRef.current.value = '';
    }, [editingQ, imgTarget, user]);

    const triggerImgUpload = useCallback((field, cIdx) => {
        setImgTarget({ field, cIdx });
        setTimeout(() => imgInputRef.current?.click(), 50);
    }, []);

    /* ═══ Math ═══ */
    const openMath = (field, cIdx) => { setMathTarget({ field, cIdx }); setMathLatex(''); setMathPaletteGroup(0); };
    const insertMathSymbol = (latex) => { setMathLatex(prev => { const ph = '\u25AB'; const idx = prev.indexOf(ph); return idx >= 0 ? prev.slice(0, idx) + latex + prev.slice(idx + 1) : prev + latex; }); };
    const confirmMath = () => {
        if (!mathTarget || editingQ < 0 || !mathLatex.trim()) return;
        const i = editingQ, tex = '$$' + mathLatex.replace(/\u25AB/g, '') + '$$';
        if (mathTarget.field === 'content') updateQ(i, { content_text: (questions[i].content_text || '') + tex });
        else if (mathTarget.field === 'choice') updateChoice(i, mathTarget.cIdx, { text: (questions[i].choices[mathTarget.cIdx]?.text || '') + tex });
        else if (mathTarget.field === 'explanation') updateQ(i, { explanation: (questions[i].explanation || '') + tex });
        setMathTarget(null); setMathLatex('');
    };

    /* ═══ Save single question ═══ */
    const saveQuestion = async (idx) => {
        const q = questions[idx];
        if (!q.id) return;
        setSavingQ(true);
        try {
            const content_html = richHtml(q.content_text, extractImgTags(q.content_html));
            const explanation_html = q.explanation ? richHtml(q.explanation, extractImgTags(q.explanation_html)) : null;
            const choices = (q.choices || []).map(c => ({
                letter: c.letter, text: c.text, html: richHtml(c.text, extractImgTags(c.html)),
            }));
            await updateDoc(doc(db, 'exams', examId, 'questions', q.id), {
                content_text: q.content_text || '', content_html,
                choices, correct_answer: q.correct_answer || null,
                explanation: q.explanation || null, explanation_html, type: q.type,
                points: q.points || 1,
            });
            updateQ(idx, { content_html, explanation_html, choices });
            Swal.fire({ icon: 'success', title: 'Đã lưu câu ' + (idx + 1), timer: 800, showConfirmButton: false });
        } catch (err) {
            console.error(err);
            Swal.fire('Lỗi', err.message, 'error');
        } finally { setSavingQ(false); }
    };

    /* ═══ Add new question ═══ */
    const addQuestion = async () => {
        const newQ = {
            number: questions.length + 1, type: 'mcq', order: questions.length + 1,
            content_text: '', content_html: '',
            choices: [{ letter: 'A', text: '', html: '' }, { letter: 'B', text: '', html: '' }, { letter: 'C', text: '', html: '' }, { letter: 'D', text: '', html: '' }],
            correct_answer: null, explanation: null, explanation_html: null,
        };
        const docRef = await addDoc(collection(db, 'exams', examId, 'questions'), newQ);
        setQuestions(prev => [...prev, { id: docRef.id, ...newQ }]);
        await updateDoc(doc(db, 'exams', examId), { questionCount: questions.length + 1 });
        setEditingQ(questions.length);
        Swal.fire({ icon: 'success', title: 'Đã thêm câu ' + (questions.length + 1), timer: 800, showConfirmButton: false });
    };

    /* Mini toolbar */
    const EditorToolbar = ({ fieldKey, onMath, onImage }) => (
        <div className="ed-toolbar">
            <button className="ed-tb-btn" title="In đậm" onClick={() => wrapSelection(fieldKey, '**', '**')}><i className="bi bi-type-bold"></i></button>
            <button className="ed-tb-btn" title="In nghiêng" onClick={() => wrapSelection(fieldKey, '*', '*')}><i className="bi bi-type-italic"></i></button>
            <button className="ed-tb-btn" title="Gạch chân" onClick={() => wrapSelection(fieldKey, '<u>', '</u>')}><i className="bi bi-type-underline"></i></button>
            <button className="ed-tb-btn" title="Gạch ngang" onClick={() => wrapSelection(fieldKey, '~~', '~~')}><i className="bi bi-type-strikethrough"></i></button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn" title="Căn giữa" onClick={() => wrapSelection(fieldKey, '{center}', '{/center}')}><i className="bi bi-text-center"></i></button>
            <button className="ed-tb-btn" title="Danh sách •" onClick={() => insertAtLineStart(fieldKey, '• ')}><i className="bi bi-list-ul"></i></button>
            <button className="ed-tb-btn" title="Danh sách 1." onClick={() => insertAtLineStart(fieldKey, '1. ')}><i className="bi bi-list-ol"></i></button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn" title="Tô sáng" onClick={() => wrapSelection(fieldKey, '==', '==')}><i className="bi bi-highlighter"></i></button>
            <button className="ed-tb-btn" title="Chỉ số trên" onClick={() => wrapSelection(fieldKey, '<sup>', '</sup>')}>x<sup style={{fontSize:'0.6em'}}>²</sup></button>
            <button className="ed-tb-btn" title="Chỉ số dưới" onClick={() => wrapSelection(fieldKey, '<sub>', '</sub>')}>x<sub style={{fontSize:'0.6em'}}>₂</sub></button>
            <span className="ed-tb-sep" />
            <button className="ed-tb-btn accent" title="Công thức" onClick={onMath}><i className="bi bi-calculator"></i> <span className="ed-tb-label">Σ</span></button>
            <button className="ed-tb-btn accent" title="Ảnh" onClick={onImage}><i className="bi bi-image"></i></button>
        </div>
    );

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />

            {/* Breadcrumb */}
            <div className="breadcrumb">
                <Link to="/teacher"><i className="bi bi-arrow-left"></i> Kho đề</Link>
                <span className="breadcrumb-sep">/</span>
                <span>{exam.title}</span>
            </div>

            {/* Exam info card */}
            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-header-gradient" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ color: '#fff', margin: 0 }}>{exam.title}</h2>
                        <p style={{ color: 'rgba(255,255,255,0.8)', margin: '4px 0 0', fontSize: '0.85rem' }}>
                            {exam.subject && `${exam.subject}`}{exam.grade && ` · ${exam.grade}`} · {formatDate(exam.createdAt)}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8 }} onClick={toggleStatus}>
                            <i className={`bi bi-${exam.status === 'active' ? 'pause-circle' : 'play-circle'}`}></i>
                            {exam.status === 'active' ? ' Đóng' : ' Kích hoạt'}
                        </button>
                        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: '#fca5a5', border: '1px solid rgba(252,165,165,0.3)', borderRadius: 8 }} onClick={deleteExam}>
                            <i className="bi bi-trash3"></i> Xóa đề
                        </button>
                    </div>
                </div>
                <div className="card-body">
                    {editing ? (
                        <div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tiêu đề</label><input className="form-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Môn</label><input className="form-input" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Lớp</label><input className="form-input" value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Thời gian (phút)</label><input type="number" className="form-input" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Lần thi tối đa</label><input type="number" className="form-input" value={form.maxAttempts} onChange={e => setForm({ ...form, maxAttempts: e.target.value })} /></div>
                            </div>
                            <div className="toggle-group">
                                <label className="toggle-label"><input type="checkbox" checked={form.shuffleQuestions} onChange={e => setForm({ ...form, shuffleQuestions: e.target.checked })} /><span className="toggle-switch"></span><span>Xáo trộn câu hỏi</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.shuffleChoices} onChange={e => setForm({ ...form, shuffleChoices: e.target.checked })} /><span className="toggle-switch"></span><span>Xáo trộn đáp án</span></label>
                                <label className="toggle-label"><input type="checkbox" checked={form.showResult} onChange={e => setForm({ ...form, showResult: e.target.checked })} /><span className="toggle-switch"></span><span>Hiện kết quả chi tiết</span></label>
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                <button className="btn btn-primary btn-sm" onClick={handleSave}><i className="bi bi-check-lg"></i> Lưu</button>
                                <button className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>Hủy</button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="info-grid">
                                <div className="info-item"><span className="info-label">Thời gian</span><span className="info-value">{exam.duration} phút</span></div>
                                <div className="info-item"><span className="info-label">Số câu</span><span className="info-value">{questions.length}</span></div>
                                <div className="info-item"><span className="info-label">Lần thi tối đa</span><span className="info-value">{exam.maxAttempts || 1}</span></div>
                                <div className="info-item"><span className="info-label">Trạng thái</span><span className={`stat-badge ${exam.status === 'active' ? 'success' : 'warning'}`}>{exam.status === 'active' ? 'Đang mở' : 'Nháp'}</span></div>
                                <div className="info-item"><span className="info-label">Xáo trộn câu</span><span className="info-value">{exam.shuffleQuestions ? '✓' : '✗'}</span></div>
                                <div className="info-item"><span className="info-label">Xáo trộn đáp án</span><span className="info-value">{exam.shuffleChoices ? '✓' : '✗'}</span></div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}><i className="bi bi-pencil"></i> Chỉnh sửa cài đặt</button>
                                <Link to={`/teacher/exam/${examId}/sessions`} className="btn btn-outline btn-sm"><i className="bi bi-bar-chart"></i> Xem kết quả thi</Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Questions header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <h2 className="section-title" style={{ margin: 0 }}>
                    <i className="bi bi-list-ol"></i> Câu hỏi ({questions.length})
                </h2>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={rescoreAllSessions} title="Chấm lại điểm dựa trên đáp án hiện tại">
                        <i className="bi bi-arrow-repeat"></i> Chấm lại
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={addQuestion}>
                        <i className="bi bi-plus-lg"></i> Thêm câu hỏi
                    </button>
                </div>
            </div>

            {/* Question cards */}
            {questions.map((q, idx) => (
                <motion.div key={q.id} className="question-preview-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
                    style={{ cursor: 'pointer' }} onClick={() => setEditingQ(idx)}>
                    <div className="question-preview-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="question-number">{idx + 1}</span>
                            <span className="stat-badge" style={{ background: TYPE_COLORS[q.type]?.bg, color: TYPE_COLORS[q.type]?.color, fontSize: '0.7rem' }}>{TYPE_LABELS[q.type] || q.type}</span>
                            {q.points && q.points !== 1 && <span className="stat-badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '0.7rem' }}>{q.points}đ</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn-icon-sm" onClick={e => { e.stopPropagation(); setEditingQ(idx); }} title="Sửa"><i className="bi bi-pencil"></i></button>
                            <button className="btn-icon-sm danger" onClick={e => { e.stopPropagation(); deleteQuestion(q.id); }} title="Xóa"><i className="bi bi-trash3"></i></button>
                        </div>
                    </div>
                    <div className="question-preview-content" dangerouslySetInnerHTML={{ __html: renderLatex(q.content_html || escHtml(q.content_text) || '') }} />
                    <div className="choice-preview-list">
                        {(q.choices || []).map((c, ci) => {
                            const isCorrect = q.type === 'mcq' ? (q.correct_answer === c.letter || c.isCorrect) :
                                q.type === 'tf' ? q.correct_answer?.[ci] === 'D' : false;
                            return (
                                <div key={ci} className={`choice-preview ${isCorrect ? 'correct' : ''}`}>
                                    <span className="choice-letter-sm">{c.letter || String.fromCharCode(65 + ci)}</span>
                                    <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || escHtml(c.text) || '') }} />
                                    {isCorrect && <i className="bi bi-check-circle-fill" style={{ color: '#10b981', marginLeft: 'auto' }}></i>}
                                </div>
                            );
                        })}
                    </div>
                    {q.type === 'short_answer' && q.correct_answer && (
                        <div style={{ fontSize: '0.85rem', marginTop: 6, color: '#059669' }}>
                            <i className="bi bi-check2-circle"></i> Đáp án: <b>{q.correct_answer}</b>
                        </div>
                    )}
                </motion.div>
            ))}

            {questions.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                    <i className="bi bi-inbox" style={{ fontSize: 48 }}></i>
                    <p style={{ marginTop: 12 }}>Chưa có câu hỏi nào. Bấm "Thêm câu hỏi" để bắt đầu.</p>
                </div>
            )}

            {/* ══════ EDIT DIALOG ══════ */}
            <AnimatePresence>
                {eq && (
                    <motion.div className="ed-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={e => { if (e.target === e.currentTarget) setEditingQ(-1); }}>
                        <motion.div className="ed-dialog" initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0, scale: 0.97 }}
                            transition={{ type: 'spring', damping: 28, stiffness: 400 }}>
                            <div className="ed-head">
                                <div className="ed-head-left">
                                    <span className="ed-head-num">Câu {editingQ + 1}</span>
                                    <select value={eq.type} onChange={e => updateQ(editingQ, { type: e.target.value })} className="ed-type-select">
                                        <option value="mcq">Trắc nghiệm</option>
                                        <option value="tf">Đúng/Sai</option>
                                        <option value="short_answer">Tự luận ngắn</option>
                                    </select>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                                        <label style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>Điểm:</label>
                                        <input type="number" min="0" step="0.25" value={eq.points || 1}
                                            onChange={e => updateQ(editingQ, { points: parseFloat(e.target.value) || 1 })}
                                            style={{ width: 50, padding: '2px 6px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.85rem', textAlign: 'center' }} />
                                    </div>
                                </div>
                                <div className="ed-head-right">
                                    <button className="ed-nav-btn" disabled={editingQ <= 0} onClick={() => setEditingQ(editingQ - 1)}><i className="bi bi-chevron-left"></i></button>
                                    <span className="ed-nav-label">{editingQ + 1} / {questions.length}</span>
                                    <button className="ed-nav-btn" disabled={editingQ >= questions.length - 1} onClick={() => setEditingQ(editingQ + 1)}><i className="bi bi-chevron-right"></i></button>
                                    <button className="btn btn-primary btn-sm" onClick={() => saveQuestion(editingQ)} disabled={savingQ} style={{ marginLeft: 8 }}>
                                        {savingQ ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span> : <><i className="bi bi-check-lg"></i> Lưu</>}
                                    </button>
                                    <button className="ed-close" onClick={() => setEditingQ(-1)}><i className="bi bi-x-lg"></i></button>
                                </div>
                            </div>

                            <div className="ed-body">
                                <div className="ed-form">
                                    <div className="ed-section">
                                        <label className="ed-label"><i className="bi bi-card-text"></i> Nội dung câu hỏi</label>
                                        <EditorToolbar fieldKey="q-content" onMath={() => openMath('content')} onImage={() => triggerImgUpload('content')} />
                                        <textarea ref={el => fieldRefs.current['q-content'] = el} value={eq.content_text || ''}
                                            onChange={e => updateQ(editingQ, { content_text: e.target.value })}
                                            rows={Math.max(3, Math.min(10, (eq.content_text || '').split('\n').length + 1))}
                                            className="ed-textarea" placeholder="Nhập nội dung câu hỏi..." />
                                    </div>

                                    {(eq.type === 'mcq' || eq.type === 'tf') && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-list-check"></i> Đáp án {eq.type === 'mcq' && <small>(chọn đáp án đúng)</small>}</label>
                                            <div className="ed-choices">
                                                {eq.choices.map((c, j) => {
                                                    const isCorrect = eq.type === 'mcq' ? eq.correct_answer === c.letter : eq.correct_answer?.[j] === 'D';
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
                                                                        {isCorrect ? 'Đ' : 'S'}
                                                                    </button>
                                                                )}
                                                                <span className="ed-cletter">{eq.type === 'tf' ? c.letter + ')' : c.letter + '.'}</span>
                                                                <input type="text" ref={el => fieldRefs.current['q-c' + j] = el}
                                                                    value={c.text || ''} onChange={e => updateChoice(editingQ, j, { text: e.target.value })}
                                                                    className="ed-cinput" placeholder="Nội dung đáp án..." />
                                                                <button className="ed-mini" onClick={() => openMath('choice', j)} title="Công thức"><i className="bi bi-calculator"></i></button>
                                                                <button className="ed-mini" onClick={() => triggerImgUpload('choice', j)} title="Ảnh"><i className="bi bi-image"></i></button>
                                                                <button className="ed-mini danger" onClick={() => removeChoice(editingQ, j)} title="Xóa"><i className="bi bi-x-lg"></i></button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <button className="ed-add-choice" onClick={() => addChoice(editingQ)}><i className="bi bi-plus-circle"></i> Thêm đáp án</button>
                                        </div>
                                    )}

                                    {eq.type === 'short_answer' && (
                                        <div className="ed-section">
                                            <label className="ed-label"><i className="bi bi-check2-circle"></i> Đáp án</label>
                                            <input type="text" value={eq.correct_answer || ''} onChange={e => setCorrectAnswer(editingQ, e.target.value)}
                                                className="ed-cinput" style={{ width: '100%' }} placeholder="Nhập đáp án..." />
                                        </div>
                                    )}

                                    <div className="ed-section ed-expl">
                                        <label className="ed-label"><i className="bi bi-lightbulb"></i> Lời giải <small>(không bắt buộc)</small></label>
                                        <EditorToolbar fieldKey="q-expl" onMath={() => openMath('explanation')} onImage={() => triggerImgUpload('explanation')} />
                                        <textarea ref={el => fieldRefs.current['q-expl'] = el} value={eq.explanation || ''}
                                            onChange={e => updateQ(editingQ, { explanation: e.target.value })}
                                            rows={3} className="ed-textarea" placeholder="Giải thích chi tiết..." />
                                    </div>
                                </div>

                                <div className="ed-preview">
                                    <div className="ed-preview-label"><i className="bi bi-eye"></i> Xem trước</div>
                                    <div className="ed-preview-card">
                                        <div className="ed-p-head">
                                            <span className="ep-num">Câu {editingQ + 1}</span>
                                            <span className="ep-type" style={{ background: TYPE_COLORS[eq.type]?.bg, color: TYPE_COLORS[eq.type]?.color }}>{TYPE_LABELS[eq.type]}</span>
                                        </div>
                                        <div className="ed-p-content" dangerouslySetInnerHTML={{ __html: renderLatex(eq.content_html || escHtml(eq.content_text)) }} />
                                        {eq.type === 'mcq' && eq.choices.length > 0 && (
                                            <div className="ep-choices">
                                                {eq.choices.map((c, j) => (
                                                    <div key={j} className={'ep-choice' + (eq.correct_answer === c.letter ? ' correct' : '')}>
                                                        <span className="ep-radio">{eq.correct_answer === c.letter ? '●' : '○'}</span>
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
                                                        <span style={{ display:'inline-block', width:24, height:24, borderRadius:4, textAlign:'center', lineHeight:'24px', fontSize:'0.75rem', fontWeight:700, background: eq.correct_answer?.[j] === 'D' ? '#d1fae5' : '#fee2e2', color: eq.correct_answer?.[j] === 'D' ? '#065f46' : '#991b1b' }}>{eq.correct_answer?.[j] === 'D' ? 'Đ' : 'S'}</span>
                                                        <span className="ep-letter">{c.letter})</span>
                                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || escHtml(c.text)) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {eq.type === 'short_answer' && eq.correct_answer && <div style={{ margin: '12px 0', color: '#059669', fontWeight: 600 }}><i className="bi bi-pencil-square"></i> Đáp án: {eq.correct_answer}</div>}
                                        {(eq.explanation || eq.explanation_html) ? (
                                            <div className="ed-p-expl">
                                                <div className="ed-p-expl-head"><i className="bi bi-lightbulb-fill"></i> Lời giải</div>
                                                <div className="ed-p-expl-body" dangerouslySetInnerHTML={{ __html: renderLatex(eq.explanation_html || escHtml(eq.explanation || '')) }} />
                                            </div>
                                        ) : <div style={{ padding: '12px', color: '#94a3b8', fontSize: '0.85rem' }}><i className="bi bi-lightbulb"></i> Chưa có lời giải</div>}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ══════ MATH SUB-DIALOG ══════ */}
            <AnimatePresence>
                {mathTarget && (
                    <motion.div className="math-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        onClick={() => setMathTarget(null)} style={{ zIndex: 1100 }}>
                        <motion.div className="math-dialog" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            onClick={e => e.stopPropagation()}>
                            <div className="math-dialog-head">
                                <h3><i className="bi bi-calculator"></i> Chèn công thức</h3>
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
                            <div className="math-input-area"><label>LaTeX</label>
                                <textarea value={mathLatex} onChange={e => setMathLatex(e.target.value)}
                                    placeholder='Nhập LaTeX: \frac{1}{2}, \sqrt{x},...' rows={3} autoFocus />
                            </div>
                            <div className="math-live"><label>Xem trước</label>
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
