export const CERTIFICATE_DOCUMENT_TYPES = {
    COMMENDATION: 'commendation',
    CONFIRMATION: 'confirmation',
};

export const CERTIFICATE_TEMPLATE_OPTIONS = [
    {
        id: 'imperial',
        name: 'Imperial',
        displayName: 'Imperial Academic',
        description: 'Phiên bản trang trọng để in và lưu',
        previewBackground: 'linear-gradient(135deg, #fff6dc, #edd6a6)',
        accentColor: '#9a6b16',
        secondaryColor: '#e7c477',
        inkColor: '#17324f',
        lineColor: 'rgba(154,107,22,0.18)',
        softColor: 'rgba(255,255,255,0.68)',
        sheetBackground: 'radial-gradient(circle at 50% -16%, rgba(226,181,92,0.28), transparent 36%), linear-gradient(180deg, rgba(255,250,240,0.98), rgba(248,236,203,0.96))',
        badgeGradient: 'linear-gradient(135deg, #d8b05a, #9a6b16)',
    },
    {
        id: 'royal',
        name: 'Royal',
        displayName: 'Royal Crimson',
        description: 'Phiên bản lễ trao thưởng sang trọng',
        previewBackground: 'linear-gradient(135deg, #fff2f5, #d86a86)',
        accentColor: '#8f2c4b',
        secondaryColor: '#e08aa3',
        inkColor: '#17324f',
        lineColor: 'rgba(143,44,75,0.16)',
        softColor: 'rgba(255,255,255,0.64)',
        sheetBackground: 'radial-gradient(circle at 100% 0%, rgba(224,138,163,0.22), transparent 34%), linear-gradient(180deg, rgba(255,247,250,0.98), rgba(252,231,240,0.96))',
        badgeGradient: 'linear-gradient(135deg, #e08aa3, #8f2c4b)',
    },
    {
        id: 'scholar',
        name: 'Scholar',
        displayName: 'Scholar Minimal',
        description: 'Phiên bản tối giản, sạch và hiện đại',
        previewBackground: 'linear-gradient(135deg, #ffffff, #dce7ef)',
        accentColor: '#1f537a',
        secondaryColor: '#9bb7ca',
        inkColor: '#18354d',
        lineColor: 'rgba(31,83,122,0.14)',
        softColor: 'rgba(255,255,255,0.74)',
        sheetBackground: 'linear-gradient(180deg, rgba(255,255,255,0.99), rgba(240,246,250,0.97))',
        badgeGradient: 'linear-gradient(135deg, #9bb7ca, #1f537a)',
    },
    {
        id: 'modern',
        name: 'Modern',
        displayName: 'Modern Momentum',
        description: 'Phiên bản chia sẻ giàu năng lượng',
        previewBackground: 'linear-gradient(135deg, #eef8ff, #90c6f2)',
        accentColor: '#1c6bb0',
        secondaryColor: '#78b7ea',
        inkColor: '#15344f',
        lineColor: 'rgba(28,107,176,0.16)',
        softColor: 'rgba(255,255,255,0.66)',
        sheetBackground: 'radial-gradient(circle at 100% 0%, rgba(120,183,234,0.22), transparent 34%), linear-gradient(180deg, rgba(247,251,255,0.98), rgba(231,243,255,0.96))',
        badgeGradient: 'linear-gradient(135deg, #78b7ea, #1c6bb0)',
    },
    {
        id: 'aurora',
        name: 'Aurora',
        displayName: 'Aurora Celebration',
        description: 'Phiên bản mềm mại, tươi sáng và truyền cảm hứng',
        previewBackground: 'linear-gradient(135deg, #effffb, #8fe1d6)',
        accentColor: '#14776d',
        secondaryColor: '#7fd9cc',
        inkColor: '#18394c',
        lineColor: 'rgba(20,119,109,0.14)',
        softColor: 'rgba(255,255,255,0.68)',
        sheetBackground: 'radial-gradient(circle at 0% 100%, rgba(127,217,204,0.20), transparent 34%), linear-gradient(180deg, rgba(247,255,252,0.98), rgba(228,250,246,0.96))',
        badgeGradient: 'linear-gradient(135deg, #7fd9cc, #14776d)',
    },
    {
        id: 'signature',
        name: 'Signature',
        displayName: 'Signature Class Edition',
        description: 'Phiên bản riêng cho lớp và giáo viên',
        previewBackground: 'linear-gradient(135deg, #fff3ea, #efc07e)',
        accentColor: '#a05a11',
        secondaryColor: '#f0bd73',
        inkColor: '#16344d',
        lineColor: 'rgba(160,90,17,0.15)',
        softColor: 'rgba(255,255,255,0.68)',
        sheetBackground: 'radial-gradient(circle at 12% 100%, rgba(240,189,115,0.24), transparent 36%), linear-gradient(180deg, rgba(255,250,246,0.98), rgba(249,239,228,0.96))',
        badgeGradient: 'linear-gradient(135deg, #f0bd73, #a05a11)',
    },
];

