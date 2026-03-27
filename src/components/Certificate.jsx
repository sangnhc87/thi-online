import React, { useRef } from 'react';

const RANK_CONFIG = {
    perfect: { color: '#f59e0b', gradient: 'linear-gradient(135deg, #fbbf24, #f59e0b, #d97706)', label: 'XUẤT SẮC', border: '#d97706', emoji: '🏆' },
    high: { color: '#6366f1', gradient: 'linear-gradient(135deg, #818cf8, #6366f1, #4f46e5)', label: 'GIỎI', border: '#4f46e5', emoji: '🌟' },
    good: { color: '#10b981', gradient: 'linear-gradient(135deg, #34d399, #10b981, #059669)', label: 'KHÁ', border: '#059669', emoji: '👍' },
    pass: { color: '#3b82f6', gradient: 'linear-gradient(135deg, #60a5fa, #3b82f6, #2563eb)', label: 'ĐẠT', border: '#2563eb', emoji: '✅' },
};

function getRank(score, total) {
    const pct = total > 0 ? (score / total) * 100 : 0;
    if (pct >= 95) return 'perfect';
    if (pct >= 80) return 'high';
    if (pct >= 60) return 'good';
    return 'pass';
}

export default function Certificate({ studentName, examTitle, score, total, date, teacherName, onClose }) {
    const certRef = useRef(null);
    const rank = getRank(score, total);
    const config = RANK_CONFIG[rank];
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Giấy khen</title>
<style>
@page { size: landscape; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 297mm; height: 210mm; display: flex; align-items: center; justify-content: center; font-family: 'Georgia', 'Times New Roman', serif; }
.cert { width: 280mm; height: 195mm; position: relative; padding: 24mm 32mm; text-align: center; background: white; }
.cert-border { position: absolute; inset: 8mm; border: 3px solid ${config.border}; border-radius: 8px; }
.cert-border-inner { position: absolute; inset: 11mm; border: 1px solid ${config.border}80; border-radius: 6px; }
.cert-corner { position: absolute; width: 30mm; height: 30mm; }
.cert-corner.tl { top: 5mm; left: 5mm; border-top: 5px solid ${config.border}; border-left: 5px solid ${config.border}; border-radius: 8px 0 0 0; }
.cert-corner.tr { top: 5mm; right: 5mm; border-top: 5px solid ${config.border}; border-right: 5px solid ${config.border}; border-radius: 0 8px 0 0; }
.cert-corner.bl { bottom: 5mm; left: 5mm; border-bottom: 5px solid ${config.border}; border-left: 5px solid ${config.border}; border-radius: 0 0 0 8px; }
.cert-corner.br { bottom: 5mm; right: 5mm; border-bottom: 5px solid ${config.border}; border-right: 5px solid ${config.border}; border-radius: 0 0 8px 0; }
.cert-header { font-size: 12pt; color: #64748b; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 4mm; }
.cert-title { font-size: 32pt; font-weight: bold; background: ${config.gradient}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 2mm; }
.cert-rank { display: inline-block; padding: 2mm 8mm; background: ${config.gradient}; color: white; border-radius: 20px; font-size: 14pt; font-weight: bold; letter-spacing: 2px; margin-bottom: 6mm; }
.cert-for { font-size: 11pt; color: #64748b; margin-bottom: 2mm; }
.cert-name { font-size: 24pt; font-weight: bold; color: #1e293b; border-bottom: 2px solid ${config.border}; display: inline-block; padding: 0 16mm 2mm; margin-bottom: 4mm; }
.cert-exam { font-size: 12pt; color: #475569; margin-bottom: 2mm; }
.cert-score { font-size: 16pt; font-weight: bold; color: ${config.color}; margin-bottom: 6mm; }
.cert-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; padding-top: 8mm; }
.cert-date { font-size: 10pt; color: #94a3b8; }
.cert-sign { text-align: center; }
.cert-sign-line { width: 40mm; border-top: 1px solid #cbd5e1; margin: 0 auto 1mm; }
.cert-sign-label { font-size: 9pt; color: #94a3b8; }
.cert-emoji { font-size: 40pt; margin-bottom: 2mm; }
@media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="cert">
<div class="cert-border"></div><div class="cert-border-inner"></div>
<div class="cert-corner tl"></div><div class="cert-corner tr"></div><div class="cert-corner bl"></div><div class="cert-corner br"></div>
<div class="cert-emoji">${config.emoji}</div>
<div class="cert-header">Hệ thống thi trực tuyến</div>
<div class="cert-title">GIẤY KHEN</div>
<div class="cert-rank">${config.label}</div>
<div class="cert-for">Chứng nhận</div>
<div class="cert-name">${studentName || 'Học sinh'}</div>
<div class="cert-exam">Đã hoàn thành xuất sắc bài thi</div>
<div class="cert-exam" style="font-weight:bold;font-size:14pt;color:#1e293b">"${examTitle || 'Bài thi'}"</div>
<div class="cert-score">Kết quả: ${score}/${total} (${pct}%)</div>
<div class="cert-footer">
<div class="cert-date">${date || new Date().toLocaleDateString('vi-VN')}</div>
<div class="cert-sign"><div class="cert-sign-line"></div><div class="cert-sign-label">${teacherName || 'Giáo viên'}</div></div>
</div>
</div></body></html>`);
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 500);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 500, width: '100%', textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>{config.emoji}</div>
                <h2 style={{ fontSize: '1.5rem', background: config.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>GIẤY KHEN</h2>
                <div style={{ display: 'inline-block', padding: '4px 16px', background: config.gradient, color: '#fff', borderRadius: 20, fontWeight: 700, fontSize: '0.85rem', marginBottom: 16 }}>{config.label}</div>
                <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: 4 }}>Chứng nhận</p>
                <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1e293b', borderBottom: `2px solid ${config.border}`, display: 'inline-block', padding: '0 24px 4px', marginBottom: 12 }}>{studentName || 'Học sinh'}</p>
                <p style={{ color: '#475569', fontSize: '0.9rem', marginBottom: 4 }}>Đã hoàn thành bài thi</p>
                <p style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem', marginBottom: 8 }}>"{examTitle}"</p>
                <p style={{ color: config.color, fontWeight: 700, fontSize: '1.2rem', marginBottom: 20 }}>Kết quả: {score}/{total} ({pct}%)</p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button onClick={onClose} style={{ padding: '8px 24px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}>Đóng</button>
                    <button onClick={handlePrint} style={{ padding: '8px 24px', border: 'none', borderRadius: 8, background: config.gradient, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                        <i className="bi bi-printer"></i> In giấy khen
                    </button>
                </div>
            </div>
        </div>
    );
}
