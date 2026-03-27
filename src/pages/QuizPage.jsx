import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, addDoc, Timestamp, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import Swal from 'sweetalert2';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Render LaTeX in HTML string
function renderLatex(html) {
    if (!html) return '';
    return html.replace(/\$\$(.*?)\$\$/gs, (_, tex) => {
        try { return katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
        catch { return tex; }
    }).replace(/\$(.*?)\$/g, (_, tex) => {
        try { return katex.renderToString(tex, { throwOnError: false }); }
        catch { return tex; }
    });
}

export default function QuizPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [answers, setAnswers] = useState({});
    const [currentIdx, setCurrentIdx] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0);
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(true);
    const timerRef = useRef(null);

    useEffect(() => {
        loadExam();
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [examId]);

    const loadExam = async () => {
        // Check if already completed
        const sessionQ = query(
            collection(db, 'sessions'),
            where('examId', '==', examId),
            where('studentId', '==', user.uid)
        );
        const sessionSnap = await getDocs(sessionQ);
        if (!sessionSnap.empty) {
            Swal.fire('Đã làm bài', 'Bạn đã hoàn thành đề thi này.', 'info');
            navigate('/student');
            return;
        }

        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) {
            Swal.fire('Không tìm thấy', 'Đề thi không tồn tại.', 'error');
            navigate('/student');
            return;
        }

        const examData = { id: examDoc.id, ...examDoc.data() };
        setExam(examData);
        setTimeLeft(examData.duration * 60);

        // Load questions (shuffle order for each student)
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        const qList = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        qList.sort(() => Math.random() - 0.5); // Simple shuffle
        setQuestions(qList);
        setLoading(false);

        // Start timer
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
    }, [submitted]);

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

        // Calculate score (client-side for immediate feedback)
        // Server-side verification should be added via Cloud Functions
        let score = 0;
        const answerDetails = [];
        for (const q of questions) {
            const selected = answers[q.id];
            const correctIdx = (q.choices || []).findIndex(c => c.isCorrect);
            const isCorrect = selected === correctIdx;
            if (isCorrect) score++;
            answerDetails.push({
                questionId: q.id,
                selected: selected ?? null,
                correctIdx,
                isCorrect,
            });
        }

        // Save session to Firestore
        await addDoc(collection(db, 'sessions'), {
            examId,
            studentId: user.uid,
            studentName: user.displayName,
            studentEmail: user.email,
            score,
            total: questions.length,
            answers: answerDetails,
            startedAt: Timestamp.now(), // approximate
            completedAt: Timestamp.now(),
        });

        Swal.fire({
            icon: score / questions.length >= 0.5 ? 'success' : 'info',
            title: autoSubmit ? 'Hết giờ!' : 'Đã nộp bài!',
            html: `<div class="result-card"><div class="result-score">${score}/${questions.length}</div><div class="result-label">Số câu đúng</div></div>`,
            confirmButtonColor: '#5b5ea6',
        }).then(() => navigate('/student'));
    };

    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải đề thi...</p></div>;
    }

    const currentQ = questions[currentIdx];
    const progress = ((currentIdx + 1) / questions.length) * 100;

    return (
        <div className="quiz-container">
            {/* Header */}
            <div className="quiz-header">
                <div>
                    <h2 style={{ fontSize: '1.2rem', margin: 0 }}>{exam?.title}</h2>
                    <small style={{ color: 'var(--text-muted)' }}>Câu {currentIdx + 1}/{questions.length}</small>
                </div>
                <div className={`quiz-timer ${timeLeft < 60 ? 'urgent' : ''}`}>
                    <i className="bi bi-clock me-1"></i>{formatTime(timeLeft)}
                </div>
            </div>

            {/* Progress bar */}
            <div className="quiz-progress">
                <div className="quiz-progress-bar" style={{ width: `${progress}%` }}></div>
            </div>

            {/* Question */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentIdx}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                >
                    <div className="question-card">
                        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16 }}>
                            <span className="question-number">{currentIdx + 1}</span>
                            <div
                                className="question-text"
                                dangerouslySetInnerHTML={{ __html: renderLatex(currentQ.content_html) }}
                            />
                        </div>

                        <ul className="choice-list">
                            {(currentQ.choices || []).map((choice, idx) => {
                                const letter = String.fromCharCode(65 + idx);
                                const isSelected = answers[currentQ.id] === idx;
                                return (
                                    <li
                                        key={idx}
                                        className={`choice-item ${isSelected ? 'selected' : ''}`}
                                        onClick={() => handleAnswer(currentQ.id, idx)}
                                    >
                                        <span className="choice-letter">{letter}</span>
                                        <span dangerouslySetInnerHTML={{ __html: renderLatex(choice.html) }} />
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <button
                    className="btn btn-outline"
                    disabled={currentIdx === 0}
                    onClick={() => setCurrentIdx(prev => prev - 1)}
                >
                    <i className="bi bi-chevron-left"></i> Câu trước
                </button>

                {currentIdx < questions.length - 1 ? (
                    <button
                        className="btn btn-primary"
                        onClick={() => setCurrentIdx(prev => prev + 1)}
                    >
                        Câu tiếp <i className="bi bi-chevron-right"></i>
                    </button>
                ) : (
                    <button className="btn btn-success" onClick={() => handleSubmit(false)}>
                        <i className="bi bi-check-lg"></i> Nộp bài
                    </button>
                )}
            </div>

            {/* Question dots */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 24, justifyContent: 'center' }}>
                {questions.map((q, idx) => (
                    <button
                        key={q.id}
                        onClick={() => setCurrentIdx(idx)}
                        style={{
                            width: 32, height: 32,
                            borderRadius: '50%',
                            border: idx === currentIdx ? '2px solid var(--accent)' : '1px solid var(--border-light)',
                            background: answers[q.id] !== undefined
                                ? 'var(--accent)' : (idx === currentIdx ? '#ede9fe' : '#fff'),
                            color: answers[q.id] !== undefined ? '#fff' : 'var(--text-secondary)',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        {idx + 1}
                    </button>
                ))}
            </div>
        </div>
    );
}
