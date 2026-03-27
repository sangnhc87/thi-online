import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDate, formatDateTime } from '../utils/formatters';
import StatsCard from '../components/StatsCard';
import Swal from 'sweetalert2';

function generateSlug(name) {
    return (name || 'user')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 40);
}

export default function AdminDashboard() {
    const { user } = useAuth();
    const [teachers, setTeachers] = useState([]);
    const [students, setStudents] = useState([]);
    const [stats, setStats] = useState({ pending: 0, trial: 0, active: 0, expired: 0, totalStudents: 0 });
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState('teachers');
    const [loading, setLoading] = useState(true);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        // Load all teachers
        const teacherQ = query(collection(db, 'users'), where('role', '==', 'teacher'));
        const teacherSnap = await getDocs(teacherQ);
        const teacherList = teacherSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

        // Check expired subscriptions
        const now = new Date();
        const enriched = teacherList.map(t => {
            let status = t.teacherStatus || 'pending';
            if (status === 'active' && t.subscriptionEnd) {
                const end = t.subscriptionEnd.toDate ? t.subscriptionEnd.toDate() : new Date(t.subscriptionEnd);
                if (end <= now) status = 'expired';
            }
            return { ...t, computedStatus: status };
        });

        // Load pending teachers (role: 'pending_teacher')
        const pendingQ = query(collection(db, 'users'), where('role', '==', 'pending_teacher'));
        const pendingSnap = await getDocs(pendingQ);
        const pendingList = pendingSnap.docs.map(d => ({ uid: d.id, ...d.data(), computedStatus: 'pending' }));

        const allTeachers = [...pendingList, ...enriched].sort((a, b) => {
            const order = { pending: 0, trial: 1, active: 2, expired: 3 };
            return (order[a.computedStatus] || 9) - (order[b.computedStatus] || 9);
        });

        setTeachers(allTeachers);

        // Load all students
        const studentQ = query(collection(db, 'users'), where('role', '==', 'student'));
        const studentSnap = await getDocs(studentQ);
        const studentList = studentSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
        setStudents(studentList);

        // Stats
        const pending = allTeachers.filter(t => t.computedStatus === 'pending').length;
        const trial = allTeachers.filter(t => t.computedStatus === 'trial').length;
        const active = allTeachers.filter(t => t.computedStatus === 'active').length;
        const expired = allTeachers.filter(t => t.computedStatus === 'expired').length;
        setStats({ pending, trial, active, expired, totalStudents: studentList.length });
        setLoading(false);
    };

    const approveTeacher = async (teacher, months) => {
        const slug = teacher.teacherSlug || generateSlug(teacher.displayName) + '-' + Date.now().toString(36);
        const now = new Date();
        let subscriptionEnd = null;
        let teacherStatus = 'trial';

        if (months > 0) {
            teacherStatus = 'active';
            subscriptionEnd = new Date(now);
            subscriptionEnd.setMonth(subscriptionEnd.getMonth() + months);
        }

        const updateData = {
            role: 'teacher',
            teacherStatus,
            teacherSlug: slug,
            schoolName: teacher.schoolName || '',
            subscriptionMonths: months,
            approvedAt: Timestamp.now(),
            approvedBy: user.uid,
        };
        if (subscriptionEnd) {
            updateData.subscriptionEnd = Timestamp.fromDate(subscriptionEnd);
        }

        await updateDoc(doc(db, 'users', teacher.uid), updateData);
        Swal.fire({ icon: 'success', title: 'Đã duyệt!', text: `${teacher.displayName} — ${months === 0 ? 'Dùng thử' : months + ' tháng'}`, timer: 2000, showConfirmButton: false });
        loadData();
    };

    const handleApprove = async (teacher) => {
        const { value: months } = await Swal.fire({
            title: `Duyệt: ${teacher.displayName}`,
            html: `
                <p style="margin-bottom:12px;color:#64748b">${teacher.email}</p>
                ${teacher.schoolName ? `<p style="margin-bottom:12px"><b>Trường:</b> ${teacher.schoolName}</p>` : ''}
                <label style="font-weight:600;display:block;margin-bottom:6px">Thời hạn gói:</label>
                <select id="swal-months" class="swal2-select" style="width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0">
                    <option value="0">Dùng thử (miễn phí)</option>
                    <option value="1">1 tháng</option>
                    <option value="3">3 tháng</option>
                    <option value="6">6 tháng</option>
                    <option value="12" selected>12 tháng (1 năm)</option>
                    <option value="24">24 tháng (2 năm)</option>
                    <option value="36">36 tháng (3 năm)</option>
                    <option value="60">60 tháng (5 năm)</option>
                    <option value="120">120 tháng (10 năm)</option>
                </select>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Duyệt & Kích hoạt',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#10b981',
            preConfirm: () => {
                return parseInt(document.getElementById('swal-months').value);
            },
        });
        if (months !== undefined) {
            await approveTeacher(teacher, months);
        }
    };

    const handleExtend = async (teacher) => {
        const { value: months } = await Swal.fire({
            title: `Gia hạn: ${teacher.displayName}`,
            html: `
                <p style="color:#64748b">${teacher.email}</p>
                <p style="margin:8px 0">Trạng thái: <b>${getStatusLabel(teacher.computedStatus)}</b></p>
                ${teacher.subscriptionEnd ? `<p>Hết hạn: <b>${formatDate(teacher.subscriptionEnd)}</b></p>` : ''}
                <label style="font-weight:600;display:block;margin:12px 0 6px">Gia hạn thêm:</label>
                <select id="swal-months" class="swal2-select" style="width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0">
                    <option value="1">1 tháng</option>
                    <option value="3">3 tháng</option>
                    <option value="6">6 tháng</option>
                    <option value="12" selected>12 tháng</option>
                    <option value="24">24 tháng</option>
                    <option value="36">36 tháng</option>
                </select>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Gia hạn',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#5b5ea6',
            preConfirm: () => parseInt(document.getElementById('swal-months').value),
        });
        if (!months) return;

        // Calculate new end date (from current end or from now if expired)
        let baseDate = new Date();
        if (teacher.subscriptionEnd) {
            const end = teacher.subscriptionEnd.toDate ? teacher.subscriptionEnd.toDate() : new Date(teacher.subscriptionEnd);
            if (end > baseDate) baseDate = end; // extend from current end
        }
        const newEnd = new Date(baseDate);
        newEnd.setMonth(newEnd.getMonth() + months);

        await updateDoc(doc(db, 'users', teacher.uid), {
            teacherStatus: 'active',
            subscriptionEnd: Timestamp.fromDate(newEnd),
            subscriptionMonths: (teacher.subscriptionMonths || 0) + months,
        });
        Swal.fire({ icon: 'success', title: 'Đã gia hạn!', text: `Hết hạn mới: ${newEnd.toLocaleDateString('vi-VN')}`, timer: 2000, showConfirmButton: false });
        loadData();
    };

    const handleReject = async (teacher) => {
        const result = await Swal.fire({
            title: `Từ chối: ${teacher.displayName}?`,
            text: 'Tài khoản sẽ trở về trạng thái học sinh.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Từ chối',
            cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;

        await updateDoc(doc(db, 'users', teacher.uid), {
            role: 'student',
            teacherStatus: null,
            teacherSlug: null,
            schoolName: null,
        });
        Swal.fire({ icon: 'info', title: 'Đã từ chối', timer: 1500, showConfirmButton: false });
        loadData();
    };

    const handleSuspend = async (teacher) => {
        const result = await Swal.fire({
            title: `Tạm khóa: ${teacher.displayName}?`,
            text: 'Giáo viên sẽ không thể tạo/mở đề thi.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#f59e0b',
            confirmButtonText: 'Tạm khóa',
            cancelButtonText: 'Hủy',
        });
        if (!result.isConfirmed) return;

        await updateDoc(doc(db, 'users', teacher.uid), { teacherStatus: 'expired' });
        Swal.fire({ icon: 'info', title: 'Đã tạm khóa', timer: 1500, showConfirmButton: false });
        loadData();
    };

    const copyPortalLink = (slug) => {
        const url = `${window.location.origin}/t/${slug}`;
        navigator.clipboard.writeText(url);
        Swal.fire({ icon: 'success', title: 'Đã sao chép!', text: url, timer: 2000, showConfirmButton: false });
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'pending': return 'Chờ duyệt';
            case 'trial': return 'Dùng thử';
            case 'active': return 'Đang hoạt động';
            case 'expired': return 'Hết hạn';
            default: return status || 'N/A';
        }
    };

    const getStatusClass = (status) => {
        switch (status) {
            case 'pending': return 'warning';
            case 'trial': return 'info';
            case 'active': return 'success';
            case 'expired': return 'danger';
            default: return 'muted';
        }
    };

    const filtered = teachers
        .filter(t => filter === 'all' || t.computedStatus === filter)
        .filter(t => !search || t.displayName?.toLowerCase().includes(search.toLowerCase()) || t.email?.toLowerCase().includes(search.toLowerCase()));

    if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>🛡️ Quản trị hệ thống</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Quản lý giáo viên, gói đăng ký và học sinh</p>
                </div>
            </div>

            <div className="stats-grid">
                <StatsCard icon="hourglass-split" label="Chờ duyệt" value={stats.pending} color="warm" delay={0} />
                <StatsCard icon="gift" label="Dùng thử" value={stats.trial} color="cool" delay={1} />
                <StatsCard icon="check-circle" label="Đang hoạt động" value={stats.active} color="success" delay={2} />
                <StatsCard icon="exclamation-triangle" label="Hết hạn" value={stats.expired} color="warm" delay={3} />
            </div>

            <div className="tab-nav">
                <button className={`tab-btn ${tab === 'teachers' ? 'active' : ''}`} onClick={() => setTab('teachers')}>
                    <i className="bi bi-person-workspace"></i> Giáo viên ({teachers.length})
                </button>
                <button className={`tab-btn ${tab === 'students' ? 'active' : ''}`} onClick={() => setTab('students')}>
                    <i className="bi bi-people"></i> Học sinh ({students.length})
                </button>
            </div>

            {tab === 'teachers' && (
                <>
                    <div className="filter-bar">
                        <div className="filter-tabs">
                            {[
                                { key: 'all', label: 'Tất cả' },
                                { key: 'pending', label: 'Chờ duyệt' },
                                { key: 'trial', label: 'Dùng thử' },
                                { key: 'active', label: 'Hoạt động' },
                                { key: 'expired', label: 'Hết hạn' },
                            ].map(f => (
                                <button key={f.key} className={`filter-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
                            ))}
                        </div>
                        <div className="search-box">
                            <i className="bi bi-search"></i>
                            <input type="text" placeholder="Tìm giáo viên..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <div className="empty-state"><i className="bi bi-person-x"></i><p>Không tìm thấy giáo viên.</p></div>
                    ) : (
                        <div className="admin-teacher-list">
                            <AnimatePresence>
                                {filtered.map((t, idx) => (
                                    <motion.div key={t.uid} className="admin-teacher-card" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.03 }}>
                                        <div className="atc-left">
                                            {t.photoURL ? (
                                                <img src={t.photoURL} alt="" className="atc-avatar" referrerPolicy="no-referrer" />
                                            ) : (
                                                <div className="atc-avatar-placeholder">{(t.displayName || '?')[0]}</div>
                                            )}
                                            <div className="atc-info">
                                                <div className="atc-name">{t.displayName || 'Không tên'}</div>
                                                <div className="atc-email">{t.email}</div>
                                                {t.schoolName && <div className="atc-school"><i className="bi bi-building"></i> {t.schoolName}</div>}
                                            </div>
                                        </div>
                                        <div className="atc-center">
                                            <span className={`stat-badge ${getStatusClass(t.computedStatus)}`}>{getStatusLabel(t.computedStatus)}</span>
                                            {t.subscriptionEnd && t.computedStatus !== 'pending' && (
                                                <div className="atc-expire">
                                                    <i className="bi bi-calendar3"></i>
                                                    HH: {formatDate(t.subscriptionEnd)}
                                                </div>
                                            )}
                                            {t.teacherSlug && (
                                                <button className="btn-link-small" onClick={() => copyPortalLink(t.teacherSlug)} title={`/t/${t.teacherSlug}`}>
                                                    <i className="bi bi-link-45deg"></i> /t/{t.teacherSlug}
                                                </button>
                                            )}
                                        </div>
                                        <div className="atc-actions">
                                            {t.computedStatus === 'pending' && (
                                                <>
                                                    <button className="btn btn-sm btn-success-soft" onClick={() => handleApprove(t)}>
                                                        <i className="bi bi-check-lg"></i> Duyệt
                                                    </button>
                                                    <button className="btn btn-sm btn-danger-soft" onClick={() => handleReject(t)}>
                                                        <i className="bi bi-x-lg"></i> Từ chối
                                                    </button>
                                                </>
                                            )}
                                            {(t.computedStatus === 'active' || t.computedStatus === 'trial') && (
                                                <>
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleExtend(t)}>
                                                        <i className="bi bi-plus-circle"></i> Gia hạn
                                                    </button>
                                                    <button className="btn btn-sm btn-warning-soft" onClick={() => handleSuspend(t)}>
                                                        <i className="bi bi-pause-circle"></i> Khóa
                                                    </button>
                                                </>
                                            )}
                                            {t.computedStatus === 'expired' && (
                                                <>
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleExtend(t)}>
                                                        <i className="bi bi-arrow-clockwise"></i> Gia hạn
                                                    </button>
                                                    <button className="btn btn-sm btn-danger-soft" onClick={() => handleReject(t)}>
                                                        <i className="bi bi-trash3"></i> Xóa quyền
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </>
            )}

            {tab === 'students' && (
                <div className="card">
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Học sinh</th>
                                    <th>Email</th>
                                    <th>Giáo viên</th>
                                    <th>Bài thi</th>
                                    <th>Ngày tham gia</th>
                                </tr>
                            </thead>
                            <tbody>
                                {students.map((s, idx) => (
                                    <tr key={s.uid}>
                                        <td>{idx + 1}</td>
                                        <td style={{ fontWeight: 600 }}>{s.displayName || '—'}</td>
                                        <td><small>{s.email}</small></td>
                                        <td>{s.teacherName || <span style={{ color: 'var(--text-muted)' }}>Chưa có</span>}</td>
                                        <td>{s.totalQuizzes || 0}</td>
                                        <td><small>{formatDate(s.createdAt)}</small></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
