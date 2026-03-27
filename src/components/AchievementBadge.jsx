import React from 'react';
import { motion } from 'framer-motion';
import { getAchievement } from '../utils/achievements';

export function AchievementBadge({ achievementId, size = 'md', showLabel = true }) {
    const achievement = getAchievement(achievementId);
    if (!achievement) return null;

    const sizes = {
        sm: { icon: '1.2rem', padding: '6px 10px' },
        md: { icon: '1.6rem', padding: '8px 14px' },
        lg: { icon: '2.2rem', padding: '12px 18px' },
    };
    const s = sizes[size] || sizes.md;

    return (
        <div className="achievement-badge" title={achievement.description} style={{ padding: s.padding }}>
            <span style={{ fontSize: s.icon }}>{achievement.icon}</span>
            {showLabel && <span className="achievement-name">{achievement.name}</span>}
        </div>
    );
}

export function AchievementPopup({ achievement, onClose }) {
    if (!achievement) return null;

    return (
        <motion.div
            className="achievement-popup-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <motion.div
                className="achievement-popup"
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
                <div className="achievement-popup-icon">
                    <motion.span
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ repeat: 3, duration: 0.6 }}
                        style={{ fontSize: '3rem' }}
                    >
                        {achievement.icon}
                    </motion.span>
                </div>
                <h3 className="achievement-popup-title">Thành tích mới!</h3>
                <div className="achievement-popup-name">{achievement.name}</div>
                <p className="achievement-popup-desc">{achievement.description}</p>
                <button className="btn btn-primary" onClick={onClose}>Tuyệt vời!</button>
            </motion.div>
        </motion.div>
    );
}

export function AchievementGrid({ achievements = [] }) {
    return (
        <div className="achievement-grid">
            {achievements.map((id, idx) => (
                <motion.div
                    key={id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                >
                    <AchievementBadge achievementId={id} size="md" />
                </motion.div>
            ))}
            {achievements.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', gridColumn: '1 / -1' }}>
                    Chưa có thành tích nào. Hãy bắt đầu làm bài!
                </p>
            )}
        </div>
    );
}
