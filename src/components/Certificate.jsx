import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    buildCertificatePayload,
    buildCertificateVerificationUrl,
    CERTIFICATE_DOCUMENT_TYPES,
    CERTIFICATE_TEMPLATE_OPTIONS,
    getCertificateDefaultTemplateId,
    getCertificateRankMeta,
    getCertificateTemplateById,
    loadRememberedCertificateTemplate,
    saveRememberedCertificateTemplate,
} from '../utils/certificateExport';

const PRINT_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Sora:wght@400;500;600;700&display=swap');

@page { size: landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #f2f6fb;
    font-family: 'Sora', 'Inter', sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}
.cert-export-sheet {
    position: relative;
    width: 280mm;
    min-height: 194mm;
    padding: 16mm 17mm 15mm;
    color: var(--cert-ink);
    background: var(--cert-surface);
    overflow: hidden;
    font-family: 'Sora', 'Inter', sans-serif;
}
.cert-export-sheet::before {
    content: '';
    position: absolute;
    inset: 8mm;
    border-radius: 8mm;
    border: 1.2px solid var(--cert-line);
    pointer-events: none;
}
.cert-export-sheet::after {
    content: '';
    position: absolute;
    inset: 12mm;
    border-radius: 6mm;
    border: 0.8px solid color-mix(in srgb, var(--cert-accent) 18%, transparent);
    pointer-events: none;
}
.cert-export-sheet-top,
.cert-export-footer,
.cert-export-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10mm;
}
.cert-export-brand {
    justify-content: flex-start;
    gap: 4mm;
}
.cert-export-brand-mark {
    width: 12mm;
    height: 12mm;
    border-radius: 3.5mm;
    background: linear-gradient(135deg, var(--cert-secondary), var(--cert-accent));
    box-shadow: inset 0 0 0 0.8mm rgba(255,255,255,0.45);
}
.cert-export-brand-copy,
.cert-export-brand-copy span,
.cert-export-brand-copy strong,
.cert-export-code,
.cert-export-sheet-label,
.cert-export-meta-card span,
.cert-export-signature span,
.cert-export-qr-copy span,
.cert-export-teacher-note span,
.cert-export-badge {
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.cert-export-brand-copy strong,
.cert-export-code {
    display: block;
    font-size: 10pt;
    color: var(--cert-ink);
    font-weight: 700;
}
.cert-export-brand-copy span,
.cert-export-code,
.cert-export-sheet-label,
.cert-export-meta-card span,
.cert-export-signature span,
.cert-export-qr-copy span,
.cert-export-teacher-note span {
    font-size: 7.7pt;
    color: color-mix(in srgb, var(--cert-ink) 72%, white);
}
.cert-export-code {
    padding: 3.2mm 4.6mm;
    border-radius: 999px;
    background: rgba(255,255,255,0.58);
    border: 0.8px solid var(--cert-line);
}
.cert-export-badge {
    display: inline-flex;
    align-items: center;
    gap: 2.2mm;
    margin-top: 7mm;
    padding: 3mm 5.8mm;
    border-radius: 999px;
    color: #fff;
    font-size: 9.2pt;
    font-weight: 700;
    background: var(--cert-badge-gradient);
}
.cert-export-sheet-label {
    margin: 5mm 0 2mm;
    font-size: 8pt;
}
.cert-export-sheet-title {
    margin: 0;
    font-family: 'Cormorant Garamond', serif;
    font-size: 26pt;
    line-height: 0.95;
}
.cert-export-student-name {
    margin: 5mm 0 4mm;
    font-family: 'Cormorant Garamond', serif;
    font-size: 31pt;
    font-weight: 700;
    line-height: 0.92;
}
.cert-export-citation {
    margin: 0 0 5mm;
    max-width: 100%;
    font-size: 10.8pt;
    line-height: 1.7;
    color: color-mix(in srgb, var(--cert-ink) 82%, white);
}
.cert-export-award-row {
    display: flex;
    flex-wrap: wrap;
    gap: 2.4mm;
    margin-bottom: 5mm;
}
.cert-export-award-chip {
    display: inline-flex;
    align-items: center;
    gap: 2mm;
    padding: 2.6mm 4mm;
    border-radius: 999px;
    background: rgba(255,255,255,0.56);
    border: 0.8px solid var(--cert-line);
    color: var(--cert-ink);
    font-size: 8.4pt;
    font-weight: 700;
}
.cert-export-meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3.6mm;
}
.cert-export-meta-card,
.cert-export-teacher-note,
.cert-export-signature {
    padding: 4.4mm 4.8mm;
    border-radius: 4.8mm;
    background: rgba(255,255,255,0.54);
    border: 0.8px solid var(--cert-line);
}
.cert-export-meta-card strong,
.cert-export-signature strong,
.cert-export-teacher-note p,
.cert-export-qr-copy strong {
    display: block;
    margin-top: 1.2mm;
    color: var(--cert-ink);
    font-size: 10.2pt;
    line-height: 1.55;
}
.cert-export-teacher-note {
    margin-top: 4.4mm;
}
.cert-export-teacher-note p { margin: 1.4mm 0 0; }
.cert-export-footer {
    margin-top: 5mm;
    align-items: flex-end;
}
.cert-export-signature strong {
    font-family: 'Cormorant Garamond', serif;
    font-size: 18pt;
}
.cert-export-signature em {
    display: block;
    margin-top: 1.2mm;
    font-size: 8.3pt;
    color: color-mix(in srgb, var(--cert-ink) 70%, white);
    font-style: normal;
}
.cert-export-qr-block {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4mm;
}
.cert-export-qr {
    width: 24mm;
    height: 24mm;
    border-radius: 4.6mm;
    padding: 1.6mm;
    background: rgba(255,255,255,0.72);
    border: 0.8px solid var(--cert-line);
}
.cert-export-qr img {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 3mm;
}
.cert-export-qr-copy {
    max-width: 58mm;
    text-align: right;
}
.cert-export-qr-copy strong {
    font-size: 8.1pt;
    line-height: 1.55;
}
`;

function normalizeTeacherKey(value = '') {
    return String(value || 'default')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') || 'default';
}

export default function Certificate({
    studentName,
    examTitle,
    score,
    total,
    date,
    teacherName,
    schoolName,
    classroomName,
    teacherSlug,
    initialDocumentType,
    onClose,
}) {
    const certRef = useRef(null);
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const teacherKey = useMemo(() => normalizeTeacherKey(teacherSlug || teacherName || schoolName), [schoolName, teacherName, teacherSlug]);
    const preferredDocumentType = initialDocumentType || (percent >= 60 ? CERTIFICATE_DOCUMENT_TYPES.COMMENDATION : CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION);
    const [documentType, setDocumentType] = useState(preferredDocumentType);
    const [templateId, setTemplateId] = useState(() => loadRememberedCertificateTemplate(
        teacherKey,
        getCertificateDefaultTemplateId(preferredDocumentType, percent),
    ));

    useEffect(() => {
        setDocumentType(preferredDocumentType);
    }, [preferredDocumentType]);

    useEffect(() => {
        saveRememberedCertificateTemplate(teacherKey, templateId);
    }, [teacherKey, templateId]);

    const template = useMemo(() => getCertificateTemplateById(templateId), [templateId]);
    const payload = useMemo(() => buildCertificatePayload({
        studentName,
        examTitle,
        score,
        total,
        date,
        teacherName,
        schoolName,
        classroomName,
        teacherSlug,
        documentType,
        templateId,
    }), [classroomName, date, documentType, examTitle, schoolName, score, studentName, teacherName, teacherSlug, templateId, total]);
    const verifyUrl = useMemo(() => buildCertificateVerificationUrl(payload, typeof window !== 'undefined' ? window.location.origin : ''), [payload]);
    const qrUrl = useMemo(() => `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(verifyUrl)}`, [verifyUrl]);
    const rankMeta = useMemo(() => getCertificateRankMeta(score, total, documentType), [documentType, score, total]);

    const sheetVars = useMemo(() => ({
        '--cert-accent': template.accentColor,
        '--cert-secondary': template.secondaryColor,
        '--cert-ink': template.inkColor,
        '--cert-line': template.lineColor,
        '--cert-soft': template.softColor,
        '--cert-surface': template.sheetBackground,
        '--cert-badge-gradient': template.badgeGradient,
    }), [template]);

    const handleOpenVerify = () => {
        window.open(verifyUrl, '_blank', 'noopener,noreferrer');
    };

    const handlePrint = () => {
        const sheetMarkup = certRef.current?.outerHTML;
        if (!sheetMarkup) return;

        const printWindow = window.open('', '_blank', 'noopener,noreferrer');
        if (!printWindow) return;

        printWindow.document.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${payload.documentLabel} - ${payload.studentName}</title><style>${PRINT_STYLES}</style></head><body>${sheetMarkup}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
        window.setTimeout(() => printWindow.print(), 400);
    };

    return (
        <div className="cert-export-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
            <div className="cert-export-modal">
                <div className="cert-export-toolbar">
                    <div>
                        <span className="cert-export-kicker">Honors export</span>
                        <h2>Nâng cấp giấy xuất thành một sản phẩm chỉn chu hơn</h2>
                        <p>Chọn mẫu, nhớ phong cách theo giáo viên và in ra bản giấy khen hoặc giấy xác nhận chuyên nghiệp.</p>
                    </div>
                    <button type="button" className="btn-icon-sm" onClick={onClose} title="Đóng cửa sổ xuất giấy">
                        <i className="bi bi-x-lg"></i>
                    </button>
                </div>

                <div className="cert-export-layout">
                    <section className="cert-export-preview-panel">
                        <div className="cert-export-preview-stage">
                            <article ref={certRef} className={`cert-export-sheet doc-${documentType}`} style={sheetVars}>
                                <div className="cert-export-sheet-top">
                                    <div className="cert-export-brand">
                                        <span className="cert-export-brand-mark" aria-hidden="true"></span>
                                        <div className="cert-export-brand-copy">
                                            <strong>{payload.brandLabel}</strong>
                                            <span>{payload.brandHeadline}</span>
                                        </div>
                                    </div>
                                    <div className="cert-export-code">{payload.certificateCode}</div>
                                </div>

                                <div className="cert-export-badge">
                                    <i className={`bi ${rankMeta.icon}`}></i>
                                    <span>{payload.rankLabel}</span>
                                </div>

                                <p className="cert-export-sheet-label">{payload.documentLabel}</p>
                                <h3 className="cert-export-sheet-title">{payload.title}</h3>
                                <p className="cert-export-student-name">{payload.studentName}</p>
                                <p className="cert-export-citation">{payload.citation}</p>

                                <div className="cert-export-award-row">
                                    {payload.awardBadges.map((award) => (
                                        <span key={`${award.label}-${award.tone}`} className={`cert-export-award-chip tone-${award.tone || 'slate'}`}>
                                            <i className={`bi ${award.icon || 'bi-star-fill'}`}></i>
                                            <strong>{award.label}</strong>
                                        </span>
                                    ))}
                                </div>

                                <div className="cert-export-meta-grid">
                                    <div className="cert-export-meta-card">
                                        <span>Giáo viên phụ trách</span>
                                        <strong>{payload.teacherName}</strong>
                                    </div>
                                    <div className="cert-export-meta-card">
                                        <span>Ngày cấp</span>
                                        <strong>{payload.issuedAtText}</strong>
                                    </div>
                                    <div className="cert-export-meta-card">
                                        <span>Kết quả</span>
                                        <strong>{payload.score}/{payload.total} · {payload.percent}%</strong>
                                    </div>
                                    <div className="cert-export-meta-card">
                                        <span>Bài thi</span>
                                        <strong>{payload.examTitle}</strong>
                                    </div>
                                    {payload.classroomName && (
                                        <div className="cert-export-meta-card">
                                            <span>Lớp học</span>
                                            <strong>{payload.classroomName}</strong>
                                        </div>
                                    )}
                                    {payload.schoolName && (
                                        <div className="cert-export-meta-card">
                                            <span>Đơn vị</span>
                                            <strong>{payload.schoolName}</strong>
                                        </div>
                                    )}
                                </div>

                                <div className="cert-export-teacher-note">
                                    <span>Ghi chú hệ thống</span>
                                    <p>{payload.verificationNote}</p>
                                </div>

                                <div className="cert-export-footer">
                                    <div className="cert-export-signature">
                                        <span>Chữ ký / xác nhận</span>
                                        <strong>{payload.teacherName}</strong>
                                        <em>{payload.documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION ? 'Người xác nhận kết quả' : 'Người hướng dẫn học tập'}</em>
                                    </div>

                                    <div className="cert-export-qr-block">
                                        <div className="cert-export-qr">
                                            <img src={qrUrl} alt="QR xác thực giấy xuất" />
                                        </div>
                                        <div className="cert-export-qr-copy">
                                            <span>Trang xác thực</span>
                                            <strong>{verifyUrl.replace(/^https?:\/\//, '')}</strong>
                                        </div>
                                    </div>
                                </div>
                            </article>
                        </div>
                    </section>

                    <aside className="cert-export-config-panel">
                        <div className="cert-export-doc-toggle">
                            <button
                                type="button"
                                className={`cert-export-doc-btn${documentType === CERTIFICATE_DOCUMENT_TYPES.COMMENDATION ? ' is-active' : ''}`}
                                onClick={() => setDocumentType(CERTIFICATE_DOCUMENT_TYPES.COMMENDATION)}
                            >
                                <i className="bi bi-award-fill"></i> Giấy khen
                            </button>
                            <button
                                type="button"
                                className={`cert-export-doc-btn${documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION ? ' is-active' : ''}`}
                                onClick={() => setDocumentType(CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION)}
                            >
                                <i className="bi bi-patch-check-fill"></i> Giấy xác nhận
                            </button>
                        </div>

                        <div className="cert-export-template-picker">
                            <div className="cert-export-template-head">
                                <div>
                                    <span className="cert-export-template-label">Thumbnail chọn mẫu</span>
                                    <span className="cert-export-template-note">Nhấn trực tiếp để chọn và ghi nhớ theo giáo viên hiện tại.</span>
                                </div>
                                <div className="cert-export-memory-status">
                                    Giáo viên này đang nhớ: <strong>{template.displayName}</strong>
                                </div>
                            </div>

                            <div className="cert-export-template-grid">
                                {CERTIFICATE_TEMPLATE_OPTIONS.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={`cert-export-template-card${templateId === option.id ? ' is-active' : ''}`}
                                        onClick={() => setTemplateId(option.id)}
                                    >
                                        <span className="cert-export-template-preview" style={{ background: option.previewBackground }}>
                                            <span className="cert-export-template-ribbon"></span>
                                            <strong>{option.name}</strong>
                                            <span className="cert-export-template-line short"></span>
                                            <span className="cert-export-template-line"></span>
                                            <span className="cert-export-template-chip"></span>
                                        </span>
                                        <span className="cert-export-template-copy">
                                            <strong>{option.displayName}</strong>
                                            <small>{option.description}</small>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="cert-export-insight-grid">
                            <div className="cert-export-insight-card">
                                <span>Điểm số</span>
                                <strong>{payload.score}/{payload.total}</strong>
                                <small>Kết quả lấy trực tiếp từ bài làm hiện tại.</small>
                            </div>
                            <div className="cert-export-insight-card">
                                <span>Tỷ lệ đúng</span>
                                <strong>{payload.percent}%</strong>
                                <small>Dùng để gợi ý tone vinh danh phù hợp.</small>
                            </div>
                            <div className="cert-export-insight-card">
                                <span>Mẫu đang dùng</span>
                                <strong>{payload.templateLabel}</strong>
                                <small>Phong cách này sẽ được nhớ cho giáo viên hiện tại.</small>
                            </div>
                            <div className="cert-export-insight-card">
                                <span>QR verify</span>
                                <strong>Sẵn sàng</strong>
                                <small>Giấy in có thể mở trang xác thực từ mã QR.</small>
                            </div>
                        </div>

                        <div className="cert-export-print-note">
                            Bản in tối ưu cho landscape PDF/A4. Nếu lưu PDF, hãy chọn <strong>Background graphics</strong> để giữ đầy đủ nền và màu template.
                        </div>

                        <div className="cert-export-actions">
                            <button type="button" className="btn btn-outline" onClick={onClose}>
                                <i className="bi bi-x-circle"></i> Đóng
                            </button>
                            <button type="button" className="btn btn-outline" onClick={handleOpenVerify}>
                                <i className="bi bi-qr-code-scan"></i> Mở trang xác thực
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handlePrint}>
                                <i className="bi bi-printer-fill"></i> In hoặc lưu PDF
                            </button>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}