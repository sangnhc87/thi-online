import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { decodeCertificatePayload, getCertificateTemplateById } from '../utils/certificateExport';

export default function CertificateVerifyPage() {
    const location = useLocation();

    const { payload, error } = useMemo(() => {
        try {
            const params = new URLSearchParams(location.search);
            const rawData = params.get('data');
            if (!rawData) throw new Error('Thiếu mã xác thực trong liên kết này.');
            return { payload: decodeCertificatePayload(rawData), error: null };
        } catch (nextError) {
            return { payload: null, error: nextError.message || 'Không thể xác thực giấy này.' };
        }
    }, [location.search]);

    const template = getCertificateTemplateById(payload?.templateId);
    const verifyVars = payload ? {
        '--cert-verify-accent': payload.accentColor || template.accentColor,
        '--cert-verify-secondary': payload.secondaryColor || template.secondaryColor,
        '--cert-verify-ink': payload.inkColor || template.inkColor,
    } : undefined;

    return (
        <div className="cert-verify-page" style={verifyVars}>
            <div className={`cert-verify-card${error ? ' is-error' : ''}`}>
                <div className="cert-verify-topline">
                    <div>
                        <span className="cert-verify-kicker">Xác thực giấy xuất</span>
                        <h1>{error ? 'Không thể xác thực liên kết này' : 'Bản xác thực giấy khen / giấy xác nhận'}</h1>
                        <p>{error || `Liên kết này được mở từ mã QR đính kèm trên ${payload?.documentLabel?.toLowerCase()} của ${payload?.studentName}.`}</p>
                    </div>
                    <Link to="/login" className="cert-verify-home-link">
                        <i className="bi bi-box-arrow-up-right"></i> Về Thi Online
                    </Link>
                </div>

                {!error && payload && (
                    <>
                        <div className="cert-verify-status">
                            <i className="bi bi-patch-check-fill"></i>
                            <span>Bản ghi hợp lệ với dữ liệu đã đóng gói cùng mã QR của Thi Online</span>
                        </div>

                        <div className="cert-verify-grid">
                            <section className="cert-verify-panel">
                                <div className="cert-verify-section-head">
                                    <strong>Thông tin chính</strong>
                                    <span>{payload.documentLabel}</span>
                                </div>
                                <dl className="cert-verify-details">
                                    <div>
                                        <dt>Học sinh</dt>
                                        <dd>{payload.studentName}</dd>
                                    </div>
                                    <div>
                                        <dt>Bài thi</dt>
                                        <dd>{payload.examTitle}</dd>
                                    </div>
                                    <div>
                                        <dt>Giáo viên</dt>
                                        <dd>{payload.teacherName}</dd>
                                    </div>
                                    <div>
                                        <dt>Mã giấy</dt>
                                        <dd>{payload.certificateCode}</dd>
                                    </div>
                                    <div>
                                        <dt>Kết quả</dt>
                                        <dd>{payload.score}/{payload.total} · {payload.percent}%</dd>
                                    </div>
                                    <div>
                                        <dt>Ngày cấp</dt>
                                        <dd>{payload.issuedAtText}</dd>
                                    </div>
                                    {payload.classroomName && (
                                        <div>
                                            <dt>Lớp học</dt>
                                            <dd>{payload.classroomName}</dd>
                                        </div>
                                    )}
                                    {payload.schoolName && (
                                        <div>
                                            <dt>Đơn vị</dt>
                                            <dd>{payload.schoolName}</dd>
                                        </div>
                                    )}
                                </dl>
                            </section>

                            <aside className="cert-verify-sidebar">
                                <div>
                                    <div className="cert-verify-section-head">
                                        <strong>{payload.brandLabel}</strong>
                                        <span>{payload.templateLabel}</span>
                                    </div>
                                    <p>{payload.brandHeadline}</p>
                                </div>

                                <div>
                                    <div className="cert-verify-section-head">
                                        <strong>Dấu ấn thành tích</strong>
                                        <span>{payload.rankLabel}</span>
                                    </div>
                                    <div className="cert-verify-awards">
                                        {payload.awardBadges?.map((award) => (
                                            <span key={`${award.label}-${award.tone}`} className={`cert-verify-award-chip tone-${award.tone || 'slate'}`}>
                                                <i className={`bi ${award.icon || 'bi-star-fill'}`}></i>
                                                {award.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <div className="cert-verify-section-head">
                                        <strong>Ghi chú</strong>
                                    </div>
                                    <p>{payload.verificationNote}</p>
                                </div>
                            </aside>
                        </div>

                        <div className="cert-verify-footer">
                            <span>{payload.platformName} · QR verify record</span>
                            <strong>{payload.certificateCode}</strong>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}