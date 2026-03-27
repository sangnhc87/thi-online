import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import TeacherDashboard from './pages/TeacherDashboard';
import UploadExamPage from './pages/UploadExamPage';
import ExamDetailPage from './pages/ExamDetailPage';
import ExamSessionsPage from './pages/ExamSessionsPage';
import StudentDashboard from './pages/StudentDashboard';
import QuizPage from './pages/QuizPage';
import ResultPage from './pages/ResultPage';
import './styles/app.css';

function ProtectedRoute({ children, role }) {
    const { user, userProfile, loading } = useAuth();
    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;
    if (!user) return <Navigate to="/login" replace />;
    if (role === 'teacher' && userProfile?.role !== 'teacher' && userProfile?.role !== 'admin') {
        return <Navigate to="/student" replace />;
    }
    return children;
}

function Navbar() {
    const { user, userProfile, logout, isTeacher } = useAuth();
    const navigate = useNavigate();

    if (!user) return null;

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <nav className="navbar">
            <div className="navbar-content">
                <Link to={isTeacher ? '/teacher' : '/student'} className="navbar-brand">
                    📝 Thi Online
                </Link>
                <div className="navbar-right">
                    {isTeacher && (
                        <div className="navbar-links">
                            <Link to="/teacher" className="nav-link"><i className="bi bi-grid"></i> Dashboard</Link>
                            <Link to="/teacher/upload" className="nav-link"><i className="bi bi-upload"></i> Tạo đề</Link>
                        </div>
                    )}
                    <div className="navbar-user">
                        {userProfile?.photoURL && <img src={userProfile.photoURL} alt="" className="navbar-avatar" referrerPolicy="no-referrer" />}
                        <span className="navbar-name">{userProfile?.displayName || user.email}</span>
                        <span className={`navbar-role ${userProfile?.role}`}>{userProfile?.role === 'teacher' ? 'GV' : userProfile?.role === 'admin' ? 'Admin' : 'HS'}</span>
                    </div>
                    <button className="btn-icon-sm" onClick={handleLogout} title="Đăng xuất">
                        <i className="bi bi-box-arrow-right"></i>
                    </button>
                </div>
            </div>
        </nav>
    );
}

function AppRoutes() {
    return (
        <>
            <Navbar />
            <main className="main-content">
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/teacher" element={<ProtectedRoute role="teacher"><TeacherDashboard /></ProtectedRoute>} />
                    <Route path="/teacher/upload" element={<ProtectedRoute role="teacher"><UploadExamPage /></ProtectedRoute>} />
                    <Route path="/teacher/exam/:examId" element={<ProtectedRoute role="teacher"><ExamDetailPage /></ProtectedRoute>} />
                    <Route path="/teacher/exam/:examId/sessions" element={<ProtectedRoute role="teacher"><ExamSessionsPage /></ProtectedRoute>} />
                    <Route path="/student" element={<ProtectedRoute><StudentDashboard /></ProtectedRoute>} />
                    <Route path="/student/quiz/:examId" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} />
                    <Route path="/student/result/:sessionId" element={<ProtectedRoute><ResultPage /></ProtectedRoute>} />
                    <Route path="/" element={<Navigate to="/login" replace />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </main>
        </>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </BrowserRouter>
    );
}
