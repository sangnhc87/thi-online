import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { collectQuestionResourceGroups, extractResourceLinksFromHtml, mergeResourceLinks } from '../utils/resourceLinks';
import {
    PRESENTATION_ROLE_PRESENTER,
    PRESENTATION_ROLE_PROJECTOR,
    PRESENTATION_ROLE_STANDALONE,
    buildPresentationSessionId,
    loadPresentationSnapshot,
    normalizePresentationRole,
    openPresentationSyncChannel,
    savePresentationSnapshot,
} from '../utils/presentationSync';
import {
    configureSoundEngine,
    playCorrect,
    playStart,
    playTick,
    resetSoundEngine,
} from '../utils/sounds';

const TYPE_LABELS = {
    mcq: 'Trắc nghiệm',
    tf: 'Đúng / Sai',
    short_answer: 'Trả lời ngắn',
    essay: 'Tự luận',
};

const THEME_PRESETS = [
    { id: 'lecture', label: 'Lecture Dark' },
    { id: 'paper', label: 'Paper Light' },
    { id: 'neon', label: 'STEM Neon' },
];

const SOUND_PROFILES = [
    { id: 'lecture', label: 'Lecture', cues: { slide: 'tick', section: 'start', answer: 'correct', explanation: 'tick', resources: 'start' } },
    { id: 'cinema', label: 'Cinema', cues: { slide: 'start', section: 'start', answer: 'correct', explanation: 'start', resources: 'tick' } },
    { id: 'minimal', label: 'Minimal', cues: { slide: 'tick', section: 'tick', answer: 'correct', explanation: 'tick', resources: 'tick' } },
    { id: 'silent', label: 'Silent', cues: { slide: null, section: null, answer: null, explanation: null, resources: null } },
];

