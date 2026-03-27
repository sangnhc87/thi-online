import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { getScoreColor, getScoreEmoji } from '../utils/formatters';
import Swal from 'sweetalert2';

export default function TeacherPortal() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const { user, userProfile, signInWithGoogle, refreshProfile, logout } = useAuth();

    const [teacher, setTeacher] = useState(null);
    const [exams, setExams] = useState([]);
    const [myResults, setMyResults] = useState({});
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);

    const isJoined = userProfile?.teacherId === teacher?.uid;
    const isBlocked = userProfile?.blocked === true;

    useEffect(() => { loadTeacher(); }, [slug]);
    useEffect(() => { if (user && teacher && isJoined) loadMyResults(); }, [user, teacher, isJoined]);

    const loadTeacher = async () => {
        const q = query(collection(db, 'users'), where('teacherSlug', '==', slug));
        const snap = await getDocs(q);
        if (snap.empty) { setLoading(false); return; }

        const teacherData = { uid: snap.docs[0].id, ...snap.docs[0].data() };
        setTeacher(teacherData);

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

    const loadMyResults = async () => {
        if (!user) return;
        const sessionQ = query(collection(db, 'sessions'), where('studentId', '==', user.uid));
        const sessionSnap = await getDocs(sessionQ);
        const results = {};
        sessionSnap.docs.forEach(d => {
            const data = { id: d.id, ...d.data() };
            if (!results[data.examId] || data.score > results[data.examId].score) {
                results[data.examId] = data;
            }
        });
        setMyResults(results);
    };

    const handleJoin = async () => {
        if (!user) {
            try { await signInWithGoogle(); return; } catch { return; }
        }
        if (userProfile?.role === 'teacher' || userProfile?.role === 'admin') {
            Swal.fire('Thông báo', 'Tài khoản giáo viên/admin không tham gia lớp được.', 'info');
            return;
        }
        setJoining(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                teacherId: teacher.uid,
                teacherName: teacher.displayName,
            });
            await refreshProfile();
            Swal.fire({ icon: 'success', title: 'Đã tham gia!', text: `Bạn là học sinh của ${teacher.displayName}`, timer: 2000, showConfirmButton: false });
        } catch (err) {
            Swal.fire('Lỗi', 'Không thể tham gia. Thử lại.', 'error');
        } finally { setJoining(false); }
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
            }).then(async (r) => { if (r.isConfirmed) await signInWithGoogle(); });
            return;
        }
        if (isBlocked) {
            Swal.fire('Bị khóa', 'Tài khoản của bạn đã bị giáo viên khóa.', 'error');
            return;
        }
        if (!isJoined && userProfile?.role === 'student') {
            handleJoin().then(() => navigate(`/student/quiz/${examId}`));
            return;
        }
        navigate(`/student/quiz/${examId}`);
    };

    const handleLogout = async () => {
        await logout();
        window.location.reload();
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;

    if (!teacher) {
        return (
            <div className="portal-not-found">
                <i className="bi bi-person-x" style={{ fontSize: '3rem', color: 'var(--text-muted)' }}></i>
                <h2>Không tìm thấy giáo viên</h2>
                <p>Đường dẫn <code>/t/{slug}</code> không tồn tại.</p>
                <Link to="/login" className="btn btn-primary" style={{ marginTop: 16 }}>Về trang chủ</Link>
            </div>
        );
    }

    return (
        <div className="portal-page">
            {/* Teacher header */}
            <motion.div className="portal-header" initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    {teacher.photoURL ? (
                        <img src={teacher.photoURL} alt="" className="portal-avatar" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="portal-avatar-placeholder">{(teacher.displayName || '?')[0]}</div>
                    )}
                    <div>
                        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>{teacher.displayName}</h1>
                        {teacher.schoolName && <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: '0.9rem' }}><i className="bi bi-building"></i> {teacher.schoolName}</p>}
                        <p style={{ color: 'var(--text-muted)', margin: '2px 0 0', fontSize: '0.85rem' }}><i className="bi bi-journal-text"></i> {exams.length} đề thi đang mở</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
                    {user ? (
                        <>
                            {isBlocked ? (
                                <div className="stat-badge expired"><i className="bi bi-lock"></i> Tài khoản bị khóa</div>
                            ) : isJoined ? (
                                <div className="portal-joined-badge"><i className="bi bi-check-circle-fill"></i> Đã tham gia</div>
                            ) : userProfile?.role === 'student' ? (
                                <button className="btn btn-primary" onClick={handleJoin} disabled={joining}>
                                    {joining ? 'Đang xử lý...' : <><i className="bi bi-person-plus"></i> Tham gia lớp</>}
                                </button>
                            ) : null}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                {userProfile?.photoURL && <img src={userProfile.photoURL} alt="" style={{ width: 24, height: 24, borderRadius: '50%' }} referrerPolicy="no-referrer" />}
                                <span>{userProfile?.displayName}</span>
                                <button className="btn btn-sm btn-outline" onClick={handleLogout} style={{ marginLeft: 4, padding: '2px 8px', fontSize: '0.75rem' }}>
                                    Đổi TK
                                </button>
                            </div>
                        </>
                    ) : (
                        <button className="btn btn-primary" onClick={signInWithGoogle}>
                            <i className="bi bi-google"></i> Đăng nhập Google để tham gia
                        </button>
                    )}
                </div>
            </motion.div>

            {/* Exam list */}
            {isBlocked ? (
                <div className="empty-state" style={{ marginTop: 32 }}>
                    <i className="bi bi-lock"></i>
                    <p>Tài khoản của bạn đã bị giáo viên khóa. Liên hệ giáo viên để được mở khóa.</p>
                </div>
            ) : exams.length === 0 ? (
                <div className="empty-state" style={{ marginTop: 32 }}>
                    <i className="bi bi-journal-x"></i>
                    <p>Giáo viên chưa mở đề thi nào.</p>
                </div>
            ) : (
                <>
                    <h2 style={{ fontSize: '1.1rem', margin: '28px 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="bi bi-journal-text"></i> Đề thi
                    </h2>
                    <div className="dashboard-grid">
                        {exams.map((exam, idx) => {
                            const result = myResults[exam.id];
                            return (
                                <motion.div key={exam.id} className="exam-card exam-card-student" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                                    {result && (
                                        <div className={`exam-card-ribbon ${getScoreColor(result.score, result.total)}`}>
                                            {getScoreEmoji(result.score, result.total)} {result.score}/{result.total}
                                        </div>
                                    )}
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
                                        {result ? (
                                            <>
                                                <Link to={`/student/result/${result.id}`} className="btn btn-sm btn-outline">
                                                    <i className="bi bi-eye"></i> Xem lại
                                                </Link>
                                                <button className="btn btn-sm btn-primary" onClick={() => handleStartQuiz(exam.id)}>
                                                    <i className="bi bi-arrow-repeat"></i> Thi lại
                                                </button>
                                            </>
                                        ) : (
                                            <button className="btn btn-sm btn-success" onClick={() => handleStartQuiz(exam.id)}>
                                                <i className="bi bi-play-fill"></i> Bắt đầu thi
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* Login prompt for guests */}
            {!user && (
                <motion.div className="portal-login-prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                    <i className="bi bi-info-circle" style={{ fontSize: '1.2rem' }}></i>
                    <span>Đăng nhập bằng Google để bắt đầu làm bài thi</span>
                    <button className="btn btn-sm btn-primary" onClick={signInWithGoogle}>Đăng nhập</button>
                </motion.div>
            )}
        </div>
    );
}
