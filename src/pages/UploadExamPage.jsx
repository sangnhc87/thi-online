import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';

const CLOUD_RUN_URL = import.meta.env.VITE_PANDOC_API_URL || 'http://localhost:8080';

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
    const [showGuide, setShowGuide] = useState(false);

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!file || !title.trim()) {
            Swal.fire('Thiếu thông tin', 'Vui lòng nhập tiêu đề và chọn file DOCX.', 'warning');
            return;
        }

        setProcessing(true);
        try {
            Swal.fire({
                title: 'Đang xử lý file...',
                html: '<div style="text-align:center"><p>Pandoc đang chuyển đổi DOCX → JSON</p><p style="color:#9ca3af;font-size:0.85rem">Trích xuất câu hỏi + hình ảnh...</p></div>',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });

            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${CLOUD_RUN_URL}/convert`, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Pandoc API error: ${await response.text()}`);

            const result = await response.json();

            // Upload images
            const imageMap = {};
            if (result.images?.length > 0) {
                for (const img of result.images) {
                    const imgBytes = Uint8Array.from(atob(img.data_base64), c => c.charCodeAt(0));
                    const imgRef = ref(storage, `exams/${user.uid}/${Date.now()}_${img.name}`);
                    await uploadBytes(imgRef, imgBytes, { contentType: img.content_type || 'image/png' });
                    imageMap[img.name] = await getDownloadURL(imgRef);
                }
            }

            // Replace image refs in questions
            const questions = result.questions.map((q, idx) => {
                let contentHtml = q.content_html || '';
                for (const [name, url] of Object.entries(imageMap)) {
                    contentHtml = contentHtml.replaceAll(name, url);
                }
                const choices = (q.choices || []).map(c => {
                    let choiceHtml = c.html || '';
                    for (const [name, url] of Object.entries(imageMap)) {
                        choiceHtml = choiceHtml.replaceAll(name, url);
                    }
                    return { ...c, html: choiceHtml };
                });
                return { ...q, content_html: contentHtml, choices, order: idx + 1 };
            });

            // Save exam
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
            console.error('Upload error:', error);
            Swal.fire('Lỗi xử lý', error.message, 'error');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>
                <i className="bi bi-cloud-arrow-up me-2" style={{ color: 'var(--accent)' }}></i>
                Tải lên đề thi
            </h1>

            <form onSubmit={handleUpload}>
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
                        <input id="file-input" type="file" accept=".docx" onChange={e => setFile(e.target.files[0])} style={{ display: 'none' }} />

                        <div style={{ marginTop: 16 }}>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowGuide(!showGuide)}>
                                <i className={`bi bi-${showGuide ? 'chevron-up' : 'chevron-down'}`}></i>
                                Hướng dẫn soạn đề DOCX
                            </button>
                        </div>

                        {showGuide && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="format-guide">
                                <h4>Cấu trúc chuẩn soạn đề DOCX:</h4>
                                <div className="code-block">
{`Câu 1: Nội dung câu hỏi ở đây.
Có thể viết nhiều dòng, chèn hình ảnh.
Hỗ trợ công thức LaTeX: $x^2 + y^2 = r^2$
A. Đáp án A
B. Đáp án B
C. Đáp án C (đúng)
D. Đáp án D
Đáp án: C

Câu 2: Tính giá trị biểu thức $$\\frac{a+b}{c}$$
A. 1
B. 2
C. 3
D. 4
Đáp án: B`}
                                </div>
                                <h4>Quy tắc:</h4>
                                <ul>
                                    <li><b>Câu hỏi:</b> Bắt đầu bằng "Câu 1:", "Câu 2:",... (hoặc "Question 1:")</li>
                                    <li><b>Đáp án:</b> A. B. C. D. (hoặc A) B) C) D))</li>
                                    <li><b>Đáp án đúng:</b> Dòng "Đáp án: X" sau mỗi câu (X = A/B/C/D)</li>
                                    <li><b>Công thức:</b> Inline <code>$...$</code>, display <code>$$...$$</code></li>
                                    <li><b>Hình ảnh:</b> Chèn trực tiếp trong DOCX, tự trích xuất</li>
                                    <li><b>Định dạng:</b> In đậm, nghiêng, gạch chân giữ nguyên</li>
                                </ul>
                            </motion.div>
                        )}
                    </div>
                </div>

                <button type="submit" className="btn btn-primary btn-lg" disabled={processing} style={{ width: '100%' }}>
                    {processing ? (
                        <><span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }}></span> Đang xử lý...</>
                    ) : (
                        <><i className="bi bi-rocket-takeoff"></i> Tải lên & Tạo đề</>
                    )}
                </button>
            </form>
        </div>
    );
}
