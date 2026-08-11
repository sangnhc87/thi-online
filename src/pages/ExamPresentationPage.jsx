import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { AnimatePresence, motion } from 'framer-motion';
import Swal from 'sweetalert2';
import 'katex/dist/katex.min.css';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { renderLatexContent as renderLatex } from '../utils/math';
import { getChoiceDisplayContent, orderQuestionsForDelivery, stripQuestionNumberPrefix } from '../utils/examSections';
import { stripOptionLayoutHints } from '../utils/questionLayout';
import {
    DEFAULT_QUESTION_SCORING,
    DEFAULT_TF_SCORING,
    getQuestionMaxPoints,
} from '../utils/examScoring';
import { isDynamicBankDelivery } from '../utils/examDelivery';

const TYPE_LABELS = {
    mcq: 'Trắc nghiệm',
    tf: 'Đúng / Sai',
    short_answer: 'Trả lời ngắn',
    essay: 'Tự luận',
};

function getFullscreenElement() {
    if (typeof document === 'undefined') return null;
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function requestElementFullscreen(element) {
    if (!element) return false;
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    if (!request) return false;
    await request.call(element);
    return true;
}

function getQuestionHtml(question = {}) {
    return renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(question.content_html || question.content_text || ''), question, question.number ? question.number - 1 : 0));
}

function getChoiceHtml(choice = {}, questionType = 'mcq', index = 0) {
    return renderLatex(getChoiceDisplayContent(choice, questionType, index));
}

function getExplanationHtml(question = {}) {
    return renderLatex(question.explanation_html || question.explanation || '');
}

