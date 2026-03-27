import React from 'react';
import { motion } from 'framer-motion';

export default function StatsCard({ icon, label, value, sub, color = 'primary', delay = 0 }) {
    const gradients = {
        primary: 'var(--gradient-main)',
        success: 'var(--gradient-success)',
        warm: 'var(--gradient-warm)',
        cool: 'var(--gradient-cool)',
        gold: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    };

    return (
        <motion.div
            className="stats-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay * 0.1, duration: 0.4 }}
        >
            <div className="stats-icon" style={{ background: gradients[color] || gradients.primary }}>
                <i className={`bi bi-${icon}`}></i>
            </div>
            <div className="stats-info">
                <div className="stats-value">{value}</div>
                <div className="stats-label">{label}</div>
                {sub && <div className="stats-sub">{sub}</div>}
            </div>
        </motion.div>
    );
}
