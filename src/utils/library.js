import {
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    increment,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { buildExamSearchFields } from './search';
import { logAuditEvent } from './audit';
import { normalizeGamificationSettings } from './gamification';
import { buildImportHistoryEntry, buildImportQualityReport } from './importQuality';
import { getBuiltInSampleExamById } from './sampleLibrary';

function sanitizeQuestion(question = {}, index = 0) {
    return {
        number: question.number || index + 1,
        type: question.type || 'mcq',
        content_text: question.content_text || '',
        content_html: question.content_html || '',
        choices: (question.choices || []).map((choice) => ({
            letter: choice.letter,
            text: choice.text || '',
            html: choice.html || '',
        })),
        optionLayout: question.optionLayout || null,
        correct_answer: question.correct_answer || null,
        explanation: question.explanation || null,
        explanation_html: question.explanation_html || null,
        resourceLinks: Array.isArray(question.resourceLinks) ? question.resourceLinks : [],
        sectionResourceLinks: Array.isArray(question.sectionResourceLinks) ? question.sectionResourceLinks : [],
        order: question.order || index + 1,
        points: question.points || 1,
        sectionId: question.sectionId || null,
        sectionOrder: question.sectionOrder ?? null,
        sectionTag: question.sectionTag || null,
        sectionTitle: question.sectionTitle || null,
        sectionContextText: question.sectionContextText || null,
        sectionContextHtml: question.sectionContextHtml || null,
        sectionShuffleQuestions: question.sectionShuffleQuestions ?? null,
        sectionShuffleChoices: question.sectionShuffleChoices ?? null,
        sectionFixedPosition: question.sectionFixedPosition ?? null,
        sectionQuestionLimit: question.sectionQuestionLimit ?? null,
    };
}

function buildTrustedLibraryImportState({ questions = [], sourceFormat = 'library', sourceLabel = 'Thư viện' }) {
    const reviewedAt = Timestamp.now();
    const importQuality = buildImportQualityReport({
        questions,
        warningCount: 0,
        warningSamples: [],
        sourceFormat,
        imageCount: 0,
        teacherReviewed: true,
        teacherReviewedAt: reviewedAt,
        teacherReviewedBy: 'system-library',
        teacherReviewedName: 'Thi Online',
    });

    return {
        importQuality,
        importHistory: [buildImportHistoryEntry({
            kind: 'import_created',
            actorId: 'system-library',
            actorName: 'Thi Online',
            actorRole: 'system',
            at: reviewedAt,
            note: sourceLabel,
            report: importQuality,
            sourceFormat,
        })],
    };
}

function buildSharedExamPayload(exam, user, sharedExamId = null) {
    return {
        title: exam.title,
        subject: exam.subject || null,
        grade: exam.grade || null,
        duration: exam.duration || 45,
        questionCount: exam.questionCount || 0,
        maxAttempts: exam.maxAttempts || 1,
        shuffleQuestions: exam.shuffleQuestions ?? true,
        shuffleChoices: exam.shuffleChoices ?? false,
        showResult: exam.showResult ?? true,
        antiCheat: exam.antiCheat || null,
        gamification: normalizeGamificationSettings(exam.gamification),
        ownerAdminId: user.uid,
        ownerAdminName: user.displayName || user.email || 'Super admin',
        ownerRole: 'admin',
        sourceExamId: exam.id,
        sourceFormat: exam.sourceFormat || 'manual',
        assetSummary: exam.assetSummary || { imageCount: 0, imageBytes: 0 },
        importCount: exam.sharedImportCount || 0,
        sharedExamId,
        published: true,
        publishedAt: exam.sharedPublishedAt || Timestamp.now(),
        updatedAt: serverTimestamp(),
        ...buildExamSearchFields({
            title: exam.title,
            subject: exam.subject,
            grade: exam.grade,
            teacherName: user.displayName || user.email,
        }),
    };
}

export async function publishExamToSharedLibrary({ exam, questions, user }) {
    if (!exam?.id) throw new Error('Thiếu đề thi để xuất bản');
    if (!user?.uid) throw new Error('Thiếu thông tin người dùng');

    const sharedRef = doc(db, 'sharedExams', exam.sharedExamId || doc(collection(db, 'sharedExams')).id);
    const sharedSnap = await getDoc(sharedRef);
    const existingShared = sharedSnap.exists() ? sharedSnap.data() : null;
    const questionCollectionRef = collection(db, 'sharedExams', sharedRef.id, 'questions');
    const existingQuestions = await getDocs(questionCollectionRef);
    const batch = writeBatch(db);

    existingQuestions.docs.forEach((snapshot) => batch.delete(snapshot.ref));
    batch.set(sharedRef, {
        ...buildSharedExamPayload(exam, user, sharedRef.id),
        importCount: existingShared?.importCount || exam.sharedImportCount || 0,
        publishedAt: existingShared?.publishedAt || exam.sharedPublishedAt || Timestamp.now(),
        lastImportedAt: existingShared?.lastImportedAt || null,
        lastImportedBy: existingShared?.lastImportedBy || null,
        lastImportedTeacherName: existingShared?.lastImportedTeacherName || null,
    }, { merge: true });
    questions.forEach((question, index) => {
        batch.set(doc(db, 'sharedExams', sharedRef.id, 'questions', question.id || `q_${index + 1}`), sanitizeQuestion(question, index));
    });
    batch.update(doc(db, 'exams', exam.id), {
        sharedExamId: sharedRef.id,
        sharedPublished: true,
        sharedPublishedAt: serverTimestamp(),
    });
    await batch.commit();

    await logAuditEvent({
        actorId: user.uid,
        actorRole: 'admin',
        actorName: user.displayName || user.email,
        action: 'library.publish_exam',
        targetType: 'sharedExam',
        targetId: sharedRef.id,
        examId: exam.id,
        metadata: {
            title: exam.title,
            questionCount: questions.length,
            sourceFormat: exam.sourceFormat || 'manual',
        },
    }).catch((error) => console.error('audit log failed', error));

    return sharedRef.id;
}

export async function unpublishSharedExam({ exam, user }) {
    if (!exam?.sharedExamId) return;

    const sharedRef = doc(db, 'sharedExams', exam.sharedExamId);
    const questions = await getDocs(collection(db, 'sharedExams', exam.sharedExamId, 'questions'));
    const batch = writeBatch(db);

    questions.docs.forEach((snapshot) => batch.delete(snapshot.ref));
    batch.delete(sharedRef);
    batch.update(doc(db, 'exams', exam.id), {
        sharedExamId: null,
        sharedPublished: false,
        sharedPublishedAt: null,
    });
    await batch.commit();

    await logAuditEvent({
        actorId: user.uid,
        actorRole: 'admin',
        actorName: user.displayName || user.email,
        action: 'library.unpublish_exam',
        targetType: 'sharedExam',
        targetId: exam.sharedExamId,
        examId: exam.id,
        metadata: {
            title: exam.title,
        },
    }).catch((error) => console.error('audit log failed', error));
}

export async function importSharedExamToTeacher({ sharedExamId, user }) {
    if (!sharedExamId) throw new Error('Thiếu mã đề thư viện');
    if (!user?.uid) throw new Error('Thiếu người dùng');

    const sharedRef = doc(db, 'sharedExams', sharedExamId);
    const sharedSnap = await getDoc(sharedRef);
    if (!sharedSnap.exists()) throw new Error('Đề thư viện không tồn tại');

    const sharedExam = { id: sharedSnap.id, ...sharedSnap.data() };
    const questionsSnap = await getDocs(collection(db, 'sharedExams', sharedExamId, 'questions'));
    const questions = questionsSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));

    const examRef = doc(collection(db, 'exams'));
    const batch = writeBatch(db);

    batch.set(examRef, {
        title: sharedExam.title,
        subject: sharedExam.subject || null,
        grade: sharedExam.grade || null,
        duration: sharedExam.duration || 45,
        questionCount: sharedExam.questionCount || questions.length,
        maxAttempts: sharedExam.maxAttempts || 1,
        shuffleQuestions: sharedExam.shuffleQuestions ?? true,
        shuffleChoices: sharedExam.shuffleChoices ?? false,
        showResult: sharedExam.showResult ?? true,
        antiCheat: sharedExam.antiCheat || null,
        gamification: normalizeGamificationSettings(sharedExam.gamification),
        teacherId: user.uid,
        teacherName: user.displayName || user.email,
        status: 'draft',
        createdAt: Timestamp.now(),
        sourceFormat: sharedExam.sourceFormat || 'library',
        sourceSharedExamId: sharedExamId,
        sourceSharedTitle: sharedExam.title,
        sourceSharedAdminId: sharedExam.ownerAdminId,
        isLibraryImported: true,
        assetSummary: {
            ...(sharedExam.assetSummary || {}),
            storageReused: true,
        },
        ...buildExamSearchFields({
            title: sharedExam.title,
            subject: sharedExam.subject,
            grade: sharedExam.grade,
            teacherName: user.displayName || user.email,
        }),
    });

    questions.forEach((question, index) => {
        batch.set(doc(db, 'exams', examRef.id, 'questions', question.id || `q_${index + 1}`), sanitizeQuestion(question, index));
    });
    batch.update(sharedRef, {
        importCount: increment(1),
        lastImportedAt: serverTimestamp(),
        lastImportedBy: user.uid,
        lastImportedTeacherName: user.displayName || user.email,
    });
    await batch.commit();

    await logAuditEvent({
        actorId: user.uid,
        actorRole: 'teacher',
        actorName: user.displayName || user.email,
        action: 'library.import_exam',
        targetType: 'sharedExam',
        targetId: sharedExamId,
        teacherId: user.uid,
        examId: examRef.id,
        metadata: {
            importedExamTitle: sharedExam.title,
            sourceAdminId: sharedExam.ownerAdminId,
            questionCount: questions.length,
        },
    }).catch((error) => console.error('audit log failed', error));

    return { examId: examRef.id, sharedExam };
}

