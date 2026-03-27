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
    const { user } = useAuth();
    const [exams, setExams] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0, draft: 0, totalSessions: 0 });
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) loadData();
    }, [user]);

    const loadData = async () => {
        const q = query(
            collection(db, 'exams'),
            where('teacherId', '==', user.uid),
            orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        const examList = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
        });
        setLoading(false);
    };

    const toggleStatus = async (examId, currentStatus) => {
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
        setStats(prev => ({
            ...prev,
            active: prev.active + (newStatus === 'active' ? 1 : -1),
            draft: prev.draft + (newStatus === 'active' ? -1 : 1),
        }));
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

    const filtered = exams
        .filter(e => filter === 'all' || e.status === filter)
        .filter(e => !search || e.title.toLowerCase().includes(search.toLowerCase()));

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải kho đề...</p></div>;

    return (
        <div>
            <div className="stats-grid">
                <StatsCard icon="journal-text" label="Tổng đề thi" value={stats.total} color="primary" delay={0} />
                <StatsCard icon="broadcast" label="Đang mở" value={stats.active} color="success" delay={1} />
                <StatsCard icon="pencil-square" label="Bản nháp" value={stats.draft} color="warm" delay={2} />
                <StatsCard icon="people-fill" label="Lượt thi" value={stats.totalSessions} color="cool" delay={3} />
            </div>

            <div className="section-header">
                <h2 className="section-title"><i className="bi bi-collection"></i> Kho Đề Thi</h2>
                <Link to="/teacher/upload" className="btn btn-primary">
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
                    {exams.length === 0 && (
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
                                    <span className={`status-dot ${exam.status}`}>
                                        <span className="status-dot-inner"></span>
                                    </span>
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
        </div>
    );
}
