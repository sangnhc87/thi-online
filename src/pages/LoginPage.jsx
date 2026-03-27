import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
    const { login } = useAuth();

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="brand">Thi Online</div>
                <p className="subtitle">Hệ thống thi trắc nghiệm trực tuyến</p>
                <button className="btn-google" onClick={login}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
                    Đăng nhập bằng Google
                </button>
            </div>
        </div>
    );
}
