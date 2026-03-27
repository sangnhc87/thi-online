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

    const previewRefs = useRef([]);
    const editorRefs = useRef([]);

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

    const updateQ = useCallback((idx, updates) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== idx) return q;
            const updated = { ...q, ...updates };
            if ('content_text' in updates) updated.content_html = escHtml(updates.content_text);
            if ('explanation' in updates) updated.explanation_html = updates.explanation ? escHtml(updates.explanation) : null;
            return updated;
        }));
    }, []);

    const updateChoice = useCallback((qIdx, cIdx, updates) => {
        setQuestions(prev => prev.map((q, i) => {
            if (i !== qIdx) return q;
            const choices = q.choices.map((c, j) => {
                if (j !== cIdx) return c;
                const u = { ...c, ...updates };
                if ('text' in updates) u.html = escHtml(updates.text);
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
                                <small style={{ color: 'var(--text-muted)' }}>Trích xuất câu hỏi, đáp án, hình ảnh</small>
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
                        <small><b>Đáp án đúng:</b> Gạch chân trong Word hoặc dòng "Đáp án: X"</small>
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
                                    return (
                                        <div key={i} ref={el => editorRefs.current[i] = el}
                                            className={'eq-card' + (isActive ? ' active' : '') + (issues.length ? ' has-issues' : ' valid')}
                                            onClick={() => scrollToPreview(i)}>
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
                                            {!isEditing && (
                                                <div className="eq-compact">
                                                    <p className="eq-preview-text">{(q.content_text || '').slice(0, 120)}{(q.content_text || '').length > 120 ? '...' : ''}</p>
                                                    {q.choices.length > 0 && (
                                                        <div className="eq-choices-inline">
                                                            {q.choices.map((c, j) => (
                                                                <span key={j} className={'eq-choice-pill' + (q.correct_answer === c.letter ? ' correct' : '')}>
                                                                    {q.type === 'tf' ? c.letter + ')' : c.letter + '.'} {(c.text || '').slice(0, 25)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {issues.length > 0 && <div className="eq-issues">{issues.map((iss, j) => <span key={j}>⚠ {iss}</span>)}</div>}
                                                </div>
                                            )}
                                            {isEditing && (
                                                <div className="eq-edit" onClick={e => e.stopPropagation()}>
                                                    <div className="eq-field"><label>Loại:</label>
                                                        <select value={q.type} onChange={e => changeType(i, e.target.value)} className="form-select-sm">
                                                            <option value="mcq">Trắc nghiệm</option><option value="tf">Đúng/Sai</option><option value="short_answer">Tự luận ngắn</option>
                                                        </select>
                                                    </div>
                                                    <div className="eq-field"><label>Nội dung:</label>
                                                        <textarea value={q.content_text || ''} onChange={e => updateQ(i, { content_text: e.target.value })}
                                                            rows={Math.min(6, (q.content_text || '').split('\n').length + 1)} className="eq-textarea" />
                                                    </div>
                                                    {(q.type === 'mcq' || q.type === 'tf') && (
                                                        <div className="eq-field"><label>Đáp án:</label>
                                                            {q.choices.map((c, j) => (
                                                                <div key={j} className="eq-choice-row">
                                                                    {q.type === 'mcq' ? (
                                                                        <input type="radio" name={'correct-' + i} checked={q.correct_answer === c.letter}
                                                                            onChange={() => setCorrectAnswer(i, c.letter)} />
                                                                    ) : (
                                                                        <label className="eq-tf-toggle">
                                                                            <input type="checkbox"
                                                                                checked={q.correct_answer ? q.correct_answer[j] === 'D' : false}
                                                                                onChange={e => {
                                                                                    const arr = (q.correct_answer || 'SSSS').split('');
                                                                                    arr[j] = e.target.checked ? 'D' : 'S';
                                                                                    setCorrectAnswer(i, arr.join(''));
                                                                                }} />
                                                                            <span className="eq-tf-label">{q.correct_answer?.[j] === 'D' ? 'Đ' : 'S'}</span>
                                                                        </label>
                                                                    )}
                                                                    <span className="eq-choice-letter">{q.type === 'tf' ? c.letter + ')' : c.letter + '.'}</span>
                                                                    <input type="text" value={c.text || ''} onChange={e => updateChoice(i, j, { text: e.target.value })}
                                                                        className="eq-choice-input" placeholder="Nội dung đáp án..." />
                                                                    <button className="eq-btn-x" onClick={() => removeChoice(i, j)}>×</button>
                                                                </div>
                                                            ))}
                                                            <button className="eq-add-choice" onClick={() => addChoice(i)}>
                                                                <i className="bi bi-plus"></i> Thêm đáp án
                                                            </button>
                                                        </div>
                                                    )}
                                                    {q.type === 'short_answer' && (
                                                        <div className="eq-field"><label>Đáp án:</label>
                                                            <input type="text" value={q.correct_answer || ''} onChange={e => setCorrectAnswer(i, e.target.value)}
                                                                className="eq-input" placeholder="Nhập đáp án..." />
                                                        </div>
                                                    )}
                                                    <div className="eq-field"><label>Lời giải (tuỳ chọn):</label>
                                                        <textarea value={q.explanation || ''} onChange={e => updateQ(i, { explanation: e.target.value })}
                                                            rows={2} className="eq-textarea" placeholder="Giải thích chi tiết..." />
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
                                    onClick={() => { setActiveQ(i); editorRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>
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
                                                    <span className="ep-radio">{q.correct_answer === c.letter ? '●' : '○'}</span>
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
                                                    <span className={'ep-tf-badge' + (q.correct_answer?.[j] === 'D' ? ' true' : ' false')}>{q.correct_answer?.[j] === 'D' ? 'Đ' : 'S'}</span>
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
                                        <div className="ep-issues">{issues.map((iss, j) => <span key={j}>⚠ {iss}</span>)}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

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
