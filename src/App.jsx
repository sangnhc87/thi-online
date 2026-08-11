import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './styles/app.css';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const TeacherGuidePage = lazy(() => import('./pages/TeacherGuidePage'));
const TeachingStudioPage = lazy(() => import('./pages/TeachingStudioPage'));
const UploadExamPage = lazy(() => import('./pages/UploadExamPage'));
const ExamDetailPage = lazy(() => import('./pages/ExamDetailPage'));
const ExamPresentationPage = lazy(() => import('./pages/ExamPresentationDeckPage'));
const ExamSessionsPage = lazy(() => import('./pages/ExamSessionsPage'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const QuizPage = lazy(() => import('./pages/QuizPage'));
const ResultPage = lazy(() => import('./pages/ResultPage'));
const TeacherPortal = lazy(() => import('./pages/TeacherPortal'));
const TeacherStudentDetailPage = lazy(() => import('./pages/TeacherStudentDetailPage'));
const LiveClassroomPage = lazy(() => import('./pages/LiveClassroomPage'));
const LiveStudentPage = lazy(() => import('./pages/LiveStudentPage'));
const QuestionBankPage = lazy(() => import('./pages/QuestionBankPage'));
const CertificateVerifyPage = lazy(() => import('./pages/CertificateVerifyPage'));
const PdfImportLabPage = lazy(() => import('./pages/PdfImportLabPage'));

function RouteFallback() {
    return <div className="loading-screen"><div className="spinner"></div><p>Đang tải trang...</p></div>;
}

function ProtectedRoute({ children, role, allowAdmin = true }) {
    const { user, userProfile, loading } = useAuth();
    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;
    if (!user) return <Navigate to="/login" replace />;
    if (role === 'admin' && userProfile?.role !== 'admin') return <Navigate to="/login" replace />;
    if (role === 'teacher' && userProfile?.role !== 'teacher' && (!allowAdmin || userProfile?.role !== 'admin')) {
        return <Navigate to={userProfile?.role === 'admin' ? '/admin' : '/student'} replace />;
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
                            <Link to="/teacher" className="nav-link"><i className="bi bi-grid"></i> Kho đề</Link>
                            <Link to="/teacher/guide" className="nav-link"><i className="bi bi-journal-bookmark"></i> HDSD GV</Link>
                            <Link to="/teacher/studio" className="nav-link"><i className="bi bi-joystick"></i> Studio</Link>
                            <Link to="/teacher/upload" className="nav-link"><i className="bi bi-upload"></i> Soạn đề</Link>
                            <Link to="/teacher/pdf-import" className="nav-link"><i className="bi bi-file-earmark-pdf"></i> PDF</Link>
                        </div>
                    )}
                    {isTeacher && !isAdmin && (
                        <div className="navbar-links">
                            <Link to="/teacher" className="nav-link"><i className="bi bi-grid"></i> Dashboard</Link>
                            <Link to="/teacher/guide" className="nav-link"><i className="bi bi-journal-bookmark"></i> HDSD GV</Link>
                            <Link to="/teacher/studio" className="nav-link"><i className="bi bi-joystick"></i> Studio</Link>
                            <Link to="/teacher/upload" className="nav-link"><i className="bi bi-upload"></i> Tạo đề</Link>
                            <Link to="/teacher/pdf-import" className="nav-link"><i className="bi bi-file-earmark-pdf"></i> PDF</Link>
                        </div>
                    )}
                    <div className="navbar-user">
                        {userProfile?.photoURL && <img src={userProfile.photoURL} alt="" className="navbar-avatar" referrerPolicy="no-referrer" />}
                        <span className="navbar-name">{userProfile?.displayName || user.email}</span>
                        <span className={`navbar-role ${userProfile?.role}`}>
                            {userProfile?.role === 'admin' ? 'Super Admin' : userProfile?.role === 'teacher' ? 'GV' : 'HS'}
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
    }, [logout, navigate]);
    return <div className="loading-screen"><div className="spinner"></div><p>Đang đăng xuất...</p></div>;
}