const RESOURCE_ICONS = {
    anchor: 'signpost-2',
    file: 'paperclip',
    image: 'image',
    link: 'link-45deg',
    pdf: 'filetype-pdf',
    video: 'play-btn',
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

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function noteToHtml(value = '') {
    if (!value) return '';
    return renderLatex(escapeHtml(value).replace(/\n/g, '<br>'));
}

function getQuestionHtml(question = {}) {
    return renderLatex(stripQuestionNumberPrefix(stripOptionLayoutHints(question.content_html || question.content_text || ''), question, question.number ? question.number - 1 : 0));
}

function getChoiceHtml(choice = {}, questionType = 'mcq', index = 0) {
    return renderLatex(getChoiceDisplayContent(choice, questionType, index));
}

function getExplanationHtml(question = {}) {
    return renderLatex(question.explanation_html || noteToHtml(question.explanation || ''));
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

function getWorkbenchStorageKey(userId, examId) {
    return `thi-online:presentation-workbench:${userId || 'teacher'}:${examId}`;
}

function getDefaultWorkbenchState() {
    return {
        localHints: {},
        speakerNotes: {},
        themeId: 'lecture',
        soundProfileId: 'lecture',
        soundMuted: false,
        soundVolume: 0.7,
        spotlightSize: 24,
        followExamShuffle: false,
    };
}

function getSlideLabel(slide) {
    if (!slide) return 'Slide';
    if (slide.type === 'cover') return 'Trang mở đầu';
    if (slide.type === 'section') return slide.section?.title || 'Phần câu hỏi';
    return `Câu ${slide.questionNumber}. ${getQuestionPreview(slide.question) || TYPE_LABELS[slide.question?.type] || 'Câu hỏi'}`;
}

function getSlideResourceGroups(slide) {
    if (!slide) return { sectionLinks: [], questionLinks: [], allLinks: [] };
    if (slide.type === 'section') {
        const sectionLinks = mergeResourceLinks(
            extractResourceLinksFromHtml(slide.section?.contextHtml || '', { scope: 'section', source: 'section_html' }),
        );
        return { sectionLinks, questionLinks: [], allLinks: sectionLinks };
    }
    if (slide.type !== 'question') return { sectionLinks: [], questionLinks: [], allLinks: [] };
    return collectQuestionResourceGroups(slide.question);
}

function getSlideRevealStages(slide, hintText, resourceGroups) {
    if (!slide) return ['slide'];
    if (slide.type === 'cover') return ['cover'];
    if (slide.type === 'section') {
        const stages = ['section'];
        if ((resourceGroups?.allLinks || []).length > 0) stages.push('resources');
        return stages;
    }

    const question = slide.question || {};
    const stages = ['question'];
    if (String(hintText || '').trim()) stages.push('hint');
    stages.push('answer');
    if (question.explanation || question.explanation_html) stages.push('explanation');
    if ((resourceGroups?.allLinks || []).length > 0) stages.push('resources');
    return stages;
}

function getRevealChipLabel(stage) {
    if (stage === 'cover') return 'Mở đầu';
    if (stage === 'section') return 'Phần';
    if (stage === 'hint') return 'Gợi ý';
    if (stage === 'answer') return 'Đáp án';
    if (stage === 'explanation') return 'Lời giải';
    if (stage === 'resources') return 'Tài nguyên';
    return 'Đề bài';
}

function getRevealChipIcon(stage) {
    if (stage === 'cover') return 'house-door';
    if (stage === 'section') return 'collection-play';
    if (stage === 'hint') return 'lightbulb';
    if (stage === 'answer') return 'patch-check';
    if (stage === 'explanation') return 'journal-text';
    if (stage === 'resources') return 'link-45deg';
    return 'patch-question';
}

function getSlideRailIcon(slide) {
    if (!slide) return 'circle';
    if (slide.type === 'cover') return 'house-door';
    if (slide.type === 'section') return 'collection-play';
    if (slide.question?.type === 'tf') return 'check2-square';
    if (slide.question?.type === 'short_answer') return 'input-cursor-text';
    if (slide.question?.type === 'essay') return 'journal-richtext';
    return 'patch-question';
}

function getSlideRailShortLabel(slide) {
    if (!slide) return 'Slide';
    if (slide.type === 'cover') return 'Mở';
    if (slide.type === 'section') return `P${(slide.section?.groupIndex || 0) + 1}`;
    return `C${slide.questionNumber}`;
}

function getSlideRailTitle(slide) {
    if (!slide) return 'Slide';
    if (slide.type === 'cover') return 'Mở đầu';
    if (slide.type === 'section') return slide.section?.title || 'Phần câu hỏi';
    return `Câu ${slide.questionNumber}`;
}

function PresentationQuestionRail({
    slides = [],
    activeSlideIndex = 0,
    jumpToSlide,
    revealProgressBySlideId = {},
    localHints = {},
}) {
    const activeChipRef = useRef(null);

    useEffect(() => {
        activeChipRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center',
        });
    }, [activeSlideIndex]);

    if (!slides.length) return null;

    return (
        <div className="presentation-question-rail" role="tablist" aria-label="Điều hướng các câu trong deck">
            {slides.map((slide, index) => {
                const active = index === activeSlideIndex;
                const revealCount = Number(revealProgressBySlideId[slide.id] || 0);
                const hasLocalHint = Boolean(localHints[slide.id]);

                return (
                    <button
                        key={slide.id}
                        type="button"
                        ref={active ? activeChipRef : null}
                        className={`presentation-rail-chip is-${slide.type}${active ? ' active' : ''}`}
                        onClick={() => jumpToSlide(index)}
                        title={getSlideLabel(slide)}
                        aria-selected={active}
                    >
                        <span className="presentation-rail-chip-top">
                            <span className="presentation-rail-chip-index">
                                <i className={`bi bi-${getSlideRailIcon(slide)}`}></i>
                                {getSlideRailShortLabel(slide)}
                            </span>
                            {(hasLocalHint || revealCount > 0) && (
                                <span className="presentation-rail-chip-flags">
                                    {hasLocalHint && <span className="presentation-rail-flag hint"><i className="bi bi-lightbulb-fill"></i></span>}
                                    {revealCount > 0 && <span className="presentation-rail-flag reveal"><i className="bi bi-check2-circle"></i></span>}
                                </span>
                            )}
                        </span>
                        <span className="presentation-rail-chip-copy">
                            <strong>{getSlideRailTitle(slide)}</strong>
                            <small>{getSlideLabel(slide)}</small>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function PresentationRevealDock({
    activeSlideIndex = 0,
    slidesLength = 0,
    revealStages = [],
    currentRevealIndex = 0,
    setCurrentRevealIndex,
    jumpToPrevSlide,
    retreatReveal,
    advanceReveal,
    jumpToNextSlide,
    compact = false,
}) {
    return (
        <div className={`presentation-beamer-dock${compact ? ' compact' : ''}`}>
            <div className="presentation-beamer-dock-actions">
                <button
                    type="button"
                    className={`btn btn-outline${compact ? ' presentation-dock-nav-btn compact' : ' presentation-dock-nav-btn'}`}
                    onClick={jumpToPrevSlide}
                    disabled={activeSlideIndex === 0}
                    title="Slide trước"
                    aria-label="Slide trước"
                >
                    <i className="bi bi-skip-backward"></i>
                    {!compact && <span>Slide trước</span>}
                </button>
                <button
                    type="button"
                    className={`btn btn-outline${compact ? ' presentation-dock-nav-btn compact' : ' presentation-dock-nav-btn'}`}
                    onClick={retreatReveal}
                    disabled={currentRevealIndex === 0}
                    title="Lùi bước"
                    aria-label="Lùi bước"
                >
                    <i className="bi bi-chevron-left"></i>
                    {!compact && <span>Lùi bước</span>}
                </button>
            </div>

            <div className="presentation-beamer-dock-center">
                <div className="presentation-beamer-dock-meta">
                    <strong>Slide {activeSlideIndex + 1}/{slidesLength}</strong>
                    <span>{compact ? 'Bấm icon để mở đúng lớp nội dung cần chiếu.' : 'Nhảy trực tiếp tới Đáp án hoặc Lời giải thay vì chỉ bấm bước tiếp.'}</span>
                </div>
                <div className="presentation-reveal-timeline presentation-reveal-timeline-dock">
                    {revealStages.map((stage, index) => (
                        <button
                            key={stage}
                            type="button"
                            className={`presentation-reveal-chip ${index <= currentRevealIndex ? 'active' : ''}${index === currentRevealIndex ? ' current' : ''}`}
                            onClick={() => setCurrentRevealIndex(index)}
                            title={getRevealChipLabel(stage)}
                            aria-label={getRevealChipLabel(stage)}
                        >
                            <i className={`bi bi-${getRevealChipIcon(stage)}`}></i>
                            {!compact && <span>{getRevealChipLabel(stage)}</span>}
                        </button>
                    ))}
                </div>
            </div>

            <div className="presentation-beamer-dock-actions align-end">
                <button
                    type="button"
                    className={`btn btn-primary${compact ? ' presentation-dock-nav-btn compact' : ' presentation-dock-nav-btn'}`}
                    onClick={advanceReveal}
                    disabled={currentRevealIndex >= revealStages.length - 1}
                    title="Mở bước tiếp"
                    aria-label="Mở bước tiếp"
                >
                    {!compact && <span>Mở bước tiếp</span>}
                    <i className="bi bi-chevron-right"></i>
                </button>
                <button
                    type="button"
                    className={`btn btn-primary${compact ? ' presentation-dock-nav-btn compact' : ' presentation-dock-nav-btn'}`}
                    onClick={jumpToNextSlide}
                    disabled={activeSlideIndex >= slidesLength - 1}
                    title="Slide tiếp"
                    aria-label="Slide tiếp"
                >
                    {!compact && <span>Slide tiếp</span>}
                    <i className="bi bi-skip-forward"></i>
                </button>
            </div>
        </div>
    );
}

function playCue(cueId) {
    if (!cueId) return;
    if (cueId === 'correct') {
        playCorrect();
        return;
    }
    if (cueId === 'start') {
        playStart();
        return;
    }
    playTick();
}

function PresentationResourceChips({ links = [], title = 'Tài nguyên' }) {
    if (!links.length) return null;

    return (
        <div className="presentation-resource-panel">
            <span className="presentation-answer-label">{title}</span>
            <div className="presentation-resource-chip-row">
                {links.map((link) => (
                    <a
                        key={`${link.scope}-${link.href}`}
                        href={link.href}
                        target={link.href?.startsWith('#') ? '_self' : '_blank'}
                        rel={link.href?.startsWith('#') ? undefined : 'noreferrer noopener'}
                        className="presentation-resource-chip"
                    >
                        <i className={`bi bi-${RESOURCE_ICONS[link.kind] || RESOURCE_ICONS.link}`}></i>
                        <span>{link.label}</span>
                    </a>
                ))}
            </div>
        </div>
    );
}

function PresentationImageLightbox({ src, alt, onClose }) {
    if (!src) return null;

    return (
        <div className="presentation-image-lightbox" onClick={onClose} role="presentation">
            <button type="button" className="presentation-image-close" onClick={onClose}>
                <i className="bi bi-x-lg"></i>
            </button>
            <img src={src} alt={alt || ''} />
        </div>
    );
}

function PresentationSpotlightLayer({ enabled, position, size }) {
    if (!enabled) return null;

    return (
        <div
            className="presentation-spotlight-layer"
            style={{
                '--spot-x': `${Math.round((position?.x || 0.5) * 100)}%`,
                '--spot-y': `${Math.round((position?.y || 0.5) * 100)}%`,
                '--spot-size': `${size || 24}%`,
            }}
            aria-hidden="true"
        ></div>
    );
}

function PresentationStageContent({
    slide,
    exam,
    currentQuestionPoints,
    revealStages,
    revealIndex,
    currentHintHtml,
    resourceGroups,
}) {
    if (!slide) return null;

    const visibleStages = new Set(revealStages.slice(0, revealIndex + 1));
    const showHint = visibleStages.has('hint');
    const answerVisible = visibleStages.has('answer');
    const explanationVisible = visibleStages.has('explanation');
    const resourcesVisible = visibleStages.has('resources');
    const currentQuestion = slide.type === 'question' ? slide.question : null;
    const answerSummary = currentQuestion?.type === 'mcq'
        ? currentQuestion.correct_answer ? `Đáp án ${currentQuestion.correct_answer}` : null
        : currentQuestion?.type === 'short_answer'
            ? 'Đáp án ngắn đã mở'
            : currentQuestion?.type === 'essay'
                ? 'Gợi ý chấm đã mở'
                : null;

    return (
        <>
            {slide.type === 'cover' && (
                <div className="presentation-slide presentation-slide-cover">
                    <div className="presentation-cover-grid">
                        <div className="presentation-cover-copy">
                            <span className="presentation-kicker">Chế độ dạy học trực tiếp</span>
                            <h2>{exam.title}</h2>
                            <p>
                                Deck này tái dùng trực tiếp đề, lời giải, section và hyperlink tài nguyên để giáo viên lên lớp dạy luôn.
                            </p>
                        </div>

                        <div className="presentation-cover-panel">
                            <div className="presentation-stat-card">
                                <span>Tổng câu</span>
                                <strong>{exam.questionCount || 0}</strong>
                            </div>
                            <div className="presentation-stat-card">
                                <span>Môn / khối</span>
                                <strong>{exam.subject || 'Chưa gán'} · {exam.grade || 'Chưa gán'}</strong>
                            </div>
                            <div className="presentation-stat-card">
                                <span>Điều khiển</span>
                                <strong>Space · ← → · F</strong>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {slide.type === 'section' && (
                <div className="presentation-slide presentation-slide-section">
                    <span className="presentation-kicker">Phần {slide.section.groupIndex + 1}</span>
                    <h2>{slide.section.title || 'Phần câu hỏi'}</h2>
                    <div className="presentation-section-meta">
                        <span>Bắt đầu từ câu {slide.questionNumber}</span>
                        {slide.section.questionLimit && <span>Lấy {slide.section.questionLimit} câu</span>}
                        <span>{slide.section.shuffleQuestions !== false ? 'Có trộn câu trong phần' : 'Giữ nguyên thứ tự trong phần'}</span>
                    </div>
                    {slide.section.contextHtml && (
                        <div className="presentation-section-context" dangerouslySetInnerHTML={{ __html: renderLatex(slide.section.contextHtml) }} />
                    )}
                    {resourcesVisible && <PresentationResourceChips links={resourceGroups.sectionLinks} title="Tài nguyên của phần" />}
                </div>
            )}

            {slide.type === 'question' && currentQuestion && (
                <div className="presentation-slide presentation-slide-question">
                    <div className="presentation-question-header">
                        <div className="presentation-question-headline">
                            <div className="presentation-question-kicker">
                                <span className="presentation-question-number">Câu {slide.questionNumber}</span>
                                <span className="presentation-question-type">{TYPE_LABELS[currentQuestion.type] || currentQuestion.type}</span>
                                <span className="presentation-question-points">{currentQuestionPoints} điểm</span>
                            </div>
                            <div className="presentation-question-context">
                                <span>{currentQuestion.deliverySection?.title || exam.subject || 'Deck chữa bài'}</span>
                                {currentQuestion.deliverySection?.questionIndexInSection && (
                                    <strong>
                                        {`Trong phần: ${currentQuestion.deliverySection.questionIndexInSection}/${currentQuestion.deliverySection.questionCountInSection}`}
                                    </strong>
                                )}
                            </div>
                        </div>
                        {answerVisible && answerSummary && <div className="presentation-live-answer-pill"><i className="bi bi-patch-check-fill"></i> {answerSummary}</div>}
                    </div>

                    <div className="presentation-question-stem" dangerouslySetInnerHTML={{ __html: getQuestionHtml(currentQuestion) }} />

                    {showHint && currentHintHtml && (
                        <div className="presentation-hint-box" dangerouslySetInnerHTML={{ __html: currentHintHtml }} />
                    )}

                    {(currentQuestion.type === 'mcq' || currentQuestion.type === 'tf') && (
                        <div className={`presentation-choice-grid ${currentQuestion.type === 'tf' ? 'tf' : ''}`}>
                            {(currentQuestion.choices || []).map((choice, choiceIndex) => {
                                const tfAnswer = currentQuestion.type === 'tf' ? getTfChoiceAnswer(currentQuestion, choiceIndex) : null;
                                const isCorrect = currentQuestion.type === 'mcq' ? Boolean(choice.isCorrect) : false;
                                return (
                                    <div
                                        key={`${choice.letter || choiceIndex}-${choiceIndex}`}
                                        className={`presentation-choice-card ${answerVisible && isCorrect ? 'is-correct' : ''}${answerVisible && currentQuestion.type === 'tf' ? ` tf-${tfAnswer === 'Đúng' ? 'true' : 'false'}` : ''}`}
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
                            <strong>{answerVisible ? currentQuestion.correct_answer || 'Chưa có đáp án' : 'Đề bài đang chờ bước lộ đáp án.'}</strong>
                        </div>
                    )}

                    {currentQuestion.type === 'essay' && (
                        <div className={`presentation-answer-box essay ${answerVisible ? 'visible' : ''}`}>
                            <span className="presentation-answer-label">Gợi ý chấm / đáp án mở</span>
                            <div dangerouslySetInnerHTML={{ __html: renderLatex(answerVisible ? currentQuestion.correct_answer || 'Chưa có gợi ý chấm' : 'Đề bài đang chờ bước lộ đáp án.') }} />
                        </div>
                    )}

                    {explanationVisible && (currentQuestion.explanation || currentQuestion.explanation_html) && (
                        <div className="presentation-explanation-panel">
                            <div className="presentation-explanation-head"><i className="bi bi-lightbulb"></i> Lời giải</div>
                            <div dangerouslySetInnerHTML={{ __html: getExplanationHtml(currentQuestion) }} />
                        </div>
                    )}

                    {resourcesVisible && <PresentationResourceChips links={resourceGroups.allLinks} title="Tài nguyên của câu" />}
                </div>
            )}
        </>
    );
}

function SlideEmptyState({ examId, missingSession = false }) {
    return (
        <div className="presentation-empty-state">
            <div className="presentation-empty-icon"><i className="bi bi-easel2"></i></div>
            <h2>{missingSession ? 'Thiếu phiên presenter/projector' : 'Đề này chưa có dữ liệu để trình chiếu'}</h2>
            <p>
                {missingSession
                    ? 'Hãy mở Projector từ Presenter View để đồng bộ màn chiếu.'
                    : 'Trang này dành cho đề cố định đã có câu hỏi và lời giải, để giáo viên mở lên chiếu dạy trực tiếp.'}
            </p>
            <div className="presentation-empty-actions">
                <Link to={`/teacher/exam/${examId}`} className="btn btn-primary">
                    <i className="bi bi-arrow-left"></i> Quay lại chi tiết đề
                </Link>
            </div>
        </div>
    );
}

export default function ExamPresentationDeckPage() {
    const { examId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const rootRef = useRef(null);
    const syncChannelRef = useRef(null);
    const cueStateRef = useRef({ initialized: false, slideId: null, revealIndex: 0 });
    const [exam, setExam] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showOutline, setShowOutline] = useState(false);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [followExamShuffle, setFollowExamShuffle] = useState(false);
    const [fullscreenSupported, setFullscreenSupported] = useState(false);
    const [isFullscreenActive, setIsFullscreenActive] = useState(Boolean(getFullscreenElement()));
    const [themeId, setThemeId] = useState('lecture');
    const [soundProfileId, setSoundProfileId] = useState('lecture');
    const [soundMuted, setSoundMuted] = useState(false);
    const [soundVolume, setSoundVolume] = useState(0.7);
    const [revealProgressBySlideId, setRevealProgressBySlideId] = useState({});
    const [localHints, setLocalHints] = useState({});
    const [speakerNotes, setSpeakerNotes] = useState({});
    const [spotlightEnabled, setSpotlightEnabled] = useState(false);
    const [spotlightSize, setSpotlightSize] = useState(24);
    const [spotlightPosition, setSpotlightPosition] = useState({ x: 0.5, y: 0.5 });
    const [lightboxImage, setLightboxImage] = useState(null);
    const [projectorHeartbeat, setProjectorHeartbeat] = useState(0);
    const [syncReady, setSyncReady] = useState(false);
    const [sessionStart] = useState(() => Date.now());
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    const role = normalizePresentationRole(searchParams.get('role'));
    const sessionId = searchParams.get('session') || '';
    const isPresenterRole = role === PRESENTATION_ROLE_PRESENTER;
    const isProjectorRole = role === PRESENTATION_ROLE_PROJECTOR;
    const isStandaloneRole = role === PRESENTATION_ROLE_STANDALONE;
    const workbenchStorageKey = useMemo(() => getWorkbenchStorageKey(user?.uid, examId), [examId, user?.uid]);

    useEffect(() => {
        if (!isPresenterRole || sessionId) return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('role', PRESENTATION_ROLE_PRESENTER);
        nextParams.set('session', buildPresentationSessionId());
        setSearchParams(nextParams, { replace: true });
    }, [isPresenterRole, searchParams, sessionId, setSearchParams]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            const raw = window.localStorage.getItem(workbenchStorageKey);
            if (!raw) {
                const defaults = getDefaultWorkbenchState();
                setThemeId(defaults.themeId);
                setSoundProfileId(defaults.soundProfileId);
                setSoundMuted(defaults.soundMuted);
                setSoundVolume(defaults.soundVolume);
                setSpotlightSize(defaults.spotlightSize);
                setFollowExamShuffle(defaults.followExamShuffle);
                setSyncReady(true);
                return;
            }
            const saved = { ...getDefaultWorkbenchState(), ...JSON.parse(raw) };
            setThemeId(saved.themeId || 'lecture');
            setSoundProfileId(saved.soundProfileId || 'lecture');
            setSoundMuted(Boolean(saved.soundMuted));
            setSoundVolume(Math.max(0, Math.min(1, Number(saved.soundVolume) || 0.7)));
            setSpotlightSize(Math.max(12, Math.min(46, Number(saved.spotlightSize) || 24)));
            setFollowExamShuffle(Boolean(saved.followExamShuffle));
            setLocalHints(saved.localHints || {});
            setSpeakerNotes(saved.speakerNotes || {});
        } catch {
            const defaults = getDefaultWorkbenchState();
            setThemeId(defaults.themeId);
            setSoundProfileId(defaults.soundProfileId);
            setSoundMuted(defaults.soundMuted);
            setSoundVolume(defaults.soundVolume);
            setSpotlightSize(defaults.spotlightSize);
            setFollowExamShuffle(defaults.followExamShuffle);
        } finally {
            setSyncReady(true);
        }
    }, [workbenchStorageKey]);

    useEffect(() => {
        if (!syncReady || typeof window === 'undefined' || !window.localStorage) return;
        try {
            window.localStorage.setItem(workbenchStorageKey, JSON.stringify({
                localHints,
                speakerNotes,
                themeId,
                soundProfileId,
                soundMuted,
                soundVolume,
                spotlightSize,
                followExamShuffle,
            }));
        } catch {
            // Ignore local storage write failures.
        }
    }, [followExamShuffle, localHints, soundMuted, soundProfileId, soundVolume, speakerNotes, spotlightSize, syncReady, themeId, workbenchStorageKey]);

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
        const supported = Boolean(element && (element.requestFullscreen || element.webkitRequestFullscreen));
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

    useEffect(() => {
        configureSoundEngine({ muted: soundMuted, volume: soundVolume });
        return () => resetSoundEngine();
    }, [soundMuted, soundVolume]);

    useEffect(() => {
        if (!isPresenterRole) return;
        const interval = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - sessionStart) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [isPresenterRole, sessionStart]);

    const deliveredQuestions = useMemo(() => {
        if (!questions.length) return [];
        return orderQuestionsForDelivery(questions, {
            shuffleQuestions: followExamShuffle ? exam?.shuffleQuestions !== false : false,
            shuffleChoices: followExamShuffle ? exam?.shuffleChoices !== false : false,
        });
    }, [exam?.shuffleChoices, exam?.shuffleQuestions, followExamShuffle, questions]);

    const slides = useMemo(() => buildSlides(exam, deliveredQuestions), [deliveredQuestions, exam]);
    const dynamicBankExam = isDynamicBankDelivery(exam?.deliveryConfig);
    const maxSlideIndex = Math.max(slides.length - 1, 0);
    const activeSlideIndex = Math.min(currentSlideIndex, maxSlideIndex);
    const currentSlide = slides[activeSlideIndex] || slides[0] || null;
    const nextSlide = slides[activeSlideIndex + 1] || null;
    const questionSlideCount = deliveredQuestions.length;
    const currentProgress = slides.length > 1 ? Math.round((activeSlideIndex / (slides.length - 1)) * 100) : 0;
    const currentQuestion = currentSlide?.type === 'question' ? currentSlide.question : null;
    const currentQuestionPoints = currentQuestion
        ? getQuestionMaxPoints(currentQuestion, exam?.questionScoring || DEFAULT_QUESTION_SCORING, exam?.tfScoring || DEFAULT_TF_SCORING)
        : 0;
    const currentResourceGroups = useMemo(() => getSlideResourceGroups(currentSlide), [currentSlide]);
    const currentHintText = currentSlide ? (localHints[currentSlide.id] || currentQuestion?.presentationHint || '') : '';
    const currentHintHtml = currentHintText ? noteToHtml(currentHintText) : '';
    const revealStages = useMemo(() => getSlideRevealStages(currentSlide, currentHintText, currentResourceGroups), [currentHintText, currentResourceGroups, currentSlide]);
    const currentRevealIndex = currentSlide ? Math.min(revealProgressBySlideId[currentSlide.id] || 0, revealStages.length - 1) : 0;
    const visibleStages = new Set(revealStages.slice(0, currentRevealIndex + 1));
    const currentAutoNotesHtml = useMemo(() => {
        if (!currentSlide) return '';
        if (currentSlide.type === 'cover') {
            return noteToHtml(`Mục tiêu: mở nhanh bộ đề, dẫn lớp theo từng câu, lộ đáp án và lời giải theo nhịp dạy.`);
        }
        if (currentSlide.type === 'section') {
            return renderLatex(currentSlide.section?.contextHtml || noteToHtml(currentSlide.section?.contextText || ''));
        }
        if (currentQuestion?.explanation || currentQuestion?.explanation_html) {
            return getExplanationHtml(currentQuestion);
        }
        if (currentQuestion?.correct_answer) {
            return noteToHtml(`Đáp án / gợi ý chấm: ${currentQuestion.correct_answer}`);
        }
        return noteToHtml('Chưa có lời giải gốc cho câu này.');
    }, [currentQuestion, currentSlide]);

    useEffect(() => {
        if (!currentSlide) return;
        const maxReveal = Math.max(0, revealStages.length - 1);
        if ((revealProgressBySlideId[currentSlide.id] || 0) > maxReveal) {
            setRevealProgressBySlideId((previous) => ({
                ...previous,
                [currentSlide.id]: maxReveal,
            }));
        }
    }, [currentSlide, revealProgressBySlideId, revealStages.length]);

    const syncSnapshot = useMemo(() => ({
        activeSlideIndex,
        followExamShuffle,
        themeId,
        soundProfileId,
        soundMuted,
        soundVolume,
        revealProgressBySlideId,
        localHints,
        spotlightEnabled,
        spotlightSize,
        spotlightPosition,
        updatedAt: Date.now(),
    }), [activeSlideIndex, followExamShuffle, localHints, revealProgressBySlideId, soundMuted, soundProfileId, soundVolume, spotlightEnabled, spotlightPosition, spotlightSize, themeId]);

    const applySnapshot = useCallback((snapshot) => {
        if (!snapshot || typeof snapshot !== 'object') return;
        if (typeof snapshot.activeSlideIndex === 'number') setCurrentSlideIndex(Math.max(0, Math.min(snapshot.activeSlideIndex, maxSlideIndex)));
        if (typeof snapshot.followExamShuffle === 'boolean') setFollowExamShuffle(snapshot.followExamShuffle);
        if (typeof snapshot.themeId === 'string') setThemeId(snapshot.themeId);
        if (typeof snapshot.soundProfileId === 'string') setSoundProfileId(snapshot.soundProfileId);
        if (typeof snapshot.soundMuted === 'boolean') setSoundMuted(snapshot.soundMuted);
        if (typeof snapshot.soundVolume === 'number') setSoundVolume(Math.max(0, Math.min(1, snapshot.soundVolume)));
        if (snapshot.revealProgressBySlideId && typeof snapshot.revealProgressBySlideId === 'object') setRevealProgressBySlideId(snapshot.revealProgressBySlideId);
        if (snapshot.localHints && typeof snapshot.localHints === 'object') setLocalHints(snapshot.localHints);
        if (typeof snapshot.spotlightEnabled === 'boolean') setSpotlightEnabled(snapshot.spotlightEnabled);
        if (typeof snapshot.spotlightSize === 'number') setSpotlightSize(Math.max(12, Math.min(46, snapshot.spotlightSize)));
        if (snapshot.spotlightPosition && typeof snapshot.spotlightPosition === 'object') {
            setSpotlightPosition({
                x: Math.max(0, Math.min(1, Number(snapshot.spotlightPosition.x) || 0.5)),
                y: Math.max(0, Math.min(1, Number(snapshot.spotlightPosition.y) || 0.5)),
            });
        }
    }, [maxSlideIndex]);

    useEffect(() => {
        if (!sessionId || isStandaloneRole) return undefined;
        const channel = openPresentationSyncChannel(sessionId);
        syncChannelRef.current = channel;
        const snapshot = loadPresentationSnapshot(sessionId);
        if (isProjectorRole && snapshot) applySnapshot(snapshot);

        if (channel) {
            channel.onmessage = (event) => {
                const message = event.data || {};
                if (isProjectorRole && message.type === 'sync' && message.snapshot) {
                    applySnapshot(message.snapshot);
                    return;
                }
                if (isPresenterRole && message.type === 'projector-ready') {
                    setProjectorHeartbeat(Date.now());
                    channel.postMessage({ type: 'sync', snapshot: syncSnapshot });
                    return;
                }
                if (isPresenterRole && message.type === 'request-sync') {
                    channel.postMessage({ type: 'sync', snapshot: syncSnapshot });
                }
            };

            if (isProjectorRole) {
                channel.postMessage({ type: 'projector-ready' });
                channel.postMessage({ type: 'request-sync' });
            }
        }

        return () => {
            if (channel) channel.close();
            syncChannelRef.current = null;
        };
    }, [applySnapshot, isPresenterRole, isProjectorRole, isStandaloneRole, sessionId, syncSnapshot]);

    useEffect(() => {
        if (!sessionId || !isPresenterRole) return;
        savePresentationSnapshot(sessionId, syncSnapshot);
        if (syncChannelRef.current) {
            syncChannelRef.current.postMessage({ type: 'sync', snapshot: syncSnapshot });
        }
    }, [isPresenterRole, sessionId, syncSnapshot]);

    const activeSoundProfile = useMemo(() => SOUND_PROFILES.find((profile) => profile.id === soundProfileId) || SOUND_PROFILES[0], [soundProfileId]);
    const activeThemePreset = useMemo(() => THEME_PRESETS.find((theme) => theme.id === themeId) || THEME_PRESETS[0], [themeId]);
    const elapsedDisplay = useMemo(() => {
        const m = Math.floor(elapsedSeconds / 60);
        const s = elapsedSeconds % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, [elapsedSeconds]);

    const triggerPresentationCue = useCallback((cueType) => {
        if (isPresenterRole) return;
        playCue(activeSoundProfile.cues[cueType]);
    }, [activeSoundProfile.cues, isPresenterRole]);

    useEffect(() => {
        if (!currentSlide || isPresenterRole) return;

        const previous = cueStateRef.current;
        if (!previous.initialized) {
            cueStateRef.current = {
                initialized: true,
                slideId: currentSlide.id,
                revealIndex: currentRevealIndex,
            };
            return;
        }

        if (previous.slideId !== currentSlide.id) {
            triggerPresentationCue(currentSlide.type === 'section' ? 'section' : 'slide');
        } else if (currentRevealIndex > previous.revealIndex) {
            const revealedStage = revealStages[currentRevealIndex];
            if (revealedStage === 'answer') triggerPresentationCue('answer');
            else if (revealedStage === 'explanation') triggerPresentationCue('explanation');
            else if (revealedStage === 'resources') triggerPresentationCue('resources');
            else triggerPresentationCue('slide');
        }

        cueStateRef.current = {
            initialized: true,
            slideId: currentSlide.id,
            revealIndex: currentRevealIndex,
        };
    }, [currentRevealIndex, currentSlide, isPresenterRole, revealStages, triggerPresentationCue]);

    const setCurrentRevealIndex = useCallback((nextIndex) => {
        if (!currentSlide) return;
        const bounded = Math.max(0, Math.min(revealStages.length - 1, nextIndex));
        setRevealProgressBySlideId((previous) => ({
            ...previous,
            [currentSlide.id]: bounded,
        }));
    }, [currentSlide, revealStages.length]);

    const advanceReveal = useCallback(() => {
        if (!currentSlide) return false;
        if (currentRevealIndex >= revealStages.length - 1) return false;
        const nextIndex = currentRevealIndex + 1;
        setCurrentRevealIndex(nextIndex);
        const nextStage = revealStages[nextIndex];
        if (nextStage === 'answer') triggerPresentationCue('answer');
        else if (nextStage === 'explanation') triggerPresentationCue('explanation');
        else if (nextStage === 'resources') triggerPresentationCue('resources');
        else triggerPresentationCue('slide');
        return true;
    }, [currentRevealIndex, currentSlide, revealStages, setCurrentRevealIndex, triggerPresentationCue]);

    const retreatReveal = useCallback(() => {
        if (!currentSlide || currentRevealIndex <= 0) return false;
        setCurrentRevealIndex(currentRevealIndex - 1);
        return true;
    }, [currentRevealIndex, currentSlide, setCurrentRevealIndex]);

    const jumpToSlide = useCallback((index) => {
        setCurrentSlideIndex(Math.max(0, Math.min(index, maxSlideIndex)));
        setShowOutline(false);
        triggerPresentationCue('slide');
    }, [maxSlideIndex, triggerPresentationCue]);

    const jumpToPrevSlide = useCallback(() => {
        setCurrentSlideIndex((previous) => Math.max(previous - 1, 0));
        triggerPresentationCue('slide');
    }, [triggerPresentationCue]);

    const jumpToNextSlide = useCallback(() => {
        setCurrentSlideIndex((previous) => Math.min(previous + 1, maxSlideIndex));
        triggerPresentationCue(currentSlide?.type === 'section' ? 'section' : 'slide');
    }, [currentSlide?.type, maxSlideIndex, triggerPresentationCue]);

    const goPrev = useCallback(() => {
        if (retreatReveal()) return;
        jumpToPrevSlide();
    }, [jumpToPrevSlide, retreatReveal]);

    const goNext = useCallback(() => {
        if (advanceReveal()) return;
        jumpToNextSlide();
    }, [advanceReveal, jumpToNextSlide]);

    const enableFullscreen = useCallback(async () => {
        try {
            await requestElementFullscreen(rootRef.current);
        } catch (error) {
            console.error('presentation fullscreen failed', error);
            Swal.fire('Không bật được toàn màn hình', 'Trình duyệt đã chặn yêu cầu toàn màn hình.', 'warning');
        }
    }, []);

    const openProjectorWindow = useCallback(() => {
        if (!isPresenterRole || !sessionId) return;
        const url = `${window.location.origin}/teacher/exam/${examId}/presentation?role=${PRESENTATION_ROLE_PROJECTOR}&session=${encodeURIComponent(sessionId)}`;
        const projectorWindow = window.open(url, `thi-online-projector-${sessionId}`, 'popup=yes,width=1440,height=960');
        if (!projectorWindow) {
            Swal.fire('Popup bị chặn', 'Hãy cho phép popup để mở màn chiếu projector.', 'warning');
        }
    }, [examId, isPresenterRole, sessionId]);

    const copyProjectorUrl = useCallback(async () => {
        if (!sessionId) return;
        const url = `${window.location.origin}/teacher/exam/${examId}/presentation?role=${PRESENTATION_ROLE_PROJECTOR}&session=${encodeURIComponent(sessionId)}`;
        try {
            await navigator.clipboard.writeText(url);
            Swal.fire({ icon: 'success', title: 'Đã copy link projector', timer: 1200, showConfirmButton: false });
        } catch {
            Swal.fire('Không copy được', 'Trình duyệt hiện tại chặn clipboard.', 'info');
        }
    }, [examId, sessionId]);

    const switchToPresenterMode = useCallback(() => {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('role', PRESENTATION_ROLE_PRESENTER);
        if (!nextParams.get('session')) nextParams.set('session', buildPresentationSessionId());
        setSearchParams(nextParams);
    }, [searchParams, setSearchParams]);

    const switchToStandaloneMode = useCallback(() => {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('role');
        nextParams.delete('session');
        setSearchParams(nextParams);
    }, [searchParams, setSearchParams]);

    const handleStageMouseMove = useCallback((event) => {
        if (!spotlightEnabled || isProjectorRole) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        setSpotlightPosition({
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        });
    }, [isProjectorRole, spotlightEnabled]);

    const handleStageClick = useCallback((event) => {
        const image = event.target.closest('img');
        if (!image) return;
        setLightboxImage({ src: image.getAttribute('src'), alt: image.getAttribute('alt') || '' });
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
            if (event.key.toLowerCase() === 'o' && !isProjectorRole) {
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
    }, [enableFullscreen, fullscreenSupported, goNext, goPrev, isProjectorRole]);

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang dựng trình chiếu HTML...</p></div>;
    }

    if (!exam || dynamicBankExam || !questions.length) {
        return <SlideEmptyState examId={examId} />;
    }

    if (isProjectorRole && !sessionId) {
        return <SlideEmptyState examId={examId} missingSession />;
    }

    const presenterConnected = projectorHeartbeat > 0 && Date.now() - projectorHeartbeat < 60000;

    if (isProjectorRole) {
        return (
            <div className={`exam-presentation-page presentation-theme-${themeId} is-projector`} ref={rootRef}>
                <div className="presentation-backdrop presentation-backdrop-a"></div>
                <div className="presentation-backdrop presentation-backdrop-b"></div>
                <div className="presentation-projector-shell">
                    <div className="presentation-projector-topline">
                        <div className="presentation-projector-status">
                            <span className="presentation-mode-pill">Beamer</span>
                            <strong>{getSlideLabel(currentSlide)}</strong>
                        </div>
                        <div className="presentation-projector-stage-flags">
                            {revealStages.slice(0, currentRevealIndex + 1).map((stage) => (
                                <span key={stage} className="presentation-projector-flag">{getRevealChipLabel(stage)}</span>
                            ))}
                            <span className="presentation-projector-counter">{activeSlideIndex + 1}/{slides.length}</span>
                        </div>
                    </div>

                    <div className="presentation-projector-stage-frame">
                        <div className="presentation-projector-stage presentation-stage-beamer" onMouseMove={handleStageMouseMove} onClick={handleStageClick} role="presentation">
                            <PresentationStageContent
                                slide={currentSlide}
                                exam={exam}
                                currentQuestionPoints={currentQuestionPoints}
                                revealStages={revealStages}
                                revealIndex={currentRevealIndex}
                                currentHintHtml={currentHintHtml}
                                resourceGroups={currentResourceGroups}
                            />
                            <PresentationSpotlightLayer enabled={spotlightEnabled} position={spotlightPosition} size={spotlightSize} />
                        </div>
                    </div>
                    <div className="presentation-projector-progress" style={{ width: `${currentProgress}%` }}></div>
                </div>
                <PresentationImageLightbox src={lightboxImage?.src} alt={lightboxImage?.alt} onClose={() => setLightboxImage(null)} />
            </div>
        );
    }

    return (
        <div className={`exam-presentation-page presentation-theme-${themeId}${isPresenterRole ? ' is-presenter' : ''}`} ref={rootRef}>
            <div className="presentation-backdrop presentation-backdrop-a"></div>
            <div className="presentation-backdrop presentation-backdrop-b"></div>

            <header className="presentation-toolbar">
                <div className="presentation-toolbar-main">
                    <span className="presentation-mode-pill">
                        {isPresenterRole ? 'Presenter Controller' : 'Beamer Deck'}
                    </span>
                    <div>
                        <h1>{exam.title}</h1>
                        <div className="presentation-toolbar-meta">
                            <span>{exam.subject || 'Chưa gán môn'}</span>
                            <span>{exam.grade || 'Chưa gán khối'}</span>
                            <span>{questionSlideCount} câu</span>
                            <span>{exam.duration || 0} phút</span>
                            {isPresenterRole && <span>{presenterConnected ? 'Projector đã kết nối' : 'Chưa thấy projector'}</span>}
                        </div>
                    </div>
                </div>

                <div className="presentation-toolbar-actions">
                    {!isPresenterRole && (
                        <button type="button" className="btn btn-outline btn-sm presentation-toolbar-action-btn" onClick={switchToPresenterMode} title="Mở Presenter Controller" aria-label="Mở Presenter Controller">
                            <i className="bi bi-display"></i>
                            <span>Presenter</span>
                        </button>
                    )}
                    {isPresenterRole && (
                        <>
                            <button type="button" className="btn btn-primary btn-sm presentation-toolbar-action-btn" onClick={openProjectorWindow} title="Mở Projector" aria-label="Mở Projector">
                                <i className="bi bi-window-desktop"></i>
                                <span>Projector</span>
                            </button>
                            <button type="button" className="btn btn-outline btn-sm presentation-toolbar-action-btn" onClick={copyProjectorUrl} title="Copy link projector" aria-label="Copy link projector">
                                <i className="bi bi-link-45deg"></i>
                                <span>Copy link</span>
                            </button>
                            <button type="button" className="btn btn-outline btn-sm presentation-toolbar-action-btn" onClick={switchToStandaloneMode} title="Đổi sang deck thường" aria-label="Đổi sang deck thường">
                                <i className="bi bi-easel2"></i>
                                <span>Deck</span>
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        className={`btn btn-sm presentation-toolbar-action-btn ${followExamShuffle ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => {
                            setFollowExamShuffle((previous) => !previous);
                            setCurrentSlideIndex(0);
                            setRevealProgressBySlideId({});
                        }}
                        title="Bật để xem đúng thứ tự xáo theo cấu hình phát đề"
                        aria-label={followExamShuffle ? 'Đang bám cấu hình đề' : 'Đang giữ thứ tự dạy'}
                    >
                        <i className="bi bi-shuffle"></i>
                        <span>{followExamShuffle ? 'Bám cấu hình' : 'Thứ tự dạy'}</span>
                    </button>
                    {!isPresenterRole && (
                        <button type="button" className="btn btn-outline btn-sm presentation-toolbar-action-btn" onClick={() => setShowOutline((previous) => !previous)} title="Mở danh sách đầy đủ" aria-label="Mở danh sách đầy đủ">
                            <i className="bi bi-list-ul"></i>
                            <span>Danh sách</span>
                        </button>
                    )}
                    {fullscreenSupported && (
                        <button type="button" className="btn btn-outline btn-sm presentation-toolbar-action-btn" onClick={enableFullscreen} title={isFullscreenActive ? 'Thoát toàn màn hình' : 'Toàn màn hình'} aria-label={isFullscreenActive ? 'Thoát toàn màn hình' : 'Toàn màn hình'}>
                            <i className={`bi bi-${isFullscreenActive ? 'fullscreen-exit' : 'arrows-fullscreen'}`}></i>
                            <span>{isFullscreenActive ? 'Thu lại' : 'Fullscreen'}</span>
                        </button>
                    )}
                    <Link to={`/teacher/exam/${examId}`} className="btn btn-outline btn-sm presentation-toolbar-action-btn" title="Về trang chi tiết đề" aria-label="Về trang chi tiết đề">
                        <i className="bi bi-arrow-left"></i>
                        <span>Về đề</span>
                    </Link>
                </div>
            </header>

            <div className="presentation-progress-track" aria-hidden="true">
                <div className="presentation-progress-bar" style={{ width: `${currentProgress}%` }}></div>
            </div>

            {isPresenterRole ? (
                <div className="presenter-workspace">
                    {/* ── Left: Stage column ── */}
                    <div className="presenter-stage-col">
                        <PresentationQuestionRail
                            slides={slides}
                            activeSlideIndex={activeSlideIndex}
                            jumpToSlide={jumpToSlide}
                            revealProgressBySlideId={revealProgressBySlideId}
                            localHints={localHints}
                        />

                        <div className="presenter-stage-viewport">
                            <div className="presentation-stage presentation-stage-beamer" onMouseMove={handleStageMouseMove} onClick={handleStageClick} role="presentation">
                                <PresentationStageContent
                                    slide={currentSlide}
                                    exam={exam}
                                    currentQuestionPoints={currentQuestionPoints}
                                    revealStages={revealStages}
                                    revealIndex={currentRevealIndex}
                                    currentHintHtml={currentHintHtml}
                                    resourceGroups={currentResourceGroups}
                                />
                                <PresentationSpotlightLayer enabled={spotlightEnabled} position={spotlightPosition} size={spotlightSize} />
                            </div>
                        </div>

                        {/* Navigation strip */}
                        <div className="presenter-navstrip">
                            <button type="button" className="presenter-navstrip-btn" onClick={jumpToPrevSlide} disabled={activeSlideIndex === 0} title="Slide trước (PageUp)" aria-label="Slide trước">
                                <i className="bi bi-skip-backward-fill"></i>
                            </button>
                            <button type="button" className="presenter-navstrip-btn" onClick={retreatReveal} disabled={currentRevealIndex === 0} title="Lùi bước (←)" aria-label="Lùi bước">
                                <i className="bi bi-chevron-left"></i>
                            </button>
                            <div className="presenter-navstrip-center">
                                <div className="presenter-navstrip-progress">Slide {activeSlideIndex + 1} / {slides.length}</div>
                                <div className="presenter-navstrip-stages">
                                    {revealStages.map((stage, index) => (
                                        <button key={stage} type="button" className={`presenter-navstrip-stage${index < currentRevealIndex ? ' done' : ''}${index === currentRevealIndex ? ' current' : ''}`} onClick={() => setCurrentRevealIndex(index)} title={getRevealChipLabel(stage)}>
                                            <i className={`bi bi-${getRevealChipIcon(stage)}`}></i>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <button type="button" className="presenter-navstrip-btn primary" onClick={advanceReveal} disabled={currentRevealIndex >= revealStages.length - 1} title="Mở bước tiếp (→ / Space)" aria-label="Mở bước tiếp">
                                {currentRevealIndex < revealStages.length - 1
                                    ? <><span>{getRevealChipLabel(revealStages[currentRevealIndex + 1])}</span><i className="bi bi-chevron-right"></i></>
                                    : <><i className="bi bi-check2-all"></i><span>Đủ lớp</span></>
                                }
                            </button>
                            <button type="button" className="presenter-navstrip-btn" onClick={jumpToNextSlide} disabled={activeSlideIndex >= slides.length - 1} title="Slide tiếp (PageDown)" aria-label="Slide tiếp">
                                <i className="bi bi-skip-forward-fill"></i>
                            </button>
                        </div>
                    </div>

                    {/* ── Right: Console ── */}
                    <div className="presenter-console">
                        {/* Status bar */}
                        <div className="presenter-status-bar">
                            <span className="presenter-mode-badge">Presenter</span>
                            <span className="presenter-timer">{elapsedDisplay}</span>
                            <span className={`presenter-conn-pill${presenterConnected ? ' connected' : ''}`}>
                                <span className="presenter-conn-dot"></span>
                                {presenterConnected ? 'Projector' : 'Offline'}
                            </span>
                            <button type="button" className="presenter-status-btn" onClick={openProjectorWindow} title="Mở Projector" aria-label="Mở Projector"><i className="bi bi-window-desktop"></i></button>
                            <button type="button" className="presenter-status-btn" onClick={copyProjectorUrl} title="Copy link Projector" aria-label="Copy link Projector"><i className="bi bi-link-45deg"></i></button>
                        </div>

                        {/* Now / Next */}
                        <div className="presenter-now-next">
                            <div className="presenter-section-label"><i className="bi bi-broadcast-pin"></i> Đang chiếu</div>
                            <div className="presenter-now-title">{getSlideLabel(currentSlide)}</div>
                            <div className="presenter-now-meta">Bước {currentRevealIndex + 1}/{revealStages.length} · <strong>{getRevealChipLabel(revealStages[currentRevealIndex])}</strong></div>
                            {nextSlide && (
                                <>
                                    <div className="presenter-mini-divider"></div>
                                    <div className="presenter-section-label" style={{ opacity: 0.7 }}><i className="bi bi-arrow-right"></i> Tiếp theo</div>
                                    <div className="presenter-next-title">{getSlideLabel(nextSlide)}</div>
                                </>
                            )}
                        </div>

                        {/* Reveal controls — primary console feature */}
                        <div className="presenter-reveal-panel">
                            <div className="presenter-reveal-header">
                                <span className="presenter-section-label"><i className="bi bi-layers"></i> Lớp nội dung</span>
                                <span className="presenter-reveal-count">{currentRevealIndex + 1} / {revealStages.length}</span>
                            </div>
                            <div className="presenter-reveal-grid">
                                {revealStages.map((stage, index) => (
                                    <button key={stage} type="button" className={`presenter-reveal-step${index < currentRevealIndex ? ' done' : ''}${index === currentRevealIndex ? ' current' : ''}`} onClick={() => setCurrentRevealIndex(index)}>
                                        <span className="presenter-reveal-step-icon"><i className={`bi bi-${getRevealChipIcon(stage)}`}></i></span>
                                        <span className="presenter-reveal-step-label">{getRevealChipLabel(stage)}</span>
                                        {index < currentRevealIndex && <i className="bi bi-check2 presenter-reveal-done-icon"></i>}
                                        {index === currentRevealIndex && <i className="bi bi-caret-right-fill presenter-reveal-active-icon"></i>}
                                    </button>
                                ))}
                            </div>
                            <div className="presenter-reveal-cta">
                                <button type="button" className="presenter-cta-btn" onClick={retreatReveal} disabled={currentRevealIndex === 0} aria-label="Lùi bước">
                                    <i className="bi bi-chevron-left"></i> Lùi
                                </button>
                                <button type="button" className="presenter-cta-btn primary" onClick={advanceReveal} disabled={currentRevealIndex >= revealStages.length - 1} aria-label="Mở bước tiếp">
                                    {currentRevealIndex >= revealStages.length - 1
                                        ? <><i className="bi bi-check2-all"></i> Đủ lớp</>
                                        : <><i className="bi bi-chevron-right"></i> {getRevealChipLabel(revealStages[currentRevealIndex + 1])}</>
                                    }
                                </button>
                            </div>
                        </div>

                        {/* Notes */}
                        <div className="presenter-notes-panel">
                            {currentAutoNotesHtml && (
                                <details className="presenter-notes-detail" open>
                                    <summary><i className="bi bi-stars"></i> Lời giải / Ghi chú tự động</summary>
                                    <div className="presenter-notes-content" dangerouslySetInnerHTML={{ __html: currentAutoNotesHtml }} />
                                </details>
                            )}
                            <div className="presenter-note-field">
                                <label className="presenter-note-label">
                                    <i className="bi bi-lightbulb"></i> Gợi ý chiếu
                                    {currentSlide && localHints[currentSlide.id] && (
                                        <button type="button" className="btn-icon-sm" onClick={() => setLocalHints((previous) => ({ ...previous, [currentSlide.id]: '' }))} title="Xóa gợi ý" aria-label="Xóa gợi ý chiếu"><i className="bi bi-x-lg"></i></button>
                                    )}
                                </label>
                                <textarea className="presenter-textarea" value={currentSlide ? (localHints[currentSlide.id] || '') : ''} onChange={(event) => { if (!currentSlide) return; const value = event.target.value; setLocalHints((previous) => ({ ...previous, [currentSlide.id]: value })); }} placeholder="Gợi ý ngắn hiện ra trước đáp án. Chỉ lưu trên máy này." />
                            </div>
                            <div className="presenter-note-field">
                                <label className="presenter-note-label"><i className="bi bi-journal-text"></i> Ghi chú riêng</label>
                                <textarea className="presenter-textarea" value={currentSlide ? (speakerNotes[currentSlide.id] || '') : ''} onChange={(event) => { if (!currentSlide) return; const value = event.target.value; setSpeakerNotes((previous) => ({ ...previous, [currentSlide.id]: value })); }} placeholder="Chỉ giáo viên thấy ở presenter..." />
                            </div>
                        </div>

                        {/* Settings — collapsed by default */}
                        <details className="presenter-settings">
                            <summary><i className="bi bi-sliders2"></i> Cài đặt</summary>
                            <div className="presenter-settings-body">
                                <div className="presentation-compact-select-grid">
                                    <label className="presentation-compact-field">
                                        <span><i className="bi bi-palette2"></i> Theme</span>
                                        <select className="form-select form-select-sm presentation-select-compact" value={themeId} onChange={(event) => setThemeId(event.target.value)}>
                                            {THEME_PRESETS.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                                        </select>
                                    </label>
                                    <label className="presentation-compact-field">
                                        <span><i className="bi bi-music-note-beamed"></i> Âm thanh</span>
                                        <select className="form-select form-select-sm presentation-select-compact" value={soundProfileId} onChange={(event) => setSoundProfileId(event.target.value)}>
                                            {SOUND_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                                        </select>
                                    </label>
                                </div>
                                <div className="presentation-icon-control-row">
                                    <button type="button" className={`presentation-icon-toggle${soundMuted ? ' active' : ''}`} onClick={() => setSoundMuted((previous) => !previous)} title={soundMuted ? 'Bật lại âm thanh' : 'Tắt âm thanh'} aria-label={soundMuted ? 'Bật lại âm thanh' : 'Tắt âm thanh'}><i className={`bi bi-${soundMuted ? 'volume-mute-fill' : 'volume-up-fill'}`}></i></button>
                                    <div className="presentation-range-control">
                                        <span className="presentation-range-label"><i className="bi bi-soundwave"></i></span>
                                        <input type="range" min="0" max="1" step="0.05" value={soundVolume} onChange={(event) => setSoundVolume(Number(event.target.value))} aria-label="Âm lượng" />
                                        <strong>{Math.round(soundVolume * 100)}%</strong>
                                    </div>
                                </div>
                                <div className="presentation-icon-control-row">
                                    <button type="button" className={`presentation-icon-toggle${spotlightEnabled ? ' active' : ''}`} onClick={() => setSpotlightEnabled((previous) => !previous)} title={spotlightEnabled ? 'Tắt spotlight' : 'Bật spotlight'} aria-label={spotlightEnabled ? 'Tắt spotlight' : 'Bật spotlight'}><i className="bi bi-bullseye"></i></button>
                                    <div className="presentation-range-control">
                                        <span className="presentation-range-label"><i className="bi bi-arrows-angle-expand"></i></span>
                                        <input type="range" min="12" max="46" step="1" value={spotlightSize} onChange={(event) => setSpotlightSize(Number(event.target.value))} aria-label="Kích thước spotlight" />
                                        <strong>{spotlightSize}</strong>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </div>
                </div>
            ) : (
                <div className={`presentation-body ${showOutline ? 'outline-open' : ''}`}>
                    <div className="presentation-stage-wrap">
                        <PresentationQuestionRail
                            slides={slides}
                            activeSlideIndex={activeSlideIndex}
                            jumpToSlide={jumpToSlide}
                            revealProgressBySlideId={revealProgressBySlideId}
                            localHints={localHints}
                        />

                        <div className="presentation-stage-frame">
                        <AnimatePresence mode="wait">
                            <motion.article
                                key={currentSlide?.id || 'cover'}
                                className="presentation-stage presentation-stage-beamer"
                                initial={{ opacity: 0, y: 24, scale: 0.985 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -24, scale: 0.985 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                onMouseMove={handleStageMouseMove}
                                onClick={handleStageClick}
                            >
                                <PresentationStageContent
                                    slide={currentSlide}
                                    exam={exam}
                                    currentQuestionPoints={currentQuestionPoints}
                                    revealStages={revealStages}
                                    revealIndex={currentRevealIndex}
                                    currentHintHtml={currentHintHtml}
                                    resourceGroups={currentResourceGroups}
                                />
                                <PresentationSpotlightLayer enabled={spotlightEnabled} position={spotlightPosition} size={spotlightSize} />
                            </motion.article>
                        </AnimatePresence>
                        </div>

                        <PresentationRevealDock
                            activeSlideIndex={activeSlideIndex}
                            slidesLength={slides.length}
                            revealStages={revealStages}
                            currentRevealIndex={currentRevealIndex}
                            setCurrentRevealIndex={setCurrentRevealIndex}
                            jumpToPrevSlide={jumpToPrevSlide}
                            retreatReveal={retreatReveal}
                            advanceReveal={advanceReveal}
                            jumpToNextSlide={jumpToNextSlide}
                        />
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
                                return (
                                    <button
                                        type="button"
                                        key={slide.id}
                                        className={`presentation-outline-item ${active ? 'active' : ''}`}
                                        onClick={() => jumpToSlide(index)}
                                    >
                                        <span className="presentation-outline-index">{index + 1}</span>
                                        <span className="presentation-outline-copy">
                                            <strong>{slide.type === 'cover' ? 'Mở đầu' : slide.type === 'section' ? 'Phần' : `Câu ${slide.questionNumber}`}</strong>
                                            <span>{getSlideLabel(slide)}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            )}

            <PresentationImageLightbox src={lightboxImage?.src} alt={lightboxImage?.alt} onClose={() => setLightboxImage(null)} />
        </div>
    );
}
