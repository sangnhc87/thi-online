import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { getScoreEmoji } from '../utils/formatters';
import Swal from 'sweetalert2';

export default function TeacherPortal() {
    const { slug } = useParams();
    const navigate = useNavigate();
    const { user, userProfile, signInWithGoogle, refreshProfile, logout } = useAuth();

    const [teacher, setTeacher] = useState(null);
    const [exams, setExams] = useState([]);
    const [myResults, setMyResults] = useState({});
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);

    const isJoined = userProfile?.teacherId === teacher?.uid;
    const isPending = userProfile?.pendingTeacherId === teacher?.uid;
    const isBlocked = userProfile?.blocked === true;
    const isExpired = isJoined && userProfile?.teacherExpiry && (() => {
        const d = userProfile.teacherExpiry.toDate ? userProfile.teacherExpiry.toDate() : new Date(userProfile.teacherExpiry);
        return d < new Date();
    })();
    const expiryLabel = isJoined && userProfile?.teacherExpiry ? (() => {
        const d = userProfile.teacherExpiry.toDate ? userProfile.teacherExpiry.toDate() : new Date(userProfile.teacherExpiry);
        const days = Math.ceil((d - Date.now()) / 86400000);
        if (days < 0) return null;
        if (days <= 30) return `Hạn còn ${days} ngày`;
        return `Hạn ${d.toLocaleDateString('vi-VN')}`;
    })() : null;
    const completedCount = Object.keys(myResults).length;
    const bestResult = Object.values(myResults).reduce((best, session) => {
        if (!best) return session;
        const bestPct = best.total ? best.score / best.total : 0;
        const currentPct = session.total ? session.score / session.total : 0;
        return currentPct > bestPct ? session : best;
    }, null);
    const bestResultPct = bestResult?.total ? Math.round((bestResult.score / bestResult.total) * 100) : null;
    const antiCheatCount = exams.filter((exam) => exam.antiCheat?.enabled).length;
    const liveModeCount = exams.filter((exam) => exam.gamification?.liveLeaderboard || exam.gamification?.mode === 'arcade').length;
    const heroStatus = isBlocked
        ? { tone: 'alert', icon: 'shield-lock', label: 'Tài khoản đang bị khóa' }
        : isExpired
            ? { tone: 'alert', icon: 'calendar-x', label: 'Cần gia hạn để tiếp tục thi' }
            : isJoined
                ? { tone: 'good', icon: 'patch-check', label: 'Đã kết nối với lớp học' }
                : isPending
                    ? { tone: 'warm', icon: 'hourglass-split', label: 'Yêu cầu tham gia đang chờ duyệt' }
                    : user
                        ? { tone: 'neutral', icon: 'door-open', label: 'Sẵn sàng tham gia lớp này' }
                        : { tone: 'neutral', icon: 'google', label: 'Đăng nhập để bắt đầu trong vài giây' };
    const storyCards = [
        {
            icon: 'shield-check',
            title: antiCheatCount > 0 ? `${antiCheatCount} đề có kiểm soát chống gian lận` : 'Luồng làm bài tập trung và rõ ràng',
            copy: antiCheatCount > 0
                ? 'Các bài quan trọng có thể bật toàn màn hình và cảnh báo chuyển tab để giữ chất lượng kiểm tra.'
                : 'Giáo viên đang ưu tiên trải nghiệm làm bài mạch lạc, dễ theo dõi và ít nhiễu cho học sinh.',
        },
        {
            icon: 'broadcast',
            title: liveModeCount > 0 ? `${liveModeCount} đề có nhịp live / arcade` : 'Sẵn sàng cho live quiz',
            copy: 'Từ học trên lớp đến ôn tập nhanh, giao diện này được tối ưu để vào đề và theo dõi trạng thái rất nhanh.',
        },
        {
            icon: 'bar-chart-line',
            title: completedCount > 0 ? `Bạn đã hoàn thành ${completedCount} đề` : 'Kết quả sẽ được lưu và xem lại',
            copy: completedCount > 0
                ? `Bài tốt nhất hiện tại của bạn là ${bestResultPct}%${expiryLabel ? ` và ${expiryLabel.toLowerCase()}` : ''}.`
                : 'Sau mỗi bài thi, bạn có thể xem lại chi tiết để ôn tập và cải thiện lần tiếp theo.',
        },
    ];

    const loadTeacher = useCallback(async () => {
        const q = query(collection(db, 'users'), where('teacherSlug', '==', slug));
        const snap = await getDocs(q);
        if (snap.empty) { setLoading(false); return; }

        const teacherData = { uid: snap.docs[0].id, ...snap.docs[0].data() };
        setTeacher(teacherData);

        const examQ = query(
            collection(db, 'exams'),
            where('teacherId', '==', teacherData.uid),
            where('status', '==', 'active'),
            orderBy('createdAt', 'desc')
        );
        const examSnap = await getDocs(examQ);
        setExams(examSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
    }, [slug]);

    const loadMyResults = useCallback(async () => {
        if (!user?.uid) return;
        const sessionQ = query(collection(db, 'sessions'), where('studentId', '==', user.uid));
        const sessionSnap = await getDocs(sessionQ);
        const results = {};
        sessionSnap.docs.forEach(d => {
            const data = { id: d.id, ...d.data() };
            if (!results[data.examId] || data.score > results[data.examId].score) {
                results[data.examId] = data;
            }
        });
        setMyResults(results);
    }, [user?.uid]);

    useEffect(() => { loadTeacher(); }, [loadTeacher]);
    useEffect(() => {
        if (user && teacher && isJoined) loadMyResults();
    }, [isJoined, loadMyResults, teacher, user]);

    const handleJoin = async () => {
        if (!user) {
            try { await signInWithGoogle(); return; } catch { return; }
        }
        if (userProfile?.role === 'teacher' || userProfile?.role === 'admin') {
            Swal.fire('Thông báo', 'Tài khoản giáo viên/admin không tham gia lớp được.', 'info');
            return;
        }
        setJoining(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                pendingTeacherId: teacher.uid,
                pendingTeacherName: teacher.displayName,
            });
            await refreshProfile();
            Swal.fire({ icon: 'info', title: 'Đã gửi yêu cầu!', text: 'Chờ giáo viên duyệt. Khi được duyệt bạn có thể bắt đầu thi.', timer: 3000, showConfirmButton: false });
        } catch {
            Swal.fire('Lỗi', 'Không thể tham gia. Thử lại.', 'error');
        } finally { setJoining(false); }
    };

    const handleStartQuiz = (examId) => {
        if (!user) {
            Swal.fire({
                title: 'Đăng nhập để thi',
                text: 'Bạn cần đăng nhập Google trước.',
                icon: 'info',
                showCancelButton: true,
                confirmButtonText: 'Đăng nhập',
                cancelButtonText: 'Hủy',
            }).then(async (r) => { if (r.isConfirmed) await signInWithGoogle(); });
            return;
        }
        if (isBlocked) {
            Swal.fire('Bị khóa', 'Tài khoản của bạn đã bị giáo viên khóa.', 'error');
            return;
        }
        if (isExpired) {
            Swal.fire('Hết hạn', 'Thời hạn tham gia lớp đã hết. Liên hệ giáo viên để gia hạn.', 'warning');
            return;
        }
        if (isPending) {
            Swal.fire('Đang chờ duyệt', 'Yêu cầu tham gia lớp của bạn đang chờ giáo viên phê duyệt.', 'info');
            return;
        }
        if (!isJoined && userProfile?.role === 'student') {
            handleJoin().then(() => navigate(`/student/quiz/${examId}`));
            return;
        }
        navigate(`/student/quiz/${examId}`);
    };

    const handleLogout = async () => {
        await logout();
        window.location.reload();
    };

    if (loading) return (
        <div className="portal-loading">
            <div className="portal-loading-inner">
                <div className="spinner"></div>
                <p>Đang tải lớp học...</p>
            </div>
        </div>
    );

    if (!teacher) {
        return (
            <div className="portal-wrap">
                <div className="portal-not-found">
                    <i className="bi bi-person-x"></i>
                    <h2>Không tìm thấy lớp học</h2>
                    <p>Đường dẫn <code>/t/{slug}</code> không tồn tại.</p>
                    <Link to="/login" className="btn btn-primary" style={{ marginTop: 16 }}>Về trang chủ</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="portal-wrap">
            {/* ── HERO BANNER ── */}
            <motion.div className="portal-hero" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                {/* blurred circles decoration */}
                <div className="portal-hero-blob portal-hero-blob--1" />
                <div className="portal-hero-blob portal-hero-blob--2" />

                <div className="portal-hero-panel">
                    <div className="portal-hero-copy">
                        <div className="portal-hero-topline">
                            <span className="portal-kicker">Teacher Showcase</span>
                            <span className={`portal-status-chip ${heroStatus.tone}`}>
                                <i className={`bi bi-${heroStatus.icon}`}></i> {heroStatus.label}
                            </span>
                        </div>

                        <div className="portal-hero-title-row">
                            <div className="portal-avatar-ring">
                                {teacher.photoURL
                                    ? <img src={teacher.photoURL} alt="" className="portal-avatar" referrerPolicy="no-referrer" />
                                    : <div className="portal-avatar-fallback">{(teacher.displayName || '?')[0].toUpperCase()}</div>
                                }
                            </div>

                            <div className="portal-hero-copy-block">
                                <h1 className="portal-teacher-name">{teacher.displayName}</h1>
                                <p className="portal-hero-subtitle">
                                    Lớp thi trực tuyến với giao diện tập trung, vào bài nhanh, kết quả rõ và đủ nghiêm túc cho những buổi kiểm tra cần chất lượng.
                                </p>
                                {teacher.schoolName && (
                                    <p className="portal-school"><i className="bi bi-building"></i> {teacher.schoolName}</p>
                                )}
                            </div>
                        </div>

                        <div className="portal-hero-chips">
                            <span className="portal-hero-chip"><i className="bi bi-journal-richtext"></i> {exams.length} đề đang mở</span>
                            <span className="portal-hero-chip"><i className="bi bi-check2-circle"></i> {completedCount || '0'} đề đã hoàn thành</span>
                            <span className="portal-hero-chip"><i className="bi bi-shield-lock"></i> {antiCheatCount} đề anti-cheat</span>
                            <span className="portal-hero-chip"><i className="bi bi-broadcast"></i> {liveModeCount} đề thiên hướng live / arcade</span>
                        </div>

                        <div className="portal-hero-actions">
                            {user ? (
                                <>
                                    {isBlocked ? (
                                        <div className="portal-blocked-badge">
                                            <i className="bi bi-lock-fill"></i> Tài khoản bị khóa
                                        </div>
                                    ) : isJoined ? (
                                        isExpired ? (
                                            <div className="portal-blocked-badge">
                                                <i className="bi bi-clock-history"></i> Hết hạn tham gia lớp
                                            </div>
                                        ) : (
                                            <div className="portal-joined-badge">
                                                <i className="bi bi-check-circle-fill"></i> Đã tham gia lớp
                                                {expiryLabel && <span style={{ fontSize: '0.75rem', opacity: 0.85, marginLeft: 4 }}>· {expiryLabel}</span>}
                                            </div>
                                        )
                                    ) : isPending ? (
                                        <div className="portal-pending-badge">
                                            <i className="bi bi-hourglass-split"></i> Đang chờ giáo viên duyệt...
                                        </div>
                                    ) : userProfile?.role === 'student' ? (
                                        <button className="portal-join-btn" onClick={handleJoin} disabled={joining}>
                                            {joining
                                                ? <><div className="spinner-sm"></div> Đang xử lý...</>
                                                : <><i className="bi bi-person-plus-fill"></i> Tham gia lớp</>}
                                        </button>
                                    ) : null}

                                    <div className="portal-user-chip">
                                        {userProfile?.photoURL && (
                                            <img src={userProfile.photoURL} alt="" className="portal-user-chip-avatar" referrerPolicy="no-referrer" />
                                        )}
                                        <span>{userProfile?.displayName}</span>
                                        <button className="portal-switch-btn" onClick={handleLogout}>Đổi TK</button>
                                    </div>
                                </>
                            ) : (
                                <button className="portal-join-btn" onClick={signInWithGoogle}>
                                    <i className="bi bi-google"></i> Đăng nhập để tham gia
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="portal-hero-aside">
                        <div className="portal-hero-metric-grid">
                            <div>
                                <span>Đề đang mở</span>
                                <strong>{exams.length}</strong>
                                <small>Sẵn sàng bắt đầu ngay</small>
                            </div>
                            <div>
                                <span>Đã hoàn thành</span>
                                <strong>{completedCount || '—'}</strong>
                                <small>{completedCount ? 'Tiến độ của bạn trong lớp' : 'Chưa có lượt làm nào'}</small>
                            </div>
                            <div>
                                <span>Best result</span>
                                <strong>{bestResultPct !== null ? `${bestResultPct}%` : '—'}</strong>
                                <small>{bestResult ? `${bestResult.score}/${bestResult.total}` : 'Sẽ hiện sau bài đầu tiên'}</small>
                            </div>
                            <div>
                                <span>Trạng thái lớp</span>
                                <strong>{expiryLabel || (isPending ? 'Chờ duyệt' : isJoined ? 'Đang học' : 'Khách mời')}</strong>
                                <small>{heroStatus.label}</small>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* ── EXAM LIST ── */}
            <div className="portal-body">
                <div className="portal-story-strip">
                    {storyCards.map((card) => (
                        <div key={card.title} className="portal-story-card">
                            <div className="portal-story-icon"><i className={`bi bi-${card.icon}`}></i></div>
                            <div>
                                <strong>{card.title}</strong>
                                <p>{card.copy}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {isBlocked || isExpired ? (
                    <div className="portal-empty">
                        <i className="bi bi-lock" style={{ fontSize: '2.5rem', color: '#ef4444' }}></i>
                        <p>{isExpired
                            ? 'Thời hạn tham gia lớp đã hết.\nLiên hệ giáo viên để được gia hạn.'
                            : 'Tài khoản của bạn đã bị giáo viên khóa.\nLiên hệ giáo viên để được mở khóa.'}
                        </p>
                    </div>
                ) : exams.length === 0 ? (
                    <div className="portal-empty">
                        <i className="bi bi-journal-x" style={{ fontSize: '2.5rem', color: 'var(--text-muted)' }}></i>
                        <p>Giáo viên chưa mở đề thi nào.</p>
                    </div>
                ) : (
                    <>
                        <div className="portal-section-toolbar">
                            <div>
                                <div className="portal-section-title">
                                    <i className="bi bi-collection-fill"></i> Đề thi đang mở
                                    <span className="portal-section-count">{exams.length}</span>
                                </div>
                                <p className="portal-section-copy">
                                    Chọn một đề phù hợp để bắt đầu nhanh. Khi hoàn thành, kết quả sẽ được lưu lại để xem lại và cải thiện ở các lần sau.
                                </p>
                            </div>
                            <div className="portal-section-pills">
                                <span className="portal-section-pill"><i className="bi bi-lightning-charge"></i> Vào đề nhanh</span>
                                <span className="portal-section-pill"><i className="bi bi-journal-check"></i> Xem lại sau khi thi</span>
                            </div>
                        </div>
                        <div className="portal-exam-grid">
                            {exams.map((exam, idx) => {
                                const result = myResults[exam.id];
                                const pct = result ? Math.round(result.score / (result.total || 1) * 100) : null;
                                const scoreColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
                                return (
                                    <motion.div
                                        key={exam.id}
                                        className={`portal-exam-card ${result ? 'portal-exam-card--done' : ''}`}
                                        initial={{ opacity: 0, y: 24 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.06 }}
                                    >
                                        {/* top accent */}
                                        <div className="portal-exam-top" />

                                        {/* score badge if done */}
                                        {result && (
                                            <div className="portal-score-badge" style={{ background: scoreColor }}>
                                                {getScoreEmoji(result.score, result.total)} {result.score}/{result.total}
                                            </div>
                                        )}

                                        <div className="portal-exam-body">
                                            <div className="portal-exam-title">{exam.title}</div>

                                            {(exam.subject || exam.grade) && (
                                                <div className="portal-exam-tags">
                                                    {exam.subject && <span className="portal-exam-tag">{exam.subject}</span>}
                                                    {exam.grade && <span className="portal-exam-tag portal-exam-tag--grade">{exam.grade}</span>}
                                                </div>
                                            )}

                                            <div className="portal-exam-meta">
                                                <span><i className="bi bi-question-circle-fill"></i> {exam.questionCount || 0} câu</span>
                                                <span><i className="bi bi-clock-fill"></i> {exam.duration || 0} phút</span>
                                            </div>

                                            {/* progress bar if done */}
                                            {result && (
                                                <div className="portal-progress-bar">
                                                    <div className="portal-progress-fill" style={{ width: `${pct}%`, background: scoreColor }} />
                                                </div>
                                            )}
                                        </div>

                        <div className="portal-exam-footer">
                                            {isPending || isExpired ? (
                                                <div style={{ flex:1, textAlign:'center', fontSize:'0.82rem', color: isExpired ? '#ef4444' : '#d97706', fontWeight:600, padding:'4px 0' }}>
                                                    {isExpired
                                                        ? <><i className="bi bi-clock-history"></i> Hết hạn</>  
                                                        : <><i className="bi bi-hourglass-split"></i> Chờ giáo viên duyệt</>}
                                                </div>
                                            ) : result ? (
                                                <>
                                                    <Link to={`/student/result/${result.id}`} className="portal-exam-btn portal-exam-btn--outline">
                                                        <i className="bi bi-eye-fill"></i> Xem lại
                                                    </Link>
                                                    <button className="portal-exam-btn portal-exam-btn--retry" onClick={() => handleStartQuiz(exam.id)}>
                                                        <i className="bi bi-arrow-repeat"></i> Thi lại
                                                    </button>
                                                </>
                                            ) : (
                                                <button className="portal-exam-btn portal-exam-btn--start" onClick={() => handleStartQuiz(exam.id)}>
                                                    <i className="bi bi-play-circle-fill"></i> Bắt đầu thi
                                                </button>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* Guest CTA */}
                {!user && (
                    <motion.div className="portal-guest-cta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                        <i className="bi bi-google" style={{ fontSize: '1.6rem', color: '#4285f4' }}></i>
                        <div>
                            <p style={{ margin: 0, fontWeight: 700 }}>Đăng nhập để bắt đầu thi</p>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Dùng tài khoản Google của bạn</p>
                        </div>
                        <button className="portal-join-btn" style={{ flexShrink: 0 }} onClick={signInWithGoogle}>Đăng nhập</button>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