function AppRoutes() {
    const location = useLocation();
    const isQuizRoute = /\/quiz\//.test(location.pathname);
    const isLiveRoute = /\/live(?:\/|$)/.test(location.pathname);
    const isPresentationRoute = /\/teacher\/exam\/[^/]+\/presentation(?:\/|$)/.test(location.pathname);
    const hideNavbar = isQuizRoute || isLiveRoute || isPresentationRoute;
    const isImmersiveRoute = location.pathname === '/teacher/upload' || isQuizRoute || isLiveRoute || isPresentationRoute;

    return (
        <>
            {!hideNavbar && <Navbar />}
            <main className={`main-content ${isImmersiveRoute ? 'main-content-immersive' : ''}`}>
                <Suspense fallback={<RouteFallback />}>
                    <Routes>
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/t/:slug" element={<TeacherPortal />} />
                        <Route path="/certificate/verify" element={<CertificateVerifyPage />} />
                        <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
                        <Route path="/teacher" element={<ProtectedRoute role="teacher"><TeacherDashboard /></ProtectedRoute>} />
                        <Route path="/teacher/guide" element={<ProtectedRoute role="teacher"><TeacherGuidePage /></ProtectedRoute>} />
                        <Route path="/teacher/studio" element={<ProtectedRoute role="teacher"><TeachingStudioPage /></ProtectedRoute>} />
                        <Route path="/teacher/upload" element={<ProtectedRoute role="teacher"><UploadExamPage /></ProtectedRoute>} />
                        <Route path="/teacher/exam/:examId" element={<ProtectedRoute role="teacher"><ExamDetailPage /></ProtectedRoute>} />
                        <Route path="/teacher/exam/:examId/presentation" element={<ProtectedRoute role="teacher"><ExamPresentationPage /></ProtectedRoute>} />
                        <Route path="/teacher/exam/:examId/sessions" element={<ProtectedRoute role="teacher" allowAdmin={false}><ExamSessionsPage /></ProtectedRoute>} />
                        <Route path="/teacher/exam/:examId/live" element={<ProtectedRoute role="teacher"><LiveClassroomPage /></ProtectedRoute>} />
                        <Route path="/teacher/bank" element={<ProtectedRoute role="teacher"><QuestionBankPage /></ProtectedRoute>} />
                        <Route path="/teacher/pdf-import" element={<ProtectedRoute role="teacher"><PdfImportLabPage /></ProtectedRoute>} />
                        <Route path="/teacher/student/:studentId" element={<ProtectedRoute role="teacher" allowAdmin={false}><TeacherStudentDetailPage /></ProtectedRoute>} />
                        <Route path="/teacher/student/:studentId/preview" element={<ProtectedRoute role="teacher" allowAdmin={false}><StudentDashboard /></ProtectedRoute>} />
                        <Route path="/teacher/student/:studentId/preview/quiz/:examId" element={<ProtectedRoute role="teacher" allowAdmin={false}><QuizPage /></ProtectedRoute>} />
                        <Route path="/teacher/student/:studentId/preview/result/:sessionId" element={<ProtectedRoute role="teacher" allowAdmin={false}><ResultPage /></ProtectedRoute>} />
                        <Route path="/student" element={<ProtectedRoute><StudentDashboard /></ProtectedRoute>} />
                        <Route path="/live/:code" element={<ProtectedRoute><LiveStudentPage /></ProtectedRoute>} />
                        <Route path="/student/quiz/:examId" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} />
                        <Route path="/student/result/:sessionId" element={<ProtectedRoute><ResultPage /></ProtectedRoute>} />
                        <Route path="/logout" element={<LogoutRoute />} />
                        <Route path="/" element={<Navigate to="/login" replace />} />
                        <Route path="*" element={<Navigate to="/login" replace />} />
                    </Routes>
                </Suspense>
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
