import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { formatDate } from '../utils/formatters';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function renderLatex(html) {
    if (!html) return '';
    return html.replace(/\$\$(.*?)\$\$/gs, (_, tex) => {
        try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch { return tex; }
    }).replace(/\$(.*?)\$/g, (_, tex) => {
        try { return katex.renderToString(tex, { throwOnError: false }); } catch { return tex; }
    });
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

    useEffect(() => { loadData(); }, [examId]);

    const loadData = async () => {
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) { navigate('/teacher'); return; }
        const examData = { id: examDoc.id, ...examDoc.data() };
        setExam(examData);
        setForm({
            title: examData.title || '',
            subject: examData.subject || '',
            grade: examData.grade || '',
            duration: examData.duration || 45,
            maxAttempts: examData.maxAttempts || 1,
            shuffleQuestions: examData.shuffleQuestions ?? true,
            shuffleChoices: examData.shuffleChoices ?? false,
            showResult: examData.showResult ?? true,
        });

        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        setQuestions(qSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0)));
        setLoading(false);
    };

    const handleSave = async () => {
        await updateDoc(doc(db, 'exams', examId), {
            title: form.title.trim(),
            subject: form.subject || null,
            grade: form.grade || null,
            duration: Number(form.duration),
            maxAttempts: Number(form.maxAttempts),
            shuffleQuestions: form.shuffleQuestions,
            shuffleChoices: form.shuffleChoices,
            showResult: form.showResult,
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

    const deleteQuestion = async (qId) => {
        const result = await Swal.fire({
            title: 'Xóa câu hỏi?', icon: 'warning',
            showCancelButton: true, confirmButtonColor: '#ef4444',
            confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;
        await deleteDoc(doc(db, 'exams', examId, 'questions', qId));
        setQuestions(prev => prev.filter(q => q.id !== qId));
        await updateDoc(doc(db, 'exams', examId), { questionCount: questions.length - 1 });
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
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
                        <button className={`btn btn-sm ${exam.status === 'active' ? 'btn-warning-soft' : 'btn-success-soft'}`} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }} onClick={toggleStatus}>
                            <i className={`bi bi-${exam.status === 'active' ? 'pause-circle' : 'play-circle'}`}></i>
                            {exam.status === 'active' ? 'Đóng' : 'Kích hoạt'}
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
                            <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)} style={{ marginTop: 12 }}><i className="bi bi-pencil"></i> Chỉnh sửa</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Questions preview */}
            <div className="section-header">
                <h2 className="section-title"><i className="bi bi-list-ol"></i> Danh sách câu hỏi ({questions.length})</h2>
                <Link to={`/teacher/exam/${examId}/sessions`} className="btn btn-outline btn-sm"><i className="bi bi-bar-chart"></i> Xem kết quả</Link>
            </div>

            {questions.map((q, idx) => (
                <motion.div key={q.id} className="question-preview-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
                    <div className="question-preview-header">
                        <span className="question-number">{idx + 1}</span>
                        <button className="btn-icon-sm danger" onClick={() => deleteQuestion(q.id)} title="Xóa câu hỏi"><i className="bi bi-trash3"></i></button>
                    </div>
                    <div className="question-preview-content" dangerouslySetInnerHTML={{ __html: renderLatex(q.content_html || q.content_text || '') }} />
                    <div className="choice-preview-list">
                        {(q.choices || []).map((c, ci) => (
                            <div key={ci} className={`choice-preview ${c.isCorrect || (q.correct_answer && c.letter === q.correct_answer) ? 'correct' : ''}`}>
                                <span className="choice-letter-sm">{c.letter || String.fromCharCode(65 + ci)}</span>
                                <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || c.text || '') }} />
                                {(c.isCorrect || (q.correct_answer && c.letter === q.correct_answer)) && <i className="bi bi-check-circle-fill" style={{ color: '#10b981', marginLeft: 'auto' }}></i>}
                            </div>
                        ))}
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
