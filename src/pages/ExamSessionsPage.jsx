import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, getDoc, getDocs, collection, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { formatDateTime, getScoreColor } from '../utils/formatters';
import { renderLatexContent as renderLatex } from '../utils/math';
import StatsCard from '../components/StatsCard';
import Swal from 'sweetalert2';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '<br>');
}

function renderChoiceHtml(choice = {}, index = 0) {
    const letter = choice.displayLetter || choice.letter || String.fromCharCode(65 + index);
    return {
        letter,
        content: renderLatex(choice.html || escapeHtml(choice.text || '')),
        originLetter: choice.originLetter || choice.letter || null,
    };
}

function renderSubmissionQuestionHtml(question = {}, answer = {}, questionIndex = 0) {
    const questionContent = renderLatex(question.content_html || escapeHtml(question.content_text || ''));
    const maxPoints = answer?.maxPoints || question.points || 0;
    const typeLabel = question.type === 'tf'
        ? 'Đúng / Sai'
        : question.type === 'short_answer'
            ? 'Tự luận ngắn'
            : question.type === 'essay'
                ? 'Tự luận'
                : 'Trắc nghiệm';

    if (question.type === 'tf') {
        const choices = (question.choices || []).map((choice, choiceIndex) => {
            const rendered = renderChoiceHtml(choice, choiceIndex);
            const studentAnswer = (answer.tfItemAnswers || [])[choiceIndex];
            const correctAnswer = (question.correct_answer || '')[choiceIndex];
            return `
                <div class="print-tf-row ${studentAnswer === correctAnswer ? 'correct' : 'wrong'}">
                    <div class="print-choice-text"><strong>${rendered.letter})</strong> ${rendered.content}</div>
                    <div class="print-answer-inline">
                        <span>HS: ${studentAnswer ? (studentAnswer === 'D' ? 'Đúng' : 'Sai') : 'Bỏ trống'}</span>
                        <span>Đáp án: ${correctAnswer === 'D' ? 'Đúng' : 'Sai'}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <section class="print-question">
                <div class="print-question-head">
                    <strong>Câu ${questionIndex + 1}</strong>
                    <span>${typeLabel} · ${maxPoints} điểm</span>
                </div>
                <div class="print-question-content">${questionContent}</div>
                <div class="print-tf-list">${choices}</div>
            </section>
        `;
    }

    if (question.type === 'short_answer') {
        return `
            <section class="print-question">
                <div class="print-question-head">
                    <strong>Câu ${questionIndex + 1}</strong>
                    <span>${typeLabel} · ${maxPoints} điểm</span>
                </div>
                <div class="print-question-content">${questionContent}</div>
                <div class="print-answer-box">
                    <div class="print-answer-label">Bài làm học sinh</div>
                    <div class="print-answer-text">${renderLatex(escapeHtml(answer.textAnswer || 'Bỏ trống'))}</div>
                </div>
                <div class="print-answer-key"><strong>Đáp án:</strong> ${renderLatex(escapeHtml(question.correct_answer || 'Chưa cấu hình'))}</div>
            </section>
        `;
    }

    if (question.type === 'essay') {
        const attachments = Array.isArray(answer.attachments) ? answer.attachments : [];
        const attachmentHtml = attachments.length > 0
            ? `
                <div class="print-essay-attachments">
                    ${attachments.map((attachment, attachmentIndex) => `
                        <figure class="print-essay-figure">
                            <img src="${attachment.url}" alt="Bài làm trang ${attachmentIndex + 1}" />
                            <figcaption>Ảnh ${attachmentIndex + 1}</figcaption>
                        </figure>
                    `).join('')}
                </div>
            `
            : '<div class="print-empty-attachments">Không có ảnh đính kèm</div>';

        return `
            <section class="print-question">
                <div class="print-question-head">
                    <strong>Câu ${questionIndex + 1}</strong>
                    <span>${typeLabel} · tối đa ${maxPoints} điểm</span>
                </div>
                <div class="print-question-content">${questionContent}</div>
                <div class="print-answer-box essay-mode">
                    <div class="print-answer-label">Bài làm học sinh</div>
                    <div class="print-answer-text">${renderLatex(escapeHtml(answer.textAnswer || 'Bỏ trống'))}</div>
                    ${attachmentHtml}
                </div>
                ${question.correct_answer ? `<div class="print-answer-key"><strong>Gợi ý chấm:</strong> ${renderLatex(escapeHtml(question.correct_answer))}</div>` : ''}
                <div class="print-score-box">Điểm GV: ________ / ${maxPoints}</div>
            </section>
        `;
    }

    const choices = (answer.choiceSnapshot || question.choices || []).map((choice, choiceIndex) => {
        const rendered = renderChoiceHtml(choice, choiceIndex);
        const isSelected = choiceIndex === answer.selected;
        const isCorrect = rendered.originLetter === answer.correctOriginLetter || choiceIndex === answer.correctIdx;
        return `
            <li class="print-choice ${isSelected ? 'selected' : ''} ${isCorrect ? 'correct' : ''}">
                <span class="print-choice-letter">${rendered.letter}</span>
                <span class="print-choice-copy">${rendered.content}</span>
            </li>
        `;
    }).join('');

    const selectedChoice = typeof answer.selected === 'number'
        ? (answer.choiceSnapshot || question.choices || [])[answer.selected]
        : null;
    const selectedLetter = selectedChoice?.displayLetter || selectedChoice?.letter || (typeof answer.selected === 'number' ? String.fromCharCode(65 + answer.selected) : 'Bỏ trống');
    const correctLetter = answer.correctOriginLetter || question.correct_answer || 'Chưa cấu hình';

    return `
        <section class="print-question">
            <div class="print-question-head">
                <strong>Câu ${questionIndex + 1}</strong>
                <span>${typeLabel} · ${maxPoints} điểm</span>
            </div>
            <div class="print-question-content">${questionContent}</div>
            <ul class="print-choice-list">${choices}</ul>
            <div class="print-answer-inline summary-row">
                <span><strong>HS chọn:</strong> ${selectedLetter || 'Bỏ trống'}</span>
                <span><strong>Đáp án:</strong> ${correctLetter}</span>
            </div>
        </section>
    `;
}

function exportSubmissionPdf({ exam, sessions, questionMap }) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const body = sessions.map((session, index) => {
        const answerMap = Object.fromEntries((session.answers || []).map((answer) => [answer.questionId, answer]));
        const orderedQuestionIds = (session.answers || []).map((answer) => answer.questionId);
        const questionHtml = orderedQuestionIds.map((questionId, questionIndex) => (
            renderSubmissionQuestionHtml(questionMap[questionId] || {}, answerMap[questionId] || {}, questionIndex)
        )).join('');

        return `
            <article class="print-sheet ${index < sessions.length - 1 ? 'page-break' : ''}">
                <header class="print-sheet-head">
                    <h1>${escapeHtml(exam?.title || 'Bai tu luan')}</h1>
                    <div class="print-meta">
                        <span><strong>Học sinh:</strong> ${escapeHtml(session.studentName || 'Ẩn danh')}</span>
                        <span><strong>Email:</strong> ${escapeHtml(session.studentEmail || '')}</span>
                        <span><strong>Nộp lúc:</strong> ${escapeHtml(session.completedAt?.toDate?.()?.toLocaleString('vi-VN') || '')}</span>
                        <span><strong>Điểm hệ thống:</strong> ${escapeHtml(session.total ? `${session.score}/${session.total}` : 'Chờ chấm')}</span>
                    </div>
                </header>
                <div class="print-sheet-note">Mỗi học sinh được in trọn bài theo đúng thứ tự câu hỏi của lượt làm, chỉ ngắt trang khi sang học sinh mới.</div>
                ${questionHtml}
            </article>
        `;
    }).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(exam?.title || 'Bai tu luan')}</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
            <style>
                body { font-family: Georgia, 'Times New Roman', serif; margin: 0; padding: 24px; color: #0f172a; }
                .print-sheet { max-width: 860px; margin: 0 auto; }
                .print-sheet.page-break { page-break-after: always; }
                .print-sheet-head { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 2px solid #e2e8f0; }
                .print-sheet-head h1 { margin: 0 0 8px; font-size: 24px; }
                .print-meta { display: grid; gap: 4px; font-size: 13px; color: #475569; }
                .print-sheet-note { margin: 12px 0 18px; padding: 10px 12px; border-radius: 12px; background: #f8fafc; color: #475569; font-size: 13px; }
                .print-question { margin: 14px 0; padding: 14px; border: 1px solid #cbd5e1; border-radius: 14px; break-inside: avoid; page-break-inside: avoid; }
                .print-question-head { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #475569; margin-bottom: 10px; }
                .print-question-content { line-height: 1.7; margin-bottom: 12px; }
                .print-choice-list, .print-tf-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
                .print-choice-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .print-choice { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; border: 1px solid #e2e8f0; }
                .print-choice.selected { border-color: #60a5fa; background: #eff6ff; }
                .print-choice.correct { border-color: #86efac; background: #f0fdf4; }
                .print-choice-letter { font-weight: 700; min-width: 18px; }
                .print-choice-copy { flex: 1; }
                .print-answer-box { border: 1px dashed #94a3b8; border-radius: 10px; padding: 12px; }
                .print-answer-box.essay-mode { background: #fffdf7; }
                .print-answer-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
                .print-answer-text { white-space: pre-wrap; line-height: 1.7; }
                .print-answer-key { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #faf5ff; border: 1px solid #d8b4fe; color: #6b21a8; }
                .print-score-box { margin-top: 12px; text-align: right; font-weight: 700; }
                .print-answer-inline { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; color: #334155; }
                .print-answer-inline.summary-row { margin-top: 12px; }
                .print-tf-row { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
                .print-tf-row.correct { background: #f0fdf4; border-color: #86efac; }
                .print-tf-row.wrong { background: #fff7ed; border-color: #fdba74; }
                .print-choice-text { margin-bottom: 6px; line-height: 1.6; }
                .print-essay-attachments { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
                .print-essay-figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px; background: #fff; }
                .print-essay-figure img { width: 100%; height: auto; display: block; border-radius: 8px; }
                .print-essay-figure figcaption { margin-top: 6px; font-size: 12px; color: #64748b; text-align: center; }
                .print-empty-attachments { margin-top: 10px; font-size: 13px; color: #64748b; }
                @media print { body { padding: 0; } }
                @media (max-width: 760px) {
                    .print-choice-list,
                    .print-essay-attachments { grid-template-columns: 1fr; }
                }
            </style>
        </head>
        <body>${body}</body>
        </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
}

function exportToExcel(sessions, examTitle) {
    const headers = ['STT', 'Họ tên', 'Email', 'Điểm', 'Tổng câu', 'Tỷ lệ %', 'Thời gian làm (s)', 'Ngày nộp'];
    const rows = sessions.map((s, i) => [
        i + 1,
        s.studentName || 'Ẩn danh',
        s.studentEmail || '',
        s.score || 0,
        s.total || 0,
        s.total ? Math.round((s.score / s.total) * 100) : 0,
        s.timeSpent || '',
        s.completedAt?.toDate?.()?.toLocaleString('vi-VN') || '',
    ]);

    let csv = '\uFEFF'; // BOM for UTF-8
    csv += headers.join(',') + '\n';
    rows.forEach(row => {
        csv += row.map(cell => {
            const str = String(cell);
            return str.includes(',') || str.includes('"') || str.includes('\n') ? '"' + str.replace(/"/g, '""') + '"' : str;
        }).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${examTitle || 'ket-qua'}_${new Date().toLocaleDateString('vi-VN')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}

export default function ExamSessionsPage() {
    const { examId } = useParams();
    const { user, userProfile } = useAuth();
    const [exam, setExam] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [stats, setStats] = useState({ total: 0, avg: 0, max: 0, min: 0, perfect: 0, displayTotal: 0 });
    const [loading, setLoading] = useState(true);
    const [sortBy, setSortBy] = useState('score'); // 'score', 'time', 'name'
    const [sortDir, setSortDir] = useState('desc');
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('sessions');
    const [liveSessions, setLiveSessions] = useState([]);
    const [liveLoading, setLiveLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (!examDoc.exists()) {
            setLoading(false);
            return;
        }
        const examData = { id: examDoc.id, ...examDoc.data() };
        if (userProfile?.role !== 'admin' && examData.teacherId !== user.uid) {
            Swal.fire('Không có quyền', 'Bạn không được xem kết quả đề này.', 'error');
            setLoading(false);
            return;
        }
        setExam(examData);

        const sessionQ = query(collection(db, 'sessions'), where('examId', '==', examId));
        const snap = await getDocs(sessionQ);
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Compute stats
        if (list.length > 0) {
            const gradable = list.filter((session) => (session.total || 0) > 0);
            const scores = gradable.map(s => s.score || 0);
            const totals = gradable.map(s => s.total || 1);
            const pcts = gradable.map((s, i) => (scores[i] / totals[i]) * 100);
            setStats({
                total: list.length,
                avg: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0,
                max: scores.length ? Math.max(...scores) : 0,
                min: scores.length ? Math.min(...scores) : 0,
                perfect: gradable.filter((s, i) => scores[i] === totals[i]).length,
                displayTotal: gradable.find((session) => (session.total || 0) > 0)?.total || 0,
            });
        }

        setSessions(list);
        setLoading(false);
    }, [examId, user?.uid, userProfile?.role]);

    useEffect(() => {
        if (!user || !userProfile) return;
        queueMicrotask(() => {
            loadData();
        });
    }, [loadData, user, userProfile]);

    const loadLiveSessions = useCallback(async () => {
        if (!user || liveLoading) return;
        setLiveLoading(true);
        try {
            const lsQ = query(
                collection(db, 'liveSessions'),
                where('teacherId', '==', user.uid),
                where('examId', '==', examId),
                orderBy('playedAt', 'desc'),
            );
            const snap = await getDocs(lsQ);
            setLiveSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (err) {
            console.error('loadLiveSessions error', err);
        } finally {
            setLiveLoading(false);
        }
    }, [user, examId, liveLoading]);

    const filtered = sessions.filter(s => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (s.studentName || '').toLowerCase().includes(term) || (s.studentEmail || '').toLowerCase().includes(term);
    });

    const sorted = [...filtered].sort((a, b) => {
        const dir = sortDir === 'desc' ? -1 : 1;
        if (sortBy === 'score') return ((a.score || 0) - (b.score || 0)) * dir;
        if (sortBy === 'name') return (a.studentName || '').localeCompare(b.studentName || '') * dir;
        if (sortBy === 'time') {
            const ta = a.completedAt?.toMillis?.() || 0;
            const tb = b.completedAt?.toMillis?.() || 0;
            return (ta - tb) * dir;
        }
        return 0;
    });

    const toggleSort = (key) => {
        if (sortBy === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        else { setSortBy(key); setSortDir('desc'); }
    };

    const handleExportSubmissionPdf = async () => {
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        const questionMap = {};
        qSnap.docs.forEach((item) => {
            questionMap[item.id] = { id: item.id, ...item.data() };
        });

        if (sorted.length === 0) {
            Swal.fire('Chưa có bài nộp', 'Chưa có lượt nộp nào để xuất PDF.', 'info');
            return;
        }

        exportSubmissionPdf({ exam, sessions: sorted, questionMap });
    };

    if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div className="breadcrumb">
                <Link to="/teacher"><i className="bi bi-arrow-left"></i> Kho đề</Link>
                <span className="breadcrumb-sep">/</span>
                <Link to={`/teacher/exam/${examId}`}>{exam?.title || 'Đề thi'}</Link>
                <span className="breadcrumb-sep">/</span>
                <span>Kết quả</span>
            </div>

            <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>
                <i className="bi bi-bar-chart me-2" style={{ color: 'var(--accent)' }}></i>
                Kết quả: {exam?.title}
            </h1>

            {/* Tab navigation */}
            <div className="sessions-tab-nav" style={{ marginBottom: 24 }}>
                <button className={`sessions-tab-btn${activeTab === 'sessions' ? ' active' : ''}`} onClick={() => setActiveTab('sessions')}>
                    <i className="bi bi-journal-text"></i> Bài thi thường ({sessions.length})
                </button>
                <button className={`sessions-tab-btn${activeTab === 'live' ? ' active' : ''}`} onClick={() => {
                    setActiveTab('live');
                    if (liveSessions.length === 0) loadLiveSessions();
                }}>
                    <i className="bi bi-broadcast"></i> Lịch sử Live {liveSessions.length > 0 ? `(${liveSessions.length})` : ''}
                </button>
            </div>

            {/* ── Tab: Bài thi thường ── */}
            {activeTab === 'sessions' && (<>
                <div className="stats-grid-4">
                    <StatsCard icon="people-fill" label="Tổng lượt thi" value={stats.total} color="primary" delay={0} />
                    <StatsCard icon="graph-up" label="Trung bình" value={`${stats.avg}%`} color="cool" delay={1} />
                    <StatsCard icon="trophy" label="Điểm cao nhất" value={stats.displayTotal ? `${stats.max}/${stats.displayTotal}` : `${stats.max}`} color="success" delay={2} />
                    <StatsCard icon="star" label="Điểm tuyệt đối" value={stats.perfect} color="gold" delay={3} />
                </div>

                {/* Search & export bar */}
                {sessions.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                            <i className="bi bi-search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}></i>
                            <input type="text" placeholder="Tìm học sinh..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px 8px 36px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.85rem' }} />
                        </div>
                        <button className="btn btn-outline btn-sm" onClick={() => exportToExcel(sorted, exam?.title)}>
                            <i className="bi bi-file-earmark-spreadsheet"></i> Xuất CSV
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={handleExportSubmissionPdf}>
                            <i className="bi bi-file-earmark-pdf"></i> Xuất PDF đề + bài làm
                        </button>
                        <small style={{ color: '#64748b' }}>PDF sẽ gom trọn từng bài theo học sinh và chỉ ngắt trang khi sang bài mới.</small>
                    </div>
                )}

                {/* Score distribution */}
                {sessions.length > 0 && (
                    <div className="card" style={{ marginBottom: 24 }}>
                        <div className="card-body">
                            <h3 style={{ fontSize: '1rem', marginBottom: 16 }}><i className="bi bi-bar-chart-line"></i> Phân bố điểm</h3>
                            <ScoreDistribution sessions={sessions} />
                        </div>
                    </div>
                )}

                {/* Results table */}
                {sessions.length === 0 ? (
                    <div className="empty-state">
                        <i className="bi bi-inbox"></i>
                        <p>Chưa có học sinh nào làm bài.</p>
                    </div>
                ) : (
                    <div className="card">
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 50 }}>#</th>
                                        <th className="sortable" onClick={() => toggleSort('name')}>
                                            Học sinh {sortBy === 'name' && <i className={`bi bi-caret-${sortDir === 'desc' ? 'down' : 'up'}-fill`}></i>}
                                        </th>
                                        <th className="sortable" onClick={() => toggleSort('score')}>
                                            Điểm {sortBy === 'score' && <i className={`bi bi-caret-${sortDir === 'desc' ? 'down' : 'up'}-fill`}></i>}
                                        </th>
                                        <th>Tỷ lệ</th>
                                        <th className="sortable" onClick={() => toggleSort('time')}>
                                            Thời gian nộp {sortBy === 'time' && <i className={`bi bi-caret-${sortDir === 'desc' ? 'down' : 'up'}-fill`}></i>}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((s, idx) => {
                                        const pct = s.total ? Math.round((s.score / s.total) * 100) : 0;
                                        const color = getScoreColor(s.score, s.total);
                                        return (
                                            <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.02 }}>
                                                <td>{idx + 1}</td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span style={{ fontWeight: 600 }}>{s.studentName || 'Ẩn danh'}</span>
                                                    </div>
                                                    <small style={{ color: 'var(--text-muted)' }}>{s.studentEmail}</small>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'grid', gap: 4 }}>
                                                        <span className={`stat-badge ${color}`}>{s.total ? `${s.score}/${s.total}` : 'Chờ chấm'}</span>
                                                        {s.manualReviewPending && <small style={{ color: '#7c3aed' }}>+ {s.manualTotalPoints || 0} điểm tự luận chờ chấm</small>}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="mini-progress">
                                                        <div className="mini-progress-bar" style={{ width: `${pct}%`, background: `var(--gradient-${color === 'danger' ? 'warm' : color === 'primary' ? 'main' : color})` }}></div>
                                                    </div>
                                                    <small>{pct}%</small>
                                                </td>
                                                <td><small>{formatDateTime(s.completedAt)}</small></td>
                                            </motion.tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </>)}

            {/* ── Tab: Lịch sử Live ── */}
            {activeTab === 'live' && (
                <div>
                    {liveLoading ? (
                        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner"></div><p>Đang tải lịch sử live...</p></div>
                    ) : liveSessions.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-broadcast"></i>
                            <p>Chưa có phòng live nào được lưu lại cho đề này.</p>
                            <small style={{ color: 'var(--text-muted)' }}>Phòng live được lưu tự động khi giáo viên nhấn Kết thúc phòng.</small>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: 16 }}>
                            {liveSessions.map((ls, idx) => {
                                const scores = Object.values(ls.scores || {});
                                const topScore = scores.length ? Math.max(...scores) : 0;
                                const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
                                const playedAt = ls.playedAt?.toMillis ? new Date(ls.playedAt.toMillis()).toLocaleString('vi-VN') : '—';
                                const modeLabel = { millionaire: 'Triệu Phú', classic: 'Classic', golden_bell: 'Chuông Vàng', speed: 'Speed', presentation: 'Trình chiếu' }[ls.mode] || ls.mode || 'Unknown';
                                const participants = Object.entries(ls.scores || {});
                                const questionAccuracy = ls.questionAccuracy || {};

                                return (
                                    <div key={ls.id} className="live-session-history-card card">
                                        <div className="lsh-header">
                                            <div>
                                                <div className="lsh-title">
                                                    <span className="stat-badge info">{modeLabel}</span>
                                                    <span className="lsh-date">{playedAt}</span>
                                                </div>
                                                <div className="lsh-stats-row">
                                                    <span><i className="bi bi-people-fill"></i> {participants.length} người chơi</span>
                                                    <span><i className="bi bi-trophy"></i> Cao nhất: {topScore} điểm</span>
                                                    <span><i className="bi bi-graph-up"></i> Trung bình: {avgScore} điểm</span>
                                                    {ls.teamMode && <span className="stat-badge muted">Team mode</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Top 3 */}
                                        {participants.length > 0 && (
                                            <div className="lsh-leaderboard">
                                                <div className="lsh-section-label">Bảng xếp hạng</div>
                                                <div className="lsh-lb-list">
                                                    {participants
                                                        .sort(([, a], [, b]) => b - a)
                                                        .slice(0, 5)
                                                        .map(([name, score], rank) => (
                                                            <div key={name} className="lsh-lb-row">
                                                                <span className={`lsh-rank lsh-rank-${rank + 1}`}>{rank + 1}</span>
                                                                <span className="lsh-name">{name}</span>
                                                                <span className="lsh-score">{score} điểm</span>
                                                            </div>
                                                        ))}
                                                    {participants.length > 5 && (
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: 8 }}>
                                                            +{participants.length - 5} người khác
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Per-question accuracy */}
                                        {Object.keys(questionAccuracy).length > 0 && (
                                            <div className="lsh-q-accuracy">
                                                <div className="lsh-section-label">Độ chính xác theo câu</div>
                                                <div className="lsh-q-bars">
                                                    {Object.entries(questionAccuracy)
                                                        .sort(([a], [b]) => Number(a) - Number(b))
                                                        .map(([qIdx, acc]) => (
                                                            <div key={qIdx} className="lsh-q-bar-item">
                                                                <span className="lsh-q-label">C{Number(qIdx) + 1}</span>
                                                                <div className="lsh-q-bar-track">
                                                                    <div className="lsh-q-bar-fill" style={{
                                                                        width: `${Math.round(acc * 100)}%`,
                                                                        background: acc >= 0.7 ? '#10b981' : acc >= 0.4 ? '#f59e0b' : '#ef4444',
                                                                    }}></div>
                                                                </div>
                                                                <span className="lsh-q-pct">{Math.round(acc * 100)}%</span>
                                                            </div>
                                                        ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ScoreDistribution({ sessions }) {
    const buckets = [0, 0, 0, 0, 0]; // 0-20%, 20-40%, 40-60%, 60-80%, 80-100%
    const labels = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%'];
    const colors = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#10b981'];

    sessions.forEach(s => {
        if (!s.total) return;
        const pct = (s.score / s.total) * 100;
        if (pct < 20) buckets[0]++;
        else if (pct < 40) buckets[1]++;
        else if (pct < 60) buckets[2]++;
        else if (pct < 80) buckets[3]++;
        else buckets[4]++;
    });

    const max = Math.max(...buckets, 1);

    return (
        <div className="score-distribution">
            {buckets.map((count, idx) => (
                <div key={idx} className="dist-bar-group">
                    <div className="dist-bar-wrapper">
                        <motion.div
                            className="dist-bar"
                            style={{ background: colors[idx] }}
                            initial={{ height: 0 }}
                            animate={{ height: `${(count / max) * 100}%` }}
                            transition={{ delay: idx * 0.1, duration: 0.5 }}
                        />
                    </div>
                    <div className="dist-label">{labels[idx]}</div>
                    <div className="dist-count">{count}</div>
                </div>
            ))}
        </div>
    );
}
