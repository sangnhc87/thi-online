import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import Swal from 'sweetalert2';

const CLOUD_RUN_URL = import.meta.env.VITE_PANDOC_API_URL || 'http://localhost:8080';

export default function UploadExamPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState('');
    const [duration, setDuration] = useState(45);
    const [processing, setProcessing] = useState(false);

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
                html: 'Pandoc đang chuyển đổi DOCX → JSON + trích xuất ảnh...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });

            // Step 1: Send DOCX to Cloud Run Pandoc API
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${CLOUD_RUN_URL}/convert`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Pandoc API error: ${errText}`);
            }

            const result = await response.json();
            // result = { questions: [...], images: [{name, data_base64}] }

            // Step 2: Upload extracted images to Firebase Storage
            const imageMap = {};
            if (result.images && result.images.length > 0) {
                for (const img of result.images) {
                    const imgBytes = Uint8Array.from(atob(img.data_base64), c => c.charCodeAt(0));
                    const imgRef = ref(storage, `exams/${user.uid}/${Date.now()}_${img.name}`);
                    await uploadBytes(imgRef, imgBytes, { contentType: img.content_type || 'image/png' });
                    imageMap[img.name] = await getDownloadURL(imgRef);
                }
            }

            // Step 3: Replace image references in questions with Storage URLs
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

            // Step 4: Save exam + questions to Firestore
            const examRef = await addDoc(collection(db, 'exams'), {
                title: title.trim(),
                teacherId: user.uid,
                teacherName: user.displayName,
                duration: Number(duration),
                questionCount: questions.length,
                status: 'draft',
                createdAt: Timestamp.now(),
            });

            // Save questions as subcollection
            const batch = [];
            for (const q of questions) {
                batch.push(
                    addDoc(collection(db, 'exams', examRef.id, 'questions'), q)
                );
            }
            await Promise.all(batch);

            Swal.fire({
                icon: 'success',
                title: 'Tải lên thành công!',
                html: `<p>Đã tạo đề "<b>${title}</b>" với <b>${questions.length}</b> câu hỏi.</p>`,
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
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>
                <i className="bi bi-cloud-arrow-up me-2" style={{ color: 'var(--accent)' }}></i>
                Tải lên đề thi
            </h1>

            <form onSubmit={handleUpload}>
                <div className="card">
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Tiêu đề đề thi *</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="VD: Kiểm tra Toán 12 — HK1"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Thời gian làm bài (phút) *</label>
                            <input
                                type="number"
                                className="form-input"
                                min="1"
                                max="180"
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">File đề thi (.docx) *</label>
                            <input
                                type="file"
                                className="form-input"
                                accept=".docx"
                                onChange={(e) => setFile(e.target.files[0])}
                                required
                            />
                            <small style={{ color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>
                                File DOCX sẽ được gửi đến Pandoc API để chuyển đổi thành câu hỏi + trích xuất ảnh.
                            </small>
                        </div>
                    </div>
                </div>

                <button type="submit" className="btn btn-primary btn-lg" disabled={processing} style={{ width: '100%', marginTop: 20 }}>
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
