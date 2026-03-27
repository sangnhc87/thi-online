import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/app.css';

// Pages
import LoginPage from './pages/LoginPage';
import TeacherDashboard from './pages/TeacherDashboard';
import UploadExamPage from './pages/UploadExamPage';
import StudentDashboard from './pages/StudentDashboard';
import QuizPage from './pages/QuizPage';

function ProtectedRoute({ children, requireTeacher = false }) {
    const { user, userProfile, loading, isTeacher } = useAuth();
    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;
    if (!user) return <Navigate to="/login" />;
    if (requireTeacher && !isTeacher) return <Navigate to="/student" />;
    return children;
}

function AppNavbar() {
    const { user, userProfile, logout, isTeacher } = useAuth();
    const location = useLocation();

    // Hide navbar on login page and quiz page
    if (!user || location.pathname.startsWith('/student/quiz/')) return null;

    return (
        <nav className="app-navbar">
            <NavLink to="/" className="brand">Thi Online</NavLink>
            <div className="nav-links">
                {isTeacher && (
                    <>
                        <NavLink to="/teacher" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <i className="bi bi-grid me-1"></i>Kho đề
                        </NavLink>
                        <NavLink to="/teacher/upload" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                            <i className="bi bi-cloud-arrow-up me-1"></i>Tải lên
                        </NavLink>
                    </>
                )}
                <NavLink to="/student" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <i className="bi bi-mortarboard me-1"></i>Làm bài
                </NavLink>
            </div>
            <div className="user-info">
                {user.photoURL && <img src={user.photoURL} alt="" className="user-avatar" referrerPolicy="no-referrer" />}
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{user.displayName}</span>
                <span className="stat-badge primary" style={{ fontSize: '0.75rem' }}>
                    {userProfile?.role || 'student'}
                </span>
                <button className="btn-logout" onClick={logout}>
                    <i className="bi bi-box-arrow-right"></i>
                </button>
            </div>
        </nav>
    );
}

function AppRoutes() {
    const { user, loading, isTeacher } = useAuth();

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;

    return (
        <div className="app-shell">
            <AppNavbar />
            <div className="main-content">
                <Routes>
                    <Route path="/login" element={user ? <Navigate to={isTeacher ? '/teacher' : '/student'} /> : <LoginPage />} />

                    {/* Teacher routes */}
                    <Route path="/teacher" element={<ProtectedRoute requireTeacher><TeacherDashboard /></ProtectedRoute>} />
                    <Route path="/teacher/upload" element={<ProtectedRoute requireTeacher><UploadExamPage /></ProtectedRoute>} />

                    {/* Student routes */}
                    <Route path="/student" element={<ProtectedRoute><StudentDashboard /></ProtectedRoute>} />
                    <Route path="/student/quiz/:examId" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} />

                    {/* Default redirect */}
                    <Route path="/" element={<Navigate to={user ? (isTeacher ? '/teacher' : '/student') : '/login'} />} />
                    <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </div>
        </div>
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
