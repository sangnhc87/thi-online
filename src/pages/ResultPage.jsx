import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { collection, getDocs, query, where, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { formatDateTime, formatDuration } from '../utils/formatters';
import 'katex/dist/katex.min.css';
import { renderLatexContent as renderLatex } from '../utils/math';
import { getGamificationPresetLabel } from '../utils/gamification';
import { getChoiceDisplayContent, getQuestionSectionKey, getSectionDisplayTitle, stripQuestionNumberPrefix } from '../utils/examSections';

export default function ResultPage() {
    const { sessionId, studentId: previewStudentId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const [previewStudent, setPreviewStudent] = useState(null);

    const [session, setSession] = useState(null);
    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const isPreviewMode = Boolean(previewStudentId);
    const homePath = isPreviewMode ? `/teacher/student/${previewStudentId}/preview` : '/student';

    const loadResult = useCallback(async () => {
        try {
            let targetStudentId = user?.uid;

            if (isPreviewMode) {
                if (userProfile?.role !== 'teacher') {
                    navigate('/teacher');
                    return;
                }

                const previewSnap = await getDoc(doc(db, 'users', previewStudentId));
                if (!previewSnap.exists()) {
                    navigate('/teacher');
                    return;
                }

                const previewData = { uid: previewSnap.id, ...previewSnap.data() };
                if (previewData.role !== 'student' || previewData.teacherId !== user.uid) {
                    navigate('/teacher');
                    return;
                }

                setPreviewStudent(previewData);
                targetStudentId = previewData.uid;
            } else {
                setPreviewStudent(null);
            }

            // Try sessionId as actual session doc ID first
            let sessionData = null;

            // First try: direct session lookup
            const sessDoc = await getDoc(doc(db, 'sessions', sessionId));
            if (sessDoc.exists()) {
                sessionData = { id: sessDoc.id, ...sessDoc.data() };
            } else if (!isPreviewMode) {
                // Second try: sessionId might be examId — get latest session for this exam
                const q = query(
                    collection(db, 'sessions'),
                    where('examId', '==', sessionId),
                    where('studentId', '==', targetStudentId),
                    orderBy('completedAt', 'desc'),
                    limit(1)
                );
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const d = snap.docs[0];
                    sessionData = { id: d.id, ...d.data() };
                }
            }

            if (!sessionData || sessionData.studentId !== targetStudentId) {
                navigate(homePath);
                return;
            }

            setSession(sessionData);

            // Load exam settings (for scoreScale, examType)
            const examSnap = await getDoc(doc(db, 'exams', sessionData.examId));
            if (examSnap.exists()) setExam({ id: examSnap.id, ...examSnap.data() });

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
    }, [homePath, isPreviewMode, navigate, previewStudentId, sessionId, user?.uid, userProfile?.role]);

    useEffect(() => {
        if (user && userProfile) loadResult();
    }, [loadResult, user, userProfile]);

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải kết quả...</p></div>;
    }

    if (!session) {
        return <div className="loading-screen"><p>Không tìm thấy kết quả.</p></div>;
    }

    const displayTotal = session.total || session.autoGradedTotal || session.manualTotalPoints || 0;
    const pct = displayTotal > 0 ? Math.round((session.score / displayTotal) * 100) : 0;
    const scoreDisplay = (() => {
        const scale = exam?.scoreScale;
        const s = session.score, t = displayTotal;
        if (!t) return 'Chờ chấm';
        if (scale === '10') return `${(Math.round(s / t * 100) / 10).toFixed(1)}/10`;
        if (scale === '100') return `${Math.round(s / t * 100)}/100`;
        return `${s}/${t}`;
    })();
    const orderedQuestions = (session.answers || []).map((answer) => questions[answer.questionId] || {});

    return (
        <div className="result-page">
            <div className="breadcrumb">
                <Link to={homePath}>{isPreviewMode ? 'Preview học sinh' : 'Dashboard'}</Link>
                <span>›</span>
                <span>Kết quả: {session.examTitle || 'Bài thi'}</span>
            </div>

            {isPreviewMode && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-display"></i> Đang xem kết quả dưới góc nhìn học sinh {previewStudent?.displayName || previewStudent?.email || previewStudentId}.
                </div>
            )}

            {session.manualReviewPending && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-journal-richtext"></i> Bài thi có phần tự luận cần chấm tay. Điểm hiện tại mới tính phần hệ thống chấm tự động.
                </div>
            )}

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
                        {scoreDisplay}
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
                    <span>{session.score} điểm tự động</span>
                </div>
                <div className="result-info-item">
                    <i className="bi bi-calculator"></i>
                    <span>{displayTotal} điểm phần đã chấm</span>
                </div>
                {session.manualTotalPoints > 0 && (
                    <div className="result-info-item">
                        <i className="bi bi-journal-richtext"></i>
                        <span>Chờ chấm tay {session.manualTotalPoints} điểm tự luận</span>
                    </div>
                )}
                {session.gameMeta?.presetLabel && (
                    <div className="result-info-item">
                        <i className="bi bi-stars"></i>
                        <span>{session.gameMeta.presetLabel || getGamificationPresetLabel(session.gameMeta)}</span>
                    </div>
                )}
                {session.gameMeta?.totalGamePoints > 0 && (
                    <div className="result-info-item">
                        <i className="bi bi-controller"></i>
                        <span>{session.gameMeta.totalGamePoints} điểm game</span>
                    </div>
                )}
            </div>

            {session.gameMeta?.totalGamePoints > 0 && (
                <div className="result-game-strip review-mode" style={{ marginBottom: 20 }}>
                    <div><span>Điểm game</span><strong>{session.gameMeta.totalGamePoints}</strong></div>
                    <div><span>Combo</span><strong>+{session.gameMeta.streakBonusPoints || 0}</strong></div>
                    <div><span>Tốc độ</span><strong>+{session.gameMeta.speedBonusPoints || 0}</strong></div>
                </div>
            )}

            {/* Question review */}
            <h3 className="section-header" style={{ marginTop: 32 }}>
                <i className="bi bi-list-check"></i> Chi tiết từng câu
            </h3>

            <div className="result-questions">
                {(session.answers || []).map((ans, idx) => {
                    const q = orderedQuestions[idx] || {};
                    const choices = ans.choiceSnapshot || q.choices || [];
                    const sectionKey = getQuestionSectionKey(q, idx, orderedQuestions);
                    const prevSectionKey = idx > 0 ? getQuestionSectionKey(orderedQuestions[idx - 1], idx - 1, orderedQuestions) : null;
                    const showSectionIntro = sectionKey !== '__default' && sectionKey !== prevSectionKey;
                    const isPendingManual = ans.type === 'essay';
                    const cardClass = isPendingManual ? 'pending' : ans.isCorrect ? 'correct' : 'wrong';
                    const badgeClass = isPendingManual ? 'pending' : ans.isCorrect ? 'correct' : 'wrong';

                    return (
                        <React.Fragment key={`${sectionKey}_${idx}`}>
                            {showSectionIntro && (
                                <div className="section-context-card result-mode">
                                    <div className="section-context-head">
                                        <strong>{getSectionDisplayTitle(q)}</strong>
                                        {q.sectionTag && <span className="stat-badge muted">{q.sectionTag}</span>}
                                    </div>
                                    {q.sectionContextHtml && <div className="section-context-body" dangerouslySetInnerHTML={{ __html: renderLatex(q.sectionContextHtml) }} />}
                                </div>
                            )}
                        <motion.div
                            className={`result-question-card ${cardClass}`}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.04 }}
                        >
                            <div className="rq-header">
                                <span className={`rq-badge ${badgeClass}`}>
                                    {isPendingManual ? <i className="bi bi-journal-richtext"></i> : ans.isCorrect ? <i className="bi bi-check-lg"></i> : <i className="bi bi-x-lg"></i>}
                                    Câu {idx + 1}
                                </span>
                                {ans.type === 'tf' && ans.earnedPoints != null && (
                                    <span className="rq-tf-score-badge">
                                        {ans.tfCorrectItems}/{(q.correct_answer || '').length} ý đúng · {ans.earnedPoints} điểm
                                    </span>
                                )}
                                {ans.type === 'essay' && ans.maxPoints != null && (
                                    <span className="rq-tf-score-badge">Tự luận · tối đa {ans.maxPoints} điểm</span>
                                )}
                            </div>

                            <div className="rq-content" dangerouslySetInnerHTML={{ __html: renderLatex(stripQuestionNumberPrefix(q.content_html || q.content_text || `Câu ${idx + 1}`, q, idx)) }} />

                            {ans.type === 'tf' ? (
                                <div className="rq-tf-review">
                                    {(choices).map((c, ci) => {
                                        const label = c.letter || String.fromCharCode(97 + ci);
                                        const studentAns = (ans.tfItemAnswers || [])[ci];
                                        const correctAns = (q.correct_answer || '')[ci];
                                        const isItemCorrect = studentAns === correctAns;
                                        return (
                                            <div key={ci} className={`rq-tf-item ${isItemCorrect ? 'item-correct' : 'item-wrong'}`}>
                                                <span className="tf-item-label">{label})</span>
                                                <span className="rq-tf-item-text" dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, q.type, ci)) }} />
                                                <span className="rq-tf-item-answer">
                                                    {studentAns ? (
                                                        <span className={studentAns === 'D' ? 'tf-ans-true' : 'tf-ans-false'}>
                                                            {studentAns === 'D' ? 'Đúng' : 'Sai'}
                                                        </span>
                                                    ) : <span className="tf-ans-skip">Bỏ trống</span>}
                                                    {' → '}
                                                    <span className={correctAns === 'D' ? 'tf-ans-true' : 'tf-ans-false'}>
                                                        {correctAns === 'D' ? 'Đúng' : 'Sai'}
                                                    </span>
                                                    {isItemCorrect
                                                        ? <i className="bi bi-check-circle-fill" style={{ color: '#10b981', marginLeft: 4 }}></i>
                                                        : <i className="bi bi-x-circle-fill" style={{ color: '#ef4444', marginLeft: 4 }}></i>}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : ans.type === 'short_answer' ? (
                                <div className="rq-text-review">
                                    <div className="rq-text-row">
                                        <span className="rq-text-label">Bài làm</span>
                                        <div className={`rq-text-value ${ans.textAnswer ? '' : 'empty'}`}>{ans.textAnswer || 'Bỏ trống'}</div>
                                    </div>
                                    <div className="rq-text-row">
                                        <span className="rq-text-label">Đáp án</span>
                                        <div className="rq-text-value answer-key">{q.correct_answer || 'Chưa cấu hình'}</div>
                                    </div>
                                </div>
                            ) : ans.type === 'essay' ? (
                                <div className="rq-text-review essay-mode">
                                    <div className="rq-text-row">
                                        <span className="rq-text-label">Bài làm</span>
                                        <div className={`rq-text-value essay ${(ans.textAnswer || ans.attachments?.length) ? '' : 'empty'}`}>{ans.textAnswer || (ans.attachments?.length ? 'Đã nộp ảnh bài làm' : 'Bỏ trống')}</div>
                                    </div>
                                    {Array.isArray(ans.attachments) && ans.attachments.length > 0 && (
                                        <div className="rq-essay-attachments">
                                            {ans.attachments.map((attachment, attachmentIndex) => (
                                                <a key={attachment.path || attachment.url || attachmentIndex} className="rq-essay-attachment" href={attachment.url} target="_blank" rel="noreferrer">
                                                    <img src={attachment.url} alt={`Bài làm trang ${attachmentIndex + 1}`} />
                                                    <span>Ảnh {attachmentIndex + 1}</span>
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                    {q.correct_answer && (
                                        <div className="rq-text-row">
                                            <span className="rq-text-label">Gợi ý chấm</span>
                                            <div className="rq-text-value answer-key">{q.correct_answer}</div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                            <ul className="rq-choices">
                                {choices.map((c, ci) => {
                                    const letter = c.letter || String.fromCharCode(65 + ci);
                                    const isCorrectChoice = (c.originLetter || c.letter) === ans.correctOriginLetter || ci === ans.correctIdx;
                                    const isSelectedChoice = ci === ans.selected;
                                    let cls = '';
                                    if (isCorrectChoice) cls = 'rq-correct';
                                    if (isSelectedChoice && !isCorrectChoice) cls = 'rq-wrong';

                                    return (
                                        <li key={ci} className={`rq-choice ${cls}`}>
                                            <span className="choice-letter">{letter}</span>
                                            <span dangerouslySetInnerHTML={{ __html: renderLatex(getChoiceDisplayContent(c, q.type, ci)) }} />
                                            {isCorrectChoice && <i className="bi bi-check-circle-fill rq-icon-correct"></i>}
                                            {isSelectedChoice && !isCorrectChoice && <i className="bi bi-x-circle-fill rq-icon-wrong"></i>}
                                        </li>
                                    );
                                })}
                            </ul>
                            )}

                            {((ans.type === 'mcq' && ans.selected === null) || (ans.type === 'short_answer' && !ans.textAnswer) || (ans.type === 'essay' && !ans.textAnswer && !(ans.attachments || []).length)) && (
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
                        </React.Fragment>
                    );
                })}
            </div>

            <div style={{ textAlign: 'center', margin: '32px 0' }}>
                <button className="btn btn-primary" onClick={() => navigate(homePath)}>
                    <i className="bi bi-house"></i> Về Dashboard
                </button>
            </div>
        </div>
    );
}
