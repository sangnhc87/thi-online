import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function LoginPage() {
    const { user, userProfile, loading, signInWithGoogle } = useAuth();

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div></div>;
    }

    if (user && userProfile) {
        return <Navigate to={userProfile.role === 'teacher' || userProfile.role === 'admin' ? '/teacher' : '/student'} replace />;
    }

    return (
        <div className="login-page">
            <motion.div className="login-card" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 120 }}>
                <div className="login-header">
                    <div className="login-logo">📝</div>
                    <h1>Thi Online</h1>
                    <p>Hệ thống thi trắc nghiệm trực tuyến</p>
                </div>

                <button className="btn-google" onClick={signInWithGoogle}>
                    <svg width="20" height="20" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Đăng nhập bằng Google
                </button>

                <div className="login-features">
                    <div className="login-feature">
                        <i className="bi bi-lightning-charge"></i>
                        <span>Thi nhanh, chấm tự động</span>
                    </div>
                    <div className="login-feature">
                        <i className="bi bi-trophy"></i>
                        <span>Xếp hạng & thành tích</span>
                    </div>
                    <div className="login-feature">
                        <i className="bi bi-graph-up"></i>
                        <span>Theo dõi tiến bộ</span>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
