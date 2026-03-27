import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, getDocs, query, where, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { formatDateTime, formatDuration, formatPercent } from '../utils/formatters';
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

export default function ResultPage() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [session, setSession] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => { loadResult(); }, [sessionId]);

    const loadResult = async () => {
        try {
            // Try sessionId as actual session doc ID first
            let sessionData = null;

            // First try: direct session lookup
            const sessDoc = await getDoc(doc(db, 'sessions', sessionId));
            if (sessDoc.exists()) {
                sessionData = { id: sessDoc.id, ...sessDoc.data() };
            } else {
                // Second try: sessionId might be examId — get latest session for this exam
                const q = query(
                    collection(db, 'sessions'),
                    where('examId', '==', sessionId),
                    where('studentId', '==', user.uid),
                    orderBy('completedAt', 'desc'),
                    limit(1)
                );
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const d = snap.docs[0];
                    sessionData = { id: d.id, ...d.data() };
                }
            }

            if (!sessionData) {
                navigate('/student');
                return;
            }

            setSession(sessionData);

            // Load questions
            const qSnap = await getDocs(collection(db, 'exams', sessionData.examId, 'questions'));
            const qMap = {};
            qSnap.docs.forEach(d => { qMap[d.id] = { id: d.id, ...d.data() }; });
            setQuestions(qMap);
        } catch (err) {
            console.error('Load result error:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải kết quả...</p></div>;
    }

    if (!session) {
        return <div className="loading-screen"><p>Không tìm thấy kết quả.</p></div>;
    }

    const pct = Math.round((session.score / session.total) * 100);

    return (
        <div className="result-page">
            <div className="breadcrumb">
                <Link to="/student">Dashboard</Link>
                <span>›</span>
                <span>Kết quả: {session.examTitle || 'Bài thi'}</span>
            </div>

            {/* Summary card */}
            <motion.div className="result-summary-card" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                <div className="result-summary-left">
                    <h2>{session.examTitle || 'Bài thi'}</h2>
                    <p style={{ color: 'var(--text-muted)' }}>
                        {session.completedAt ? formatDateTime(session.completedAt.toDate ? session.completedAt.toDate() : new Date(session.completedAt)) : ''}
                    </p>
                </div>
                <div className="result-summary-right">
                    <div className={`result-score-badge ${pct >= 80 ? 'excellent' : pct >= 60 ? 'good' : pct >= 40 ? 'average' : 'poor'}`}>
                        {session.score}/{session.total}
                    </div>
                    <div className="result-pct">{pct}%</div>
                </div>
            </motion.div>

            {/* Stats row */}
            <div className="result-info-row">
                <div className="result-info-item">
                    <i className="bi bi-clock"></i>
                    <span>{formatDuration(session.timeSpent || 0)}</span>
                </div>
                {session.maxQuizStreak > 0 && (
                    <div className="result-info-item">
                        <span>🔥</span>
                        <span>Streak: {session.maxQuizStreak}</span>
                    </div>
                )}
                <div className="result-info-item">
                    <i className="bi bi-check-circle"></i>
                    <span>{session.score} đúng</span>
                </div>
                <div className="result-info-item">
                    <i className="bi bi-x-circle"></i>
                    <span>{session.total - session.score} sai</span>
                </div>
            </div>

            {/* Question review */}
            <h3 className="section-header" style={{ marginTop: 32 }}>
                <i className="bi bi-list-check"></i> Chi tiết từng câu
            </h3>

            <div className="result-questions">
                {(session.answers || []).map((ans, idx) => {
                    const q = questions[ans.questionId] || {};
                    const choices = q.choices || [];

                    return (
                        <motion.div
                            key={idx}
                            className={`result-question-card ${ans.isCorrect ? 'correct' : 'wrong'}`}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.04 }}
                        >
                            <div className="rq-header">
                                <span className={`rq-badge ${ans.isCorrect ? 'correct' : 'wrong'}`}>
                                    {ans.isCorrect ? <i className="bi bi-check-lg"></i> : <i className="bi bi-x-lg"></i>}
                                    Câu {idx + 1}
                                </span>
                            </div>

                            <div className="rq-content" dangerouslySetInnerHTML={{ __html: renderLatex(q.content_html || q.content_text || `Câu ${idx + 1}`) }} />

                            <ul className="rq-choices">
                                {choices.map((c, ci) => {
                                    const letter = c.letter || String.fromCharCode(65 + ci);
                                    const isCorrectChoice = ci === ans.correctIdx;
                                    const isSelectedChoice = ci === ans.selected;
                                    let cls = '';
                                    if (isCorrectChoice) cls = 'rq-correct';
                                    if (isSelectedChoice && !isCorrectChoice) cls = 'rq-wrong';

                                    return (
                                        <li key={ci} className={`rq-choice ${cls}`}>
                                            <span className="choice-letter">{letter}</span>
                                            <span dangerouslySetInnerHTML={{ __html: renderLatex(c.html || c.text || '') }} />
                                            {isCorrectChoice && <i className="bi bi-check-circle-fill rq-icon-correct"></i>}
                                            {isSelectedChoice && !isCorrectChoice && <i className="bi bi-x-circle-fill rq-icon-wrong"></i>}
                                        </li>
                                    );
                                })}
                            </ul>

                            {ans.selected === null && (
                                <div className="rq-skipped">
                                    <i className="bi bi-dash-circle"></i> Bỏ trống
                                </div>
                            )}

                            {/* Lời giải */}
                            {q.explanation_html && (
                                <div className="rq-explanation">
                                    <div className="rq-explanation-header">
                                        <i className="bi bi-lightbulb"></i> Lời giải
                                    </div>
                                    <div dangerouslySetInnerHTML={{ __html: renderLatex(q.explanation_html) }} />
                                </div>
                            )}
                            {!q.explanation_html && q.explanation && (
                                <div className="rq-explanation">
                                    <div className="rq-explanation-header">
                                        <i className="bi bi-lightbulb"></i> Lời giải
                                    </div>
                                    <div dangerouslySetInnerHTML={{ __html: renderLatex(q.explanation) }} />
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </div>

            <div style={{ textAlign: 'center', margin: '32px 0' }}>
                <button className="btn btn-primary" onClick={() => navigate('/student')}>
                    <i className="bi bi-house"></i> Về Dashboard
                </button>
            </div>
        </div>
    );
}
