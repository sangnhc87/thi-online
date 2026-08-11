import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { formatDuration, getScoreColor, getScoreEmoji } from '../utils/formatters';
import { ACHIEVEMENTS } from '../utils/achievements';
import StatsCard from '../components/StatsCard';
import StreakBadge from '../components/StreakBadge';
import { AchievementGrid } from '../components/AchievementBadge';
import Leaderboard from '../components/Leaderboard';
import { getGamificationPresetLabel, normalizeGamificationSettings } from '../utils/gamification';
import { getStudentAccessState } from '../utils/studentAccess';

export default function StudentDashboard() {
    const { studentId: previewStudentId } = useParams();
    const { user, userProfile, logout } = useAuth();
    const isPreviewMode = Boolean(previewStudentId);
    const [previewStudent, setPreviewStudent] = useState(null);
    const [exams, setExams] = useState([]);
    const [myResults, setMyResults] = useState({});
    const [mySessions, setMySessions] = useState([]);
    const [leaderboard, setLeaderboard] = useState([]);
    const [stats, setStats] = useState({ totalQuizzes: 0, totalScore: 0, totalQuestions: 0, avgPercent: 0, streak: 0 });
    const [tab, setTab] = useState('exams');
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();
    const [joinCode, setJoinCode] = useState('');
    const [joinError, setJoinError] = useState('');
    const handleJoinLive = () => {
        if (studentAccessState.locked) {
            setJoinError(studentAccessState.description);
            return;
        }
        const code = joinCode.trim().toUpperCase().replace(/\s/g, '');
        if (!code) { setJoinError('Nhập mã phòng thi.'); return; }
        navigate(`/live/${code}`);
    };
    const activeStudent = isPreviewMode ? previewStudent : userProfile;
    const teacherId = activeStudent?.teacherId;
    const activeStudentId = activeStudent?.uid;
    const activeName = activeStudent?.displayName || activeStudent?.email || 'Học sinh';
    const activeFirstName = activeName.split(' ').pop();
    const studentAccessState = isPreviewMode ? {
        code: 'preview',
        locked: false,
        title: 'Chế độ preview',
        shortLabel: 'Preview không ghi dữ liệu',
        description: 'Đây là chế độ mô phỏng để giáo viên kiểm tra giao diện học sinh.',
        cardNote: null,
    } : getStudentAccessState(activeStudent);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            let targetStudent = userProfile;

            if (isPreviewMode) {
                if (userProfile?.role !== 'teacher') {
                    setPreviewStudent(null);
                    setExams([]);
                    setMyResults({});
                    setMySessions([]);
                    setLeaderboard([]);
                    setStats({ totalQuizzes: 0, totalScore: 0, totalQuestions: 0, avgPercent: 0, streak: 0 });
                    setLoading(false);
                    return;
                }

                const previewSnap = await getDoc(doc(db, 'users', previewStudentId));
                if (!previewSnap.exists()) {
                    setPreviewStudent(null);
                    setLoading(false);
                    return;
                }

                const previewData = { uid: previewSnap.id, ...previewSnap.data() };
                if (previewData.role !== 'student' || previewData.teacherId !== user.uid) {
                    setPreviewStudent(null);
                    setLoading(false);
                    return;
                }

                targetStudent = previewData;
                setPreviewStudent(previewData);
            } else {
                setPreviewStudent(null);
            }

            if (!targetStudent?.teacherId) {
                setExams([]);
                setMyResults({});
                setMySessions([]);
                setLeaderboard([]);
                setStats({ totalQuizzes: 0, totalScore: 0, totalQuestions: 0, avgPercent: 0, streak: 0 });
                setLoading(false);
                return;
            }

            const [examSnap, allTeacherExamsSnap, sessionSnap, classmatesSnap] = await Promise.all([
                getDocs(query(collection(db, 'exams'), where('teacherId', '==', targetStudent.teacherId), where('status', '==', 'active'), orderBy('createdAt', 'desc'))),
                getDocs(query(collection(db, 'exams'), where('teacherId', '==', targetStudent.teacherId))),
                isPreviewMode
                    ? getDocs(query(collection(db, 'sessions'), where('teacherId', '==', targetStudent.teacherId)))
                    : getDocs(query(collection(db, 'sessions'), where('studentId', '==', targetStudent.uid))),
                getDocs(query(collection(db, 'users'), where('teacherId', '==', targetStudent.teacherId), where('role', '==', 'student'))),
            ]);

            const examList = examSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
            const teacherExamIds = new Set(allTeacherExamsSnap.docs.map((snapshot) => snapshot.id));
            const filteredSessions = sessionSnap.docs
                .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
                .filter((session) => session.studentId === targetStudent.uid)
                .filter((session) => teacherExamIds.has(session.examId))
                .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

            const results = {};
            let totalScore = 0;
            let totalQuestions = 0;

            filteredSessions.forEach((session) => {
                if (!results[session.examId] || session.score > results[session.examId].score) {
                    results[session.examId] = session;
                }
                const aggregateTotal = session.manualReviewPending ? (session.autoGradedTotal || 0) : (session.total || 0);
                totalScore += session.score || 0;
                totalQuestions += aggregateTotal;
            });

            const leaderboardRows = classmatesSnap.docs
                .map((snapshot) => ({ uid: snapshot.id, ...snapshot.data() }))
                .map((student) => ({
                    uid: student.uid,
                    displayName: student.displayName,
                    photoURL: student.photoURL,
                    streak: student.streak || 0,
                    totalScore: student.totalScore || 0,
                    totalQuestions: student.totalQuestions || 0,
                    totalQuizzes: student.totalQuizzes || 0,
                }))
                .filter((student) => student.totalQuizzes > 0 && student.totalQuestions > 0)
                .sort((a, b) => {
                    const pctA = a.totalQuestions ? a.totalScore / a.totalQuestions : 0;
                    const pctB = b.totalQuestions ? b.totalScore / b.totalQuestions : 0;
                    return pctB - pctA || b.totalQuizzes - a.totalQuizzes;
                });

            setExams(examList);
            setMyResults(results);
            setMySessions(filteredSessions);
            setLeaderboard(leaderboardRows);
            setStats({
                totalQuizzes: filteredSessions.length,
                totalScore,
                totalQuestions,
                avgPercent: totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0,
                streak: targetStudent?.streak || 0,
            });
        } catch (error) {
            console.error('student dashboard load failed', error);
            setExams([]);
            setMyResults({});
            setMySessions([]);
            setLeaderboard([]);
            setStats({ totalQuizzes: 0, totalScore: 0, totalQuestions: 0, avgPercent: 0, streak: 0 });
        } finally {
            setLoading(false);
        }
    }, [isPreviewMode, previewStudentId, user?.uid, userProfile]);

    useEffect(() => {
        if (user && userProfile) loadData();
        else if (user && !userProfile) return; // wait for profile
        else setLoading(false);
    }, [loadData, user, userProfile]);

    // Get earned achievements
    const earnedAchievements = (activeStudent?.achievements || []);
    const myRank = leaderboard.findIndex(e => e.uid === activeStudentId) + 1;
    const completedExamCount = Object.keys(myResults).length;
    const completionRate = exams.length > 0 ? Math.round((completedExamCount / exams.length) * 100) : 0;
    const bestResult = mySessions.reduce((best, session) => {
        if (!best) return session;
        const bestPct = best.total ? best.score / best.total : 0;
        const currentPct = session.total ? session.score / session.total : 0;
        return currentPct > bestPct ? session : best;
    }, null);
    const pendingExams = exams.filter((exam) => {
        const result = myResults[exam.id];
        return !result || (exam.maxAttempts || 1) > (result.attemptCount || 1);
    });
    const masteredExams = exams.filter((exam) => {
        const result = myResults[exam.id];
        return result && result.total && result.score / result.total >= 0.8;
    }).length;
    const reviewExams = exams.filter((exam) => {
        const result = myResults[exam.id];
        return result && result.total && result.score / result.total < 0.6;
    }).length;
    const averageTimeSpent = mySessions.length > 0
        ? Math.round(mySessions.reduce((total, session) => total + (session.timeSpent || 0), 0) / mySessions.length)
        : 0;
    const recentSessions = mySessions.slice(0, 4).map((session) => {
        const examInfo = exams.find((exam) => exam.id === session.examId);
        const pct = session.total ? Math.round((session.score / session.total) * 100) : 0;
        return {
            ...session,
            title: examInfo?.title || session.examTitle || 'Bài thi',
            subject: examInfo?.subject || 'Tổng hợp',
            pct,
        };
    });
    const subjectPerformance = Object.values(mySessions.reduce((accumulator, session) => {
        const examInfo = exams.find((exam) => exam.id === session.examId);
        const subject = examInfo?.subject || 'Chưa phân môn';
        if (!accumulator[subject]) {
            accumulator[subject] = {
                subject,
                totalScore: 0,
                totalQuestions: 0,
                attempts: 0,
                bestPct: 0,
            };
        }
        const pct = session.total ? Math.round((session.score / session.total) * 100) : 0;
        accumulator[subject].totalScore += session.score || 0;
        accumulator[subject].totalQuestions += session.total || 0;
        accumulator[subject].attempts += 1;
        accumulator[subject].bestPct = Math.max(accumulator[subject].bestPct, pct);
        return accumulator;
    }, {})).map((subject) => ({
        ...subject,
        avgPct: subject.totalQuestions ? Math.round((subject.totalScore / subject.totalQuestions) * 100) : 0,
    })).sort((a, b) => b.avgPct - a.avgPct);
    const strongestSubject = subjectPerformance[0];
    const focusSubject = subjectPerformance[subjectPerformance.length - 1];
    const readinessScore = Math.min(
        100,
        Math.round((stats.avgPercent * 0.62) + (completionRate * 0.22) + Math.min(stats.streak * 4, 16)),
    );
    const missionCards = [
        pendingExams.length > 0
            ? {
                icon: 'rocket-takeoff',
                title: 'Mục tiêu kế tiếp',
                body: `Hoàn thành ${pendingExams[0].title} để nâng tiến độ lớp lên thêm một bậc.`,
                tone: 'primary',
            }
            : {
                icon: 'stars',
                title: 'Đang rất ổn',
                body: 'Bạn đã hoàn tất toàn bộ đề đang mở. Có thể quay lại các bài cần cải thiện để tăng thứ hạng.',
                tone: 'success',
            },
        reviewExams > 0
            ? {
                icon: 'arrow-repeat',
                title: 'Ưu tiên ôn lại',
                body: `${reviewExams} đề dưới 60% đang chờ bạn cải thiện. Hãy thi lại để kéo trung bình lên.`,
                tone: 'warm',
            }
            : {
                icon: 'patch-check',
                title: 'Chất lượng ổn định',
                body: 'Bạn chưa có đề nào rơi vào nhóm cần ôn gấp. Giữ nhịp để bảo toàn phong độ.',
                tone: 'cool',
            },
        {
            icon: 'lightning-charge',
            title: 'Nhịp học hiện tại',
            body: averageTimeSpent > 0
                ? `Bạn đang hoàn thành trung bình ${formatDuration(averageTimeSpent)} cho mỗi bài. Hãy giữ tốc độ nhưng vẫn đảm bảo độ chính xác.`
                : 'Chưa có đủ dữ liệu thời gian làm bài. Khi bắt đầu thi, hệ thống sẽ gợi ý nhịp làm phù hợp.',
            tone: 'gold',
        },
    ];
    const experienceModeLabel = exams[0] ? getGamificationPresetLabel(normalizeGamificationSettings(exams[0].gamification)) : 'Classic Focus';
    const focusCards = [
        {
            icon: pendingExams.length > 0 ? 'rocket-takeoff' : 'stars',
            title: 'Mục tiêu kế tiếp',
            value: pendingExams[0]?.title || 'Giữ nhịp và tăng hạng',
            copy: pendingExams.length > 0
                ? `${pendingExams.length} đề còn có thể bắt đầu hoặc thi lại.`
                : 'Bạn đã hoàn tất đề đang mở, đây là lúc phù hợp để tối ưu điểm số.',
            tone: 'primary',
        },
        {
            icon: studentAccessState.locked ? 'shield-lock' : 'person-badge',
            title: 'Trạng thái lớp',
            value: studentAccessState.shortLabel,
            copy: studentAccessState.locked
                ? studentAccessState.description
                : 'Bạn đang ở trạng thái có thể tiếp tục vào đề, vào live quiz và theo dõi tiến độ bình thường.',
            tone: studentAccessState.locked ? 'warm' : 'cool',
        },
        {
            icon: exams[0] && normalizeGamificationSettings(exams[0].gamification).mode === 'arcade' ? 'controller' : 'journal-check',
            title: 'Phong cách đề gần nhất',
            value: experienceModeLabel,
            copy: exams[0]
                ? 'Dựa trên đề đang mở gần nhất, hệ thống đang ưu tiên nhịp thi và cách hiển thị như trên.'
                : 'Khi giáo viên mở đề đầu tiên, thẻ này sẽ mô tả style trải nghiệm của bài thi.',
            tone: 'gold',
        },
    ];

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;

    if (!teacherId) {
        if (isPreviewMode) {
            return (
                <div className="student-shell student-shell-empty">
                    <div className="empty-state" style={{ marginTop: 60 }}>
                        <i className="bi bi-person-lines-fill" style={{ fontSize: '3rem' }}></i>
                        <h2 style={{ margin: '16px 0 8px' }}>Học sinh chưa tham gia lớp</h2>
                        <p style={{ color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto 16px' }}>
                            Tài khoản này chưa gắn với giáo viên nào nên chưa có giao diện học sinh đầy đủ để preview.
                        </p>
                        <Link to="/teacher" className="btn btn-primary">
                            <i className="bi bi-arrow-left"></i> Quay lại dashboard giáo viên
                        </Link>
                    </div>
                </div>
            );
        }

        return (
            <div className="student-shell student-shell-empty">
                <div className="empty-state" style={{ marginTop: 60 }}>
                    <i className="bi bi-people" style={{ fontSize: '3rem' }}></i>
                    <h2 style={{ margin: '16px 0 8px' }}>Chưa tham gia lớp nào</h2>
                    <p style={{ color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto 16px' }}>
                        Hãy nhờ giáo viên gửi link lớp học cho bạn (dạng <code>/t/ten-giao-vien</code>) hoặc nhập link bên dưới.
                    </p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
                        <input type="text" className="form-input" placeholder="Nhập link lớp, VD: /t/nguyen-van-a" id="join-input" style={{ maxWidth: 280 }} />
                        <button className="btn btn-primary" onClick={() => {
                            const val = document.getElementById('join-input').value.trim();
                            const slug = val.replace(/^.*\/t\//, '');
                            if (slug) window.location.href = `/t/${slug}`;
                        }}>
                            <i className="bi bi-box-arrow-in-right"></i> Tham gia
                        </button>
                    </div>

                    {/* BIG logout button */}
                    <div style={{ marginTop: 24, padding: 20, background: 'var(--danger-bg)', borderRadius: 12, maxWidth: 400, margin: '24px auto 0' }}>
                        <p style={{ fontWeight: 600, marginBottom: 4 }}>Đang đăng nhập: {user?.email}</p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 12 }}>Vai trò: {userProfile?.role}</p>
                        <button className="btn btn-danger" onClick={async () => { await logout(); window.location.href = '/login'; }} style={{ width: '100%', padding: '12px 24px', fontSize: '1rem' }}>
                            <i className="bi bi-box-arrow-right"></i> ĐĂNG XUẤT
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`student-shell${isPreviewMode ? ' student-shell-preview' : ''}`}>
            {isPreviewMode && activeStudent && (
                <div className="alert alert-info student-preview-banner" style={{ marginBottom: 20 }}>
                    <i className="bi bi-display"></i> Đang xem giao diện học sinh của <strong>{activeStudent.displayName || activeStudent.email}</strong> ở chế độ preview. Bạn có thể kiểm tra dashboard, lịch sử, bảng xếp hạng và luồng thi mà không ghi dữ liệu thật.
                </div>
            )}

            <div className="student-command">
                <div className="student-command-main">
                    <div className="student-command-topline">
                        <span className="student-command-chip">
                            <i className="bi bi-stars"></i> {isPreviewMode ? 'Preview student cockpit' : 'Student cockpit'}
                        </span>
                        <span className="student-command-chip muted">
                            <i className="bi bi-graph-up-arrow"></i> {completionRate}% tiến độ học phần
                        </span>
                        {!isPreviewMode && (
                            <span className={`student-command-chip ${studentAccessState.locked ? 'alert' : 'muted'}`}>
                                <i className={`bi bi-${studentAccessState.locked ? 'shield-lock' : 'calendar-check'}`}></i> {studentAccessState.shortLabel}
                            </span>
                        )}
                    </div>
                    <div className="student-command-title-row">
                        {activeStudent?.photoURL ? (
                            <img src={activeStudent.photoURL} alt="" className="student-command-avatar" referrerPolicy="no-referrer" />
                        ) : (
                            <div className="student-command-avatar student-command-avatar-fallback">
                                {(activeName || 'H')[0]}
                            </div>
                        )}
                        <div>
                            <h1>{isPreviewMode ? `Giao diện học sinh: ${activeName}` : `Xin chào, ${activeFirstName}!`}</h1>
                            <p>
                                {pendingExams.length > 0
                                    ? `Còn ${pendingExams.length} đề có thể làm hoặc thi lại. Hệ thống đang ưu tiên ${pendingExams[0].title}.`
                                    : 'Bạn đã hoàn thành toàn bộ đề đang mở. Đây là lúc phù hợp để tối ưu điểm và thứ hạng.'}
                            </p>
                        </div>
                    </div>
                    <div className="student-command-metrics">
                        <div>
                            <span>Sẵn sàng thi</span>
                            <strong>{readinessScore}/100</strong>
                        </div>
                        <div>
                            <span>Thế mạnh</span>
                            <strong>{strongestSubject?.subject || 'Đang cập nhật'}</strong>
                        </div>
                        <div>
                            <span>Cần chú ý</span>
                            <strong>{focusSubject?.subject || 'Chưa có dữ liệu'}</strong>
                        </div>
                        <div>
                            <span>Streak</span>
                            <strong>{stats.streak} ngày</strong>
                        </div>
                    </div>
                </div>
                <div className="student-command-side">
                    <div className="student-readiness-score">
                        <span className="student-readiness-label">Readiness</span>
                        <strong>{readinessScore}</strong>
                        <small>{bestResult ? `Best: ${bestResult.score}/${bestResult.total}` : 'Chưa có bài tốt nhất'}</small>
                    </div>
                    <div className="student-command-progress">
                        <div className="student-command-progress-head">
                            <span>Tiến độ lớp</span>
                            <strong>{completedExamCount}/{exams.length || 0} đề</strong>
                        </div>
                        <div className="student-progress-track large">
                            <div className="student-progress-fill" style={{ width: `${completionRate}%` }}></div>
                        </div>
                        <div className="student-command-streak">
                            <StreakBadge streak={stats.streak} size="lg" />
                        </div>
                    </div>
                </div>
            </div>

            {!isPreviewMode && (studentAccessState.locked || studentAccessState.expiryDate) && (
                <div className={`student-access-banner${studentAccessState.locked ? ' locked' : ''}`}>
                    <div className="student-access-banner-copy">
                        <strong><i className={`bi bi-${studentAccessState.locked ? 'shield-lock' : 'calendar-check'}`}></i> {studentAccessState.title}</strong>
                        <p>{studentAccessState.description}</p>
                    </div>
                    <span className={`stat-badge ${studentAccessState.locked ? 'warning' : 'info'}`}>{studentAccessState.shortLabel}</span>
                </div>
            )}

            <div className="stats-grid">
                <StatsCard icon="check2-circle" label="Bài đã làm" value={stats.totalQuizzes} sub={`${completedExamCount}/${exams.length || 0} đề hoàn thành`} color="primary" delay={0} />
                <StatsCard icon="graph-up-arrow" label="Trung bình" value={`${stats.avgPercent}%`} sub={bestResult ? `Cao nhất ${Math.round((bestResult.score / bestResult.total) * 100)}%` : 'Chưa có điểm cao nhất'} color={stats.avgPercent >= 60 ? 'success' : 'warm'} delay={1} />
                <StatsCard icon="trophy" label="Xếp hạng" value={myRank > 0 ? `#${myRank}` : '—'} sub={leaderboard.length > 0 ? `${leaderboard.length} học sinh trong lớp` : 'Chưa có BXH'} color="gold" delay={2} />
                <StatsCard icon="fire" label="Streak" value={`${stats.streak} ngày`} sub={averageTimeSpent > 0 ? `${formatDuration(averageTimeSpent)} / bài` : 'Đang chờ dữ liệu thời gian'} color="warm" delay={3} />
            </div>

            <div className="student-focus-band">
                {focusCards.map((card) => (
                    <div key={card.title} className={`student-focus-card ${card.tone}`}>
                        <div className="student-focus-icon"><i className={`bi bi-${card.icon}`}></i></div>
                        <div>
                            <small>{card.title}</small>
                            <strong>{card.value}</strong>
                            <p>{card.copy}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="student-premium-grid">
                <div className="premium-panel premium-panel-wide">
                    <div className="premium-panel-header">
                        <div>
                            <span className="premium-kicker">Tiến độ rõ ràng</span>
                            <h3>Bảng điều khiển học tập</h3>
                        </div>
                        <span className="premium-badge">{masteredExams} đề trên 80%</span>
                    </div>
                    <div className="student-progress-stack">
                        <div className="student-progress-row">
                            <span>Hoàn thành lộ trình</span>
                            <strong>{completionRate}%</strong>
                        </div>
                        <div className="student-progress-track"><div className="student-progress-fill" style={{ width: `${completionRate}%` }}></div></div>
                        <div className="student-progress-row">
                            <span>Nhóm làm tốt</span>
                            <strong>{masteredExams} đề</strong>
                        </div>
                        <div className="student-progress-track tone-success"><div className="student-progress-fill" style={{ width: `${exams.length ? (masteredExams / exams.length) * 100 : 0}%` }}></div></div>
                        <div className="student-progress-row">
                            <span>Cần ôn lại</span>
                            <strong>{reviewExams} đề</strong>
                        </div>
                        <div className="student-progress-track tone-warm"><div className="student-progress-fill" style={{ width: `${exams.length ? (reviewExams / exams.length) * 100 : 0}%` }}></div></div>
                    </div>
                    <div className="student-insight-grid">
                        <div className="student-insight-card">
                            <span>Đề chờ xử lý</span>
                            <strong>{pendingExams.length}</strong>
                            <small>{pendingExams[0]?.title || 'Đã hoàn tất toàn bộ'}</small>
                        </div>
                        <div className="student-insight-card">
                            <span>Thế mạnh</span>
                            <strong>{strongestSubject?.subject || '—'}</strong>
                            <small>{strongestSubject ? `${strongestSubject.avgPct}% trung bình` : 'Chưa có dữ liệu'}</small>
                        </div>
                        <div className="student-insight-card">
                            <span>Phong cách đề</span>
                            <strong>{experienceModeLabel}</strong>
                            <small>Dựa trên đề đang mở gần nhất</small>
                        </div>
                    </div>
                </div>

                <div className="premium-panel">
                    <div className="premium-panel-header compact">
                        <div>
                            <span className="premium-kicker">Lịch sử gần đây</span>
                            <h3>Nhịp thi gần nhất</h3>
                        </div>
                    </div>
                    {recentSessions.length === 0 ? (
                        <div className="premium-empty">Chưa có lượt thi nào để hiển thị nhịp học.</div>
                    ) : (
                        <div className="student-activity-list">
                            {recentSessions.map((session) => (
                                <div key={session.id} className="student-activity-item">
                                    <div className={`student-activity-dot ${getScoreColor(session.score, session.total)}`}></div>
                                    <div>
                                        <strong>{session.title}</strong>
                                        <p>{session.subject} · {session.pct}% · {session.completedAt ? new Date(session.completedAt.toDate()).toLocaleString('vi-VN') : '—'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="premium-panel">
                    <div className="premium-panel-header compact">
                        <div>
                            <span className="premium-kicker">Theo môn</span>
                            <h3>Chân dung hiệu suất</h3>
                        </div>
                    </div>
                    {subjectPerformance.length === 0 ? (
                        <div className="premium-empty">Làm ít nhất một bài để hệ thống vẽ hiệu suất theo môn.</div>
                    ) : (
                        <div className="subject-performance-list">
                            {subjectPerformance.slice(0, 4).map((subject) => (
                                <div key={subject.subject} className="subject-performance-item">
                                    <div className="subject-performance-head">
                                        <strong>{subject.subject}</strong>
                                        <span>{subject.avgPct}%</span>
                                    </div>
                                    <div className="student-progress-track slim">
                                        <div className="student-progress-fill" style={{ width: `${subject.avgPct}%` }}></div>
                                    </div>
                                    <small>{subject.attempts} lượt · tốt nhất {subject.bestPct}%</small>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="student-mission-grid">
                {missionCards.map((card) => (
                    <div key={card.title} className={`student-mission-card ${card.tone}`}>
                        <div className="student-mission-icon"><i className={`bi bi-${card.icon}`}></i></div>
                        <div>
                            <strong>{card.title}</strong>
                            <p>{card.body}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Join Live section */}
            {!isPreviewMode && (
                <div className="join-live-bar">
                    <div className="join-live-info">
                        <i className="bi bi-broadcast" style={{ fontSize: '1.4rem', color: 'var(--live-color, #f59e0b)' }}></i>
                        <div>
                            <strong>Tham gia phòng thi trực tiếp</strong>
                            <p>Nhập mã phòng từ giáo viên để vào live quiz</p>
                        </div>
                    </div>
                    <div className="join-live-form">
                        <input
                            type="text"
                            className="join-live-input"
                            placeholder="Mã phòng (VD: AB3K7M)"
                            value={joinCode}
                            onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleJoinLive()}
                            maxLength={8}
                            disabled={studentAccessState.locked}
                        />
                        <button className={`btn btn-live${studentAccessState.locked ? ' btn-disabled' : ''}`} onClick={handleJoinLive}>
                            <i className="bi bi-play-circle"></i> Vào phòng
                        </button>
                    </div>
                    {!studentAccessState.locked && <span className="join-live-status">Live quiz sẽ mở ngay khi mã phòng hợp lệ.</span>}
                    {joinError && <p className="join-live-error">{joinError}</p>}
                </div>
            )}

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
                        <div>
                            <div className="premium-tab-banner">
                                <div>
                                    <strong>{studentAccessState.locked ? 'Tạm khóa quyền vào thi' : pendingExams.length > 0 ? 'Lộ trình còn đang mở' : 'Kho đề đã hoàn tất'}</strong>
                                    <p>{studentAccessState.locked ? studentAccessState.cardNote : pendingExams.length > 0 ? `Bạn còn ${pendingExams.length} đề có thể bắt đầu hoặc thi lại. Hãy ưu tiên các đề có Arcade mode để có trải nghiệm trực quan hơn.` : 'Bạn có thể mở lại các đề đã làm để cải thiện thành tích hoặc so sánh kết quả.'}</p>
                                </div>
                                <span>{studentAccessState.locked ? studentAccessState.shortLabel : `${completionRate}% hoàn thành`}</span>
                            </div>
                            <div className="dashboard-grid">
                            {exams.map((exam, idx) => {
                                const result = myResults[exam.id];
                                const canRetake = !result || ((exam.maxAttempts || 1) > (result.attemptCount || 1));
                                const resultPath = result ? (isPreviewMode ? `/teacher/student/${activeStudentId}/preview/result/${result.id}` : `/student/result/${result.id}`) : null;
                                const quizPath = isPreviewMode ? `/teacher/student/${activeStudentId}/preview/quiz/${exam.id}` : `/student/quiz/${exam.id}`;
                                const gameMode = normalizeGamificationSettings(exam.gamification);
                                const actionLocked = !isPreviewMode && studentAccessState.locked;
                                return (
                                    <motion.div key={exam.id} className={`exam-card exam-card-student${actionLocked ? ' locked' : ''}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
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
                                        <div className="exam-tags" style={{ marginTop: 10 }}>
                                            <span className="exam-tag" style={{ background: gameMode.mode === 'arcade' ? '#ecfeff' : '#f8fafc', color: gameMode.mode === 'arcade' ? '#0f766e' : '#334155' }}>
                                                <i className={`bi bi-${gameMode.mode === 'arcade' ? 'controller' : 'journal-check'}`}></i> {getGamificationPresetLabel(gameMode)}
                                            </span>
                                            {gameMode.liveLeaderboard && (
                                                <span className="exam-tag" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                                                    <i className="bi bi-broadcast"></i> BXH tạm tính
                                                </span>
                                            )}
                                        </div>
                                        {exam.antiCheat?.enabled && (
                                            <div className="exam-tags" style={{ marginTop: 10 }}>
                                                <span className="exam-tag" style={{ background: '#ecfdf5', color: '#065f46' }}>
                                                    <i className="bi bi-shield-lock"></i> Chống gian lận
                                                </span>
                                                {exam.antiCheat?.requireFullscreen !== false && (
                                                    <span className="exam-tag" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                                                        <i className="bi bi-arrows-fullscreen"></i> Toàn màn hình
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {actionLocked && (
                                            <div className="exam-card-lock-note">
                                                <i className={`bi bi-${studentAccessState.code === 'expired' ? 'calendar-x' : 'lock'}`}></i> {studentAccessState.cardNote}
                                            </div>
                                        )}
                                        <div className="exam-actions">
                                            {isPreviewMode ? (
                                                <>
                                                    {resultPath && (
                                                        <Link to={resultPath} className="btn btn-sm btn-outline">
                                                            <i className="bi bi-eye"></i> Xem bài đã làm
                                                        </Link>
                                                    )}
                                                    <Link to={quizPath} className="btn btn-sm btn-primary">
                                                        <i className="bi bi-display"></i> Xem giao diện thi
                                                    </Link>
                                                </>
                                            ) : result ? (
                                                <>
                                                    <Link to={resultPath} className="btn btn-sm btn-outline">
                                                        <i className="bi bi-eye"></i> Xem lại
                                                    </Link>
                                                    {canRetake && !actionLocked && (
                                                        <Link to={quizPath} className="btn btn-sm btn-primary">
                                                            <i className="bi bi-arrow-repeat"></i> Thi lại
                                                        </Link>
                                                    )}
                                                    {canRetake && actionLocked && (
                                                        <button type="button" className="btn btn-sm btn-outline student-exam-action-disabled" disabled>
                                                            <i className={`bi bi-${studentAccessState.code === 'expired' ? 'calendar-x' : 'lock'}`}></i> Chưa thể thi lại
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                actionLocked ? (
                                                    <button type="button" className="btn btn-sm btn-outline student-exam-action-disabled" disabled>
                                                        <i className={`bi bi-${studentAccessState.code === 'expired' ? 'calendar-x' : 'lock'}`}></i> Chưa thể bắt đầu
                                                    </button>
                                                ) : (
                                                    <Link to={quizPath} className="btn btn-sm btn-success">
                                                        <i className="bi bi-play-fill"></i> Bắt đầu
                                                    </Link>
                                                )
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                            </div>
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
                                            const resultPath = isPreviewMode ? `/teacher/student/${activeStudentId}/preview/result/${s.id}` : `/student/result/${s.id}`;
                                            return (
                                                <tr key={s.id}>
                                                    <td>{idx + 1}</td>
                                                    <td style={{ fontWeight: 600 }}>{examInfo?.title || s.examId}</td>
                                                    <td>
                                                        <div style={{ display: 'grid', gap: 4 }}>
                                                            <span className={`stat-badge ${s.manualReviewPending && !(s.autoGradedTotal || 0) ? 'pending' : getScoreColor(s.score, s.total)}`}>{s.manualReviewPending && !(s.autoGradedTotal || 0) ? 'Chờ chấm' : `${s.score}/${s.total}`}</span>
                                                            {s.manualReviewPending && <small style={{ color: '#7c3aed' }}>Có phần tự luận chờ chấm tay</small>}
                                                        </div>
                                                    </td>
                                                    <td>{s.manualReviewPending && !(s.autoGradedTotal || 0) ? 'Chờ chấm' : `${pct}% ${getScoreEmoji(s.score, s.total)}`}</td>
                                                    <td><small style={{ color: 'var(--text-muted)' }}>{s.completedAt ? new Date(s.completedAt.toDate()).toLocaleString('vi-VN') : '—'}</small></td>
                                                    <td><Link to={resultPath} className="btn btn-sm btn-outline"><i className="bi bi-eye"></i></Link></td>
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
                <Leaderboard entries={leaderboard} currentUserId={activeStudentId} title="Bảng Xếp Hạng Tổng" />
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
