import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import Swal from 'sweetalert2';

export default function TeacherPortal() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const { user, userProfile, signInWithGoogle, refreshProfile } = useAuth();

    const [teacher, setTeacher] = useState(null);
    const [exams, setExams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);

    const isJoined = userProfile?.teacherId === teacher?.uid;

    useEffect(() => { loadTeacher(); }, [slug]);

    const loadTeacher = async () => {
        // Find teacher by slug
        const q = query(collection(db, 'users'), where('teacherSlug', '==', slug));
        const snap = await getDocs(q);
        if (snap.empty) {
            setLoading(false);
            return;
        }

        const teacherData = { uid: snap.docs[0].id, ...snap.docs[0].data() };
        setTeacher(teacherData);

        // Load active exams from this teacher
        const examQ = query(
            collection(db, 'exams'),
            where('teacherId', '==', teacherData.uid),
            where('status', '==', 'active'),
            orderBy('createdAt', 'desc')
        );
        const examSnap = await getDocs(examQ);
        setExams(examSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
    };

    const handleJoin = async () => {
        if (!user) {
            // Need to login first
            try {
                await signInWithGoogle();
                // After login, refreshProfile will be called by AuthContext
                // Then we'll re-render and user can join
                return;
            } catch {
                return;
            }
        }

        if (userProfile?.role === 'teacher' || userProfile?.role === 'admin') {
            Swal.fire('Thông báo', 'Tài khoản giáo viên/admin không thể tham gia lớp.', 'info');
            return;
        }

        setJoining(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                teacherId: teacher.uid,
                teacherName: teacher.displayName,
            });
            await refreshProfile();
            Swal.fire({
                icon: 'success',
                title: 'Đã tham gia!',
                text: `Bạn là học sinh của ${teacher.displayName}`,
                timer: 2000,
                showConfirmButton: false,
            });
            navigate('/student');
        } catch (err) {
            console.error('Join error:', err);
            Swal.fire('Lỗi', 'Không thể tham gia. Vui lòng thử lại.', 'error');
        } finally {
            setJoining(false);
        }
    };

    const handleStartQuiz = (examId) => {
        if (!user) {
            Swal.fire({
                title: 'Đăng nhập để thi',
                text: 'Bạn cần đăng nhập Google trước.',
                icon: 'info',
                showCancelButton: true,
                confirmButtonText: 'Đăng nhập',
                cancelButtonText: 'Hủy',
            }).then(async (result) => {
                if (result.isConfirmed) {
                    await signInWithGoogle();
                }
            });
            return;
        }

        if (!isJoined && userProfile?.role === 'student') {
            // Auto-join and start
            handleJoin().then(() => {
                navigate(`/student/quiz/${examId}`);
            });
            return;
        }

        navigate(`/student/quiz/${examId}`);
    };

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;
    }

    if (!teacher) {
        return (
            <div className="portal-not-found">
                <div className="portal-not-found-card">
                    <i className="bi bi-person-x" style={{ fontSize: '3rem', color: 'var(--text-muted)' }}></i>
                    <h2>Không tìm thấy giáo viên</h2>
                    <p>Đường dẫn <code>/t/{slug}</code> không tồn tại hoặc đã bị xóa.</p>
                    <Link to="/login" className="btn btn-primary">Về trang chủ</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="portal-page">
            {/* Teacher header */}
            <motion.div className="portal-header" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                <div className="portal-teacher-info">
                    {teacher.photoURL ? (
                        <img src={teacher.photoURL} alt="" className="portal-avatar" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="portal-avatar-placeholder">{(teacher.displayName || '?')[0]}</div>
                    )}
                    <div>
                        <h1 className="portal-name">{teacher.displayName}</h1>
                        {teacher.schoolName && <p className="portal-school"><i className="bi bi-building"></i> {teacher.schoolName}</p>}
                        <p className="portal-stats"><i className="bi bi-journal-text"></i> {exams.length} đề thi đang mở</p>
                    </div>
                </div>

                {user ? (
                    isJoined ? (
                        <div className="portal-joined-badge">
                            <i className="bi bi-check-circle-fill"></i> Đã tham gia
                        </div>
                    ) : userProfile?.role === 'student' ? (
                        <button className="btn btn-primary btn-lg" onClick={handleJoin} disabled={joining}>
                            {joining ? 'Đang xử lý...' : <><i className="bi bi-person-plus"></i> Tham gia lớp</>}
                        </button>
                    ) : null
                ) : (
                    <button className="btn btn-primary btn-lg" onClick={signInWithGoogle}>
                        <i className="bi bi-google"></i> Đăng nhập để tham gia
                    </button>
                )}
            </motion.div>

            {/* Exam list */}
            <h2 className="section-header" style={{ marginTop: 32 }}>
                <i className="bi bi-journal-text"></i> Đề thi đang mở
            </h2>

            {exams.length === 0 ? (
                <div className="empty-state">
                    <i className="bi bi-journal-x"></i>
                    <p>Giáo viên chưa mở đề thi nào.</p>
                </div>
            ) : (
                <div className="dashboard-grid">
                    {exams.map((exam, idx) => (
                        <motion.div key={exam.id} className="exam-card exam-card-student" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                            <div className="exam-title">{exam.title}</div>
                            {(exam.subject || exam.grade) && (
                                <div className="exam-tags">
                                    {exam.subject && <span className="exam-tag">{exam.subject}</span>}
                                    {exam.grade && <span className="exam-tag">{exam.grade}</span>}
                                </div>
                            )}
                            <div className="exam-meta">
                                <span><i className="bi bi-question-circle"></i> {exam.questionCount || 0} câu</span>
                                <span><i className="bi bi-clock"></i> {exam.duration || 0} phút</span>
                            </div>
                            <div className="exam-actions">
                                <button className="btn btn-sm btn-success" onClick={() => handleStartQuiz(exam.id)}>
                                    <i className="bi bi-play-fill"></i> Bắt đầu thi
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* If not logged in, show login prompt */}
            {!user && (
                <motion.div className="portal-login-prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                    <i className="bi bi-info-circle"></i>
                    <span>Đăng nhập bằng Google để bắt đầu làm bài thi</span>
                    <button className="btn btn-sm btn-primary" onClick={signInWithGoogle}>Đăng nhập</button>
                </motion.div>
            )}
        </div>
    );
}