export async function importBuiltInSampleExam({ sampleExamId, user }) {
    if (!sampleExamId) throw new Error('Thiếu mã đề mẫu');
    if (!user?.uid) throw new Error('Thiếu người dùng');

    const sampleExam = getBuiltInSampleExamById(sampleExamId);
    if (!sampleExam) throw new Error('Đề mẫu không tồn tại');

    const questions = (sampleExam.questions || []).map((question, index) => sanitizeQuestion(question, index));
    const examRef = doc(collection(db, 'exams'));
    const batch = writeBatch(db);
    const importState = buildTrustedLibraryImportState({
        questions,
        sourceFormat: sampleExam.sourceFormat || 'sample-library',
        sourceLabel: sampleExam.sourceLabel || sampleExam.title,
    });

    batch.set(examRef, {
        title: sampleExam.title,
        subject: sampleExam.subject || null,
        grade: sampleExam.grade || null,
        duration: sampleExam.duration || 45,
        questionCount: sampleExam.questionCount || questions.length,
        maxAttempts: sampleExam.maxAttempts || 1,
        shuffleQuestions: sampleExam.shuffleQuestions ?? true,
        shuffleChoices: sampleExam.shuffleChoices ?? true,
        showResult: sampleExam.showResult ?? true,
        antiCheat: sampleExam.antiCheat || null,
        gamification: normalizeGamificationSettings(sampleExam.gamification),
        teacherId: user.uid,
        teacherName: user.displayName || user.email,
        status: 'draft',
        createdAt: Timestamp.now(),
        sourceFormat: sampleExam.sourceFormat || 'sample-library',
        sourceLabel: sampleExam.sourceLabel || 'Kho đề mẫu hệ thống',
        sourceSampleId: sampleExam.id,
        sourceSampleTitle: sampleExam.title,
        sourceSampleCategory: sampleExam.sampleCategory || null,
        isLibraryImported: true,
        assetSummary: {
            ...(sampleExam.assetSummary || { imageCount: 0, imageBytes: 0 }),
            storageReused: true,
        },
        importQuality: importState.importQuality,
        importHistory: importState.importHistory,
        ...buildExamSearchFields({
            title: sampleExam.title,
            subject: sampleExam.subject,
            grade: sampleExam.grade,
            teacherName: user.displayName || user.email,
        }),
    });

    questions.forEach((question, index) => {
        batch.set(doc(db, 'exams', examRef.id, 'questions', question.id || `q_${index + 1}`), question);
    });

    await batch.commit();

    await logAuditEvent({
        actorId: user.uid,
        actorRole: 'teacher',
        actorName: user.displayName || user.email,
        action: 'library.import_sample_exam',
        targetType: 'sampleExam',
        targetId: sampleExamId,
        teacherId: user.uid,
        examId: examRef.id,
        metadata: {
            importedExamTitle: sampleExam.title,
            questionCount: questions.length,
            subject: sampleExam.subject || null,
            grade: sampleExam.grade || null,
        },
    }).catch((error) => console.error('audit log failed', error));

    return { examId: examRef.id, sampleExam };
}