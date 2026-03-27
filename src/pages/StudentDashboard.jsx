import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

export default function StudentDashboard() {
    const { user } = useAuth();
    const [exams, setExams] = useState([]);
    const [myResults, setMyResults] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [user]);

    const loadData = async () => {
        if (!user) return;

        // Load all active exams
        const examQ = query(
            collection(db, 'exams'),
            where('status', '==', 'active'),
            orderBy('createdAt', 'desc')
        );
        const examSnap = await getDocs(examQ);
        const examList = examSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setExams(examList);

        // Load my completed sessions
        const sessionQ = query(
            collection(db, 'sessions'),
            where('studentId', '==', user.uid)
        );
        const sessionSnap = await getDocs(sessionQ);
        const results = {};
        sessionSnap.docs.forEach(d => {
            const data = d.data();
            results[data.examId] = { sessionId: d.id, score: data.score, total: data.total, completedAt: data.completedAt };
        });
        setMyResults(results);
        setLoading(false);
    };

    if (loading) {
        return <div className="loading-screen"><div className="spinner"></div><p>Đang tải...</p></div>;
    }

    return (
        <div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>Đề Thi Có Sẵn</h1>

            {exams.length === 0 ? (
                <div className="empty-state">
                    <i className="bi bi-journal-x"></i>
                    <p>Chưa có đề thi nào được mở. Vui lòng quay lại sau.</p>
                </div>
            ) : (
                <div className="dashboard-grid">
                    {exams.map(exam => {
                        const result = myResults[exam.id];
                        return (
                            <div key={exam.id} className="exam-card">
                                <div className="exam-title">{exam.title}</div>
                                <div className="exam-meta">
                                    <span><i className="bi bi-question-circle me-1"></i>{exam.questionCount} câu</span>
                                    <span><i className="bi bi-clock me-1"></i>{exam.duration} phút</span>
                                    <span style={{ color: 'var(--text-muted)' }}>
                                        <i className="bi bi-person me-1"></i>{exam.teacherName}
                                    </span>
                                </div>
                                <div className="exam-actions">
                                    {result ? (
                                        <>
                                            <span className="stat-badge success">
                                                <i className="bi bi-check-circle"></i> {result.score}/{result.total}
                                            </span>
                                            <Link to={`/student/result/${result.sessionId}`} className="btn btn-sm btn-outline">
                                                <i className="bi bi-eye"></i> Xem lại
                                            </Link>
                                        </>
                                    ) : (
                                        <Link to={`/student/quiz/${exam.id}`} className="btn btn-sm btn-success">
                                            <i className="bi bi-play-fill"></i> Bắt đầu làm bài
                                        </Link>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
