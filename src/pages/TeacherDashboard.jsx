import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import Swal from 'sweetalert2';

export default function TeacherDashboard() {
    const { user } = useAuth();
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadExams();
    }, [user]);

    const loadExams = async () => {
        if (!user) return;
        const q = query(
            collection(db, 'exams'),
            where('teacherId', '==', user.uid),
            orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        setExams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
    };

    const handleDelete = async (examId, title) => {
        const result = await Swal.fire({
            title: 'Xác nhận xóa?',
            text: `Bạn có chắc muốn xóa đề "${title}"?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonText: 'Hủy',
            confirmButtonText: 'Xóa',
        });
        if (!result.isConfirmed) return;
        await deleteDoc(doc(db, 'exams', examId));
        setExams(prev => prev.filter(e => e.id !== examId));
        Swal.fire({ icon: 'success', title: 'Đã xóa!', timer: 1500, showConfirmButton: false });
    };

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Kho Đề Thi</h1>
                <Link to="/teacher/upload" className="btn btn-primary">
                    <i className="bi bi-cloud-arrow-up"></i> Tải lên đề mới
                </Link>
            </div>

            {exams.length === 0 ? (
                <div className="empty-state">
                    <i className="bi bi-journal-plus"></i>
                    <p>Chưa có đề thi nào. Bắt đầu bằng cách tải lên file DOCX.</p>
                    <Link to="/teacher/upload" className="btn btn-primary">
                        <i className="bi bi-plus-lg"></i> Tạo đề thi đầu tiên
                    </Link>
                </div>
            ) : (
                <div className="dashboard-grid">
                    {exams.map(exam => (
                        <div key={exam.id} className="exam-card">
                            <div className="exam-title">{exam.title}</div>
                            <div className="exam-meta">
                                <span><i className="bi bi-question-circle me-1"></i>{exam.questionCount || '?'} câu</span>
                                <span><i className="bi bi-clock me-1"></i>{exam.duration || '?'} phút</span>
                                <span className={`stat-badge ${exam.status === 'active' ? 'success' : 'warning'}`}>
                                    {exam.status === 'active' ? 'Đang mở' : 'Nháp'}
                                </span>
                            </div>
                            <div className="exam-actions">
                                <Link to={`/teacher/exam/${exam.id}`} className="btn btn-sm btn-outline">
                                    <i className="bi bi-eye"></i> Chi tiết
                                </Link>
                                <Link to={`/teacher/exam/${exam.id}/sessions`} className="btn btn-sm btn-outline">
                                    <i className="bi bi-people"></i> Kết quả
                                </Link>
                                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(exam.id, exam.title)}>
                                    <i className="bi bi-trash"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
