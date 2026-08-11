import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { signInAnonymously, updateProfile } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { renderLatexContent as renderLatex } from '../utils/math';
import { stripQuestionNumberPrefix } from '../utils/examSections';
import {
    buildMillionaireLadder,
    formatMillionairePrize,
    isLiveAnswerCorrect,
    sortLiveLeaderboard,
} from '../utils/liveMillionaire';

function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// Kahoot-style choice palette: color, dark shade, icon
const KAHOOT = [
    { bg: '#e21b3c', dark: '#a31527', icon: '▲' },
    { bg: '#1368ce', dark: '#0d4e9d', icon: '◆' },
    { bg: '#d89e00', dark: '#9a7200', icon: '●' },
    { bg: '#26890c', dark: '#1a5d08', icon: '■' },
    { bg: '#8b5cf6', dark: '#6d28d9', icon: '★' },
    { bg: '#06b6d4', dark: '#0891b2', icon: '⬟' },
];

function Confetti() {
    const colors = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#8b5cf6', '#fff'];
    return (
        <div className="ks-confetti-wrap" aria-hidden="true">
            {Array.from({ length: 30 }).map((_, i) => (
                <div key={i} className="ks-confetti-piece" style={{
                    left: `${(i * 3.4) % 100}%`,
                    background: colors[i % colors.length],
                    animationDelay: `${(i * 0.05) % 0.6}s`,
                    animationDuration: `${0.7 + (i % 5) * 0.15}s`,
                    width: i % 3 === 0 ? 10 : 7,
                    height: i % 2 === 0 ? 14 : 10,
                    borderRadius: i % 2 === 0 ? '50%' : 2,
                }} />
            ))}
        </div>
    );
}

function formatStudentScore(score, mode, includeUnit = false) {
    if (mode === 'millionaire') return formatMillionairePrize(score || 0);
    const value = Number(score || 0).toLocaleString('vi-VN');
    return includeUnit ? `${value} điểm` : value;
}

