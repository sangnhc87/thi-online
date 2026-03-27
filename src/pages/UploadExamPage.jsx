import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';
import { parseDocx } from '../utils/docxParser';

const TYPE_LABELS = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short_answer: 'Tự luận ngắn', essay: 'Tự luận' };

export default function UploadExamPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState('');
    const [subject, setSubject] = useState('');
    const [grade, setGrade] = useState('');
    const [duration, setDuration] = useState(45);
    const [maxAttempts, setMaxAttempts] = useState(1);
    const [shuffleQuestions, setShuffleQuestions] = useState(true);
    const [shuffleChoices, setShuffleChoices] = useState(false);
    const [showResult, setShowResult] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showGuide, setShowGuide] = useState(false);
    const [preview, setPreview] = useState(null); // { questions, imageFiles }

    // Step 1: Parse DOCX client-side
    const handleParse = async () => {
        if (!file) {
            Swal.fire('Chưa chọn file', 'Vui lòng chọn file DOCX trước.', 'warning');
            return;
        }
        setProcessing(true);
        setPreview(null);
        try {
            Swal.fire({
                title: 'Đang phân tích file...',
                html: '<p>Đọc cấu trúc DOCX, trích xuất câu hỏi + hình ảnh...</p>',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });
            const result = await parseDocx(file);
            Swal.close();

            if (result.questions.length === 0) {
                Swal.fire('Không tìm thấy câu hỏi', 'Hãy kiểm tra lại file DOCX. Mỗi câu phải bắt đầu bằng "Câu 1:", "Câu 2:",...', 'warning');
                return;
            }

            setPreview(result);
        } catch (error) {
            console.error('Parse error:', error);
            Swal.fire('Lỗi đọc file', error.message, 'error');
        } finally {
            setProcessing(false);
        }
    };

    // Step 2: Save to Firestore
    const handleSave = async (e) => {
        e.preventDefault();
        if (!preview || !title.trim()) {
            Swal.fire('Thiếu thông tin', 'Vui lòng nhập tiêu đề và xử lý file trước.', 'warning');
            return;
        }

        setSaving(true);
        try {
            Swal.fire({
                title: 'Đang lưu đề thi...',
                html: '<p>Tải hình ảnh lên Storage và lưu câu hỏi...</p>',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });

            // Upload images to Firebase Storage, get real URLs
            const storageUrlMap = {}; // dataURL → storageURL
            if (preview.imageFiles?.length > 0) {
                for (const img of preview.imageFiles) {
                    const imgRef = ref(storage, `exams/${user.uid}/${Date.now()}_${img.name}`);
                    await uploadBytes(imgRef, img.blob, { contentType: img.mime });
                    const url = await getDownloadURL(imgRef);
                    const dataUrl = preview.imageMap[img.rId];
                    if (dataUrl) storageUrlMap[dataUrl] = url;
                }
            }

            // Replace data URLs with Storage URLs in question HTML
            const replaceDataUrls = (html) => {
                if (!html) return html;
                for (const [dataUrl, storageUrl] of Object.entries(storageUrlMap)) {
                    html = html.replaceAll(dataUrl, storageUrl);
                }
                return html;
            };

            const questions = preview.questions.map((q, idx) => ({
                number: q.number,
                type: q.type,
                content_text: q.content_text,
                content_html: replaceDataUrls(q.content_html),
                choices: (q.choices || []).map(c => ({
                    letter: c.letter,
                    text: c.text,
                    html: replaceDataUrls(c.html),
                })),
                correct_answer: q.correct_answer,
                explanation: q.explanation,
                explanation_html: replaceDataUrls(q.explanation_html),
                order: idx + 1,
            }));

            const examRef = await addDoc(collection(db, 'exams'), {
                title: title.trim(),
                subject: subject.trim() || null,
                grade: grade.trim() || null,
                teacherId: user.uid,
                teacherName: user.displayName,
                duration: Number(duration),
                questionCount: questions.length,
                maxAttempts: Number(maxAttempts),
                shuffleQuestions,
                shuffleChoices,
                showResult,
                status: 'draft',
                createdAt: Timestamp.now(),
            });

            await Promise.all(questions.map(q => addDoc(collection(db, 'exams', examRef.id, 'questions'), q)));

            Swal.fire({
                icon: 'success',
                title: 'Tải lên thành công!',
                html: `<p>Đã tạo đề "<b>${title}</b>" với <b>${questions.length}</b> câu hỏi.</p><p style="color:#9ca3af;font-size:0.85rem">Đề ở trạng thái Nháp. Vào Chi tiết để kích hoạt.</p>`,
                confirmButtonColor: '#5b5ea6',
            });
            navigate('/teacher');
        } catch (error) {
            console.error('Save error:', error);
            Swal.fire('Lỗi lưu đề', error.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>
                <i className="bi bi-cloud-arrow-up me-2" style={{ color: 'var(--accent)' }}></i>
                Tải lên đề thi
            </h1>

            <form onSubmit={handleSave}>
                {/* Basic info */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header-gradient">
                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}><i className="bi bi-info-circle me-2"></i>Thông tin cơ bản</h3>
                    </div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Tiêu đề đề thi *</label>
                            <input type="text" className="form-input" placeholder="VD: Kiểm tra Toán 12 — HK1" value={title} onChange={e => setTitle(e.target.value)} required />
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Môn học</label>
                                <select className="form-select" value={subject} onChange={e => setSubject(e.target.value)}>
                                    <option value="">Chọn môn</option>
                                    <option>Toán</option><option>Vật lý</option><option>Hóa học</option>
                                    <option>Sinh học</option><option>Tiếng Anh</option><option>Ngữ văn</option>
                                    <option>Lịch sử</option><option>Địa lý</option><option>GDCD</option>
                                    <option>Tin học</option><option>Khác</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Khối lớp</label>
                                <select className="form-select" value={grade} onChange={e => setGrade(e.target.value)}>
                                    <option value="">Chọn lớp</option>
                                    {[10, 11, 12].map(g => <option key={g}>Lớp {g}</option>)}
                                    <option>Đại học</option><option>Khác</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Settings */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header-gradient" style={{ background: 'var(--gradient-cool)' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}><i className="bi bi-gear me-2"></i>Cài đặt bài thi</h3>
                    </div>
                    <div className="card-body">
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Thời gian (phút) *</label>
                                <input type="number" className="form-input" min="1" max="180" value={duration} onChange={e => setDuration(e.target.value)} required />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Số lần thi tối đa</label>
                                <input type="number" className="form-input" min="1" max="10" value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} />
                            </div>
                        </div>

                        <div className="toggle-group">
                            <label className="toggle-label">
                                <input type="checkbox" checked={shuffleQuestions} onChange={e => setShuffleQuestions(e.target.checked)} />
                                <span className="toggle-switch"></span>
                                <span>Xáo trộn thứ tự câu hỏi</span>
                            </label>
                            <label className="toggle-label">
                                <input type="checkbox" checked={shuffleChoices} onChange={e => setShuffleChoices(e.target.checked)} />
                                <span className="toggle-switch"></span>
                                <span>Xáo trộn thứ tự đáp án</span>
                            </label>
                            <label className="toggle-label">
                                <input type="checkbox" checked={showResult} onChange={e => setShowResult(e.target.checked)} />
                                <span className="toggle-switch"></span>
                                <span>Hiện kết quả chi tiết sau khi nộp</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* File upload */}
                <div className="card" style={{ marginBottom: 20 }}>
                    <div className="card-header-gradient" style={{ background: 'var(--gradient-success)' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}><i className="bi bi-file-earmark-word me-2"></i>File đề thi</h3>
                    </div>
                    <div className="card-body">
                        <div className="file-upload-area" onClick={() => document.getElementById('file-input').click()}>
                            <i className="bi bi-cloud-arrow-up" style={{ fontSize: '2.5rem', color: 'var(--accent-light)' }}></i>
                            <p style={{ fontWeight: 600, margin: '8px 0 4px' }}>
                                {file ? file.name : 'Kéo thả hoặc bấm để chọn file'}
                            </p>
                            <small style={{ color: 'var(--text-muted)' }}>Chỉ chấp nhận file .docx</small>
                        </div>
                        <input id="file-input" type="file" accept=".docx" onChange={e => { setFile(e.target.files[0]); setPreview(null); }} style={{ display: 'none' }} />

                        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-accent" disabled={!file || processing} onClick={handleParse}
                                style={{ minWidth: 160, background: 'var(--gradient-success)', color: '#fff', border: 'none' }}>
                                {processing ? (
                                    <><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }}></span> Đang xử lý...</>
                                ) : (
                                    <><i className="bi bi-eye"></i> Xem trước đề thi</>
                                )}
                            </button>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowGuide(!showGuide)}>
                                <i className={`bi bi-${showGuide ? 'chevron-up' : 'chevron-down'}`}></i>
                                Hướng dẫn soạn đề
                            </button>
                        </div>

                        {showGuide && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="format-guide">
                                <h4>Cấu trúc chuẩn soạn đề DOCX:</h4>
                                <div className="code-block">
{`Câu 1: Nội dung câu hỏi ở đây.
A. Đáp án A
B. Đáp án B (gạch chân = đúng)
C. Đáp án C
D. Đáp án D

Câu 2: Câu hỏi Đúng/Sai
a) Mệnh đề 1 (gạch chân = Đúng)
b) Mệnh đề 2
c) Mệnh đề 3
d) Mệnh đề 4

Câu 3: Công thức $x^2 + y^2 = r^2$
A. 1
B. 2
C. 3
D. 4
Đáp án: B
Lời giải: Đây là giải thích chi tiết.`}
                                </div>
                                <h4>Quy tắc:</h4>
                                <ul>
                                    <li><b>Câu hỏi:</b> Bắt đầu bằng "Câu 1:", "Câu 2:",...</li>
                                    <li><b>Trắc nghiệm:</b> A. B. C. D. — <u>gạch chân</u> đáp án đúng trong Word</li>
                                    <li><b>Đúng/Sai:</b> a) b) c) d) — <u>gạch chân</u> mệnh đề đúng</li>
                                    <li><b>Tự luận ngắn:</b> Dùng "Đáp án: ..." (không có A.B.C.D.)</li>
                                    <li><b>Lời giải:</b> Dòng "Lời giải: ..." sau đáp án (tuỳ chọn)</li>
                                    <li><b>Hình ảnh:</b> Chèn trực tiếp trong DOCX, tự trích xuất</li>
                                    <li><b>Định dạng:</b> In đậm, nghiêng, gạch chân giữ nguyên</li>
                                </ul>
                            </motion.div>
                        )}
                    </div>
                </div>

                {/* Preview */}
                {preview && (
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient" style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-search me-2"></i>
                                Xem trước — {preview.questions.length} câu hỏi
                            </h3>
                        </div>
                        <div className="card-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
                            {preview.questions.map((q, i) => (
                                <div key={i} className="preview-question" style={{
                                    padding: '14px 16px', marginBottom: 12, borderRadius: 10,
                                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                        <strong style={{ color: 'var(--accent)' }}>Câu {q.number}</strong>
                                        <span style={{
                                            fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12,
                                            background: q.type === 'mcq' ? '#dbeafe' : q.type === 'tf' ? '#fef3c7' : '#d1fae5',
                                            color: q.type === 'mcq' ? '#1e40af' : q.type === 'tf' ? '#92400e' : '#065f46',
                                            fontWeight: 600,
                                        }}>
                                            {TYPE_LABELS[q.type] || q.type}
                                        </span>
                                    </div>
                                    <div dangerouslySetInnerHTML={{ __html: q.content_html }} style={{ marginBottom: 8 }} />

                                    {q.choices.length > 0 && (
                                        <div style={{ paddingLeft: 8 }}>
                                            {q.choices.map((c, j) => (
                                                <div key={j} style={{
                                                    padding: '4px 8px', marginBottom: 3, borderRadius: 6,
                                                    background: q.type === 'mcq' && q.correct_answer === c.letter ? 'rgba(34,197,94,0.12)' : 'transparent',
                                                    border: q.type === 'mcq' && q.correct_answer === c.letter ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
                                                }}>
                                                    <span style={{ fontWeight: 600, marginRight: 6 }}>
                                                        {q.type === 'tf' ? `${c.letter})` : `${c.letter}.`}
                                                    </span>
                                                    <span dangerouslySetInnerHTML={{ __html: c.html }} />
                                                    {q.type === 'tf' && q.correct_answer && (
                                                        <span style={{
                                                            marginLeft: 8, fontSize: '0.75rem', fontWeight: 600,
                                                            color: q.correct_answer[j] === 'D' ? '#16a34a' : '#dc2626',
                                                        }}>
                                                            {q.correct_answer[j] === 'D' ? '✓ Đúng' : '✗ Sai'}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {q.correct_answer && q.type !== 'tf' && (
                                        <div style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                                            <i className="bi bi-check-circle me-1"></i>Đáp án: {q.correct_answer}
                                        </div>
                                    )}
                                    {!q.correct_answer && (
                                        <div style={{ fontSize: '0.85rem', color: '#f59e0b', fontWeight: 600, marginTop: 4 }}>
                                            <i className="bi bi-exclamation-triangle me-1"></i>Chưa có đáp án
                                        </div>
                                    )}

                                    {q.explanation_html && (
                                        <div className="rq-explanation" style={{ marginTop: 8, fontSize: '0.85rem' }}>
                                            <strong>Lời giải:</strong>
                                            <span dangerouslySetInnerHTML={{ __html: q.explanation_html }} style={{ marginLeft: 6 }} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <button type="submit" className="btn btn-primary btn-lg" disabled={!preview || saving} style={{ width: '100%' }}>
                    {saving ? (
                        <><span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></span> Đang lưu...</>
                    ) : (
                        <><i className="bi bi-rocket-takeoff"></i> Lưu đề thi ({preview ? preview.questions.length + ' câu' : '...'})</>
                    )}
                </button>
            </form>
        </div>
    );
}
