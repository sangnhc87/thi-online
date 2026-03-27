import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { formatPercent, getScoreColor, getScoreEmoji } from '../utils/formatters';
import { getStreakLevel, isStreakActive } from '../utils/scoring';
import { ACHIEVEMENTS } from '../utils/achievements';
import StatsCard from '../components/StatsCard';
import StreakBadge from '../components/StreakBadge';
import { AchievementGrid } from '../components/AchievementBadge';
import Leaderboard from '../components/Leaderboard';

export default function StudentDashboard() {
    const { user, userProfile } = useAuth();
    const [exams, setExams] = useState([]);
    const [myResults, setMyResults] = useState({});
    const [mySessions, setMySessions] = useState([]);
    const [leaderboard, setLeaderboard] = useState([]);
    const [stats, setStats] = useState({ totalQuizzes: 0, totalScore: 0, totalQuestions: 0, avgPercent: 0, streak: 0 });
    const [tab, setTab] = useState('exams'); // 'exams', 'history', 'leaderboard', 'achievements'
    const [loading, setLoading] = useState(true);

    useEffect(() => { if (user) loadData(); }, [user]);

    const loadData = async () => {
        // Load active exams
        const examQ = query(collection(db, 'exams'), where('status', '==', 'active'), orderBy('createdAt', 'desc'));
        const examSnap = await getDocs(examQ);
        const examList = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setExams(examList);

        // Load my sessions
        const sessionQ = query(collection(db, 'sessions'), where('studentId', '==', user.uid));
        const sessionSnap = await getDocs(sessionQ);
        const results = {};
        const allSessions = [];
        let totalScore = 0, totalQuestions = 0;

        sessionSnap.docs.forEach(d => {
            const data = { id: d.id, ...d.data() };
            allSessions.push(data);
            if (!results[data.examId] || data.score > results[data.examId].score) {
                results[data.examId] = data;
            }
            totalScore += data.score || 0;
            totalQuestions += data.total || 0;
        });

        setMyResults(results);
        setMySessions(allSessions.sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0)));

        // Calculate stats
        const streak = userProfile?.streak || 0;
        const avgPercent = totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0;
        setStats({ totalQuizzes: allSessions.length, totalScore, totalQuestions, avgPercent, streak });

        // Build leaderboard from all sessions
        const allSessionsQ = query(collection(db, 'sessions'));
        const allSnap = await getDocs(allSessionsQ);
        const userMap = {};
        allSnap.docs.forEach(d => {
            const data = d.data();
            if (!userMap[data.studentId]) {
                userMap[data.studentId] = { uid: data.studentId, displayName: data.studentName, totalScore: 0, totalQuestions: 0, totalQuizzes: 0 };
            }
            userMap[data.studentId].totalScore += data.score || 0;
            userMap[data.studentId].totalQuestions += data.total || 0;
            userMap[data.studentId].totalQuizzes++;
        });

        // Load user profiles for photos and streaks
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.docs.forEach(d => {
            const data = d.data();
            if (userMap[d.id]) {
                userMap[d.id].photoURL = data.photoURL;
                userMap[d.id].streak = data.streak || 0;
                userMap[d.id].displayName = data.displayName || userMap[d.id].displayName;
            }
        });

        const lb = Object.values(userMap)
            .filter(u => u.totalQuizzes > 0)
            .sort((a, b) => {
                const pctA = a.totalQuestions ? a.totalScore / a.totalQuestions : 0;
                const pctB = b.totalQuestions ? b.totalScore / b.totalQuestions : 0;
                return pctB - pctA || b.totalQuizzes - a.totalQuizzes;
            });
        setLeaderboard(lb);
        setLoading(false);
    };

    // Get earned achievements
    const earnedAchievements = (userProfile?.achievements || []);
    const myRank = leaderboard.findIndex(e => e.uid === user?.uid) + 1;

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;

    return (
        <div>
            {/* Personal stats header */}
            <div className="student-header">
                <div className="student-header-left">
                    {user?.photoURL && <img src={user.photoURL} alt="" className="student-avatar" referrerPolicy="no-referrer" />}
                    <div>
                        <h1 style={{ fontSize: '1.4rem', margin: 0 }}>Xin chào, {user?.displayName?.split(' ').pop()}!</h1>
                        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
                            {stats.totalQuizzes === 0 ? 'Bắt đầu làm bài ngay!' : `Đã hoàn thành ${stats.totalQuizzes} bài thi`}
                        </p>
                    </div>
                </div>
                <StreakBadge streak={stats.streak} size="lg" />
            </div>

            <div className="stats-grid">
                <StatsCard icon="check2-circle" label="Bài đã làm" value={stats.totalQuizzes} color="primary" delay={0} />
                <StatsCard icon="graph-up-arrow" label="Trung bình" value={`${stats.avgPercent}%`} color={stats.avgPercent >= 60 ? 'success' : 'warm'} delay={1} />
                <StatsCard icon="trophy" label="Xếp hạng" value={myRank > 0 ? `#${myRank}` : '—'} color="gold" delay={2} />
                <StatsCard icon="fire" label="Streak" value={`${stats.streak} ngày`} color="warm" delay={3} />
            </div>

            {/* Tab navigation */}
            <div className="tab-nav">
                {[
                    { key: 'exams', label: 'Đề thi', icon: 'journal-text' },
                    { key: 'history', label: 'Lịch sử', icon: 'clock-history' },
                    { key: 'leaderboard', label: 'Xếp hạng', icon: 'trophy' },
                    { key: 'achievements', label: 'Thành tích', icon: 'award' },
                ].map(t => (
                    <button key={t.key} className={`tab-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                        <i className={`bi bi-${t.icon}`}></i> {t.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {tab === 'exams' && (
                <div>
                    {exams.length === 0 ? (
                        <div className="empty-state"><i className="bi bi-journal-x"></i><p>Chưa có đề thi nào.</p></div>
                    ) : (
                        <div className="dashboard-grid">
                            {exams.map((exam, idx) => {
                                const result = myResults[exam.id];
                                const canRetake = !result || ((exam.maxAttempts || 1) > (result.attemptCount || 1));
                                return (
                                    <motion.div key={exam.id} className="exam-card exam-card-student" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                                        {result && (
                                            <div className={`exam-card-ribbon ${getScoreColor(result.score, result.total)}`}>
                                                {getScoreEmoji(result.score, result.total)} {result.score}/{result.total}
                                            </div>
                                        )}
                                        <div className="exam-title">{exam.title}</div>
                                        {(exam.subject || exam.grade) && (
                                            <div className="exam-tags">
                                                {exam.subject && <span className="exam-tag">{exam.subject}</span>}
                                                {exam.grade && <span className="exam-tag">{exam.grade}</span>}
                                            </div>
                                        )}
                                        <div className="exam-meta">
                                            <span><i className="bi bi-question-circle"></i> {exam.questionCount} câu</span>
                                            <span><i className="bi bi-clock"></i> {exam.duration} phút</span>
                                            <span><i className="bi bi-person"></i> {exam.teacherName}</span>
                                        </div>
                                        <div className="exam-actions">
                                            {result ? (
                                                <>
                                                    <Link to={`/student/result/${result.id}`} className="btn btn-sm btn-outline">
                                                        <i className="bi bi-eye"></i> Xem lại
                                                    </Link>
                                                    {canRetake && (
                                                        <Link to={`/student/quiz/${exam.id}`} className="btn btn-sm btn-primary">
                                                            <i className="bi bi-arrow-repeat"></i> Thi lại
                                                        </Link>
                                                    )}
                                                </>
                                            ) : (
                                                <Link to={`/student/quiz/${exam.id}`} className="btn btn-sm btn-success">
                                                    <i className="bi bi-play-fill"></i> Bắt đầu
                                                </Link>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {tab === 'history' && (
                <div>
                    {mySessions.length === 0 ? (
                        <div className="empty-state"><i className="bi bi-clock-history"></i><p>Chưa có lịch sử thi.</p></div>
                    ) : (
                        <div className="card">
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead><tr><th>#</th><th>Đề thi</th><th>Điểm</th><th>Tỷ lệ</th><th>Thời gian</th><th></th></tr></thead>
                                    <tbody>
                                        {mySessions.map((s, idx) => {
                                            const pct = s.total ? Math.round((s.score / s.total) * 100) : 0;
                                            const examInfo = exams.find(e => e.id === s.examId);
                                            return (
                                                <tr key={s.id}>
                                                    <td>{idx + 1}</td>
                                                    <td style={{ fontWeight: 600 }}>{examInfo?.title || s.examId}</td>
                                                    <td><span className={`stat-badge ${getScoreColor(s.score, s.total)}`}>{s.score}/{s.total}</span></td>
                                                    <td>{pct}% {getScoreEmoji(s.score, s.total)}</td>
                                                    <td><small style={{ color: 'var(--text-muted)' }}>{s.completedAt ? new Date(s.completedAt.toDate()).toLocaleString('vi-VN') : '—'}</small></td>
                                                    <td><Link to={`/student/result/${s.id}`} className="btn btn-sm btn-outline"><i className="bi bi-eye"></i></Link></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === 'leaderboard' && (
                <Leaderboard entries={leaderboard} currentUserId={user?.uid} title="Bảng Xếp Hạng Tổng" />
            )}

            {tab === 'achievements' && (
                <div>
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient" style={{ background: 'var(--gradient-warm)' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}><i className="bi bi-award me-2"></i>Thành tích đã đạt ({earnedAchievements.length}/{ACHIEVEMENTS.length})</h3>
                        </div>
                        <div className="card-body">
                            <AchievementGrid achievements={earnedAchievements} />
                        </div>
                    </div>
                    <div className="card">
                        <div className="card-body">
                            <h3 style={{ fontSize: '1rem', marginBottom: 16 }}><i className="bi bi-lock me-2"></i>Tất cả thành tích</h3>
                            <div className="achievement-full-grid">
                                {ACHIEVEMENTS.map(a => {
                                    const earned = earnedAchievements.includes(a.id);
                                    return (
                                        <div key={a.id} className={`achievement-full-item ${earned ? 'earned' : 'locked'}`}>
                                            <span className="achievement-full-icon">{a.icon}</span>
                                            <div>
                                                <div className="achievement-full-name">{a.name}</div>
                                                <div className="achievement-full-desc">{a.description}</div>
                                            </div>
                                            {earned && <i className="bi bi-check-circle-fill" style={{ color: '#10b981' }}></i>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
