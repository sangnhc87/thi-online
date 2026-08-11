import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { motion } from 'framer-motion';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import StatsCard from '../components/StatsCard';
import Certificate from '../components/Certificate';
import { CERTIFICATE_DOCUMENT_TYPES } from '../utils/certificateExport';
import { formatDate, formatDateTime, formatPercent, getScoreColor } from '../utils/formatters';
import Swal from 'sweetalert2';

export default function TeacherStudentDetailPage() {
    const { studentId } = useParams();
    const navigate = useNavigate();
    const { user, userProfile } = useAuth();
    const [student, setStudent] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [exams, setExams] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [studentStats, setStudentStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedCertificate, setSelectedCertificate] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            if (userProfile?.role === 'admin') {
                Swal.fire('Không khả dụng', 'Super admin không truy cập hồ sơ học sinh.', 'info');
                navigate('/admin');
                return;
            }

            const studentDoc = await getDoc(doc(db, 'users', studentId));
            if (!studentDoc.exists()) {
                Swal.fire('Không tìm thấy', 'Học sinh không tồn tại.', 'error');
                navigate('/teacher');
                return;
            }

            const studentData = { uid: studentDoc.id, ...studentDoc.data() };
            const scopeTeacherId = studentData.teacherId;
            if (!scopeTeacherId) {
                Swal.fire('Không có lớp', 'Học sinh này chưa thuộc lớp nào.', 'info');
                navigate('/teacher');
                return;
            }

            if (scopeTeacherId !== user.uid) {
                Swal.fire('Không có quyền', 'Bạn không được xem học sinh này.', 'error');
                navigate('/teacher');
                return;
            }

            const [examSnap, sessionSnap, studentStatsDoc, auditSnap] = await Promise.all([
                getDocs(query(collection(db, 'exams'), where('teacherId', '==', scopeTeacherId), orderBy('createdAt', 'desc'))),
                getDocs(query(collection(db, 'sessions'), where('teacherId', '==', scopeTeacherId))),
                getDoc(doc(db, 'studentStats', studentId)),
                getDocs(query(collection(db, 'auditLogs'), where('teacherId', '==', scopeTeacherId), limit(100))),
            ]);

            const examList = examSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
            const examIds = new Set(examList.map((exam) => exam.id));
            const sessionList = sessionSnap.docs
                .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
                .filter((session) => session.studentId == studentId && examIds.has(session.examId))
                .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

            setStudent(studentData);
            setExams(examList);
            setSessions(sessionList);
            setStudentStats(studentStatsDoc.exists() ? studentStatsDoc.data() : null);
            setAuditLogs(
                auditSnap.docs
                    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
                    .filter((log) => log.studentId === studentId)
                    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
                    .slice(0, 20)
            );
        } catch (error) {
            console.error(error);
            Swal.fire('Lỗi', 'Không tải được dữ liệu học sinh.', 'error');
            navigate('/teacher');
        } finally {
            setLoading(false);
        }
    }, [navigate, studentId, user?.uid, userProfile?.role]);

    useEffect(() => {
        if (user && userProfile) loadData();
    }, [loadData, user, userProfile]);

    const examMap = useMemo(() => {
        const next = {};
        exams.forEach((exam) => {
            next[exam.id] = exam;
        });
        return next;
    }, [exams]);

    const overview = useMemo(() => {
        if (!sessions.length) {
            return {
                totalSessions: 0,
                avgPercent: 0,
                autoSubmits: 0,
                antiCheatViolations: 0,
                certificates: 0,
            };
        }

        const percents = sessions
            .map((session) => {
                const aggregateTotal = session.manualReviewPending ? (session.autoGradedTotal || 0) : (session.total || 0);
                return aggregateTotal ? Math.round((session.score / aggregateTotal) * 100) : null;
            })
            .filter((value) => value !== null);
        const antiCheatViolations = sessions.reduce((sum, session) => sum + (session.antiCheat?.violations || 0), 0);

        return {
            totalSessions: sessions.length,
            avgPercent: percents.length ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length) : 0,
            autoSubmits: sessions.filter((session) => session.autoSubmitted).length,
            antiCheatViolations,
            certificates: sessions.filter((session) => {
                const aggregateTotal = session.manualReviewPending ? (session.autoGradedTotal || 0) : (session.total || 0);
                return aggregateTotal ? (session.score / aggregateTotal) * 100 >= 60 : false;
            }).length,
        };
    }, [sessions]);

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải hồ sơ học sinh...</p></div>;
    if (!student) return null;

    const scopeTeacherName = student.teacherName || exams[0]?.teacherName || 'Giáo viên';

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div className="breadcrumb">
                <Link to="/teacher"><i className="bi bi-arrow-left"></i> Dashboard giáo viên</Link>
                <span className="breadcrumb-sep">/</span>
                <span>{student.displayName || student.email || 'Học sinh'}</span>
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        {student.photoURL ? (
                            <img src={student.photoURL} alt="" style={{ width: 64, height: 64, borderRadius: '50%' }} referrerPolicy="no-referrer" />
                        ) : (
                            <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e2e8f0', fontWeight: 800, color: '#334155' }}>
                                {(student.displayName || student.email || '?')[0]}
                            </div>
                        )}
                        <div>
                            <h1 style={{ fontSize: '1.45rem', margin: 0 }}>{student.displayName || 'Ẩn danh'}</h1>
                            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>{student.email || 'Không có email'}</p>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                <span className={`stat-badge ${student.blocked ? 'expired' : 'active'}`}>{student.blocked ? 'Đang bị khóa' : 'Đang hoạt động'}</span>
                                <span className="stat-badge info">Vào lớp: {formatDate(student.createdAt)}</span>
                                {studentStats?.lastCompletedAt && <span className="stat-badge warm">Làm gần nhất: {formatDate(studentStats.lastCompletedAt)}</span>}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Link to={`/teacher/student/${studentId}/preview`} className="btn btn-primary btn-sm"><i className="bi bi-display"></i> Giao diện học sinh</Link>
                        <Link to="/teacher" className="btn btn-outline btn-sm"><i className="bi bi-grid"></i> Quay lại</Link>
                    </div>
                </div>
            </div>

            <div className="stats-grid" style={{ marginBottom: 24 }}>
                <StatsCard icon="journal-check" label="Lượt làm" value={overview.totalSessions} color="primary" delay={0} />
                <StatsCard icon="graph-up-arrow" label="Trung bình" value={`${overview.avgPercent}%`} color={overview.avgPercent >= 60 ? 'success' : 'warm'} delay={1} />
                <StatsCard icon="shield-exclamation" label="Vi phạm anti-cheat" value={overview.antiCheatViolations} color="warm" delay={2} />
                <StatsCard icon="printer" label="Giấy khen đủ điều kiện" value={overview.certificates} color="cool" delay={3} />
            </div>

            <div className="upload-sections">
                <div className="upload-section">
                    <div className="upload-section-header"><i className="bi bi-person-vcard"></i> Hồ sơ và chỉ số</div>
                    <div className="upload-section-body">
                        <div className="info-grid">
                            <div className="info-item"><span className="info-label">Giáo viên</span><span className="info-value">{scopeTeacherName}</span></div>
                            <div className="info-item"><span className="info-label">Bài đã làm</span><span className="info-value">{studentStats?.totalSessions || overview.totalSessions}</span></div>
                            <div className="info-item"><span className="info-label">Tỷ lệ đúng TB</span><span className="info-value">{studentStats?.avgPercent || overview.avgPercent}%</span></div>
                            <div className="info-item"><span className="info-label">Tự nộp do anti-cheat</span><span className="info-value">{studentStats?.autoSubmitCount || overview.autoSubmits}</span></div>
                            <div className="info-item"><span className="info-label">Streak</span><span className="info-value">{student.streak || 0} ngày</span></div>
                            <div className="info-item"><span className="info-label">Điểm hoàn hảo</span><span className="info-value">{student.perfectScores || 0}</span></div>
                        </div>
                    </div>
                </div>
                <div className="upload-section">
                    <div className="upload-section-header"><i className="bi bi-bar-chart-line"></i> Lịch sử làm bài</div>
                    <div className="upload-section-body">
                        {sessions.length === 0 ? (
                            <div className="empty-state" style={{ padding: 32 }}>
                                <i className="bi bi-inbox"></i>
                                <p>Học sinh này chưa có bài thi nào thuộc lớp của bạn.</p>
                            </div>
                        ) : (
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Đề thi</th>
                                            <th>Điểm</th>
                                            <th>Anti-cheat</th>
                                            <th>Nộp bài</th>
                                            <th style={{ textAlign: 'right' }}>Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sessions.map((session, index) => {
                                            const exam = examMap[session.examId];
                                            const aggregateTotal = session.manualReviewPending ? (session.autoGradedTotal || 0) : (session.total || 0);
                                            const pct = aggregateTotal ? Math.round((session.score / aggregateTotal) * 100) : 0;
                                            const canExportCertificate = !session.manualReviewPending && aggregateTotal > 0;
                                            const initialDocumentType = pct >= 60
                                                ? CERTIFICATE_DOCUMENT_TYPES.COMMENDATION
                                                : CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION;
                                            return (
                                                <motion.tr key={session.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.03 }}>
                                                    <td>{index + 1}</td>
                                                    <td>
                                                        <div style={{ fontWeight: 700 }}>{session.examTitle || exam?.title || session.examId}</div>
                                                        <small style={{ color: 'var(--text-muted)' }}>{formatDateTime(session.completedAt)}</small>
                                                    </td>
                                                    <td>
                                                        <span className={`stat-badge ${session.manualReviewPending && !(session.autoGradedTotal || 0) ? 'pending' : getScoreColor(session.score, session.total)}`}>{session.manualReviewPending && !(session.autoGradedTotal || 0) ? 'Chờ chấm' : `${session.score}/${session.total}`}</span>
                                                        <div style={{ marginTop: 4, fontSize: '0.78rem', color: '#64748b' }}>{session.manualReviewPending && !(session.autoGradedTotal || 0) ? 'Có phần tự luận chờ chấm' : formatPercent(session.score, session.total)}</div>
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 700 }}>{session.antiCheat?.violations || 0} vi phạm</div>
                                                        <small style={{ color: session.autoSubmitted ? '#b45309' : '#64748b' }}>{session.autoSubmitted ? 'Tự nộp' : 'Nộp thường'}</small>
                                                    </td>
                                                    <td><small>{session.submitReason || 'manual'}</small></td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                            <Link to={`/teacher/student/${studentId}/preview/result/${session.id}`} className="btn btn-sm btn-outline"><i className="bi bi-eye"></i></Link>
                                                            {canExportCertificate && (
                                                                <button
                                                                    className={`btn btn-sm ${pct >= 60 ? 'btn-success-soft' : 'btn-outline'}`}
                                                                    onClick={() => setSelectedCertificate({
                                                                        ...session,
                                                                        aggregateTotal,
                                                                        initialDocumentType,
                                                                        schoolName: userProfile?.schoolName || student.schoolName || null,
                                                                        classroomName: student.classroomName || student.className || exam?.grade || null,
                                                                        teacherSlug: userProfile?.teacherSlug || null,
                                                                    })}
                                                                    title={pct >= 60 ? 'Xuất giấy khen' : 'Xuất giấy xác nhận'}
                                                                >
                                                                    <i className="bi bi-printer"></i>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </motion.tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <div className="upload-section">
                    <div className="upload-section-header"><i className="bi bi-layout-text-window"></i> Góc nhìn học sinh</div>
                    <div className="upload-section-body">
                        {exams.length === 0 ? (
                            <div className="empty-state" style={{ padding: 32 }}>
                                <i className="bi bi-journal-x"></i>
                                <p>Chưa có đề đang mở cho lớp này.</p>
                            </div>
                        ) : (
                            <div className="dashboard-grid">
                                {exams.filter((exam) => exam.status === 'active').slice(0, 8).map((exam, index) => (
                                    <motion.div key={exam.id} className="exam-card exam-card-student" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
                                        <div className="exam-title">{exam.title}</div>
                                        {(exam.subject || exam.grade) && (
                                            <div className="exam-tags">
                                                {exam.subject && <span className="exam-tag">{exam.subject}</span>}
                                                {exam.grade && <span className="exam-tag">{exam.grade}</span>}
                                            </div>
                                        )}
                                        <div className="exam-meta">
                                            <span><i className="bi bi-question-circle"></i> {exam.questionCount || 0} câu</span>
                                            <span><i className="bi bi-clock"></i> {exam.duration || 0} phút</span>
                                        </div>
                                        {exam.antiCheat?.enabled && (
                                            <div className="exam-tags" style={{ marginTop: 10 }}>
                                                <span className="exam-tag" style={{ background: '#ecfdf5', color: '#065f46' }}><i className="bi bi-shield-lock"></i> Chống gian lận</span>
                                                {exam.antiCheat?.requireFullscreen !== false && <span className="exam-tag" style={{ background: '#eff6ff', color: '#1d4ed8' }}><i className="bi bi-arrows-fullscreen"></i> Toàn màn hình</span>}
                                            </div>
                                        )}
                                        <div className="exam-actions">
                                            <Link to={`/teacher/student/${studentId}/preview/quiz/${exam.id}`} className="btn btn-sm btn-primary">
                                                <i className="bi bi-display"></i> Xem giao diện thi
                                            </Link>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="upload-section">
                    <div className="upload-section-header"><i className="bi bi-journal-text"></i> Audit gần đây</div>
                    <div className="upload-section-body">
                        {auditLogs.length === 0 ? (
                            <div className="empty-state" style={{ padding: 32 }}>
                                <i className="bi bi-clock-history"></i>
                                <p>Chưa có audit log nào cho học sinh này.</p>
                            </div>
                        ) : (
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Thời gian</th>
                                            <th>Hành động</th>
                                            <th>Người thực hiện</th>
                                            <th>Ghi chú</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditLogs.map((log) => (
                                            <tr key={log.id}>
                                                <td><small>{formatDateTime(log.createdAt)}</small></td>
                                                <td style={{ fontWeight: 700 }}>{log.action}</td>
                                                <td>{log.actorName || log.actorId}</td>
                                                <td><small>{JSON.stringify(log.metadata || {})}</small></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {selectedCertificate && (
                <Certificate
                    studentName={student.displayName}
                    examTitle={selectedCertificate.examTitle || examMap[selectedCertificate.examId]?.title}
                    score={selectedCertificate.score}
                    total={selectedCertificate.aggregateTotal || selectedCertificate.total}
                    teacherName={scopeTeacherName}
                    schoolName={selectedCertificate.schoolName}
                    classroomName={selectedCertificate.classroomName}
                    teacherSlug={selectedCertificate.teacherSlug}
                    date={formatDate(selectedCertificate.completedAt)}
                    initialDocumentType={selectedCertificate.initialDocumentType}
                    onClose={() => setSelectedCertificate(null)}
                />
            )}
        </div>
    );
}