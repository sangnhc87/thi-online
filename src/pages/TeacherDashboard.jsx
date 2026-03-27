import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimeAgo } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import Swal from 'sweetalert2';

export default function TeacherDashboard() {
    const { user, userProfile, isSubscriptionActive } = useAuth();
    const [exams, setExams] = useState([]);
    const [students, setStudents] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0, draft: 0, totalSessions: 0, studentCount: 0 });
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState('exams'); // 'exams' | 'students'
    const [loading, setLoading] = useState(true);

    const slug = userProfile?.teacherSlug;
    const portalUrl = slug ? `${window.location.origin}/t/${slug}` : null;
    const subActive = isSubscriptionActive?.();
    const subEnd = userProfile?.subscriptionEnd?.toDate?.();
    const daysLeft = subEnd ? Math.ceil((subEnd - Date.now()) / 86400000) : null;

    useEffect(() => { if (user) loadData(); }, [user]);

    const loadData = async () => {
        const [examSnap, studentSnap] = await Promise.all([
            getDocs(query(collection(db, 'exams'), where('teacherId', '==', user.uid), orderBy('createdAt', 'desc'))),
            getDocs(query(collection(db, 'users'), where('teacherId', '==', user.uid))),
        ]);

        const examList = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const studentList = studentSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
        setStudents(studentList);

        // Load session counts
        const sessionCounts = {};
        let totalSessions = 0;
        for (const exam of examList) {
            const sSnap = await getDocs(query(collection(db, 'sessions'), where('examId', '==', exam.id)));
            sessionCounts[exam.id] = sSnap.size;
            totalSessions += sSnap.size;
        }

        setExams(examList.map(e => ({ ...e, sessionCount: sessionCounts[e.id] || 0 })));
        setStats({
            total: examList.length,
            active: examList.filter(e => e.status === 'active').length,
            draft: examList.filter(e => e.status !== 'active').length,
            totalSessions,
            studentCount: studentList.length,
        });
        setLoading(false);
    };

    const toggleStatus = async (examId, currentStatus) => {
        if (!subActive && currentStatus !== 'active') {
            Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn. Liên hệ admin để gia hạn.', 'warning');
            return;
        }
        const newStatus = currentStatus === 'active' ? 'draft' : 'active';
        const result = await Swal.fire({
            title: `${newStatus === 'active' ? 'Kích hoạt' : 'Đóng'} đề thi?`,
            text: `Đề sẽ được ${newStatus === 'active' ? 'mở cho học sinh' : 'đóng lại'}.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: newStatus === 'active' ? 'Kích hoạt' : 'Đóng lại',
            cancelButtonText: 'Hủy',
            confirmButtonColor: newStatus === 'active' ? '#10b981' : '#f59e0b',
        });
        if (!result.isConfirmed) return;
        await updateDoc(doc(db, 'exams', examId), { status: newStatus });
        setExams(prev => prev.map(e => e.id === examId ? { ...e, status: newStatus } : e));
        setStats(prev => ({ ...prev, active: prev.active + (newStatus === 'active' ? 1 : -1), draft: prev.draft + (newStatus === 'active' ? -1 : 1) }));
    };

    const handleDelete = async (examId, title) => {
        const result = await Swal.fire({
            title: 'Xóa đề thi?',
            html: `Xóa "<b>${title}</b>"?<br><small>Không thể hoàn tác.</small>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonText: 'Hủy',
            confirmButtonText: 'Xóa vĩnh viễn',
        });
        if (!result.isConfirmed) return;
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        await Promise.all(qSnap.docs.map(d => deleteDoc(d.ref)));
        await deleteDoc(doc(db, 'exams', examId));
        setExams(prev => prev.filter(e => e.id !== examId));
        Swal.fire({ icon: 'success', title: 'Đã xóa!', timer: 1500, showConfirmButton: false });
    };

    const copyPortalLink = () => {
        if (!portalUrl) return;
        navigator.clipboard.writeText(portalUrl);
        Swal.fire({ icon: 'success', title: 'Đã copy link!', text: portalUrl, timer: 2000, showConfirmButton: false });
    };

    const filtered = exams
        .filter(e => filter === 'all' || e.status === filter)
        .filter(e => !search || e.title.toLowerCase().includes(search.toLowerCase()));

    const filteredStudents = students.filter(s =>
        !search || (s.displayName || '').toLowerCase().includes(search.toLowerCase()) || (s.email || '').toLowerCase().includes(search.toLowerCase())
    );

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải kho đề...</p></div>;

    return (
        <div>
            {/* Subscription banner */}
            {userProfile?.teacherStatus === 'trial' && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-info-circle"></i> Bạn đang dùng thử. Liên hệ admin để nâng cấp gói.
                </div>
            )}
            {daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 20 }}>
                    <i className="bi bi-exclamation-triangle"></i> Gói đăng ký sẽ hết hạn trong <strong>{daysLeft} ngày</strong>. Liên hệ admin để gia hạn.
                </div>
            )}
            {userProfile?.teacherStatus === 'expired' && (
                <div className="alert alert-danger" style={{ marginBottom: 20 }}>
                    <i className="bi bi-x-octagon"></i> Gói đăng ký đã hết hạn. Bạn không thể mở đề mới. Liên hệ admin.
                </div>
            )}

            {/* Portal link */}
            {portalUrl && (
                <div className="card" style={{ marginBottom: 20, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="bi bi-link-45deg" style={{ fontSize: '1.2rem', color: 'var(--primary)' }}></i>
                        <span style={{ fontSize: '0.9rem' }}>Link lớp học:</span>
                        <code style={{ fontSize: '0.85rem', background: 'var(--bg)', padding: '2px 8px', borderRadius: 4 }}>/t/{slug}</code>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={copyPortalLink}>
                        <i className="bi bi-clipboard"></i> Copy link
                    </button>
                </div>
            )}

            <div className="stats-grid">
                <StatsCard icon="journal-text" label="Tổng đề thi" value={stats.total} color="primary" delay={0} />
                <StatsCard icon="broadcast" label="Đang mở" value={stats.active} color="success" delay={1} />
                <StatsCard icon="people-fill" label="Học sinh" value={stats.studentCount} color="cool" delay={2} />
                <StatsCard icon="bar-chart" label="Lượt thi" value={stats.totalSessions} color="warm" delay={3} />
            </div>

            {/* Tab switch */}
            <div className="tab-nav" style={{ marginBottom: 16 }}>
                <button className={`tab-btn ${activeTab === 'exams' ? 'active' : ''}`} onClick={() => setActiveTab('exams')}>
                    <i className="bi bi-journal-text"></i> Kho đề thi
                </button>
                <button className={`tab-btn ${activeTab === 'students' ? 'active' : ''}`} onClick={() => setActiveTab('students')}>
                    <i className="bi bi-people"></i> Học sinh ({stats.studentCount})
                </button>
            </div>

            {activeTab === 'exams' && (
                <>
                    <div className="section-header">
                        <h2 className="section-title"><i className="bi bi-collection"></i> Kho Đề Thi</h2>
                        <Link to="/teacher/upload" className={`btn btn-primary ${!subActive ? 'btn-disabled' : ''}`} onClick={e => { if (!subActive) { e.preventDefault(); Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn.', 'warning'); } }}>
                            <i className="bi bi-cloud-arrow-up"></i> Tải lên đề mới
                        </Link>
                    </div>

                    <div className="filter-bar">
                        <div className="filter-tabs">
                            {[
                                { key: 'all', label: 'Tất cả', count: exams.length },
                                { key: 'active', label: 'Đang mở', count: stats.active },
                                { key: 'draft', label: 'Nháp', count: stats.draft },
                            ].map(tab => (
                                <button key={tab.key} className={`filter-tab ${filter === tab.key ? 'active' : ''}`} onClick={() => setFilter(tab.key)}>
                                    {tab.label} <span className="filter-count">{tab.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="search-box">
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm kiếm đề..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-journal-plus"></i>
                            <p>{exams.length === 0 ? 'Chưa có đề thi nào.' : 'Không tìm thấy đề.'}</p>
                            {exams.length === 0 && subActive && (
                                <Link to="/teacher/upload" className="btn btn-primary"><i className="bi bi-plus-lg"></i> Tạo đề đầu tiên</Link>
                            )}
                        </div>
                    ) : (
                        <div className="dashboard-grid">
                            <AnimatePresence>
                                {filtered.map((exam, idx) => (
                                    <motion.div key={exam.id} className="exam-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: idx * 0.05 }} layout>
                                        <div className="exam-card-header">
                                            <div className="exam-title">{exam.title}</div>
                                            <span className={`status-dot ${exam.status}`}><span className="status-dot-inner"></span></span>
                                        </div>
                                        <div className="exam-meta">
                                            <span><i className="bi bi-question-circle"></i> {exam.questionCount || 0} câu</span>
                                            <span><i className="bi bi-clock"></i> {exam.duration || 0} phút</span>
                                            <span><i className="bi bi-people"></i> {exam.sessionCount} lượt</span>
                                        </div>
                                        <div className="exam-date"><i className="bi bi-calendar3"></i> {formatTimeAgo(exam.createdAt)}</div>
                                        <div className="exam-actions">
                                            <button className={`btn btn-sm ${exam.status === 'active' ? 'btn-warning-soft' : 'btn-success-soft'}`} onClick={() => toggleStatus(exam.id, exam.status)}>
                                                <i className={`bi bi-${exam.status === 'active' ? 'pause-circle' : 'play-circle'}`}></i>
                                                {exam.status === 'active' ? 'Đóng' : 'Mở'}
                                            </button>
                                            <Link to={`/teacher/exam/${exam.id}`} className="btn btn-sm btn-outline"><i className="bi bi-eye"></i> Chi tiết</Link>
                                            <Link to={`/teacher/exam/${exam.id}/sessions`} className="btn btn-sm btn-outline"><i className="bi bi-bar-chart"></i> Kết quả</Link>
                                            <button className="btn btn-sm btn-danger-soft" onClick={() => handleDelete(exam.id, exam.title)}><i className="bi bi-trash3"></i></button>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'students' && (
                <div>
                    <div className="filter-bar" style={{ marginBottom: 16 }}>
                        <div className="search-box">
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm học sinh..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {filteredStudents.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-people"></i>
                            <p>Chưa có học sinh nào tham gia.</p>
                            {portalUrl && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Chia sẻ link <strong>/t/{slug}</strong> để học sinh tham gia.</p>}
                        </div>
                    ) : (
                        <div className="card">
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead><tr><th>#</th><th>Họ tên</th><th>Email</th><th>Streak</th><th>Bài làm</th><th>Ngày tham gia</th></tr></thead>
                                    <tbody>
                                        {filteredStudents.map((s, idx) => (
                                            <tr key={s.uid}>
                                                <td>{idx + 1}</td>
                                                <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    {s.photoURL && <img src={s.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} referrerPolicy="no-referrer" />}
                                                    <span style={{ fontWeight: 600 }}>{s.displayName || 'Ẩn danh'}</span>
                                                </td>
                                                <td><small style={{ color: 'var(--text-muted)' }}>{s.email}</small></td>
                                                <td>{s.streak || 0} 🔥</td>
                                                <td>{s.totalQuizzes || 0}</td>
                                                <td><small style={{ color: 'var(--text-muted)' }}>{s.createdAt ? new Date(s.createdAt.toDate()).toLocaleDateString('vi-VN') : '—'}</small></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
