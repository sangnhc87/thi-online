import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const DEFAULT_ADMIN_PLAYBOOK = {
    collectionMap: [
        'ADMIN / SUPER ADMIN',
        '1. systemConfigs/taxonomy: bộ khung chuẩn khối và môn cho toàn hệ thống.',
        '2. exams/{examId}: đề nguồn chuẩn do admin soạn hoặc biên tập.',
        '3. bankItems (scope=system): ngân hàng câu hỏi gốc sau khi admin publish từ đề nguồn.',
        '4. sharedExams/{sharedExamId}: bộ đề thành phẩm để giáo viên nhập nhanh vào tài khoản riêng.',
        '5. bankSubmissions/{submissionId}: hàng chờ giáo viên gửi duyệt để xuất bản nội dung dùng chung.',
        '6. teacherStats / examStats / auditLogs: lớp theo dõi usage, thống kê, truy vết vận hành.',
        '',
        'TEACHER',
        '1. exams/{examId}: đề riêng của giáo viên.',
        '2. bankItems (scope=private, ownerId=teacherId): kho câu hỏi riêng phát sinh từ đề của giáo viên.',
        '3. bankItems (scope=system): kho câu hỏi hệ thống do admin phát hành.',
        '4. sharedExams: thư viện đề hoàn chỉnh để giáo viên bấm nhập về làm bản nháp riêng.',
        '5. sessions / users / students: dữ liệu học sinh, kết quả và lớp học riêng từng giáo viên.',
        '',
        'QUY TẮC NHỚ NHANH',
        '- bankItems = kho câu hỏi rời.',
        '- sharedExams = kho đề hoàn chỉnh.',
        '- bankSubmissions = nội dung giáo viên gửi admin duyệt.',
        '- system bank chỉ nên chứa câu hỏi chuẩn hóa, không phải mọi bản nháp.',
    ].join('\n'),
    dailyWorkflow: [
        'CHECKLIST HANG NGAY CUA SUPER ADMIN',
        '1. Mo tab Duyet ngan hang: xu ly bankSubmissions moi, duyet hoac tu choi co ghi chu.',
        '2. Mo tab Taxonomy: kiem tra co phat sinh mon / khoi / cach dat ten moi khong.',
        '3. Chon 1 cum uu tien de xay kho: Mon -> Khoi -> Chu de -> Do kho -> Dang cau.',
        '4. Tao de nguon chuan bang tai khoan admin, gan du subject, grade, chapter, difficulty.',
        '5. Kiem tra de nguon xong thi publish sang system bank de giao vien lay cau hoi.',
        '6. Neu muon cap nguyen bo de cho giao vien dung ngay, publish them sang sharedExams.',
        '7. Cuoi ngay xem usage / cost / teacher feedback de biet mon nao duoc dung nhieu, mon nao dang thieu.',
        '8. Cap nhat lai tab playbook nay neu thay doi quy trinh, taxonomy hoac quy tac phan quyen.',
        '',
        'NGUYEN TAC VAN HANH',
        '- Moi chu de nen co it nhat 1 de nguon co ban va 1 de nguon nang cao.',
        '- Uu tien xay kho theo cum nho de de kiem soat chat luong.',
        '- Chi dua vao system bank nhung cau da duoc admin xem lai.',
        '- Dung sharedExams cho bo de thanh pham, khong dung no thay cho system bank.',
    ].join('\n'),
    subjectLockPlan: [
        'DANH SACH THAY DOI CODE TOI THIEU DE KHOA GIAO VIEN THEO MON DANG KY',
        '1. users/{teacherId}: them approvedSubjects[] va approvedGrades[] cho moi giao vien.',
        '2. AdminDashboard: them UI gan mon / khoi duoc cap cho tung giao vien.',
        '3. firestore.rules: bankItems scope=system chi cho teacher read neu subject / grade nam trong quyen duoc cap.',
        '4. firestore.rules: sharedExams cung chi cho teacher read neu mon / khoi nam trong quyen duoc cap.',
        '5. QuestionBankPage va TeacherDashboard: query / filter mac dinh theo approvedSubjects + approvedGrades.',
        '6. UploadExamPage va ExamDetailPage: dropdown mon / khoi cua teacher chi hien lua chon duoc cap.',
        '7. Migration: cap quyen ban dau cho giao vien cu truoc khi bat rule cung, tranh mat quyen dot ngot.',
        '8. Sau khi xong, moi xem tiep den chia theo goi dich vu neu can (vi du goi Toan, goi Anh, goi lien mon).',
        '',
        'KET LUAN NGAN',
        '- Hien tai he thong da co kho system bank va shared library.',
        '- Phan con thieu de dung y van hanh cua super admin la lop phan quyen theo mon / khoi.',
    ].join('\n'),
    privateNotes: '',
};

function normalizeText(value, fallback = '') {
    if (typeof value !== 'string') return fallback;
    return value.trim();
}

export function normalizeAdminPlaybook(data = {}) {
    return {
        collectionMap: normalizeText(data.collectionMap, DEFAULT_ADMIN_PLAYBOOK.collectionMap),
        dailyWorkflow: normalizeText(data.dailyWorkflow, DEFAULT_ADMIN_PLAYBOOK.dailyWorkflow),
        subjectLockPlan: normalizeText(data.subjectLockPlan, DEFAULT_ADMIN_PLAYBOOK.subjectLockPlan),
        privateNotes: typeof data.privateNotes === 'string' ? data.privateNotes : DEFAULT_ADMIN_PLAYBOOK.privateNotes,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null,
        updatedByName: data.updatedByName || null,
    };
}

export async function loadAdminPlaybook(adminId) {
    if (!adminId) return normalizeAdminPlaybook(DEFAULT_ADMIN_PLAYBOOK);
    const snapshot = await getDoc(doc(db, 'adminPlaybooks', adminId));
    if (!snapshot.exists()) return normalizeAdminPlaybook(DEFAULT_ADMIN_PLAYBOOK);
    return normalizeAdminPlaybook(snapshot.data());
}

export async function saveAdminPlaybook({ adminId, user, draft }) {
    if (!adminId) throw new Error('Thiếu adminId để lưu playbook');

    const normalized = normalizeAdminPlaybook(draft);
    const updatedAt = Timestamp.now();
    const payload = {
        ...normalized,
        updatedAt,
        updatedBy: user?.uid || adminId,
        updatedByName: user?.displayName || user?.email || 'Super admin',
    };

    await setDoc(doc(db, 'adminPlaybooks', adminId), payload, { merge: true });
    return payload;
}