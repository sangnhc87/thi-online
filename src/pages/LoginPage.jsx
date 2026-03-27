import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

export default function LoginPage() {
    const { user, userProfile, loading, signInWithGoogle, refreshProfile } = useAuth();
    const [showTeacherReg, setShowTeacherReg] = useState(false);
    const [schoolName, setSchoolName] = useState('');
    const [registering, setRegistering] = useState(false);

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div></div>;
    }

    if (user && userProfile) {
        if (userProfile.role === 'admin') return <Navigate to="/admin" replace />;
        if (userProfile.role === 'teacher') return <Navigate to="/teacher" replace />;
        if (userProfile.role === 'pending_teacher') {
            return (
                <div className="login-page">
                    <motion.div className="login-card" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                        <div className="login-header">
                            <div className="login-logo">⏳</div>
                            <h1>Đang chờ duyệt</h1>
                            <p>Tài khoản giáo viên của bạn đang được quản trị viên xem xét.</p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 12 }}>{user.email}</p>
                        </div>
                        <button className="btn btn-outline" onClick={async () => { await refreshProfile(); }} style={{ width: '100%', marginTop: 16 }}>
                            <i className="bi bi-arrow-clockwise"></i> Kiểm tra lại
                        </button>
                    </motion.div>
                </div>
            );
        }
        return <Navigate to="/student" replace />;
    }

    const handleTeacherRegister = async () => {
        if (!user) {
            await signInWithGoogle();
            return;
        }
        setRegistering(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                role: 'pending_teacher',
                schoolName: schoolName.trim() || null,
            });
            await refreshProfile();
            Swal.fire({
                icon: 'info',
                title: 'Đã gửi yêu cầu!',
                text: 'Quản trị viên sẽ xem xét và duyệt tài khoản của bạn.',
                confirmButtonColor: '#5b5ea6',
            });
        } catch (err) {
            Swal.fire('Lỗi', err.message, 'error');
        } finally {
            setRegistering(false);
        }
    };

    return (
        <div className="login-page">
            <motion.div className="login-card" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }}>
                <div className="login-header">
                    <div className="login-logo">📝</div>
                    <h1>Thi Online</h1>
                    <p>Hệ thống thi trắc nghiệm trực tuyến</p>
                </div>

                {!showTeacherReg ? (
                    <>
                        <button className="btn-google" onClick={signInWithGoogle}>
                            <svg width="20" height="20" viewBox="0 0 48 48">
                                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                            </svg>
                            Đăng nhập (Học sinh)
                        </button>

                        <div className="login-divider"><span>hoặc</span></div>

                        <button className="btn btn-outline" onClick={() => setShowTeacherReg(true)} style={{ width: '100%' }}>
                            <i className="bi bi-person-workspace"></i> Đăng ký Giáo viên
                        </button>

                        <div className="login-features">
                            <div className="login-feature"><i className="bi bi-lightning-charge"></i><span>Thi nhanh, chấm tự động</span></div>
                            <div className="login-feature"><i className="bi bi-trophy"></i><span>Xếp hạng & thành tích</span></div>
                            <div className="login-feature"><i className="bi bi-graph-up"></i><span>Theo dõi tiến bộ</span></div>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ textAlign: 'left', marginBottom: 16 }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Đăng ký Giáo viên</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Đăng nhập Google, sau đó chờ admin duyệt.</p>
                        </div>

                        {user ? (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg)', borderRadius: 8, marginBottom: 16 }}>
                                    {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} referrerPolicy="no-referrer" />}
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.displayName}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user.email}</div>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tên trường / Tổ chức (không bắt buộc)</label>
                                    <input type="text" className="form-input" placeholder="VD: THPT Nguyễn Huệ" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
                                </div>
                                <button className="btn btn-primary" onClick={handleTeacherRegister} disabled={registering} style={{ width: '100%' }}>
                                    {registering ? 'Đang gửi...' : <><i className="bi bi-send"></i> Gửi yêu cầu</>}
                                </button>
                            </div>
                        ) : (
                            <button className="btn-google" onClick={signInWithGoogle}>
                                <svg width="20" height="20" viewBox="0 0 48 48">
                                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                                </svg>
                                Đăng nhập Google để đăng ký
                            </button>
                        )}

                        <button className="btn btn-outline" onClick={() => setShowTeacherReg(false)} style={{ width: '100%', marginTop: 12 }}>
                            <i className="bi bi-arrow-left"></i> Quay lại
                        </button>
                    </>
                )}
            </motion.div>
        </div>
    );
}
