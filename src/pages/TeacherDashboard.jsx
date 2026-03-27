import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTimeAgo } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import Swal from 'sweetalert2';

export default function TeacherDashboard() {
    const { user, userProfile, isSubscriptionActive, refreshProfile, generateSlug } = useAuth();
    const [exams, setExams] = useState([]);
    const [students, setStudents] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0, draft: 0, totalSessions: 0, studentCount: 0 });
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState('exams'); // 'exams' | 'students' | 'guide' | 'settings'
    const [loading, setLoading] = useState(true);

    const slug = userProfile?.teacherSlug;
    const portalUrl = slug ? `${window.location.origin}/t/${slug}` : null;
    const subActive = isSubscriptionActive?.();
    const subEnd = userProfile?.subscriptionEnd?.toDate?.();
    const daysLeft = subEnd ? Math.ceil((subEnd - Date.now()) / 86400000) : null;

    useEffect(() => { if (user) loadData(); }, [user]);

    const loadData = async () => {
        const [examSnap, studentSnap] = await Promise.all([
            getDocs(query(collection(db, 'exams'), where('teacherId', '==', user.uid), orderBy('createdAt', 'desc'))),
            getDocs(query(collection(db, 'users'), where('teacherId', '==', user.uid))),
        ]);

        const examList = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const studentList = studentSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
        setStudents(studentList);

        // Load session counts per exam + per student
        const sessionCounts = {};
        const studentSessionCounts = {};
        let totalSessions = 0;
        for (const exam of examList) {
            const sSnap = await getDocs(query(collection(db, 'sessions'), where('examId', '==', exam.id)));
            sessionCounts[exam.id] = sSnap.size;
            totalSessions += sSnap.size;
            sSnap.docs.forEach(d => {
                const sid = d.data().studentId;
                studentSessionCounts[sid] = (studentSessionCounts[sid] || 0) + 1;
            });
        }

        setExams(examList.map(e => ({ ...e, sessionCount: sessionCounts[e.id] || 0 })));
        setStudents(studentList.map(s => ({ ...s, quizCount: studentSessionCounts[s.uid] || 0 })));
        setStats({
            total: examList.length,
            active: examList.filter(e => e.status === 'active').length,
            draft: examList.filter(e => e.status !== 'active').length,
            totalSessions,
            studentCount: studentList.length,
        });
        setLoading(false);
    };

    const toggleStatus = async (examId, currentStatus) => {
        if (!subActive && currentStatus !== 'active') {
            Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn. Liên hệ admin để gia hạn.', 'warning');
            return;
        }
        const newStatus = currentStatus === 'active' ? 'draft' : 'active';
        const r = await Swal.fire({
            title: `${newStatus === 'active' ? 'Kích hoạt' : 'Đóng'} đề thi?`,
            icon: 'question', showCancelButton: true,
            confirmButtonText: newStatus === 'active' ? 'Kích hoạt' : 'Đóng lại',
            cancelButtonText: 'Hủy',
            confirmButtonColor: newStatus === 'active' ? '#10b981' : '#f59e0b',
        });
        if (!r.isConfirmed) return;
        await updateDoc(doc(db, 'exams', examId), { status: newStatus });
        setExams(prev => prev.map(e => e.id === examId ? { ...e, status: newStatus } : e));
        setStats(prev => ({ ...prev, active: prev.active + (newStatus === 'active' ? 1 : -1), draft: prev.draft + (newStatus === 'active' ? -1 : 1) }));
    };

    const handleDelete = async (examId, title) => {
        const r = await Swal.fire({
            title: 'Xóa đề thi?', html: `Xóa "<b>${title}</b>"?<br><small>Không thể hoàn tác.</small>`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonText: 'Hủy', confirmButtonText: 'Xóa vĩnh viễn',
        });
        if (!r.isConfirmed) return;
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        await Promise.all(qSnap.docs.map(d => deleteDoc(d.ref)));
        await deleteDoc(doc(db, 'exams', examId));
        setExams(prev => prev.filter(e => e.id !== examId));
        Swal.fire({ icon: 'success', title: 'Đã xóa!', timer: 1500, showConfirmButton: false });
    };

    const copyPortalLink = () => {
        if (!portalUrl) return;
        navigator.clipboard.writeText(portalUrl);
        Swal.fire({ icon: 'success', title: 'Đã copy link!', text: portalUrl, timer: 2000, showConfirmButton: false });
    };

    // ===== Student management =====
    const handleBlockStudent = async (student) => {
        const isBlocked = student.blocked;
        const r = await Swal.fire({
            title: isBlocked ? 'Mở khóa học sinh?' : 'Khóa học sinh?',
            text: isBlocked
                ? `Mở khóa "${student.displayName}"? Họ sẽ lại có thể thi.`
                : `Khóa "${student.displayName}"? Họ sẽ không thể thi.`,
            icon: 'question', showCancelButton: true,
            confirmButtonText: isBlocked ? 'Mở khóa' : 'Khóa',
            confirmButtonColor: isBlocked ? '#10b981' : '#f59e0b',
            cancelButtonText: 'Hủy',
        });
        if (!r.isConfirmed) return;
        await updateDoc(doc(db, 'users', student.uid), { blocked: !isBlocked });
        setStudents(prev => prev.map(s => s.uid === student.uid ? { ...s, blocked: !isBlocked } : s));
    };

    const handleRemoveStudent = async (student) => {
        const r = await Swal.fire({
            title: 'Xóa học sinh?',
            html: `Xóa "<b>${student.displayName}</b>" khỏi lớp?<br><small>Họ có thể tham gia lại bằng link.</small>`,
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Xóa', cancelButtonText: 'Hủy',
        });
        if (!r.isConfirmed) return;
        await updateDoc(doc(db, 'users', student.uid), { teacherId: null, teacherName: null, blocked: false });
        setStudents(prev => prev.filter(s => s.uid !== student.uid));
        setStats(prev => ({ ...prev, studentCount: prev.studentCount - 1 }));
    };

    // ===== Settings =====
    const handleUpdateSlug = async () => {
        const { value } = await Swal.fire({
            title: 'Đổi link lớp học',
            input: 'text',
            inputLabel: 'Nhập slug mới (chỉ chữ thường, số, dấu gạch ngang)',
            inputValue: slug || '',
            inputPlaceholder: 'vd: nguyen-van-a',
            showCancelButton: true,
            confirmButtonText: 'Cập nhật',
            cancelButtonText: 'Hủy',
            inputValidator: (val) => {
                if (!val || !/^[a-z0-9-]+$/.test(val)) return 'Slug chỉ gồm chữ thường, số và dấu gạch ngang';
            }
        });
        if (!value) return;
        await updateDoc(doc(db, 'users', user.uid), { teacherSlug: value });
        await refreshProfile();
        Swal.fire({ icon: 'success', title: 'Đã cập nhật!', text: `Link mới: /t/${value}`, timer: 2000, showConfirmButton: false });
    };

    const handleUpdateSchool = async () => {
        const { value } = await Swal.fire({
            title: 'Cập nhật tên trường',
            input: 'text',
            inputValue: userProfile?.schoolName || '',
            inputPlaceholder: 'VD: THPT Nguyễn Huệ',
            showCancelButton: true,
            confirmButtonText: 'Cập nhật',
            cancelButtonText: 'Hủy',
        });
        if (value === undefined) return;
        await updateDoc(doc(db, 'users', user.uid), { schoolName: value.trim() || null });
        await refreshProfile();
        Swal.fire({ icon: 'success', title: 'Đã cập nhật!', timer: 1500, showConfirmButton: false });
    };

    const filtered = exams
        .filter(e => filter === 'all' || e.status === filter)
        .filter(e => !search || e.title.toLowerCase().includes(search.toLowerCase()));

    const filteredStudents = students.filter(s =>
        !search || (s.displayName || '').toLowerCase().includes(search.toLowerCase()) || (s.email || '').toLowerCase().includes(search.toLowerCase())
    );

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải kho đề...</p></div>;

    return (
        <div>
            {/* Subscription banner */}
            {userProfile?.teacherStatus === 'trial' && (
                <div className="alert alert-info" style={{ marginBottom: 20 }}>
                    <i className="bi bi-info-circle"></i> Bạn đang dùng thử. Liên hệ admin để nâng cấp gói.
                </div>
            )}
            {daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 20 }}>
                    <i className="bi bi-exclamation-triangle"></i> Gói hết hạn trong <strong>{daysLeft} ngày</strong>. Liên hệ admin.
                </div>
            )}
            {userProfile?.teacherStatus === 'expired' && (
                <div className="alert alert-danger" style={{ marginBottom: 20 }}>
                    <i className="bi bi-x-octagon"></i> Gói đã hết hạn. Không thể mở đề mới. Liên hệ admin.
                </div>
            )}

            {/* Portal link bar */}
            {portalUrl && (
                <div className="card" style={{ marginBottom: 20, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="bi bi-link-45deg" style={{ fontSize: '1.2rem', color: 'var(--primary)' }}></i>
                        <span style={{ fontSize: '0.9rem' }}>Link cho học sinh:</span>
                        <code style={{ fontSize: '0.85rem', background: 'var(--bg)', padding: '2px 8px', borderRadius: 4 }}>/t/{slug}</code>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={copyPortalLink}>
                        <i className="bi bi-clipboard"></i> Copy
                    </button>
                </div>
            )}

            <div className="stats-grid">
                <StatsCard icon="journal-text" label="Tổng đề" value={stats.total} color="primary" delay={0} />
                <StatsCard icon="broadcast" label="Đang mở" value={stats.active} color="success" delay={1} />
                <StatsCard icon="people-fill" label="Học sinh" value={stats.studentCount} color="cool" delay={2} />
                <StatsCard icon="bar-chart" label="Lượt thi" value={stats.totalSessions} color="warm" delay={3} />
            </div>

            {/* Tab navigation */}
            <div className="tab-nav" style={{ marginBottom: 16 }}>
                <button className={`tab-btn ${activeTab === 'exams' ? 'active' : ''}`} onClick={() => { setActiveTab('exams'); setSearch(''); }}>
                    <i className="bi bi-journal-text"></i> Đề thi
                </button>
                <button className={`tab-btn ${activeTab === 'students' ? 'active' : ''}`} onClick={() => { setActiveTab('students'); setSearch(''); }}>
                    <i className="bi bi-people"></i> Học sinh ({stats.studentCount})
                </button>
                <button className={`tab-btn ${activeTab === 'guide' ? 'active' : ''}`} onClick={() => { setActiveTab('guide'); setSearch(''); }}>
                    <i className="bi bi-book"></i> Hướng dẫn
                </button>
                <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); setSearch(''); }}>
                    <i className="bi bi-gear"></i> Cài đặt
                </button>
            </div>

            {/* ===== EXAMS TAB ===== */}
            {activeTab === 'exams' && (
                <>
                    <div className="section-header">
                        <h2 className="section-title"><i className="bi bi-collection"></i> Kho Đề Thi</h2>
                        <Link to="/teacher/upload" className={`btn btn-primary ${!subActive ? 'btn-disabled' : ''}`} onClick={e => { if (!subActive) { e.preventDefault(); Swal.fire('Hết hạn', 'Gói đăng ký đã hết hạn.', 'warning'); } }}>
                            <i className="bi bi-cloud-arrow-up"></i> Tải lên đề mới
                        </Link>
                    </div>

                    <div className="filter-bar">
                        <div className="filter-tabs">
                            {[
                                { key: 'all', label: 'Tất cả', count: exams.length },
                                { key: 'active', label: 'Đang mở', count: stats.active },
                                { key: 'draft', label: 'Nháp', count: stats.draft },
                            ].map(t => (
                                <button key={t.key} className={`filter-tab ${filter === t.key ? 'active' : ''}`} onClick={() => setFilter(t.key)}>
                                    {t.label} <span className="filter-count">{t.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="search-box">
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm đề..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-journal-plus"></i>
                            <p>{exams.length === 0 ? 'Chưa có đề thi nào.' : 'Không tìm thấy.'}</p>
                            {exams.length === 0 && subActive && (
                                <Link to="/teacher/upload" className="btn btn-primary"><i className="bi bi-plus-lg"></i> Tạo đề đầu tiên</Link>
                            )}
                        </div>
                    ) : (
                        <div className="dashboard-grid">
                            <AnimatePresence>
                                {filtered.map((exam, idx) => (
                                    <motion.div key={exam.id} className="exam-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: idx * 0.05 }} layout>
                                        <div className="exam-card-header">
                                            <div className="exam-title">{exam.title}</div>
                                            <span className={`status-dot ${exam.status}`}><span className="status-dot-inner"></span></span>
                                        </div>
                                        <div className="exam-meta">
                                            <span><i className="bi bi-question-circle"></i> {exam.questionCount || 0} câu</span>
                                            <span><i className="bi bi-clock"></i> {exam.duration || 0} phút</span>
                                            <span><i className="bi bi-people"></i> {exam.sessionCount} lượt</span>
                                        </div>
                                        <div className="exam-date"><i className="bi bi-calendar3"></i> {formatTimeAgo(exam.createdAt)}</div>
                                        <div className="exam-actions">
                                            <button className={`btn btn-sm ${exam.status === 'active' ? 'btn-warning-soft' : 'btn-success-soft'}`} onClick={() => toggleStatus(exam.id, exam.status)}>
                                                <i className={`bi bi-${exam.status === 'active' ? 'pause-circle' : 'play-circle'}`}></i>
                                                {exam.status === 'active' ? 'Đóng' : 'Mở'}
                                            </button>
                                            <Link to={`/teacher/exam/${exam.id}`} className="btn btn-sm btn-outline"><i className="bi bi-eye"></i> Chi tiết</Link>
                                            <Link to={`/teacher/exam/${exam.id}/sessions`} className="btn btn-sm btn-outline"><i className="bi bi-bar-chart"></i> Kết quả</Link>
                                            <button className="btn btn-sm btn-danger-soft" onClick={() => handleDelete(exam.id, exam.title)}><i className="bi bi-trash3"></i></button>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </>
            )}

            {/* ===== STUDENTS TAB ===== */}
            {activeTab === 'students' && (
                <div>
                    <div className="filter-bar" style={{ marginBottom: 16 }}>
                        <div className="search-box" style={{ flex: 1 }}>
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm học sinh..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {filteredStudents.length === 0 ? (
                        <div className="empty-state">
                            <i className="bi bi-people"></i>
                            <p>{students.length === 0 ? 'Chưa có học sinh nào.' : 'Không tìm thấy.'}</p>
                            {students.length === 0 && portalUrl && (
                                <div style={{ marginTop: 12 }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 8 }}>Chia sẻ link cho học sinh:</p>
                                    <button className="btn btn-primary" onClick={copyPortalLink}><i className="bi bi-clipboard"></i> Copy link lớp</button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="card">
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Học sinh</th>
                                            <th>Email</th>
                                            <th>Bài đã thi</th>
                                            <th>Trạng thái</th>
                                            <th style={{ textAlign: 'right' }}>Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredStudents.map((s, idx) => (
                                            <tr key={s.uid} style={{ opacity: s.blocked ? 0.6 : 1 }}>
                                                <td>{idx + 1}</td>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        {s.photoURL && <img src={s.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} referrerPolicy="no-referrer" />}
                                                        <span style={{ fontWeight: 600 }}>{s.displayName || 'Ẩn danh'}</span>
                                                    </div>
                                                </td>
                                                <td><small style={{ color: 'var(--text-muted)' }}>{s.email}</small></td>
                                                <td>{s.quizCount || 0}</td>
                                                <td>
                                                    {s.blocked
                                                        ? <span className="stat-badge expired"><i className="bi bi-lock"></i> Khóa</span>
                                                        : <span className="stat-badge active">Hoạt động</span>
                                                    }
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                        <button className={`btn btn-sm ${s.blocked ? 'btn-success-soft' : 'btn-warning-soft'}`} onClick={() => handleBlockStudent(s)} title={s.blocked ? 'Mở khóa' : 'Khóa'}>
                                                            <i className={`bi bi-${s.blocked ? 'unlock' : 'lock'}`}></i>
                                                        </button>
                                                        <button className="btn btn-sm btn-danger-soft" onClick={() => handleRemoveStudent(s)} title="Xóa khỏi lớp">
                                                            <i className="bi bi-person-x"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ===== GUIDE TAB ===== */}
            {activeTab === 'guide' && (
                <div style={{ maxWidth: 800 }}>
                    <h2 style={{ fontSize: '1.3rem', marginBottom: 20 }}><i className="bi bi-book"></i> Hướng dẫn soạn đề thi DOCX</h2>

                    {/* Overview */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 12, color: 'var(--primary)' }}><i className="bi bi-info-circle"></i> Tổng quan</h3>
                            <p style={{ lineHeight: 1.7, marginBottom: 12 }}>
                                Hệ thống hỗ trợ <strong>3 loại câu hỏi</strong> — tự động nhận dạng dựa trên cách soạn. Soạn đề trong file <strong>.docx</strong> (Word / Google Docs) rồi tải lên.
                            </p>
                            <div style={{ background: 'var(--info-bg)', padding: 12, borderRadius: 8, fontSize: '0.9rem' }}>
                                <strong>Quy tắc chung:</strong>
                                <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 2 }}>
                                    <li>Mỗi câu bắt đầu bằng <code>Câu X:</code> (X = 1, 2, 3...)</li>
                                    <li><strong>Đáp án đúng</strong> đánh dấu bằng 1 trong 2 cách:
                                        <br/>• <u>Gạch chân</u> đáp án đúng trong Word (chuẩn tron-de)
                                        <br/>• Ghi dòng <code>Đáp án: X</code> sau câu hỏi
                                    </li>
                                    <li><strong>Lời giải</strong> (tùy chọn): thêm dòng <code>Lời giải: ...</code> sau đáp án</li>
                                    <li>Hỗ trợ hình ảnh chèn trực tiếp, công thức LaTeX <code>$...$</code></li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Type 1: Multiple choice A.B.C.D. */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient">
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-1-circle me-2"></i>Phần I — Trắc nghiệm nhiều lựa chọn (A. B. C. D.)
                            </h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>Phương án bắt đầu bằng <strong>A.</strong> <strong>B.</strong> <strong>C.</strong> <strong>D.</strong> (chữ HOA + dấu chấm). Đánh dấu đáp án đúng bằng <u>gạch chân</u> hoặc dòng "Đáp án:".</p>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`Câu 1: Phương trình nào có nghiệm x = 2?
A. $x^2 - 4 = 0$
B. $x^2 + 4 = 0$
C. $x^2 - 2x + 2 = 0$
D. $2x^2 + 1 = 0$
Đáp án: A
Lời giải: $x^2 - 4 = (x-2)(x+2) = 0$ nên x = 2 hoặc x = -2.

Câu 2: Thủ đô của Việt Nam là:
A. TP. Hồ Chí Minh
B. Đà Nẵng
C. Hà Nội
D. Huế
Đáp án: C`}
                            </div>
                            <div style={{ marginTop: 12, background: 'var(--success-bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem' }}>
                                <i className="bi bi-lightbulb" style={{ color: 'var(--success)' }}></i> <strong>Cách khác:</strong> Trong Word, <u>gạch chân</u> dòng đáp án đúng thay vì ghi "Đáp án: X". Cả hai cách đều được hỗ trợ.
                            </div>
                        </div>
                    </div>

                    {/* Type 2: True/False a)b)c)d) */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient" style={{ background: 'var(--gradient-success)' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-2-circle me-2"></i>Phần II — Đúng / Sai (a) b) c) d))
                            </h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
                                Mệnh đề bắt đầu bằng <strong>a)</strong> <strong>b)</strong> <strong>c)</strong> <strong>d)</strong> (chữ thường + ngoặc đóng).
                                Mỗi mệnh đề có thể Đúng (D) hoặc Sai (S).
                            </p>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`Câu 3: Cho hàm số $y = x^2 + 2x - 3$. Xét tính đúng/sai:
a) Hàm số đồng biến trên $(0; +\\infty)$
b) Hàm số có giá trị nhỏ nhất là $-4$
c) Đồ thị cắt trục Ox tại 2 điểm
d) Hàm số nghịch biến trên $(-\\infty; -1)$
Đáp án: DDDS
Lời giải: a) Đúng vì $y' = 2x+2 > 0$ khi $x > 0$.
b) Đúng: $y_{min} = -4$ tại $x = -1$.
c) Đúng: $\\Delta = 16 > 0$.
d) Sai: nghịch biến trên $(-\\infty; -1)$ đúng, nhưng...`}
                            </div>
                            <div style={{ marginTop: 12, background: 'var(--warning-bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem' }}>
                                <i className="bi bi-exclamation-triangle" style={{ color: 'var(--warning)' }}></i> <strong>Chú ý:</strong>
                                <br/>• Dùng <strong>a) b) c) d)</strong> (chữ thường + ngoặc) — KHÁC với A. B. C. D. của trắc nghiệm
                                <br/>• <code>Đáp án: DDDS</code> = a) Đúng, b) Đúng, c) Đúng, d) Sai
                                <br/>• Hoặc <u>gạch chân</u> mệnh đề Đúng trong Word
                            </div>
                        </div>
                    </div>

                    {/* Type 3: Short answer */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div className="card-header-gradient" style={{ background: 'var(--gradient-cool)' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>
                                <i className="bi bi-3-circle me-2"></i>Phần III — Trả lời ngắn
                            </h3>
                        </div>
                        <div style={{ padding: 20 }}>
                            <p style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
                                Không có phương án A/B/C/D hay a/b/c/d. Chỉ cần câu hỏi + dòng <code>Đáp án:</code> chứa giá trị đúng.
                            </p>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`Câu 5: Tính giá trị biểu thức $2x + 3$ khi $x = 5$.
Đáp án: 13
Lời giải: $2(5) + 3 = 10 + 3 = 13$

Câu 6: Cho tam giác vuông có hai cạnh góc vuông
3cm và 4cm. Cạnh huyền bằng bao nhiêu cm?
Đáp án: 5
Lời giải: Áp dụng Pytago: $\\sqrt{3^2 + 4^2} = \\sqrt{25} = 5$`}
                            </div>
                        </div>
                    </div>

                    {/* Lời giải section */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 12, color: 'var(--success)' }}><i className="bi bi-lightbulb"></i> Lời giải (tùy chọn)</h3>
                            <p style={{ lineHeight: 1.7, marginBottom: 12 }}>
                                Sau mỗi câu, thêm dòng <code>Lời giải:</code> để giải thích. Lời giải hiển thị cho học sinh sau khi nộp bài.
                            </p>
                            <div style={{ display: 'grid', gap: 8 }}>
                                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem', borderLeft: '3px solid var(--success)' }}>
                                    Từ khóa nhận dạng: <code>Lời giải:</code> hoặc <code>Giải:</code> hoặc <code>Giải thích:</code>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem', borderLeft: '3px solid var(--info)' }}>
                                    Lời giải có thể nhiều dòng — tất cả nội dung sau "Lời giải:" đến câu tiếp theo sẽ được gom lại.
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 10, borderRadius: 8, fontSize: '0.85rem', borderLeft: '3px solid var(--accent)' }}>
                                    Hỗ trợ công thức LaTeX và hình ảnh trong lời giải.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Tips & advanced */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 16, color: 'var(--accent)' }}><i className="bi bi-stars"></i> Mẹo nâng cao</h3>
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--primary)' }}>
                                    <strong>Cách phân biệt loại câu</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        • <strong>A. B. C. D.</strong> (HOA + chấm) → Trắc nghiệm<br/>
                                        • <strong>a) b) c) d)</strong> (thường + ngoặc) → Đúng/Sai<br/>
                                        • Không có phương án, chỉ <code>Đáp án:</code> → Trả lời ngắn
                                    </p>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--success)' }}>
                                    <strong>Đánh dấu đáp án bằng gạch chân</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        Trong Word, bôi đen đáp án đúng → nhấn <kbd>Ctrl+U</kbd> để gạch chân.
                                        Hệ thống tự nhận biết — không cần ghi "Đáp án: X".
                                        Với Đúng/Sai: gạch chân mệnh đề Đúng, không gạch = Sai.
                                    </p>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
                                    <strong>Công thức & hình ảnh</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        Inline: <code>$x^2 + y^2$</code> — Block: <code>$$\frac&#123;a&#125;&#123;b&#125;$$</code><br/>
                                        Hình ảnh: chèn trực tiếp trong Word, tự động trích xuất.
                                    </p>
                                </div>
                                <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, borderLeft: '3px solid var(--danger)' }}>
                                    <strong>Lưu ý quan trọng</strong>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                                        • File chỉ nhận .docx (không phải .doc cũ) — tối đa 20MB<br/>
                                        • Đánh số câu liên tục: Câu 1, Câu 2, Câu 3...<br/>
                                        • Trắc nghiệm phải có ít nhất 2 phương án<br/>
                                        • Đúng/Sai phải có đúng 4 mệnh đề a) b) c) d)
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Complete template */}
                    <div className="card" style={{ marginBottom: 20 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.05rem', marginBottom: 12 }}><i className="bi bi-file-earmark-text"></i> Mẫu đề hoàn chỉnh (3 phần)</h3>
                            <div className="code-block" style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: '0.85rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: 500, overflow: 'auto' }}>
{`Câu 1: Số nào sau đây là số nguyên tố?
A. 4
B. 9
C. 7
D. 15
Đáp án: C
Lời giải: 7 chỉ chia hết cho 1 và chính nó.

Câu 2: $\\sin(90°)$ bằng:
A. 0
B. 1
C. -1
D. $\\frac{1}{2}$
Đáp án: B

Câu 3: Nước là hợp chất gồm:
A. Hydro và Oxy
B. Hydro và Nitơ
C. Oxy và Carbon
D. Nitơ và Oxy
Đáp án: A

Câu 4: Xét tính đúng/sai các mệnh đề sau:
a) $\\sqrt{4} = 2$
b) $\\sqrt{9} = \\pm 3$
c) $\\sqrt{0} = 0$
d) $\\sqrt{-1}$ không xác định trong $\\mathbb{R}$
Đáp án: DSDD
Lời giải: b) Sai vì $\\sqrt{9} = 3$ (chỉ lấy giá trị dương).

Câu 5: Nhiệt độ sôi của nước ở áp suất tiêu chuẩn
là bao nhiêu °C?
Đáp án: 100
Lời giải: Ở 1 atm, nước sôi ở 100°C.`}
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 12 }}>
                                Copy mẫu trên vào Word (.docx), chỉnh sửa theo đề của bạn, lưu và tải lên.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== SETTINGS TAB ===== */}
            {activeTab === 'settings' && (
                <div style={{ maxWidth: 600 }}>
                    <div className="card" style={{ marginBottom: 16 }}>
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}><i className="bi bi-person-circle"></i> Thông tin</h3>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Tên hiển thị</div>
                                    <div className="settings-value">{userProfile?.displayName}</div>
                                </div>
                            </div>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Email</div>
                                    <div className="settings-value">{userProfile?.email}</div>
                                </div>
                            </div>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Tên trường / Tổ chức</div>
                                    <div className="settings-value">{userProfile?.schoolName || <em style={{ color: 'var(--text-muted)' }}>Chưa đặt</em>}</div>
                                </div>
                                <button className="btn btn-sm btn-outline" onClick={handleUpdateSchool}>
                                    <i className="bi bi-pencil"></i> Sửa
                                </button>
                            </div>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Link lớp học</div>
                                    <div className="settings-value">{portalUrl || <em style={{ color: 'var(--text-muted)' }}>Chưa có</em>}</div>
                                </div>
                                <button className="btn btn-sm btn-outline" onClick={handleUpdateSlug}>
                                    <i className="bi bi-pencil"></i> Sửa
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div style={{ padding: 20 }}>
                            <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}><i className="bi bi-credit-card"></i> Gói đăng ký</h3>

                            <div className="settings-row">
                                <div>
                                    <div className="settings-label">Trạng thái</div>
                                    <div className="settings-value">
                                        {userProfile?.teacherStatus === 'trial' && <span className="stat-badge trial">Dùng thử</span>}
                                        {userProfile?.teacherStatus === 'active' && <span className="stat-badge active">Hoạt động</span>}
                                        {userProfile?.teacherStatus === 'expired' && <span className="stat-badge expired">Hết hạn</span>}
                                        {!userProfile?.teacherStatus && <span className="stat-badge pending">Chưa xác định</span>}
                                    </div>
                                </div>
                            </div>

                            {userProfile?.subscriptionMonths && (
                                <div className="settings-row">
                                    <div>
                                        <div className="settings-label">Gói</div>
                                        <div className="settings-value">{userProfile.subscriptionMonths} tháng</div>
                                    </div>
                                </div>
                            )}

                            {subEnd && (
                                <div className="settings-row">
                                    <div>
                                        <div className="settings-label">Hết hạn</div>
                                        <div className="settings-value">
                                            {subEnd.toLocaleDateString('vi-VN')}
                                            {daysLeft > 0 && <small style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({daysLeft} ngày)</small>}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 12 }}>
                                Liên hệ quản trị viên để gia hạn hoặc nâng cấp gói.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