function getQuestionPreview(question = {}) {
    const source = stripOptionLayoutHints(question.content_html || question.content_text || '');
    return source
        .replace(/<img[^>]*>/gi, ' [hình] ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 96);
}

function getTfChoiceAnswer(question = {}, index = 0) {
    const answer = String(question.correct_answer || '');
    return answer[index] === 'D' ? 'Đúng' : answer[index] === 'S' ? 'Sai' : '—';
}

function buildSlides(exam, questions) {
    const slides = [
        {
            id: 'cover',
            type: 'cover',
            title: exam?.title || 'Trình chiếu đề thi',
        },
    ];

    questions.forEach((question, index) => {
        const section = question.deliverySection;
        if (section?.isSectionStart && (section.hasSections || section.contextHtml || section.contextText)) {
            slides.push({
                id: `section-${section.key || index}`,
                type: 'section',
                section,
                questionNumber: index + 1,
            });
        }

        slides.push({
            id: `question-${question.id || index}`,
            type: 'question',
            question,
            questionNumber: index + 1,
        });
    });

    return slides;
}

function SlideEmptyState({ examId }) {
    return (
        <div className="presentation-empty-state">
            <div className="presentation-empty-icon"><i className="bi bi-easel2"></i></div>
            <h2>Đề này chưa có dữ liệu để trình chiếu</h2>
            <p>Trang này dành cho đề cố định đã có câu hỏi và lời giải, để giáo viên mở lên chiếu dạy trực tiếp.</p>
            <div className="presentation-empty-actions">
                <Link to={`/teacher/exam/${examId}`} className="btn btn-primary">
                    <i className="bi bi-arrow-left"></i> Quay lại chi tiết đề
                </Link>
            </div>
        </div>
    );
}

export default function ExamPresentationPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const rootRef = useRef(null);
    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showOutline, setShowOutline] = useState(false);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [followExamShuffle, setFollowExamShuffle] = useState(false);
    const [revealedAnswers, setRevealedAnswers] = useState({});
    const [revealedExplanations, setRevealedExplanations] = useState({});
    const [fullscreenSupported, setFullscreenSupported] = useState(false);
    const [isFullscreenActive, setIsFullscreenActive] = useState(Boolean(getFullscreenElement()));

    const loadData = useCallback(async () => {
        setLoading(true);
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) {
            navigate('/teacher');
            return;
        }

        const examData = { id: examDoc.id, ...examDoc.data() };
        if (userProfile?.role !== 'admin' && examData.teacherId !== user?.uid) {
            await Swal.fire('Không có quyền', 'Bạn không được mở chế độ trình chiếu của đề thi này.', 'error');
            navigate('/teacher');
            return;
        }

        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        const sortedQuestions = qSnap.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (a.order || a.number || 0) - (b.order || b.number || 0));

        setExam(examData);
        setQuestions(sortedQuestions);
        setLoading(false);
    }, [examId, navigate, user?.uid, userProfile?.role]);

    useEffect(() => {
        if (!user || !userProfile) return;

        let cancelled = false;
        queueMicrotask(() => {
            loadData().catch((error) => {
                if (cancelled) return;
                console.error('load presentation failed', error);
                Swal.fire('Không tải được đề', 'Có lỗi khi mở trình chiếu HTML.', 'error');
                setLoading(false);
            });
        });

        return () => {
            cancelled = true;
        };
    }, [loadData, user, userProfile]);

    useEffect(() => {
        const element = rootRef.current;
        const supported = Boolean(
            element && (element.requestFullscreen || element.webkitRequestFullscreen),
        );
        setFullscreenSupported(supported);
        setIsFullscreenActive(Boolean(getFullscreenElement()));

        const handleFullscreenChange = () => {
            setIsFullscreenActive(Boolean(getFullscreenElement()));
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
        };
    }, []);

    const deliveredQuestions = useMemo(() => {
        if (!questions.length) return [];
        return orderQuestionsForDelivery(questions, {
            shuffleQuestions: followExamShuffle ? exam?.shuffleQuestions !== false : false,
            shuffleChoices: followExamShuffle ? exam?.shuffleChoices !== false : false,
        });
    }, [exam?.shuffleChoices, exam?.shuffleQuestions, followExamShuffle, questions]);

    const slides = useMemo(() => buildSlides(exam, deliveredQuestions), [deliveredQuestions, exam]);
    const questionSlideCount = deliveredQuestions.length;
    const maxSlideIndex = Math.max(slides.length - 1, 0);
    const activeSlideIndex = Math.min(currentSlideIndex, maxSlideIndex);
    const currentSlide = slides[activeSlideIndex] || slides[0] || null;
    const currentQuestion = currentSlide?.type === 'question' ? currentSlide.question : null;
    const currentQuestionId = currentQuestion?.id || null;
    const currentQuestionPoints = currentQuestion
        ? getQuestionMaxPoints(currentQuestion, exam?.questionScoring || DEFAULT_QUESTION_SCORING, exam?.tfScoring || DEFAULT_TF_SCORING)
        : 0;
    const answerVisible = Boolean(currentQuestionId && revealedAnswers[currentQuestionId]);
    const explanationVisible = Boolean(currentQuestionId && revealedExplanations[currentQuestionId]);
    const currentProgress = slides.length > 1 ? Math.round((activeSlideIndex / (slides.length - 1)) * 100) : 0;
    const dynamicBankExam = isDynamicBankDelivery(exam?.deliveryConfig);

    const goPrev = useCallback(() => {
        setCurrentSlideIndex((previous) => Math.max(previous - 1, 0));
    }, []);

    const goNext = useCallback(() => {
        setCurrentSlideIndex((previous) => Math.min(previous + 1, maxSlideIndex));
    }, [maxSlideIndex]);

    const jumpToSlide = useCallback((index) => {
        setCurrentSlideIndex(Math.max(0, Math.min(index, maxSlideIndex)));
        setShowOutline(false);
    }, [maxSlideIndex]);

    const toggleAnswer = useCallback(() => {
        if (!currentQuestionId) return;
        setRevealedAnswers((previous) => ({
            ...previous,
            [currentQuestionId]: !previous[currentQuestionId],
        }));
    }, [currentQuestionId]);

    const toggleExplanation = useCallback(() => {
        if (!currentQuestionId) return;
        setRevealedExplanations((previous) => ({
            ...previous,
            [currentQuestionId]: !previous[currentQuestionId],
        }));
    }, [currentQuestionId]);

    const enableFullscreen = useCallback(async () => {
        try {
            await requestElementFullscreen(rootRef.current);
        } catch (error) {
            console.error('presentation fullscreen failed', error);
            Swal.fire('Không bật được toàn màn hình', 'Trình duyệt đã chặn yêu cầu toàn màn hình.', 'warning');
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            const tag = event.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
                event.preventDefault();
                goNext();
                return;
            }
            if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
                event.preventDefault();
                goPrev();
                return;
            }
            if (event.key.toLowerCase() === 'a') {
                event.preventDefault();
                toggleAnswer();
                return;
            }
            if (event.key.toLowerCase() === 'e') {
                event.preventDefault();
                toggleExplanation();
                return;
            }
            if (event.key.toLowerCase() === 'o') {
                event.preventDefault();
                setShowOutline((previous) => !previous);
                return;
            }
            if (event.key.toLowerCase() === 'f' && fullscreenSupported) {
                event.preventDefault();
                enableFullscreen();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [enableFullscreen, fullscreenSupported, goNext, goPrev, toggleAnswer, toggleExplanation]);

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang dựng trình chiếu HTML...</p></div>;
    }

    if (!exam || dynamicBankExam || !questions.length) {
        return <SlideEmptyState examId={examId} />;
    }

    return (
        <div className="exam-presentation-page" ref={rootRef}>
            <div className="presentation-backdrop presentation-backdrop-a"></div>
            <div className="presentation-backdrop presentation-backdrop-b"></div>

            <header className="presentation-toolbar">
                <div className="presentation-toolbar-main">
                    <span className="presentation-mode-pill">HTML deck</span>
                    <div>
                        <h1>{exam.title}</h1>
                        <div className="presentation-toolbar-meta">
                            <span>{exam.subject || 'Chưa gán môn'}</span>
                            <span>{exam.grade || 'Chưa gán khối'}</span>
                            <span>{questionSlideCount} câu</span>
                            <span>{exam.duration || 0} phút</span>
                        </div>
                    </div>
                </div>

                <div className="presentation-toolbar-actions">
                    <button
                        type="button"
                        className={`btn btn-sm ${followExamShuffle ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => {
                            setFollowExamShuffle((previous) => !previous);
                            setCurrentSlideIndex(0);
                        }}
                        title="Bật để xem đúng thứ tự xáo theo cấu hình phát đề"
                    >
                        <i className="bi bi-shuffle"></i> {followExamShuffle ? 'Đang bám cấu hình đề' : 'Đang giữ thứ tự dạy'}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowOutline((previous) => !previous)}>
                        <i className="bi bi-list-ul"></i> Mục lục
                    </button>
                    {fullscreenSupported && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={enableFullscreen}>
                            <i className={`bi bi-${isFullscreenActive ? 'fullscreen-exit' : 'arrows-fullscreen'}`}></i> {isFullscreenActive ? 'Đang toàn màn hình' : 'Toàn màn hình'}
                        </button>
                    )}
                    <Link to={`/teacher/exam/${examId}`} className="btn btn-outline btn-sm">
                        <i className="bi bi-arrow-left"></i> Về đề
                    </Link>
                </div>
            </header>

            <div className="presentation-progress-track" aria-hidden="true">
                <div className="presentation-progress-bar" style={{ width: `${currentProgress}%` }}></div>
            </div>

            <div className={`presentation-body ${showOutline ? 'outline-open' : ''}`}>
                <div className="presentation-stage-wrap">
                    <AnimatePresence mode="wait">
                        <motion.article
                            key={currentSlide?.id || 'cover'}
                            className="presentation-stage"
                            initial={{ opacity: 0, y: 24, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -24, scale: 0.985 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                        >
                            {currentSlide?.type === 'cover' && (
                                <div className="presentation-slide presentation-slide-cover">
                                    <div className="presentation-cover-grid">
                                        <div className="presentation-cover-copy">
                                            <span className="presentation-kicker">Chế độ dạy học trực tiếp</span>
                                            <h2>{exam.title}</h2>
                                            <p>
                                                Mở ngay bộ câu hỏi, lộ đáp án khi cần, rồi mở lời giải để giảng. Không xuất file trung gian,
                                                không cần dựng live room.
                                            </p>
                                            <div className="presentation-cover-actions">
                                                <button type="button" className="btn btn-primary" onClick={() => jumpToSlide(Math.min(1, slides.length - 1))}>
                                                    <i className="bi bi-play-fill"></i> Bắt đầu trình chiếu
                                                </button>
                                                <button type="button" className="btn btn-outline" onClick={() => setShowOutline(true)}>
                                                    <i className="bi bi-grid-1x2"></i> Xem mục lục
                                                </button>
                                            </div>
                                        </div>

                                        <div className="presentation-cover-panel">
                                            <div className="presentation-stat-card">
                                                <span>Tổng câu</span>
                                                <strong>{questionSlideCount}</strong>
                                            </div>
                                            <div className="presentation-stat-card">
                                                <span>Hoán vị khi dạy</span>
                                                <strong>{followExamShuffle ? 'Theo cấu hình đề' : 'Giữ ổn định'}</strong>
                                            </div>
                                            <div className="presentation-stat-card">
                                                <span>Điều khiển nhanh</span>
                                                <strong>← → · A · E · F</strong>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {currentSlide?.type === 'section' && (
                                <div className="presentation-slide presentation-slide-section">
                                    <span className="presentation-kicker">Phần {currentSlide.section.groupIndex + 1}</span>
                                    <h2>{currentSlide.section.title || 'Phần câu hỏi'}</h2>
                                    <div className="presentation-section-meta">
                                        <span>Bắt đầu từ câu {currentSlide.questionNumber}</span>
                                        {currentSlide.section.questionLimit && <span>Lấy {currentSlide.section.questionLimit} câu</span>}
                                        <span>{currentSlide.section.shuffleQuestions !== false ? 'Có trộn câu trong phần' : 'Giữ nguyên thứ tự trong phần'}</span>
                                    </div>
                                    {currentSlide.section.contextHtml && (
                                        <div className="presentation-section-context" dangerouslySetInnerHTML={{ __html: renderLatex(currentSlide.section.contextHtml) }} />
                                    )}
                                </div>
                            )}

                            {currentSlide?.type === 'question' && currentQuestion && (
                                <div className="presentation-slide presentation-slide-question">
                                    <div className="presentation-question-header">
                                        <div>
                                            <div className="presentation-question-kicker">
                                                <span className="presentation-question-number">Câu {currentSlide.questionNumber}</span>
                                                <span className="presentation-question-type">{TYPE_LABELS[currentQuestion.type] || currentQuestion.type}</span>
                                                <span className="presentation-question-points">{currentQuestionPoints} điểm</span>
                                            </div>
                                            <h2>{currentQuestion.deliverySection?.title || exam.title}</h2>
                                        </div>
                                        <div className="presentation-question-actions">
                                            <button type="button" className={`btn btn-sm ${answerVisible ? 'btn-primary' : 'btn-outline'}`} onClick={toggleAnswer}>
                                                <i className="bi bi-eye"></i> {answerVisible ? 'Ẩn đáp án' : 'Lộ đáp án'}
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn btn-sm ${explanationVisible ? 'btn-primary' : 'btn-outline'}`}
                                                onClick={toggleExplanation}
                                                disabled={!currentQuestion.explanation && !currentQuestion.explanation_html}
                                            >
                                                <i className="bi bi-lightbulb"></i> {explanationVisible ? 'Ẩn lời giải' : 'Lời giải'}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="presentation-question-stem" dangerouslySetInnerHTML={{ __html: getQuestionHtml(currentQuestion) }} />

                                    {(currentQuestion.type === 'mcq' || currentQuestion.type === 'tf') && (
                                        <div className={`presentation-choice-grid ${currentQuestion.type === 'tf' ? 'tf' : ''}`}>
                                            {(currentQuestion.choices || []).map((choice, choiceIndex) => {
                                                const tfAnswer = currentQuestion.type === 'tf' ? getTfChoiceAnswer(currentQuestion, choiceIndex) : null;
                                                const isCorrect = currentQuestion.type === 'mcq' ? Boolean(choice.isCorrect) : tfAnswer === 'Đúng';
                                                return (
                                                    <div
                                                        key={`${choice.letter || choiceIndex}-${choiceIndex}`}
                                                        className={`presentation-choice-card ${answerVisible && isCorrect ? 'is-correct' : ''}`}
                                                    >
                                                        <div className="presentation-choice-head">
                                                            <span className="presentation-choice-letter">{choice.letter || String.fromCharCode(65 + choiceIndex)}</span>
                                                            {answerVisible && currentQuestion.type === 'tf' && (
                                                                <span className={`presentation-choice-answer ${tfAnswer === 'Đúng' ? 'true' : 'false'}`}>{tfAnswer}</span>
                                                            )}
                                                            {answerVisible && currentQuestion.type === 'mcq' && isCorrect && (
                                                                <span className="presentation-choice-answer true">Đáp án đúng</span>
                                                            )}
                                                        </div>
                                                        <div className="presentation-choice-body" dangerouslySetInnerHTML={{ __html: getChoiceHtml(choice, currentQuestion.type, choiceIndex) }} />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {currentQuestion.type === 'short_answer' && (
                                        <div className={`presentation-answer-box ${answerVisible ? 'visible' : ''}`}>
                                            <span className="presentation-answer-label">Đáp án ngắn</span>
                                            <strong>{answerVisible ? currentQuestion.correct_answer || 'Chưa có đáp án' : 'Nhấn “Lộ đáp án” để hiện đáp án ngắn'}</strong>
                                        </div>
                                    )}

                                    {currentQuestion.type === 'essay' && (
                                        <div className={`presentation-answer-box essay ${answerVisible ? 'visible' : ''}`}>
                                            <span className="presentation-answer-label">Gợi ý chấm / đáp án mở</span>
                                            <div dangerouslySetInnerHTML={{ __html: renderLatex(answerVisible ? currentQuestion.correct_answer || 'Chưa có gợi ý chấm' : 'Nhấn “Lộ đáp án” để hiện gợi ý chấm.') }} />
                                        </div>
                                    )}

                                    {explanationVisible && (currentQuestion.explanation || currentQuestion.explanation_html) && (
                                        <div className="presentation-explanation-panel">
                                            <div className="presentation-explanation-head"><i className="bi bi-lightbulb"></i> Lời giải</div>
                                            <div dangerouslySetInnerHTML={{ __html: getExplanationHtml(currentQuestion) }} />
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.article>
                    </AnimatePresence>

                    <footer className="presentation-controls">
                        <div className="presentation-controls-left">
                            <button type="button" className="btn btn-outline" onClick={goPrev} disabled={activeSlideIndex === 0}>
                                <i className="bi bi-arrow-left"></i> Lùi
                            </button>
                            <button type="button" className="btn btn-primary" onClick={goNext} disabled={activeSlideIndex >= slides.length - 1}>
                                Tiếp <i className="bi bi-arrow-right"></i>
                            </button>
                        </div>

                        <div className="presentation-controls-meta">
                            <strong>Slide {activeSlideIndex + 1}/{slides.length}</strong>
                            <span>Phím tắt: ← → để chuyển, A để đáp án, E để lời giải, F để toàn màn hình</span>
                        </div>

                        <div className="presentation-controls-right">
                            <button type="button" className="btn btn-outline" onClick={toggleAnswer} disabled={!currentQuestionId}>
                                <i className="bi bi-eye"></i> Đáp án
                            </button>
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={toggleExplanation}
                                disabled={!currentQuestionId || (!currentQuestion?.explanation && !currentQuestion?.explanation_html)}
                            >
                                <i className="bi bi-lightbulb"></i> Lời giải
                            </button>
                        </div>
                    </footer>
                </div>

                <aside className={`presentation-outline ${showOutline ? 'open' : ''}`}>
                    <div className="presentation-outline-head">
                        <div>
                            <span className="presentation-kicker">Mục lục</span>
                            <h3>{exam.title}</h3>
                        </div>
                        <button type="button" className="btn-icon-sm" onClick={() => setShowOutline(false)} title="Đóng mục lục">
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="presentation-outline-list">
                        {slides.map((slide, index) => {
                            const active = index === activeSlideIndex;
                            const label = slide.type === 'cover'
                                ? 'Trang mở đầu'
                                : slide.type === 'section'
                                    ? slide.section.title || `Phần ${slide.section.groupIndex + 1}`
                                    : `Câu ${slide.questionNumber}. ${getQuestionPreview(slide.question) || TYPE_LABELS[slide.question.type]}`;

                            return (
                                <button
                                    type="button"
                                    key={slide.id}
                                    className={`presentation-outline-item ${active ? 'active' : ''}`}
                                    onClick={() => jumpToSlide(index)}
                                >
                                    <span className="presentation-outline-index">{index + 1}</span>
                                    <span className="presentation-outline-copy">
                                        <strong>
                                            {slide.type === 'cover' ? 'Mở đầu' : slide.type === 'section' ? 'Phần' : `Câu ${slide.questionNumber}`}
                                        </strong>
                                        <span>{label}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    );
}