import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/AdminDashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import UploadExamPage from './pages/UploadExamPage';
import ExamDetailPage from './pages/ExamDetailPage';
import ExamSessionsPage from './pages/ExamSessionsPage';
import StudentDashboard from './pages/StudentDashboard';
import QuizPage from './pages/QuizPage';
import ResultPage from './pages/ResultPage';
import TeacherPortal from './pages/TeacherPortal';
import './styles/app.css';

function ProtectedRoute({ children, role }) {
    const { user, userProfile, loading } = useAuth();
    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;
    if (!user) return <Navigate to="/login" replace />;
    if (role === 'admin' && userProfile?.role !== 'admin') return <Navigate to="/login" replace />;
    if (role === 'teacher' && userProfile?.role !== 'teacher' && userProfile?.role !== 'admin') {
        return <Navigate to="/student" replace />;
    }
    return children;
}

function Navbar() {
    const { user, userProfile, logout, isTeacher, isAdmin } = useAuth();
    const navigate = useNavigate();

    if (!user) return null;

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const homePath = isAdmin ? '/admin' : isTeacher ? '/teacher' : '/student';

    return (
        <nav className="navbar">
            <div className="navbar-content">
                <Link to={homePath} className="navbar-brand">
                    📝 Thi Online
                </Link>
                <div className="navbar-right">
                    {isAdmin && (
                        <div className="navbar-links">
                            <Link to="/admin" className="nav-link"><i className="bi bi-shield-check"></i> Admin</Link>
                            <Link to="/teacher" className="nav-link"><i className="bi bi-grid"></i> GV</Link>
                            <Link to="/teacher/upload" className="nav-link"><i className="bi bi-upload"></i> Tạo đề</Link>
                        </div>
                    )}
                    {isTeacher && !isAdmin && (
                        <div className="navbar-links">
                            <Link to="/teacher" className="nav-link"><i className="bi bi-grid"></i> Dashboard</Link>
                            <Link to="/teacher/upload" className="nav-link"><i className="bi bi-upload"></i> Tạo đề</Link>
                        </div>
                    )}
                    <div className="navbar-user">
                        {userProfile?.photoURL && <img src={userProfile.photoURL} alt="" className="navbar-avatar" referrerPolicy="no-referrer" />}
                        <span className="navbar-name">{userProfile?.displayName || user.email}</span>
                        <span className={`navbar-role ${userProfile?.role}`}>
                            {userProfile?.role === 'admin' ? 'Admin' : userProfile?.role === 'teacher' ? 'GV' : 'HS'}
                        </span>
                    </div>
                    <button className="btn btn-sm btn-outline" onClick={handleLogout} title="Đăng xuất" style={{ whiteSpace: 'nowrap' }}>
                        <i className="bi bi-box-arrow-right"></i> Đăng xuất
                    </button>
                </div>
            </div>
        </nav>
    );
}

function LogoutRoute() {
    const { logout } = useAuth();
    const navigate = useNavigate();
    React.useEffect(() => {
        logout().then(() => navigate('/login'));
    }, []);
    return <div className="loading-screen"><div className="spinner"></div><p>Đang đăng xuất...</p></div>;
}

function AppRoutes() {
    return (
        <>
            <Navbar />
            <main className="main-content">
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/t/:slug" element={<TeacherPortal />} />
                    <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
                    <Route path="/teacher" element={<ProtectedRoute role="teacher"><TeacherDashboard /></ProtectedRoute>} />
                    <Route path="/teacher/upload" element={<ProtectedRoute role="teacher"><UploadExamPage /></ProtectedRoute>} />
                    <Route path="/teacher/exam/:examId" element={<ProtectedRoute role="teacher"><ExamDetailPage /></ProtectedRoute>} />
                    <Route path="/teacher/exam/:examId/sessions" element={<ProtectedRoute role="teacher"><ExamSessionsPage /></ProtectedRoute>} />
                    <Route path="/student" element={<ProtectedRoute><StudentDashboard /></ProtectedRoute>} />
                    <Route path="/student/quiz/:examId" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} />
                    <Route path="/student/result/:sessionId" element={<ProtectedRoute><ResultPage /></ProtectedRoute>} />
                    <Route path="/logout" element={<LogoutRoute />} />
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
