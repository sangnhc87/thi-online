import React from 'react';
import { motion } from 'framer-motion';

export default function StatsCard({ icon, label, value, sub, color = 'primary', delay = 0 }) {
    const gradients = {
        primary: 'linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)',
        success: 'linear-gradient(135deg, #059669 0%, #22c55e 100%)',
        warm: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
        cool: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
        gold: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    };

    return (
        <motion.div
            className={`stats-card stats-card-${color}`}
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
