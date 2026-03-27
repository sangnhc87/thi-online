import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getStreakLevel } from '../utils/scoring';

export default function StreakBadge({ streak = 0, size = 'md' }) {
    const { level, label, color, glow } = getStreakLevel(streak);

    if (streak === 0) return null;

    const sizes = {
        sm: { badge: 'streak-badge-sm', fontSize: '0.75rem', iconSize: '1rem' },
        md: { badge: 'streak-badge-md', fontSize: '0.9rem', iconSize: '1.3rem' },
        lg: { badge: 'streak-badge-lg', fontSize: '1.2rem', iconSize: '1.8rem' },
    };
    const s = sizes[size] || sizes.md;

    return (
        <AnimatePresence>
            <motion.div
                className={`streak-badge ${s.badge} ${glow ? 'streak-glow' : ''}`}
                style={{ '--streak-color': color }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
                <motion.span
                    className="streak-fire"
                    style={{ fontSize: s.iconSize }}
                    animate={glow ? { scale: [1, 1.2, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                >
                    🔥
                </motion.span>
                <span className="streak-count" style={{ fontSize: s.fontSize }}>{streak}</span>
                {size !== 'sm' && <span className="streak-label" style={{ fontSize: '0.7rem' }}>{label}</span>}
            </motion.div>
        </AnimatePresence>
    );
}
