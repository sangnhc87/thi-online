import React from 'react';
import { motion } from 'framer-motion';
import { formatPercent, getScoreColor } from '../utils/formatters';

export default function Leaderboard({ entries = [], currentUserId, title = 'Bảng Xếp Hạng' }) {
    if (!entries.length) {
        return (
            <div className="card">
                <div className="card-body" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    <i className="bi bi-trophy" style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }}></i>
                    Chưa có dữ liệu xếp hạng
                </div>
            </div>
        );
    }

    const getRankIcon = (rank) => {
        if (rank === 1) return <span className="rank-icon gold">🥇</span>;
        if (rank === 2) return <span className="rank-icon silver">🥈</span>;
        if (rank === 3) return <span className="rank-icon bronze">🥉</span>;
        return <span className="rank-number">{rank}</span>;
    };

    return (
        <div className="leaderboard">
            <div className="leaderboard-header">
                <i className="bi bi-trophy-fill"></i> {title}
            </div>
            <div className="leaderboard-body">
                {entries.map((entry, idx) => {
                    const rank = idx + 1;
                    const isMe = entry.uid === currentUserId;
                    const scoreColor = getScoreColor(entry.totalScore, entry.totalQuestions);

                    return (
                        <motion.div
                            key={entry.uid}
                            className={`leaderboard-row ${isMe ? 'leaderboard-row-me' : ''} ${rank <= 3 ? 'leaderboard-row-top' : ''}`}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.04 }}
                        >
                            <div className="leaderboard-rank">{getRankIcon(rank)}</div>
                            <div className="leaderboard-user">
                                {entry.photoURL ? (
                                    <img src={entry.photoURL} alt="" className="leaderboard-avatar" referrerPolicy="no-referrer" />
                                ) : (
                                    <div className="leaderboard-avatar-placeholder">
                                        {(entry.displayName || '?')[0]}
                                    </div>
                                )}
                                <div>
                                    <div className="leaderboard-name">
                                        {entry.displayName || 'Ẩn danh'}
                                        {isMe && <span className="leaderboard-me-tag">Bạn</span>}
                                    </div>
                                    <div className="leaderboard-sub">
                                        {entry.totalQuizzes} bài · streak {entry.streak || 0}🔥
                                    </div>
                                </div>
                            </div>
                            <div className="leaderboard-stats">
                                <div className={`leaderboard-score stat-badge ${scoreColor}`}>
                                    {entry.totalScore}/{entry.totalQuestions}
                                </div>
                                <div className="leaderboard-pct">
                                    {formatPercent(entry.totalScore, entry.totalQuestions)}
                                </div>
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}
