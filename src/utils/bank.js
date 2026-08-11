import { Timestamp, collection, deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { buildExamSearchFields } from './search';

export const BANK_SCOPE_PRIVATE = 'private';
export const BANK_SCOPE_SYSTEM = 'system';

function normalizeText(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function normalizeDifficulty(value) {
    const parsed = Number(value);
    return [1, 2, 3].includes(parsed) ? parsed : 1;
}

function cloneChoices(choices = []) {
    return (choices || []).map((choice) => ({
        letter: choice.letter,
        text: choice.text || '',
        html: choice.html || '',
    }));
}

export function getQuestionChapter(question = {}) {
    return normalizeText(question.chapter || question.sectionTitle || '');
}

export function getPrivateBankItemId(ownerId, examId, questionId) {
    return ['private', ownerId || 'owner', examId || 'exam', questionId || 'question'].join('__');
}

export function getSystemBankItemId(examId, questionId) {
    return ['system', examId || 'exam', questionId || 'question'].join('__');
}

export function buildBankItemPayload({
    scope = BANK_SCOPE_PRIVATE,
    ownerId = null,
    ownerName = null,
    exam = {},
    question = {},
    questionId = null,
    actorId = null,
    actorName = null,
}) {
    const subject = normalizeText(question.subject || exam.subject || '');
    const grade = normalizeText(question.grade || exam.grade || '');
    const chapter = getQuestionChapter(question);
    const sourceExamTitle = normalizeText(exam.title || '');

    return {
        scope,
        ownerId: scope === BANK_SCOPE_PRIVATE ? ownerId : null,
        ownerName: scope === BANK_SCOPE_PRIVATE ? ownerName : null,
        createdById: actorId || ownerId || null,
        createdByName: actorName || ownerName || null,
        sourceType: 'exam_sync',
        sourceExamId: exam.id || null,
        sourceQuestionId: questionId || question.id || null,
        sourceExamTitle,
        subject,
        grade,
        chapter,
        difficulty: normalizeDifficulty(question.difficulty),
        type: question.type || 'mcq',
        number: question.number || question.order || 1,
        order: question.order || question.number || 1,
        points: Number(question.points) || 1,
        optionLayout: question.optionLayout || null,
        content_text: question.content_text || '',
        content_html: question.content_html || '',
        choices: cloneChoices(question.choices),
        correct_answer: question.correct_answer || null,
        explanation: question.explanation || null,
        explanation_html: question.explanation_html || null,
        resourceLinks: Array.isArray(question.resourceLinks) ? question.resourceLinks : [],
        sectionResourceLinks: Array.isArray(question.sectionResourceLinks) ? question.sectionResourceLinks : [],
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
        sourceStatus: exam.status || 'draft',
        searchKeywords: buildExamSearchFields({
            title: sourceExamTitle || '',
            subject: subject || '',
            grade: grade || '',
            teacherName: ownerName || actorName || '',
        }).searchKeywords || [],
        updatedAt: Timestamp.now(),
    };
}

export function buildPrivateBankItemRef({ ownerId, examId, questionId }) {
    return doc(db, 'bankItems', getPrivateBankItemId(ownerId, examId, questionId));
}

export function buildSystemBankItemRef({ examId, questionId }) {
    return doc(db, 'bankItems', getSystemBankItemId(examId, questionId));
}

export function buildSyncExamToPrivateBankOperations({ ownerId, ownerName, exam, questions, actorId, actorName }) {
    return (questions || [])
        .filter((question) => question?.id)
        .map((question) => ({
            type: 'set',
            ref: buildPrivateBankItemRef({ ownerId, examId: exam.id, questionId: question.id }),
            data: buildBankItemPayload({
                scope: BANK_SCOPE_PRIVATE,
                ownerId,
                ownerName,
                exam,
                question,
                questionId: question.id,
                actorId,
                actorName,
            }),
            options: { merge: true },
        }));
}

export function buildSyncExamToSystemBankOperations({ exam, questions, actorId, actorName }) {
    return (questions || [])
        .filter((question) => question?.id)
        .map((question) => ({
            type: 'set',
            ref: buildSystemBankItemRef({ examId: exam.id, questionId: question.id }),
            data: buildBankItemPayload({
                scope: BANK_SCOPE_SYSTEM,
                exam,
                question,
                questionId: question.id,
                actorId,
                actorName,
            }),
            options: { merge: true },
        }));
}

export function buildDeletePrivateBankOperations({ ownerId, examId, questionIds = [] }) {
    return questionIds
        .filter(Boolean)
        .map((questionId) => ({
            type: 'delete',
            ref: buildPrivateBankItemRef({ ownerId, examId, questionId }),
        }));
}

export function buildDeleteSystemBankOperations({ examId, questionIds = [] }) {
    return questionIds
        .filter(Boolean)
        .map((questionId) => ({
            type: 'delete',
            ref: buildSystemBankItemRef({ examId, questionId }),
        }));
}

export async function commitWriteOperations(operations = [], chunkSize = 420) {
    let batch = writeBatch(db);
    let count = 0;

    for (const operation of operations) {
        if (!operation?.ref) continue;

        if (count >= chunkSize) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
        }

        if (operation.type === 'delete') {
            batch.delete(operation.ref);
        } else if (operation.type === 'update') {
            batch.update(operation.ref, operation.data || {});
        } else {
            batch.set(operation.ref, operation.data || {}, operation.options || {});
        }

        count += 1;
    }

    if (count > 0) {
        await batch.commit();
    }
}

export async function upsertPrivateBankItem({ ownerId, ownerName, exam, question, actorId, actorName }) {
    await setDoc(
        buildPrivateBankItemRef({ ownerId, examId: exam.id, questionId: question.id }),
        buildBankItemPayload({
            scope: BANK_SCOPE_PRIVATE,
            ownerId,
            ownerName,
            exam,
            question,
            questionId: question.id,
            actorId,
            actorName,
        }),
        { merge: true },
    );
}

export async function deletePrivateBankItem({ ownerId, examId, questionId }) {
    await deleteDoc(buildPrivateBankItemRef({ ownerId, examId, questionId }));
}

export async function publishExamToSystemBank({ exam, questions, actorId, actorName }) {
    await commitWriteOperations(buildSyncExamToSystemBankOperations({ exam, questions, actorId, actorName }));
}

export async function removeExamFromSystemBank({ examId, questionIds }) {
    await commitWriteOperations(buildDeleteSystemBankOperations({ examId, questionIds }));
}

export function buildQuestionFromBankItem(item = {}, index = 0) {
    return {
        number: index + 1,
        order: index + 1,
        type: item.type || 'mcq',
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
        difficulty: normalizeDifficulty(item.difficulty),
        chapter: getQuestionChapter(item),
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
    };
}

export function createExamWriteRefs() {
    const examRef = doc(collection(db, 'exams'));
    return { examRef };
}