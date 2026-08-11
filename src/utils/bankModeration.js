import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../firebase';
import { logAuditEvent } from './audit';
import { buildQuestionFromBankItem, commitWriteOperations, getQuestionChapter } from './bank';
import { buildExamSearchFields } from './search';

export const BANK_SUBMISSION_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
};

function cloneChoices(choices = []) {
    return (choices || []).map((choice) => ({
        letter: choice.letter,
        text: choice.text || '',
        html: choice.html || '',
    }));
}

function sanitizeQuestionForSubmission(item = {}, index = 0, submitterTeacherId = null) {
    return {
        submitterTeacherId,
        order: index + 1,
        number: index + 1,
        type: item.type || 'mcq',
        subject: item.subject || null,
        grade: item.grade || null,
        chapter: getQuestionChapter(item),
        difficulty: Number(item.difficulty) || 1,
        points: Number(item.points) || 1,
        optionLayout: item.optionLayout || null,
        content_text: item.content_text || '',
        content_html: item.content_html || '',
        choices: cloneChoices(item.choices),
        correct_answer: item.correct_answer || null,
        explanation: item.explanation || null,
        explanation_html: item.explanation_html || null,
        resourceLinks: Array.isArray(item.resourceLinks) ? item.resourceLinks : [],
        sectionResourceLinks: Array.isArray(item.sectionResourceLinks) ? item.sectionResourceLinks : [],
        sectionId: item.sectionId || null,
        sectionOrder: item.sectionOrder ?? null,
        sectionTag: item.sectionTag || null,
        sectionTitle: item.sectionTitle || null,
        sectionContextText: item.sectionContextText || null,
        sectionContextHtml: item.sectionContextHtml || null,
        sectionShuffleQuestions: item.sectionShuffleQuestions ?? null,
        sectionShuffleChoices: item.sectionShuffleChoices ?? null,
        sectionFixedPosition: item.sectionFixedPosition ?? null,
        sectionQuestionLimit: item.sectionQuestionLimit ?? null,
        sourceBankItemId: item.id || null,
        sourceBankScope: item.scope || null,
        sourceExamId: item.sourceExamId || null,
        sourceExamTitle: item.sourceExamTitle || null,
    };
}

function resolveQuestionSetMeta(items = []) {
    const subjects = [...new Set(items.map((item) => item.subject).filter(Boolean))];
    const grades = [...new Set(items.map((item) => item.grade).filter(Boolean))];
    const chapters = [...new Set(items.map((item) => getQuestionChapter(item)).filter(Boolean))];

    return {
        subject: subjects.length === 1 ? subjects[0] : null,
        grade: grades.length === 1 ? grades[0] : null,
        subjects,
        grades,
        chapters,
    };
}

function buildSharedExamPayloadFromSubmission(submission = {}, reviewer = {}) {
    return {
        title: submission.title,
        subject: submission.subject || null,
        grade: submission.grade || null,
        duration: Number(submission.duration) || 45,
        questionCount: Number(submission.questionCount) || 0,
        maxAttempts: 1,
        shuffleQuestions: true,
        shuffleChoices: true,
        showResult: true,
        ownerAdminId: reviewer.uid,
        ownerAdminName: reviewer.displayName || reviewer.email || 'Super admin',
        ownerRole: 'admin',
        sourceFormat: 'moderated-bank',
        sourceLabel: 'Ngân hàng chung đã duyệt',
        sourceSubmissionId: submission.id,
        sourceSubmitterTeacherId: submission.submitterTeacherId || null,
        sourceSubmitterName: submission.submitterName || null,
        assetSummary: { imageCount: 0, imageBytes: 0 },
        importCount: 0,
        published: true,
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildExamSearchFields({
            title: submission.title,
            subject: submission.subject || '',
            grade: submission.grade || '',
            teacherName: reviewer.displayName || reviewer.email || 'Super admin',
        }),
    };
}

function buildSharedQuestionPayload(question = {}, index = 0) {
    return {
        ...buildQuestionFromBankItem(question, index),
        difficulty: Number(question.difficulty) || 1,
        sourceBankItemId: question.sourceBankItemId || null,
        sourceSubmissionQuestionOrder: question.order || index + 1,
    };
}

export async function submitQuestionSetForModeration({ title, duration = 45, note = '', items = [], user, userProfile }) {
    if (!user?.uid) throw new Error('Thiếu tài khoản giáo viên');
    if (!title?.trim()) throw new Error('Thiếu tiêu đề bộ câu gửi duyệt');
    if (!items.length) throw new Error('Chưa có câu hỏi nào để gửi duyệt');

    const teacherName = userProfile?.displayName || user.displayName || user.email || 'Giáo viên';
    const meta = resolveQuestionSetMeta(items);
    const submissionRef = doc(collection(db, 'bankSubmissions'));
    const submissionData = {
        title: title.trim(),
        submitterTeacherId: user.uid,
        submitterName: teacherName,
        submitterEmail: user.email || null,
        status: BANK_SUBMISSION_STATUS.PENDING,
        questionCount: items.length,
        duration: Number(duration) || 45,
        subject: meta.subject,
        grade: meta.grade,
        subjects: meta.subjects,
        grades: meta.grades,
        chapters: meta.chapters.slice(0, 10),
        note: note.trim() || null,
        sharedExamId: null,
        reviewedAt: null,
        reviewedById: null,
        reviewedByName: null,
        reviewNote: null,
        submittedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildExamSearchFields({
            title: title.trim(),
            subject: meta.subject || meta.subjects.join(' '),
            grade: meta.grade || meta.grades.join(' '),
            teacherName,
        }),
    };

    const operations = [
        { type: 'set', ref: submissionRef, data: submissionData },
        ...items.map((item, index) => ({
            type: 'set',
            ref: doc(collection(db, 'bankSubmissions', submissionRef.id, 'questions'), item.id || `q_${index + 1}`),
            data: sanitizeQuestionForSubmission(item, index, user.uid),
        })),
    ];

    await commitWriteOperations(operations);
    await logAuditEvent({
        actorId: user.uid,
        actorRole: userProfile?.role || 'teacher',
        actorName: teacherName,
        action: 'bank_submission.create',
        targetType: 'bankSubmission',
        targetId: submissionRef.id,
        teacherId: user.uid,
        metadata: {
            title: title.trim(),
            questionCount: items.length,
            subject: meta.subject,
            grade: meta.grade,
        },
    }).catch((error) => console.error('audit log failed', error));

    return { id: submissionRef.id, ...submissionData };
}