export default function LiveStudentPage() {
    const { code } = useParams();
    const navigate = useNavigate();
    const { user, userProfile, loading: authLoading } = useAuth();
    const roomCode = code?.toUpperCase();

    const [room, setRoom] = useState(null);
    const [phase, setPhase] = useState(() => (roomCode ? 'loading' : 'notfound'));
    const [isEliminated, setIsEliminated] = useState(false);
    const [myAnswer, setMyAnswer] = useState(null);
    const [answered, setAnswered] = useState(false);
    const [timeLeft, setTimeLeft] = useState(0);
    const [lastCorrect, setLastCorrect] = useState(null);
    const [lastPoints, setLastPoints] = useState(0);
    const [showPointsAnim, setShowPointsAnim] = useState(false);
    const [localCountdown, setLocalCountdown] = useState(0);
    const [shortAnswerText, setShortAnswerText] = useState('');
    const [guestName, setGuestName] = useState('');
    const [guestLoading, setGuestLoading] = useState(false);

    const timerRef = useRef(null);
    const countdownRef = useRef(null);
    const unsubRef = useRef(null);
    const prevQIdxRef = useRef(-1);
    const prevPhaseRef = useRef('loading');
    const prevScoreRef = useRef(0);

    const uid = user?.uid;

    const joinRoom = useCallback(async (roomData) => {
        if (!uid || !roomCode) return;
        if (roomData.participants?.[uid]) return;
        const name = userProfile?.displayName || user?.displayName || user?.email || 'Học sinh';
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            [`participants.${uid}`]: {
                name,
                photoURL: userProfile?.photoURL || user?.photoURL || null,
                joinedAt: serverTimestamp(),
            },
        });
    }, [uid, roomCode, userProfile, user]);

    useEffect(() => {
        if (authLoading || !uid || !roomCode) return;

        unsubRef.current = onSnapshot(doc(db, 'liveRooms', roomCode), async (snap) => {
            if (!snap.exists()) { setPhase('notfound'); return; }
            const data = snap.data();

            if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
                setPhase('notfound'); return;
            }

            if (!data.participants?.[uid]) await joinRoom(data);

            setRoom(data);

            const newQIdx = data.currentQIdx;
            const qChanged = newQIdx !== prevQIdxRef.current;
            if (qChanged) {
                prevQIdxRef.current = newQIdx;
                setMyAnswer(null);
                setAnswered(false);
                setLastCorrect(null);
                setShortAnswerText('');
                setShowPointsAnim(false);
            }

            if (data.status === 'question' && data.questionStartAt) {
                const elapsed = Math.floor((Date.now() - data.questionStartAt.toMillis()) / 1000);
                const remaining = Math.max(0, (data.questionDuration || 30) - elapsed);
                setTimeLeft(remaining);
                if (timerRef.current) clearInterval(timerRef.current);
                timerRef.current = setInterval(() => {
                    setTimeLeft(t => { if (t <= 1) { clearInterval(timerRef.current); return 0; } return t - 1; });
                }, 1000);
                // Local 3-2-1 countdown when question just revealed
                if (qChanged && elapsed < 3) {
                    const start = 3 - elapsed;
                    setLocalCountdown(start);
                    if (countdownRef.current) clearInterval(countdownRef.current);
                    countdownRef.current = setInterval(() => {
                        setLocalCountdown(c => {
                            if (c <= 1) { clearInterval(countdownRef.current); return 0; }
                            return c - 1;
                        });
                    }, 1000);
                } else {
                    setLocalCountdown(0);
                }
            } else {
                if (timerRef.current) clearInterval(timerRef.current);
                if (countdownRef.current) clearInterval(countdownRef.current);
                setLocalCountdown(0);
            }

            // Score change detection on reveal
            if (data.status === 'reveal' && prevPhaseRef.current !== 'reveal') {
                const q = data.questions?.[data.currentQIdx];
                const revealedAnswer = data.revealedCorrectAnswers?.[data.currentQIdx];
                const qWithAnswer = q && revealedAnswer !== undefined ? { ...q, correct_answer: revealedAnswer } : q;
                const myAns = data.answers?.[data.currentQIdx]?.[uid];
                const correct = myAns && qWithAnswer?.correct_answer != null ? isLiveAnswerCorrect(qWithAnswer, myAns) : false;
                setLastCorrect(myAns ? correct : null);
                const newScore = data.scores?.[uid]?.score || 0;
                const gained = newScore - prevScoreRef.current;
                if (gained > 0 && correct) {
                    setLastPoints(gained);
                    setShowPointsAnim(true);
                    setTimeout(() => setShowPointsAnim(false), 2200);
                }
                prevScoreRef.current = newScore;
            }

            prevPhaseRef.current = data.status;

            // Track elimination separately – student continues watching as spectator
            if (data.eliminated?.includes(uid)) setIsEliminated(true);
            setPhase(data.status);
        });

        return () => {
            if (unsubRef.current) unsubRef.current();
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
        };
    }, [authLoading, uid, roomCode, joinRoom]);

    const submitAnswer = async (answer) => {
        if (answered || !uid || !room || isEliminated) return;
        setMyAnswer(answer);
        setAnswered(true);
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            [`answers.${room.currentQIdx}.${uid}`]: { answer, answeredAt: serverTimestamp() },
        });
    };

    const submitReadyCheck = async () => {
        if (!uid || !room) return;
        await updateDoc(doc(db, 'liveRooms', roomCode), {
            [`readyChecks.${uid}`]: {
                ready: true,
                at: serverTimestamp(),
            },
        });
    };

    const currentQ = room && room.currentQIdx >= 0 ? room.questions?.[room.currentQIdx] : null;
    const liveMode = room?.mode || 'classic';
    const isMillionaireMode = liveMode === 'millionaire';
    const myScore = room?.scores?.[uid]?.score || 0;
    const myCorrect = room?.scores?.[uid]?.correct || 0;
    const myStreak = room?.scores?.[uid]?.streak || 0;
    const myLevel = room?.scores?.[uid]?.level || 0;
    const mySafePrize = room?.scores?.[uid]?.safePrize || 0;
    const mySafeLevel = room?.scores?.[uid]?.safeLevel || 0;
    const totalQ = room?.questions?.length || 0;
    const millionaireLadder = room?.millionaire?.ladder?.length
        ? room.millionaire.ladder
        : buildMillionaireLadder(totalQ);
    const currentMillionaireStep = room && room.currentQIdx >= 0 ? millionaireLadder[room.currentQIdx] : null;
    const currentAudiencePoll = room?.lifelines?.audience?.[room?.currentQIdx] || null;
    const currentExpertHint = room?.lifelines?.expert?.[room?.currentQIdx] || null;
    const usedLifelines = room?.lifelines?.used || {};
    const readyCount = Object.values(room?.readyChecks || {}).filter((item) => item?.ready).length;
    const isReady = Boolean(room?.readyChecks?.[uid]?.ready);
    const sortedLb = room
        ? sortLiveLeaderboard(Object.entries(room.scores || {})
            .map(([u, d]) => ({ uid: u, name: room.participants?.[u]?.name || 'HS', score: d.score || 0, elim: room.eliminated?.includes(u) }))
            .map(({ uid: playerUid, name, score, elim }) => ({
                uid: playerUid,
                name,
                score,
                level: room.scores?.[playerUid]?.level || 0,
                safePrize: room.scores?.[playerUid]?.safePrize || 0,
                lastCorrectAtMs: room.scores?.[playerUid]?.lastCorrectAtMs || 0,
                eliminated: elim,
            })), liveMode)
        : [];
    const topThree = sortedLb.slice(0, 3);
    const myRank = sortedLb.findIndex(e => e.uid === uid) + 1;
    const timePct = room ? Math.round((timeLeft / (room.questionDuration || 30)) * 100) : 100;

    if (authLoading || phase === 'loading') return <div className="loading-screen"><div className="spinner"></div></div>;

    if (!user) {
        const handleGuestJoin = async () => {
            const name = guestName.trim();
            if (!name) return;
            setGuestLoading(true);
            try {
                const result = await signInAnonymously(auth);
                await updateProfile(result.user, { displayName: name });
            } catch (error) {
                console.error('guest join failed', error);
            } finally {
                setGuestLoading(false);
            }
        };
        return (
            <div className="ks-page ks-lobby-bg">
                <div className="ks-center-card">
                    <div className="ks-big-emoji">🎓</div>
                    <h2>Tham gia phòng <strong>{roomCode}</strong></h2>
                    <p>Nhập tên để tham gia không cần đăng nhập</p>
                    <input
                        className="ks-sa-input"
                        placeholder="Tên của bạn..."
                        value={guestName}
                        onChange={e => setGuestName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleGuestJoin(); }}
                        maxLength={40}
                        autoFocus
                        style={{ marginBottom: 12 }}
                    />
                    <button className="ks-btn-primary" onClick={handleGuestJoin} disabled={!guestName.trim() || guestLoading}>
                        {guestLoading ? 'Đang vào...' : 'Vào phòng →'}
                    </button>
                    <p style={{ marginTop: 16, opacity: 0.6, fontSize: 13 }}>
                        Đã có tài khoản?{' '}
                        <button className="ks-btn-outline" style={{ fontSize: 13, padding: '2px 10px' }} onClick={() => navigate('/login')}>Đăng nhập</button>
                    </p>
                </div>
            </div>
        );
    }

    if (phase === 'notfound') {
        return (
            <div className="ks-page ks-lobby-bg">
                <div className="ks-center-card">
                    <div className="ks-big-emoji">🚪</div>
                    <h2>Không tìm thấy phòng</h2>
                    <p>Mã phòng <strong>{roomCode}</strong> không tồn tại hoặc đã hết hạn.</p>
                    <button className="ks-btn-outline" onClick={() => navigate('/student')}>Về trang chính</button>
                </div>
            </div>
        );
    }

    // ── LOBBY ──
    if (phase === 'lobby' && room) {
        return (
            <div className="ks-page ks-lobby-bg">
                <motion.div className="ks-center-card ks-lobby-card"
                    initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                    <motion.div className="ks-big-emoji"
                        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}>
                        ✅
                    </motion.div>
                    <h2>Đã vào phòng!</h2>
                    <p className="ks-exam-title">{room.examTitle}</p>
                    <div className="ks-mode-pill">
                        {room.mode === 'golden_bell' ? '🔔 Rung chuông vàng' :
                            room.mode === 'speed' ? '⚡ Đua tốc độ' :
                            room.mode === 'millionaire' ? '🏆 Ai là triệu phú' :
                            room.mode === 'presentation' ? '📖 Trình chiếu / Ôn tập' :
                            '▶ Classic Live'}
                    </div>
                    {room.mode === 'golden_bell' && (
                        <div className="ks-danger-rule">⚠️ Trả lời sai <strong>1 câu</strong> là bị loại ngay!</div>
                    )}
                    {room.mode === 'millionaire' && (
                        <>
                            <div className="ks-danger-rule">🏆 Sai 1 câu bị loại! Hãy suy nghĩ kỹ trước khi khóa đáp án.</div>
                            <div className="ks-millionaire-lobby-card">
                                <div className="ks-millionaire-lobby-top">
                                    <span>Top prize</span>
                                    <strong>{formatMillionairePrize(millionaireLadder.at(-1)?.amount || 0)}</strong>
                                </div>
                                <div className="ks-millionaire-lobby-tags">
                                    {millionaireLadder.filter((step) => step.isCheckpoint).map((step) => (
                                        <span key={step.level}>Mốc an toàn {step.level}</span>
                                    ))}
                                    <span>3 lifeline cho cả phòng</span>
                                    <span>Xếp hạng realtime</span>
                                </div>
                            </div>
                        </>
                    )}
                    {room.mode === 'speed' && (
                        <div className="ks-info-rule">⚡ Trả lời <strong>càng nhanh</strong> được <strong>càng nhiều điểm!</strong></div>
                    )}
                    {room.mode === 'presentation' && (
                        <div className="ks-info-rule">📖 Chế độ ôn tập — không chấm điểm, xem câu hỏi cùng thầy cô.</div>
                    )}
                    <div className="ks-waiting-wrap">
                        <div className="ks-dot-loader"><span /><span /><span /></div>
                        <p>Chờ giáo viên bắt đầu...</p>
                        <div className="ks-count-pill">{Object.keys(room.participants || {}).length} học sinh đã vào</div>
                    </div>
                </motion.div>
            </div>
        );
    }

    if (phase === 'ready_check' && room) {
        return (
            <div className={`ks-page ks-lobby-bg${isMillionaireMode ? ' ks-millionaire-ready-bg' : ''}`}>
                <motion.div className="ks-center-card ks-ready-card"
                    initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                    <div className="ks-big-emoji">{isReady ? '🚦' : '🎯'}</div>
                    <h2>{isReady ? 'Đã sẵn sàng!' : 'Ready check trước giờ lên sóng'}</h2>
                    <p className="ks-exam-title">{room.examTitle}</p>
                    <div className="ks-mode-pill">{isMillionaireMode ? '💎 Millionaire stage check' : '🧪 Kiểm tra thiết bị & độ sẵn sàng'}</div>

                    <div className="ks-ready-metrics">
                        <span><strong>{readyCount}</strong> / {Object.keys(room.participants || {}).length} học sinh đã xác nhận</span>
                        <span>{isReady ? 'Bạn đã khóa trạng thái ready' : 'Nhấn nút bên dưới khi đã sẵn sàng vào câu 1'}</span>
                    </div>

                    <div className="ks-ready-grid">
                        {Object.entries(room.participants || {}).map(([participantUid, participant]) => {
                            const participantReady = Boolean(room.readyChecks?.[participantUid]?.ready);
                            return (
                                <div key={participantUid} className={`ks-ready-chip${participantReady ? ' ready' : ''}${participantUid === uid ? ' mine' : ''}`}>
                                    <strong>{participant.name}{participantUid === uid ? ' (bạn)' : ''}</strong>
                                    <span>{participantReady ? 'READY' : 'WAITING'}</span>
                                </div>
                            );
                        })}
                    </div>

                    {!isReady ? (
                        <button className="ks-btn-primary" onClick={submitReadyCheck}>
                            <i className="bi bi-check2-circle"></i> Tôi đã sẵn sàng
                        </button>
                    ) : (
                        <div className="ks-answered-badge ready-check">
                            ✓ Bạn đã xác nhận. Chờ giáo viên đưa cả phòng vào câu đầu tiên...
                        </div>
                    )}
                </motion.div>
            </div>
        );
    }

    // ── ELIMINATED SPECTATOR ──
    // Eliminated students now follow the game as spectators (banner shown below)
    // The actual game phase renders below with a spectator overlay

    // ── QUESTION ──
    if ((phase === 'question' || (isEliminated && phase === 'question')) && currentQ) {
        const showCd = localCountdown > 0;
        return (
            <div className={`ks-page ks-question-bg${isMillionaireMode ? ' ks-millionaire-question-bg' : ''}`}>
                {/* Top HUD */}
                <div className={`ks-top-bar${isMillionaireMode ? ' millionaire' : ''}`}>
                    <span className="ks-q-label">Câu {(room.currentQIdx || 0) + 1} / {totalQ}</span>
                    <div className={`ks-timer-ring ${timeLeft <= 5 ? 'urgent' : timeLeft <= 10 ? 'warn' : ''}`}>
                        <svg viewBox="0 0 44 44" className="ks-timer-svg">
                            <circle cx="22" cy="22" r="18" className="ks-timer-track" />
                            <circle cx="22" cy="22" r="18" className="ks-timer-fill"
                                style={{ strokeDashoffset: 113.1 * (1 - timePct / 100) }} />
                        </svg>
                        <span className="ks-timer-num">{timeLeft}</span>
                    </div>
                    <span className="ks-score-top">{formatStudentScore(myScore, liveMode)}</span>
                </div>

                {isMillionaireMode && (
                    <div className="ks-millionaire-hud">
                        <div className="ks-millionaire-hud-pill">
                            <span>Mốc hiện tại</span>
                            <strong>{currentMillionaireStep?.label || 'Đang chờ'}</strong>
                        </div>
                        <div className="ks-millionaire-hud-pill">
                            <span>An toàn</span>
                            <strong>{mySafePrize ? formatMillionairePrize(mySafePrize) : '0 đ'}</strong>
                        </div>
                        <div className="ks-millionaire-hud-pill">
                            <span>Xếp hạng</span>
                            <strong>{myRank > 0 ? `#${myRank}` : '--'}</strong>
                        </div>
                    </div>
                )}

                {/* Spectator banner for eliminated students */}
                {isEliminated && (
                    <div className="ks-spectator-banner">
                        👀 Bạn đã bị loại — đang xem tiếp với tư cách khán giả
                    </div>
                )}

                {/* Progress bar */}
                <div className="ks-time-bar-wrap">
                    <div className="ks-time-bar-fill" style={{
                        width: `${timePct}%`,
                        background: timeLeft <= 5 ? '#ef4444' : timeLeft <= 10 ? '#f59e0b' : '#22c55e',
                    }} />
                </div>

                {/* Countdown overlay */}
                <AnimatePresence>
                    {showCd && (
                        <motion.div className="ks-countdown-overlay"
                            key={`cd-${localCountdown}`}
                            initial={{ scale: 1.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.6, opacity: 0 }}
                            transition={{ duration: 0.3 }}>
                            {localCountdown}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Question text */}
                <div className="ks-q-card">
                    {currentQ?.deliverySection?.isSectionStart && (currentQ?.deliverySection?.hasSections || currentQ?.deliverySection?.contextHtml || currentQ?.deliverySection?.contextText) && (
                        <div className="section-context-card preview-mode" style={{ marginBottom: 12 }}>
                            <div className="section-context-head">
                                <strong>{currentQ.deliverySection.title || 'Phần câu hỏi'}</strong>
                                {currentQ.deliverySection.tag && <span className="stat-badge muted">{currentQ.deliverySection.tag}</span>}
                            </div>
                            {currentQ.deliverySection.contextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(currentQ.deliverySection.contextHtml) }} />}
                        </div>
                    )}
                    <div className="ks-q-text"
                        dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(currentQ.content_html || escHtml(currentQ.content_text), currentQ, room?.currentQIdx || 0)) }} />
                </div>

                {isMillionaireMode && !showCd && (
                    <div className="ks-millionaire-stage-panel">
                        <div className="ks-millionaire-lifeline-strip">
                            <span className={usedLifelines.ff ? 'used' : ''}><i className="bi bi-scissors"></i> 50/50 {usedLifelines.ff ? 'đã dùng' : 'sẵn sàng'}</span>
                            <span className={usedLifelines.audience ? 'used' : ''}><i className="bi bi-people-fill"></i> Khán giả {usedLifelines.audience ? 'đã dùng' : 'sẵn sàng'}</span>
                            <span className={usedLifelines.expert ? 'used' : ''}><i className="bi bi-lightbulb-fill"></i> Chuyên gia {usedLifelines.expert ? 'đã dùng' : 'sẵn sàng'}</span>
                        </div>

                        <div className="ks-millionaire-ladder-strip">
                            {millionaireLadder.slice().reverse().map((step) => (
                                <div key={step.level} className={`ks-millionaire-ladder-node${step.level === ((room.currentQIdx || -1) + 1) ? ' current' : ''}${step.isCheckpoint ? ' checkpoint' : ''}${myLevel >= step.level ? ' reached' : ''}`}>
                                    <span>#{step.level}</span>
                                    <strong>{step.label}</strong>
                                </div>
                            ))}
                        </div>

                        {(currentAudiencePoll || currentExpertHint) && (
                            <div className="ks-millionaire-hints-grid">
                                {currentAudiencePoll && (
                                    <div className="ks-millionaire-hint-card">
                                        <div className="ks-millionaire-hint-title">Khán giả</div>
                                        {Object.entries(currentAudiencePoll.distribution || {}).map(([letter, value]) => (
                                            <div key={letter} className="ks-millionaire-poll-row">
                                                <span>{letter}</span>
                                                <div className="ks-millionaire-poll-bar"><div style={{ width: `${value}%` }}></div></div>
                                                <strong>{value}%</strong>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {currentExpertHint && (
                                    <div className="ks-millionaire-hint-card expert">
                                        <div className="ks-millionaire-hint-title">Chuyên gia gợi ý</div>
                                        <strong>{currentExpertHint.recommended}</strong>
                                        <p>{currentExpertHint.message}</p>
                                        <small>Độ tự tin {currentExpertHint.confidence}%</small>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* MCQ grid */}
                {currentQ.type === 'mcq' && !showCd && (() => {
                    const eliminated5050 = room?.lifelines?.ff?.[room.currentQIdx] || [];
                    return (
                    <div className={`ks-choices-grid ${(currentQ.choices || []).length <= 2 ? 'cols-1' : 'cols-2'}${isMillionaireMode ? ' millionaire' : ''}`}>
                        {(currentQ.choices || []).map((c, ci) => {
                            const ck = KAHOOT[ci % KAHOOT.length];
                            const sel = answered && myAnswer === c.letter;
                            const dim = answered && myAnswer !== c.letter;
                            const eliminated = eliminated5050.includes(c.letter);
                            return (
                                <motion.button key={ci}
                                    whileTap={{ scale: 0.94 }}
                                    className={`ks-choice-btn${sel ? ' selected' : ''}${dim ? ' dimmed' : ''}${eliminated ? ' eliminated-5050' : ''}${isMillionaireMode ? ' millionaire' : ''}`}
                                    style={{ '--ck-bg': ck.bg, '--ck-dark': ck.dark }}
                                    onClick={() => !answered && !eliminated && submitAnswer(c.letter)}
                                    disabled={answered || eliminated}>
                                    <span className="ks-choice-icon">{eliminated ? '✖' : ck.icon}</span>
                                    <span className="ks-choice-text">{eliminated ? <s>{c.text}</s> : c.text}</span>
                                    {sel && <span className="ks-choice-check">✓</span>}
                                </motion.button>
                            );
                        })}
                    </div>
                    );
                })()}

                {/* Short answer */}
                {currentQ.type === 'short_answer' && !showCd && (
                    <div className="ks-short-answer-wrap">
                        <input className="ks-sa-input"
                            placeholder="Nhập đáp án..."
                            value={shortAnswerText}
                            onChange={e => setShortAnswerText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !answered && shortAnswerText.trim()) submitAnswer(shortAnswerText.trim()); }}
                            disabled={answered}
                            autoFocus />
                        <button className="ks-btn-primary"
                            onClick={() => shortAnswerText.trim() && submitAnswer(shortAnswerText.trim())}
                            disabled={answered || !shortAnswerText.trim()}>
                            Gửi →
                        </button>
                    </div>
                )}

                {answered && !showCd && (
                    <motion.div className="ks-answered-badge"
                        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                        {isMillionaireMode ? '🔒 Đã khóa đáp án! Chờ sân khấu công bố kết quả...' : '✓ Đã trả lời! Chờ giáo viên lộ đáp án...'}
                    </motion.div>
                )}
            </div>
        );
    }

    // ── REVEAL ──
    if ((phase === 'reveal' || (isEliminated && phase === 'reveal')) && currentQ) {
        const correct = lastCorrect === true;
        const noAnswer = lastCorrect === null;
        const revealedAnswer = room?.revealedCorrectAnswers?.[room?.currentQIdx];
        return (
            <div className="ks-page ks-reveal-bg">
                <AnimatePresence>
                    {showPointsAnim && (
                        <motion.div className="ks-score-popup"
                            key="pts"
                            initial={{ y: 20, opacity: 0, scale: 0.6 }}
                            animate={{ y: -80, opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.7, ease: 'backOut' }}>
                            +{formatStudentScore(lastPoints, liveMode, !isMillionaireMode)}
                            {myStreak >= 3 && <span className="ks-streak-tag">🔥 ×{myStreak}</span>}
                        </motion.div>
                    )}
                </AnimatePresence>

                {correct && myStreak >= 3 && <Confetti />}

                <motion.div
                    className={`ks-result-hero${correct ? ' correct' : noAnswer ? ' timeout' : ' wrong'}`}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 18 }}>
                    <div className="ks-result-emoji">{correct ? (myStreak >= 3 ? '🔥' : '✅') : noAnswer ? '⏰' : '❌'}</div>
                    <div className="ks-result-label">
                        {correct ? 'Đúng rồi!' : noAnswer ? 'Hết giờ!' : 'Sai mất rồi!'}
                    </div>
                    {correct && myStreak >= 3 && (
                        <div className="ks-streak-banner">🔥 {myStreak} câu liên tiếp!</div>
                    )}
                    {!correct && !noAnswer && currentQ.type === 'mcq' && (
                        <div className="ks-correct-hint">Đáp án đúng: <strong>{revealedAnswer || '?'}</strong></div>
                    )}
                    {!correct && !noAnswer && currentQ.type === 'tf' && (
                        <div className="ks-correct-hint">Đáp án đúng: <strong>{revealedAnswer || '?'}</strong></div>
                    )}
                    {!correct && !noAnswer && currentQ.type === 'short_answer' && (
                        <div className="ks-correct-hint">Đáp án mẫu: <strong>{revealedAnswer || '(Xem bảng)'}</strong></div>
                    )}
                    {isMillionaireMode && (
                        <div className="ks-millionaire-result-meta">
                            <span>Đang ở mốc <strong>{myLevel}</strong></span>
                            <span>Mốc an toàn <strong>{mySafeLevel || 0}</strong></span>
                        </div>
                    )}
                    <div className="ks-result-score">{formatStudentScore(myScore, liveMode, !isMillionaireMode)}</div>
                    {myRank > 0 && <div className="ks-result-rank">Hạng #{myRank}</div>}
                </motion.div>

                <div className="ks-waiting-sm">
                    <div className="ks-dot-loader"><span /><span /><span /></div>
                    <p>Chờ câu tiếp theo...</p>
                </div>
            </div>
        );
    }

    // ── LEADERBOARD ──
    if ((phase === 'leaderboard' || (isEliminated && phase === 'leaderboard')) && room) {
        return (
            <div className="ks-page ks-lb-bg">
                <div className="ks-lb-wrap">
                    <h2 className="ks-lb-title">{isMillionaireMode ? '💎 Bảng xếp hạng triệu phú' : '🏆 Bảng xếp hạng'}</h2>
                    <div className="ks-my-rank-banner">
                        Bạn đang ở hạng <strong>#{myRank}</strong> — {formatStudentScore(myScore, liveMode, !isMillionaireMode)}
                    </div>
                    <div className="ks-lb-list">
                        {sortedLb.slice(0, 8).map((entry, rank) => (
                            <motion.div key={entry.uid}
                                initial={{ x: -40, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                transition={{ delay: rank * 0.06 }}
                                className={`ks-lb-row${entry.uid === uid ? ' mine' : ''}${entry.eliminated ? ' elim' : ''}`}>
                                <span className="ks-lb-rank-num">{rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
                                <span className="ks-lb-name">{entry.name}{entry.uid === uid && ' (bạn)'}</span>
                                {entry.eliminated && <span className="ks-elim-tag">Loại</span>}
                                {isMillionaireMode && <span className="ks-lb-level">Mốc {entry.level || 0}</span>}
                                <span className="ks-lb-pts">{formatStudentScore(entry.score, liveMode)}</span>
                            </motion.div>
                        ))}
                    </div>
                    <div className="ks-waiting-sm">
                        <div className="ks-dot-loader"><span /><span /><span /></div>
                        <p>Chờ câu tiếp theo...</p>
                    </div>
                </div>
            </div>
        );
    }

    // ── ENDED ──
    if ((phase === 'ended' || (isEliminated && phase === 'ended')) && room) {
        const medal = myRank === 1 ? '🏆' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🎉';
        return (
            <div className="ks-page ks-ended-bg">
                {myRank <= 3 && <Confetti />}
                <motion.div className="ks-center-card ks-ended-card"
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 250 }}>
                    <div className="ks-big-emoji">{medal}</div>
                    <h2>{isMillionaireMode ? 'Chốt bảng vàng!' : 'Kết thúc!'}</h2>
                    <div className="ks-ended-rank">Hạng #{myRank}</div>
                    <div className="ks-ended-score">{formatStudentScore(myScore, liveMode, !isMillionaireMode)}</div>
                    <div className="ks-ended-stats">
                        {isMillionaireMode ? (
                            <>
                                <span>💎 Chạm mốc {myLevel}/{totalQ}</span>
                                <span>🛡️ An toàn {formatMillionairePrize(mySafePrize)}</span>
                            </>
                        ) : (
                            <>
                                <span>✅ {myCorrect}/{totalQ} câu đúng</span>
                                <span>🔥 Max streak {room.scores?.[uid]?.streak || 0}</span>
                            </>
                        )}
                    </div>
                    {isMillionaireMode && topThree.length > 0 && (
                        <div className="ks-millionaire-award-grid">
                            {topThree.map((entry, index) => (
                                <div key={entry.uid} className={`ks-millionaire-award-card rank-${index + 1}${entry.uid === uid ? ' mine' : ''}`}>
                                    <span>Top {index + 1}</span>
                                    <strong>{entry.name}{entry.uid === uid ? ' (bạn)' : ''}</strong>
                                    <em>Mốc {entry.level || 0}</em>
                                    <b>{formatStudentScore(entry.score, liveMode)}</b>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="ks-lb-list" style={{ marginTop: 20 }}>
                        {sortedLb.slice(0, 5).map((e, i) => (
                            <div key={e.uid} className={`ks-lb-row${e.uid === uid ? ' mine' : ''}${e.eliminated ? ' elim' : ''}`}>
                                <span className="ks-lb-rank-num">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
                                <span className="ks-lb-name">{e.name}{e.uid === uid && ' (bạn)'}</span>
                                <span className="ks-lb-pts">{formatStudentScore(e.score, liveMode)}</span>
                            </div>
                        ))}
                    </div>
                    <button className="ks-btn-outline" style={{ marginTop: 20 }} onClick={() => navigate('/student')}>
                        Về trang chính
                    </button>
                </motion.div>
            </div>
        );
    }

    return <div className="loading-screen"><div className="spinner"></div></div>;
}
