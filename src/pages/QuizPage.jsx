import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, addDoc, updateDoc, Timestamp, query, where, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, getTodayKey } from '../utils/formatters';
import { calculateStreak } from '../utils/scoring';
import { checkAchievements } from '../utils/achievements';
import { AchievementPopup } from '../components/AchievementBadge';
import ConfettiEffect from '../components/ConfettiEffect';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';

function renderLatex(html) {
    if (!html) return '';
    return html.replace(/\$\$\$(.*?)\$\$\$/gs, (_, tex) => {
        try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); } catch { return tex; }
    }).replace(/\$\$(.*?)\$\$/g, (_, tex) => {
        try { return katex.renderToString(tex, { throwOnError: false }); } catch { return tex; }
    });
}

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export default function QuizPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();

    const [phase, setPhase] = useState('loading'); // loading, countdown, quiz, result
    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [answers, setAnswers] = useState({});
    const [currentIdx, setCurrentIdx] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0);
    const [submitted, setSubmitted] = useState(false);
    const [score, setScore] = useState(0);
    const [quizStreak, setQuizStreak] = useState(0); // consecutive correct in this quiz
    const [maxQuizStreak, setMaxQuizStreak] = useState(0);
    const [showConfetti, setShowConfetti] = useState(false);
    const [newAchievement, setNewAchievement] = useState(null);
    const [answerFeedback, setAnswerFeedback] = useState(null); // 'correct' | 'wrong' | null
    const [countdownValue, setCountdownValue] = useState(3);
    const timerRef = useRef(null);
    const startTimeRef = useRef(null);

    useEffect(() => {
        loadExam();
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [examId]);

    const loadExam = async () => {
        // Check attempts
        const sessionQ = query(collection(db, 'sessions'), where('examId', '==', examId), where('studentId', '==', user.uid));
        const sessionSnap = await getDocs(sessionQ);

        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) {
            Swal.fire('Không tìm thấy', 'Đề thi không tồn tại.', 'error');
            navigate('/student'); return;
        }
        const examData = { id: examDoc.id, ...examDoc.data() };
        const maxAttempts = examData.maxAttempts || 1;

        if (sessionSnap.size >= maxAttempts) {
            Swal.fire('Hết lượt', `Bạn đã thi ${sessionSnap.size}/${maxAttempts} lần cho đề này.`, 'info');
            navigate('/student'); return;
        }

        setExam(examData);
        setTimeLeft(examData.duration * 60);

        // Load & shuffle questions
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        let qList = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (examData.shuffleQuestions !== false) qList = shuffleArray(qList);
        if (examData.shuffleChoices) {
            qList = qList.map(q => ({
                ...q,
                choices: shuffleArray(q.choices || []),
            }));
        }

        setQuestions(qList);
        setPhase('countdown');

        // Countdown 3..2..1
        let count = 3;
        setCountdownValue(count);
        const countdownInterval = setInterval(() => {
            count--;
            if (count <= 0) {
                clearInterval(countdownInterval);
                setPhase('quiz');
                startTimeRef.current = Date.now();
                startTimer(examData.duration * 60);
            } else {
                setCountdownValue(count);
            }
        }, 1000);
    };

    const startTimer = (seconds) => {
        setTimeLeft(seconds);
        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timerRef.current);
                    handleSubmit(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const handleAnswer = useCallback((questionId, choiceIdx) => {
        if (submitted) return;
        setAnswers(prev => ({ ...prev, [questionId]: choiceIdx }));

        // In-quiz streak feedback
        const q = questions.find(q => q.id === questionId);
        if (q) {
            const correctIdx = (q.choices || []).findIndex(c => c.isCorrect || (q.correct_answer && c.letter === q.correct_answer));
            if (choiceIdx === correctIdx) {
                setQuizStreak(prev => {
                    const newStreak = prev + 1;
                    setMaxQuizStreak(m => Math.max(m, newStreak));
                    return newStreak;
                });
                setAnswerFeedback('correct');
            } else {
                setQuizStreak(0);
                setAnswerFeedback('wrong');
            }
            setTimeout(() => setAnswerFeedback(null), 600);
        }
    }, [submitted, questions]);

    const handleSubmit = async (autoSubmit = false) => {
        if (submitted) return;

        if (!autoSubmit) {
            const unanswered = questions.length - Object.keys(answers).length;
            if (unanswered > 0) {
                const confirm = await Swal.fire({
                    title: 'Xác nhận nộp bài?',
                    html: `Bạn còn <b>${unanswered} câu</b> chưa trả lời.`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Nộp bài',
                    cancelButtonText: 'Tiếp tục làm',
                    confirmButtonColor: '#5b5ea6',
                });
                if (!confirm.isConfirmed) return;
            }
        }

        clearInterval(timerRef.current);
        setSubmitted(true);

        // Calculate score
        let finalScore = 0;
        const answerDetails = [];
        for (const q of questions) {
            const selected = answers[q.id];
            const correctIdx = (q.choices || []).findIndex(c => c.isCorrect || (q.correct_answer && c.letter === q.correct_answer));
            const isCorrect = selected === correctIdx;
            if (isCorrect) finalScore++;
            answerDetails.push({
                questionId: q.id,
                selected: selected ?? null,
                correctIdx,
                isCorrect,
            });
        }

        setScore(finalScore);
        const timeSpent = Math.round((Date.now() - startTimeRef.current) / 1000);
        const isPerfect = finalScore === questions.length;
        const isHighScore = finalScore / questions.length >= 0.8;

        // Save session
        const sessionRef = await addDoc(collection(db, 'sessions'), {
            examId,
            examTitle: exam.title,
            studentId: user.uid,
            studentName: user.displayName,
            studentEmail: user.email,
            score: finalScore,
            total: questions.length,
            maxQuizStreak: maxQuizStreak,
            timeSpent,
            answers: answerDetails,
            startedAt: Timestamp.fromMillis(startTimeRef.current),
            completedAt: Timestamp.now(),
        });

        // Update user stats: streak, achievements
        try {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            const userData = userSnap.data() || {};

            const today = getTodayKey();
            const currentStreak = calculateStreak(userData.lastActiveDate, userData.streak || 0);
            const totalQuizzes = (userData.totalQuizzes || 0) + 1;
            const totalScore = (userData.totalScore || 0) + finalScore;
            const totalQuestions = (userData.totalQuestions || 0) + questions.length;
            const perfectScores = (userData.perfectScores || 0) + (isPerfect ? 1 : 0);
            const maxStreak = Math.max(userData.maxStreak || 0, currentStreak);
            const avgPercent = totalQuestions > 0 ? Math.round((totalScore / totalQuestions) * 100) : 0;
            const speedFinishes = (userData.speedFinishes || 0) + (timeSpent < (exam.duration * 60 * 0.5) ? 1 : 0);

            const stats = { totalQuizzes, totalScore, totalQuestions, perfectScores, maxStreak, avgPercent, speedFinishes };
            const newAchievements = checkAchievements(stats, userData.achievements || []);

            const updateData = {
                streak: currentStreak,
                maxStreak,
                lastActiveDate: today,
                totalQuizzes,
                totalScore,
                totalQuestions,
                perfectScores,
                speedFinishes,
            };

            if (newAchievements.length > 0) {
                updateData.achievements = arrayUnion(...newAchievements.map(a => a.id));
            }

            await updateDoc(userRef, updateData);

            // Show achievement popup
            if (newAchievements.length > 0) {
                setNewAchievement(newAchievements[0]);
            }
        } catch (err) {
            console.error('Stats update error:', err);
        }

        // Effects
        if (isPerfect || isHighScore) setShowConfetti(true);
        setPhase('result');
    };

    const goToNext = () => {
        if (currentIdx < questions.length - 1) setCurrentIdx(prev => prev + 1);
    };
    const goToPrev = () => {
        if (currentIdx > 0) setCurrentIdx(prev => prev - 1);
    };

    // Phase: Loading
    if (phase === 'loading') {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải đề thi...</p></div>;
    }

    // Phase: Countdown
    if (phase === 'countdown') {
        return (
            <div className="quiz-countdown-screen">
                <motion.div className="quiz-countdown-card" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    <h2>{exam?.title}</h2>
                    <p>{questions.length} câu hỏi · {exam?.duration} phút</p>
                    <motion.div
                        className="countdown-number"
                        key={countdownValue}
                        initial={{ scale: 2, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300 }}
                    >
                        {countdownValue}
                    </motion.div>
                    <p style={{ color: 'var(--text-muted)' }}>Chuẩn bị...</p>
                </motion.div>
            </div>
        );
    }

    // Phase: Result
    if (phase === 'result') {
        const pct = Math.round((score / questions.length) * 100);
        const isPerfect = score === questions.length;

        return (
            <div className="quiz-result-screen">
                <ConfettiEffect active={showConfetti} />
                <AnimatePresence>
                    {newAchievement && <AchievementPopup achievement={newAchievement} onClose={() => setNewAchievement(null)} />}
                </AnimatePresence>

                <motion.div className="result-main-card" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }}>
                    <div className="result-emoji">
                        {isPerfect ? '🏆' : pct >= 80 ? '🌟' : pct >= 60 ? '👍' : pct >= 40 ? '💪' : '📚'}
                    </div>
                    <h2 className="result-title">{isPerfect ? 'Hoàn hảo!' : pct >= 80 ? 'Xuất sắc!' : pct >= 60 ? 'Tốt lắm!' : pct >= 40 ? 'Cố gắng hơn!' : 'Cần ôn tập!'}</h2>

                    <div className="result-score-circle">
                        <svg viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="#ede9fe" strokeWidth="8" />
                            <motion.circle
                                cx="60" cy="60" r="54" fill="none"
                                stroke={pct >= 80 ? '#10b981' : pct >= 60 ? '#5b5ea6' : pct >= 40 ? '#f59e0b' : '#ef4444'}
                                strokeWidth="8" strokeLinecap="round"
                                strokeDasharray={`${2 * Math.PI * 54}`}
                                initial={{ strokeDashoffset: 2 * Math.PI * 54 }}
                                animate={{ strokeDashoffset: 2 * Math.PI * 54 * (1 - pct / 100) }}
                                transition={{ duration: 1.5, ease: 'easeOut' }}
                                transform="rotate(-90 60 60)"
                            />
                        </svg>
                        <div className="result-score-text">
                            <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.5 }}
                                style={{ fontSize: '2rem', fontWeight: 900 }}
                            >
                                {score}/{questions.length}
                            </motion.span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{pct}%</span>
                        </div>
                    </div>

                    <div className="result-stats-row">
                        <div className="result-stat">
                            <span className="result-stat-value">🔥 {maxQuizStreak}</span>
                            <span className="result-stat-label">Streak max</span>
                        </div>
                        <div className="result-stat">
                            <span className="result-stat-value">{formatDuration(Math.round((Date.now() - startTimeRef.current) / 1000))}</span>
                            <span className="result-stat-label">Thời gian</span>
                        </div>
                        <div className="result-stat">
                            <span className="result-stat-value">{questions.length - Object.keys(answers).length}</span>
                            <span className="result-stat-label">Bỏ trống</span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
                        <button className="btn btn-primary" onClick={() => navigate('/student')}>
                            <i className="bi bi-house"></i> Về trang chủ
                        </button>
                        {exam?.showResult !== false && (
                            <button className="btn btn-outline" onClick={() => navigate(`/student/result/${examId}`)}>
                                <i className="bi bi-eye"></i> Xem chi tiết
                            </button>
                        )}
                    </div>
                </motion.div>
            </div>
        );
    }

    // Phase: Quiz
    const currentQ = questions[currentIdx];
    const progress = ((Object.keys(answers).length) / questions.length) * 100;
    const timePercent = exam ? (timeLeft / (exam.duration * 60)) * 100 : 100;

    return (
        <div className="quiz-container">
            <ConfettiEffect active={showConfetti} />

            {/* Answer feedback overlay */}
            <AnimatePresence>
                {answerFeedback && (
                    <motion.div
                        className={`answer-feedback ${answerFeedback}`}
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                    >
                        {answerFeedback === 'correct' ? (
                            <><i className="bi bi-check-circle-fill"></i> {quizStreak > 1 && <span className="streak-combo">{quizStreak}x Combo!</span>}</>
                        ) : (
                            <i className="bi bi-x-circle-fill"></i>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header */}
            <div className="quiz-header">
                <div className="quiz-header-left">
                    <h2 className="quiz-title">{exam?.title}</h2>
                    <div className="quiz-subtitle">
                        Câu {currentIdx + 1}/{questions.length}
                        {quizStreak >= 2 && (
                            <motion.span
                                className="quiz-streak-badge"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                key={quizStreak}
                            >
                                🔥 {quizStreak}
                            </motion.span>
                        )}
                    </div>
                </div>
                <div className={`quiz-timer ${timeLeft < 60 ? 'urgent' : timeLeft < 300 ? 'warning' : ''}`}>
                    <i className="bi bi-clock"></i> {formatDuration(timeLeft)}
                </div>
            </div>

            {/* Progress bars */}
            <div className="quiz-progress-group">
                <div className="quiz-progress" title="Tiến độ làm bài">
                    <div className="quiz-progress-bar progress-answer" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="quiz-progress time-progress" title="Thời gian còn lại">
                    <div className={`quiz-progress-bar progress-time ${timeLeft < 60 ? 'urgent' : ''}`} style={{ width: `${timePercent}%` }}></div>
                </div>
            </div>

            {/* Question */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentIdx}
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -40 }}
                    transition={{ duration: 0.25 }}
                >
                    <div className="question-card">
                        <div className="question-header">
                            <span className="question-number">{currentIdx + 1}</span>
                            <div className="question-text" dangerouslySetInnerHTML={{ __html: renderLatex(currentQ?.content_html || currentQ?.content_text || '') }} />
                        </div>

                        <ul className="choice-list">
                            {(currentQ?.choices || []).map((choice, idx) => {
                                const letter = choice.letter || String.fromCharCode(65 + idx);
                                const isSelected = answers[currentQ.id] === idx;
                                return (
                                    <motion.li
                                        key={idx}
                                        className={`choice-item ${isSelected ? 'selected' : ''}`}
                                        onClick={() => handleAnswer(currentQ.id, idx)}
                                        whileHover={{ scale: 1.01 }}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        <span className="choice-letter">{letter}</span>
                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(choice.html || choice.text || '') }} />
                                    </motion.li>
                                );
                            })}
                        </ul>
                    </div>
                </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="quiz-nav">
                <button className="btn btn-outline" disabled={currentIdx === 0} onClick={goToPrev}>
                    <i className="bi bi-chevron-left"></i> Trước
                </button>

                <button className="btn btn-danger-soft" onClick={() => handleSubmit(false)}>
                    <i className="bi bi-send"></i> Nộp bài
                </button>

                <button className="btn btn-primary" disabled={currentIdx >= questions.length - 1} onClick={goToNext}>
                    Tiếp <i className="bi bi-chevron-right"></i>
                </button>
            </div>

            {/* Question dots */}
            <div className="question-dots">
                {questions.map((q, idx) => (
                    <button
                        key={q.id}
                        className={`question-dot ${idx === currentIdx ? 'current' : ''} ${answers[q.id] !== undefined ? 'answered' : ''}`}
                        onClick={() => setCurrentIdx(idx)}
                    >
                        {idx + 1}
                    </button>
                ))}
            </div>
        </div>
    );
}