const TEMPLATE_BY_ID = Object.fromEntries(CERTIFICATE_TEMPLATE_OPTIONS.map((template) => [template.id, template]));

function normalizeText(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeDate(value) {
    if (!value) return new Date().toLocaleDateString('vi-VN');
    if (typeof value === 'string') return value;
    if (typeof value?.toDate === 'function') return value.toDate().toLocaleDateString('vi-VN');
    const nextDate = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(nextDate.getTime())) return new Date().toLocaleDateString('vi-VN');
    return nextDate.toLocaleDateString('vi-VN');
}

function hashString(value = '') {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
}

function utf8ToBase64Url(value = '') {
    const text = String(value || '');
    const binary = Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join('');
    const encoded = globalThis.btoa(binary);
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUtf8(value = '') {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function getCertificateTemplateById(templateId) {
    return TEMPLATE_BY_ID[templateId] || CERTIFICATE_TEMPLATE_OPTIONS[0];
}

export function getCertificateDefaultTemplateId(documentType, percent = 0) {
    if (documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION) return 'scholar';
    if (percent >= 95) return 'imperial';
    if (percent >= 80) return 'royal';
    if (percent >= 60) return 'aurora';
    return 'modern';
}

export function getCertificateRankMeta(score = 0, total = 0, documentType = CERTIFICATE_DOCUMENT_TYPES.COMMENDATION) {
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;

    if (documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION) {
        return {
            label: 'HOÀN THÀNH',
            title: 'Xác Nhận Hoàn Thành',
            icon: 'bi-patch-check-fill',
            tone: 'slate',
        };
    }

    if (percent >= 95) {
        return { label: 'XUẤT SẮC', title: 'Vinh Danh Thành Tích', icon: 'bi-trophy-fill', tone: 'gold' };
    }
    if (percent >= 80) {
        return { label: 'NỔI BẬT', title: 'Ghi Nhận Nỗ Lực Vượt Trội', icon: 'bi-stars', tone: 'violet' };
    }
    if (percent >= 60) {
        return { label: 'HOÀN THÀNH TỐT', title: 'Ghi Nhận Kết Quả Tích Cực', icon: 'bi-award-fill', tone: 'teal' };
    }

    return { label: 'GHI NHẬN', title: 'Xác Nhận Hoàn Thành', icon: 'bi-patch-check-fill', tone: 'blue' };
}

export function buildCertificateCode({ studentName = '', examTitle = '', teacherName = '', documentType = CERTIFICATE_DOCUMENT_TYPES.COMMENDATION, issuedAtText = '' } = {}) {
    const prefix = documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION ? 'CFM' : 'AWD';
    const hash = hashString(`${studentName}|${examTitle}|${teacherName}|${issuedAtText}|${documentType}`)
        .toString(36)
        .toUpperCase()
        .slice(0, 6)
        .padStart(6, '0');
    const year = new Date().getFullYear();
    return `TO-${prefix}-${year}-${hash}`;
}

export function getCertificateTemplateStorageKey(teacherKey = 'default') {
    return `thi-online:certificate-template:${teacherKey}`;
}

export function loadRememberedCertificateTemplate(teacherKey = 'default', fallbackId = 'aurora') {
    if (typeof window === 'undefined' || !window.localStorage) return fallbackId;
    try {
        const saved = window.localStorage.getItem(getCertificateTemplateStorageKey(teacherKey));
        return TEMPLATE_BY_ID[saved] ? saved : fallbackId;
    } catch {
        return fallbackId;
    }
}

export function saveRememberedCertificateTemplate(teacherKey = 'default', templateId = 'aurora') {
    if (typeof window === 'undefined' || !window.localStorage || !TEMPLATE_BY_ID[templateId]) return;
    try {
        window.localStorage.setItem(getCertificateTemplateStorageKey(teacherKey), templateId);
    } catch {
        // Ignore local storage failures on locked-down browsers.
    }
}

export function encodeCertificatePayload(payload = {}) {
    return utf8ToBase64Url(JSON.stringify(payload));
}

export function decodeCertificatePayload(value = '') {
    const parsed = JSON.parse(base64UrlToUtf8(value));
    if (!parsed?.certificateCode || !parsed?.studentName || !parsed?.examTitle) {
        throw new Error('Thiếu dữ liệu xác thực trong mã QR.');
    }
    return parsed;
}

export function buildCertificatePayload({
    studentName,
    examTitle,
    score,
    total,
    date,
    teacherName,
    schoolName,
    classroomName,
    teacherSlug,
    documentType = CERTIFICATE_DOCUMENT_TYPES.COMMENDATION,
    templateId = 'aurora',
    platformName = 'Thi Online',
}) {
    const safeStudentName = normalizeText(studentName, 'Học sinh');
    const safeExamTitle = normalizeText(examTitle, 'Bài thi');
    const safeTeacherName = normalizeText(teacherName, 'Giáo viên phụ trách');
    const safeSchoolName = normalizeText(schoolName);
    const safeClassroomName = normalizeText(classroomName);
    const issuedAtText = normalizeDate(date);
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const rankMeta = getCertificateRankMeta(score, total, documentType);
    const template = getCertificateTemplateById(templateId);
    const certificateCode = buildCertificateCode({
        studentName: safeStudentName,
        examTitle: safeExamTitle,
        teacherName: safeTeacherName,
        documentType,
        issuedAtText,
    });

    const citation = documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION
        ? `${safeStudentName} đã hoàn thành bài ${safeExamTitle} trên ${platformName}. Bản giấy này dùng để xác nhận quá trình làm bài và kết quả đã ghi nhận trong hệ thống.`
        : `${safeStudentName} được vinh danh vì hoàn thành nổi bật bài ${safeExamTitle}, thể hiện sự tập trung, bền bỉ và chất lượng làm bài tích cực trong quá trình học tập.`;

    const awardBadges = documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION
        ? [
            { icon: 'bi-patch-check-fill', label: 'Đã hoàn thành bài làm', tone: 'slate' },
            { icon: 'bi-clipboard-data-fill', label: `Kết quả ${score}/${total}`, tone: 'blue' },
            { icon: 'bi-calendar-check-fill', label: `Ngày cấp ${issuedAtText}`, tone: 'mint' },
        ]
        : [
            { icon: rankMeta.icon, label: rankMeta.label, tone: rankMeta.tone },
            { icon: 'bi-graph-up-arrow', label: `${percent}% hoàn thành`, tone: 'violet' },
            { icon: 'bi-journal-check', label: `Điểm ${score}/${total}`, tone: 'gold' },
        ];

    return {
        certificateCode,
        studentName: safeStudentName,
        examTitle: safeExamTitle,
        score,
        total,
        percent,
        teacherName: safeTeacherName,
        teacherSlug: normalizeText(teacherSlug),
        schoolName: safeSchoolName,
        classroomName: safeClassroomName,
        issuedAtText,
        documentType,
        documentLabel: documentType === CERTIFICATE_DOCUMENT_TYPES.CONFIRMATION ? 'Giấy xác nhận' : 'Giấy khen',
        title: rankMeta.title,
        rankLabel: rankMeta.label,
        citation,
        awardBadges,
        brandLabel: `${platformName} Honors`,
        brandHeadline: safeSchoolName || `${platformName} · Thành tích học tập`,
        verificationNote: 'Bản xác nhận này được mở từ dữ liệu đóng gói trong mã QR khi giấy được xuất ra từ Thi Online.',
        platformName,
        templateId: template.id,
        templateLabel: template.displayName,
        accentColor: template.accentColor,
        secondaryColor: template.secondaryColor,
        inkColor: template.inkColor,
    };
}

export function buildCertificateVerificationUrl(payload = {}, origin = '') {
    const baseOrigin = normalizeText(origin, typeof window !== 'undefined' ? window.location.origin : '');
    const encoded = encodeCertificatePayload(payload);
    return `${baseOrigin}/certificate/verify?data=${encoded}`;
}