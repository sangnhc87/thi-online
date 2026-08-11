function toDateValue(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateVi(value) {
    return value ? value.toLocaleDateString('vi-VN') : null;
}

export function getStudentAccessState(profile) {
    const expiryDate = toDateValue(profile?.teacherExpiry);
    const blocked = profile?.blocked === true;
    const expired = Boolean(expiryDate && expiryDate.getTime() < Date.now());

    if (blocked) {
        return {
            code: 'blocked',
            locked: true,
            expiryDate,
            title: 'Tài khoản đang bị khóa',
            shortLabel: 'Đang bị khóa',
            description: 'Giáo viên đã khóa tài khoản này nên bạn chưa thể vào thi hoặc tham gia live quiz. Hãy liên hệ giáo viên để mở khóa.',
            cardNote: 'Tài khoản đang bị khóa nên các nút vào thi tạm thời không khả dụng.',
        };
    }

    if (expired) {
        const formattedDate = formatDateVi(expiryDate);
        return {
            code: 'expired',
            locked: true,
            expiryDate,
            title: 'Hết hạn tham gia lớp',
            shortLabel: formattedDate ? `Hết hạn ${formattedDate}` : 'Đã hết hạn',
            description: formattedDate
                ? `Quyền truy cập lớp của bạn đã hết hạn từ ngày ${formattedDate}. Hãy nhờ giáo viên gia hạn để tiếp tục vào thi.`
                : 'Quyền truy cập lớp của bạn đã hết hạn. Hãy nhờ giáo viên gia hạn để tiếp tục vào thi.',
            cardNote: formattedDate
                ? `Lớp học của bạn đã hết hạn từ ${formattedDate}, nên hiện chỉ xem được danh sách đề chứ chưa thể bắt đầu thi.`
                : 'Lớp học của bạn đã hết hạn, nên hiện chỉ xem được danh sách đề chứ chưa thể bắt đầu thi.',
        };
    }

    if (expiryDate) {
        const formattedDate = formatDateVi(expiryDate);
        return {
            code: 'active',
            locked: false,
            expiryDate,
            title: 'Tài khoản đang hoạt động',
            shortLabel: formattedDate ? `Hạn lớp đến ${formattedDate}` : 'Đang hoạt động',
            description: formattedDate
                ? `Bạn vẫn có thể vào thi bình thường. Quyền truy cập lớp hiện kéo dài đến ${formattedDate}.`
                : 'Bạn vẫn có thể vào thi bình thường.',
            cardNote: null,
        };
    }

    return {
        code: 'active',
        locked: false,
        expiryDate: null,
        title: 'Tài khoản đang hoạt động',
        shortLabel: 'Không giới hạn',
        description: 'Bạn vẫn có thể vào thi bình thường.',
        cardNote: null,
    };
}