export async function loadTeacherSubmissions(teacherId) {
    if (!teacherId) return [];
    const snapshot = await getDocs(query(
        collection(db, 'bankSubmissions'),
        where('submitterTeacherId', '==', teacherId),
        orderBy('submittedAt', 'desc'),
    ));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function loadModerationSubmissions(status = 'all') {
    const constraints = [];
    if (status !== 'all') constraints.push(where('status', '==', status));
    constraints.push(orderBy('submittedAt', 'desc'));
    const snapshot = await getDocs(query(collection(db, 'bankSubmissions'), ...constraints));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function loadSubmissionQuestions(submissionId) {
    if (!submissionId) return [];
    const snapshot = await getDocs(collection(db, 'bankSubmissions', submissionId, 'questions'));
    return snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((left, right) => (left.order || 0) - (right.order || 0));
}

export async function approveBankSubmission({ submissionId, reviewer, reviewNote = '' }) {
    if (!submissionId) throw new Error('Thiếu submission để duyệt');
    if (!reviewer?.uid) throw new Error('Thiếu tài khoản duyệt');

    const submissionRef = doc(db, 'bankSubmissions', submissionId);
    const submissionSnap = await getDoc(submissionRef);
    if (!submissionSnap.exists()) throw new Error('Không tìm thấy submission');

    const submission = { id: submissionSnap.id, ...submissionSnap.data() };
    const questions = await loadSubmissionQuestions(submissionId);
    if (!questions.length) throw new Error('Submission không có câu hỏi');

    const sharedRef = doc(db, 'sharedExams', submissionId);
    const operations = [
        {
            type: 'set',
            ref: sharedRef,
            data: buildSharedExamPayloadFromSubmission(submission, reviewer),
            options: { merge: true },
        },
        ...questions.map((question, index) => ({
            type: 'set',
            ref: doc(collection(db, 'sharedExams', sharedRef.id, 'questions'), question.id || `q_${index + 1}`),
            data: buildSharedQuestionPayload(question, index),
        })),
        {
            type: 'update',
            ref: submissionRef,
            data: {
                status: BANK_SUBMISSION_STATUS.APPROVED,
                sharedExamId: sharedRef.id,
                reviewNote: reviewNote.trim() || null,
                reviewedAt: serverTimestamp(),
                reviewedById: reviewer.uid,
                reviewedByName: reviewer.displayName || reviewer.email || 'Super admin',
                updatedAt: serverTimestamp(),
            },
        },
    ];

    await commitWriteOperations(operations);
    await logAuditEvent({
        actorId: reviewer.uid,
        actorRole: 'admin',
        actorName: reviewer.displayName || reviewer.email,
        action: 'bank_submission.approve',
        targetType: 'bankSubmission',
        targetId: submissionId,
        teacherId: submission.submitterTeacherId || null,
        metadata: {
            title: submission.title,
            questionCount: questions.length,
            sharedExamId: sharedRef.id,
            reviewNote: reviewNote.trim() || null,
        },
    }).catch((error) => console.error('audit log failed', error));

    return { submissionId, sharedExamId: sharedRef.id };
}

export async function rejectBankSubmission({ submissionId, reviewer, reviewNote = '' }) {
    if (!submissionId) throw new Error('Thiếu submission để từ chối');
    if (!reviewer?.uid) throw new Error('Thiếu tài khoản duyệt');

    const submissionRef = doc(db, 'bankSubmissions', submissionId);
    const submissionSnap = await getDoc(submissionRef);
    if (!submissionSnap.exists()) throw new Error('Không tìm thấy submission');

    const submission = { id: submissionSnap.id, ...submissionSnap.data() };
    await commitWriteOperations([{
        type: 'update',
        ref: submissionRef,
        data: {
            status: BANK_SUBMISSION_STATUS.REJECTED,
            reviewNote: reviewNote.trim() || null,
            reviewedAt: serverTimestamp(),
            reviewedById: reviewer.uid,
            reviewedByName: reviewer.displayName || reviewer.email || 'Super admin',
            updatedAt: serverTimestamp(),
        },
    }]);

    await logAuditEvent({
        actorId: reviewer.uid,
        actorRole: 'admin',
        actorName: reviewer.displayName || reviewer.email,
        action: 'bank_submission.reject',
        targetType: 'bankSubmission',
        targetId: submissionId,
        teacherId: submission.submitterTeacherId || null,
        metadata: {
            title: submission.title,
            reviewNote: reviewNote.trim() || null,
        },
    }).catch((error) => console.error('audit log failed', error));

    return { submissionId };
}