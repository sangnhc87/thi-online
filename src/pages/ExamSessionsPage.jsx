import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { motion } from 'framer-motion';
import { formatDateTime, formatDurationLong, formatPercent, getScoreColor } from '../utils/formatters';
import StatsCard from '../components/StatsCard';

export default function ExamSessionsPage() {
    const { examId } = useParams();
    const [exam, setExam] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [stats, setStats] = useState({ total: 0, avg: 0, max: 0, min: 0, perfect: 0 });
    const [loading, setLoading] = useState(true);
    const [sortBy, setSortBy] = useState('score'); // 'score', 'time', 'name'
    const [sortDir, setSortDir] = useState('desc');

    useEffect(() => { loadData(); }, [examId]);

    const loadData = async () => {
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (examDoc.exists()) setExam({ id: examDoc.id, ...examDoc.data() });

        const sessionQ = query(collection(db, 'sessions'), where('examId', '==', examId));
        const snap = await getDocs(sessionQ);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Compute stats
        if (list.length > 0) {
            const scores = list.map(s => s.score || 0);
            const totals = list.map(s => s.total || 1);
            const pcts = list.map((s, i) => (scores[i] / totals[i]) * 100);
            setStats({
                total: list.length,
                avg: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
                max: Math.max(...scores),
                min: Math.min(...scores),
                perfect: list.filter((s, i) => scores[i] === totals[i]).length,
            });
        }

        setSessions(list);
        setLoading(false);
    };

    const sorted = [...sessions].sort((a, b) => {
        const dir = sortDir === 'desc' ? -1 : 1;
        if (sortBy === 'score') return ((a.score || 0) - (b.score || 0)) * dir;
        if (sortBy === 'name') return (a.studentName || '').localeCompare(b.studentName || '') * dir;
        if (sortBy === 'time') {
            const ta = a.completedAt?.toMillis?.() || 0;
            const tb = b.completedAt?.toMillis?.() || 0;
            return (ta - tb) * dir;
        }
        return 0;
    });

    const toggleSort = (key) => {
        if (sortBy === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortBy(key); setSortDir('desc'); }
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div className="breadcrumb">
                <Link to="/teacher"><i className="bi bi-arrow-left"></i> Kho đề</Link>
                <span className="breadcrumb-sep">/</span>
                <Link to={`/teacher/exam/${examId}`}>{exam?.title || 'Đề thi'}</Link>
                <span className="breadcrumb-sep">/</span>
                <span>Kết quả</span>
            </div>

            <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>
                <i className="bi bi-bar-chart me-2" style={{ color: 'var(--accent)' }}></i>
                Kết quả: {exam?.title}
            </h1>

            <div className="stats-grid">
                <StatsCard icon="people-fill" label="Tổng lượt thi" value={stats.total} color="primary" delay={0} />
                <StatsCard icon="graph-up" label="Trung bình" value={`${stats.avg}%`} color="cool" delay={1} />
                <StatsCard icon="trophy" label="Điểm cao nhất" value={`${stats.max}/${exam?.questionCount || '?'}`} color="success" delay={2} />
                <StatsCard icon="star" label="Điểm tuyệt đối" value={stats.perfect} color="gold" delay={3} />
            </div>

            {/* Score distribution */}
            {sessions.length > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-body">
                        <h3 style={{ fontSize: '1rem', marginBottom: 16 }}><i className="bi bi-bar-chart-line"></i> Phân bố điểm</h3>
                        <ScoreDistribution sessions={sessions} total={exam?.questionCount || 1} />
                    </div>
                </div>
            )}

            {/* Results table */}
            {sessions.length === 0 ? (
                <div className="empty-state">
                    <i className="bi bi-inbox"></i>
                    <p>Chưa có học sinh nào làm bài.</p>
                </div>
            ) : (
                <div className="card">
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 50 }}>#</th>
                                    <th className="sortable" onClick={() => toggleSort('name')}>
                                        Học sinh {sortBy === 'name' && <i className={`bi bi-caret-${sortDir === 'desc' ? 'down' : 'up'}-fill`}></i>}
                                    </th>
                                    <th className="sortable" onClick={() => toggleSort('score')}>
                                        Điểm {sortBy === 'score' && <i className={`bi bi-caret-${sortDir === 'desc' ? 'down' : 'up'}-fill`}></i>}
                                    </th>
                                    <th>Tỷ lệ</th>
                                    <th className="sortable" onClick={() => toggleSort('time')}>
                                        Thời gian nộp {sortBy === 'time' && <i className={`bi bi-caret-${sortDir === 'desc' ? 'down' : 'up'}-fill`}></i>}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((s, idx) => {
                                    const pct = s.total ? Math.round((s.score / s.total) * 100) : 0;
                                    const color = getScoreColor(s.score, s.total);
                                    return (
                                        <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }}>
                                            <td>{idx + 1}</td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontWeight: 600 }}>{s.studentName || 'Ẩn danh'}</span>
                                                </div>
                                                <small style={{ color: 'var(--text-muted)' }}>{s.studentEmail}</small>
                                            </td>
                                            <td><span className={`stat-badge ${color}`}>{s.score}/{s.total}</span></td>
                                            <td>
                                                <div className="mini-progress">
                                                    <div className="mini-progress-bar" style={{ width: `${pct}%`, background: `var(--gradient-${color === 'danger' ? 'warm' : color === 'primary' ? 'main' : color})` }}></div>
                                                </div>
                                                <small>{pct}%</small>
                                            </td>
                                            <td><small>{formatDateTime(s.completedAt)}</small></td>
                                        </motion.tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function ScoreDistribution({ sessions, total }) {
    const buckets = [0, 0, 0, 0, 0]; // 0-20%, 20-40%, 40-60%, 60-80%, 80-100%
    const labels = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#10b981'];

    sessions.forEach(s => {
        const pct = total > 0 ? (s.score / total) * 100 : 0;
        if (pct < 20) buckets[0]++;
        else if (pct < 40) buckets[1]++;
        else if (pct < 60) buckets[2]++;
        else if (pct < 80) buckets[3]++;
        else buckets[4]++;
    });

    const max = Math.max(...buckets, 1);

    return (
        <div className="score-distribution">
            {buckets.map((count, idx) => (
                <div key={idx} className="dist-bar-group">
                    <div className="dist-bar-wrapper">
                        <motion.div
                            className="dist-bar"
                            style={{ background: colors[idx] }}
                            initial={{ height: 0 }}
                            animate={{ height: `${(count / max) * 100}%` }}
                            transition={{ delay: idx * 0.1, duration: 0.5 }}
                        />
                    </div>
                    <div className="dist-label">{labels[idx]}</div>
                    <div className="dist-count">{count}</div>
                </div>
            ))}
        </div>
    );
}
