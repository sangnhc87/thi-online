const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const SESSION_RETENTION_YEARS = 3;
const SESSION_CLEANUP_BATCH_SIZE = 200;
const SESSION_CLEANUP_MAX_BATCHES = 5;

function normalizePart(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

function tokenize(value) {
    return normalizePart(value)
        .replace(/[^a-z0-9@._\s-]+/g, ' ')
        .split(/[\s@._-]+/)
        .map((token) => token.trim())
        .filter(Boolean);
}

function buildSearchKeywords(parts = []) {
    const keywords = new Set();
    parts.forEach((part) => {
        tokenize(part).forEach((token) => {
            for (let index = 1; index <= Math.min(token.length, 12); index += 1) {
                keywords.add(token.slice(0, index));
            }
        });
    });
    return Array.from(keywords).slice(0, 250);
}

function safeNumber(value) {
    return Number(value) || 0;
}

function normalizeAssetPaths(assetRefs = []) {
    if (!Array.isArray(assetRefs)) return [];
    return Array.from(new Set(assetRefs.map((asset) => (typeof asset === 'string' ? asset : asset?.path)).filter(Boolean)));
}

function collectSessionSubmissionAssetPaths(session = {}) {
    const answerLevelPaths = Array.isArray(session.answers)
        ? session.answers.flatMap((answer) => (
            Array.isArray(answer?.attachments)
                ? answer.attachments.map((asset) => (typeof asset === 'string' ? asset : asset?.path || asset?.fullPath))
                : []
        ))
        : [];

    return normalizeAssetPaths([
        ...(Array.isArray(session.submissionAssetRefs) ? session.submissionAssetRefs : []),
        ...answerLevelPaths,
    ]);
}

async function cleanupStoragePaths(paths = []) {
    const normalizedPaths = normalizeAssetPaths(paths);
    if (normalizedPaths.length === 0) return;

    const bucket = getStorage().bucket();
    await Promise.all(normalizedPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true }).catch(() => null)));
}

function buildTeacherMetadata(profile = {}, fallback = {}) {
    const teacherName = profile.displayName || fallback.teacherName || fallback.teacherEmail || null;
    const teacherEmail = profile.email || fallback.teacherEmail || null;
    const teacherStatus = profile.teacherStatus || fallback.teacherStatus || null;
    const teacherSlug = profile.teacherSlug || fallback.teacherSlug || null;

    return {
        teacherName,
        teacherEmail,
        teacherStatus,
        teacherSlug,
        searchKeywords: buildSearchKeywords([teacherName, teacherEmail, teacherSlug, profile.schoolName]),
    };
}

async function getUserProfile(userId) {
    if (!userId) return null;
    const snapshot = await db.doc(`users/${userId}`).get();
    return snapshot.exists ? snapshot.data() : null;
}

async function applyTeacherStatsDelta(teacherId, delta = {}, metadata = {}) {
    if (!teacherId) return;
    const payload = {
        teacherId,
        updatedAt: FieldValue.serverTimestamp(),
    };

    Object.entries(delta).forEach(([key, value]) => {
        if (typeof value === 'number' && value !== 0) {
            payload[key] = FieldValue.increment(value);
        }
    });

    Object.entries(metadata).forEach(([key, value]) => {
        if (value !== undefined) payload[key] = value;
    });

    await db.doc(`teacherStats/${teacherId}`).set(payload, { merge: true });
}

async function setExamStatsDocument(examId, examData = {}) {
    if (!examId) return;

    await db.doc(`examStats/${examId}`).set({
        examId,
        teacherId: examData.teacherId || null,
        title: examData.title || null,
        status: examData.status || 'draft',
        questionCount: safeNumber(examData.questionCount),
        createdAt: examData.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        teacherName: examData.teacherName || null,
    }, { merge: true });
}

async function applyExamStatsDelta(examId, metadata = {}, delta = {}) {
    if (!examId) return;

    const payload = {
        examId,
        updatedAt: FieldValue.serverTimestamp(),
    };

    Object.entries(delta).forEach(([key, value]) => {
        if (typeof value === 'number' && value !== 0) {
            payload[key] = FieldValue.increment(value);
        }
    });

    Object.entries(metadata).forEach(([key, value]) => {
        if (value !== undefined) payload[key] = value;
    });

    await db.doc(`examStats/${examId}`).set(payload, { merge: true });
}

function examMetricSnapshot(exam = {}) {
    return {
        examCount: exam.id ? 1 : 0,
        activeExamCount: exam.status === 'active' ? 1 : 0,
        draftExamCount: exam.status === 'active' ? 0 : 1,
        importedExamCount: exam.sourceSharedExamId ? 1 : 0,
        storageBytes: safeNumber(exam.assetSummary?.imageBytes),
        imageCount: safeNumber(exam.assetSummary?.imageCount),
    };
}

function diffMetricSnapshot(before = {}, after = {}) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diff = {};
    keys.forEach((key) => {
        const delta = safeNumber(after[key]) - safeNumber(before[key]);
        if (delta !== 0) diff[key] = delta;
    });
    return diff;
}

async function resolveSessionTeacherContext(session = {}, cache = new Map()) {
    if (!session) return { teacherId: null, teacherName: null, examId: null, examTitle: null, questionCount: 0 };

    const examId = session.examId || null;
    const teacherId = session.teacherId || null;
    if (teacherId) {
        return {
            teacherId,
            teacherName: session.teacherName || null,
            examId,
            examTitle: session.examTitle || null,
            questionCount: safeNumber(session.total),
        };
    }

    if (!examId) return { teacherId: null, teacherName: null, examId: null, examTitle: null, questionCount: 0 };
    if (!cache.has(examId)) {
        cache.set(examId, db.doc(`exams/${examId}`).get());
    }
    const snapshot = await cache.get(examId);
    const exam = snapshot.exists ? snapshot.data() : {};
    return {
        teacherId: exam.teacherId || null,
        teacherName: exam.teacherName || null,
        examId,
        examTitle: session.examTitle || exam.title || null,
        questionCount: safeNumber(session.total || exam.questionCount),
    };
}

const EXAM_DELIVERY_SOURCE_FIXED = 'fixed';
const EXAM_DELIVERY_SOURCE_BANK = 'bank';
const EXAM_DELIVERY_VARIANT_FIXED = 'fixed';
const EXAM_DELIVERY_VARIANT_PER_STUDENT = 'per_student';
const EXAM_DELIVERY_VARIANT_PER_ATTEMPT = 'per_attempt';

function safeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isAllowedBankScope(value) {
    return ['all', 'private', 'system'].includes(value);
}

function normalizeDeliveryVariant(value, fallback = EXAM_DELIVERY_VARIANT_FIXED) {
    if ([
        EXAM_DELIVERY_VARIANT_FIXED,
        EXAM_DELIVERY_VARIANT_PER_STUDENT,
        EXAM_DELIVERY_VARIANT_PER_ATTEMPT,
    ].includes(value)) {
        return value;
    }

    return fallback;
}

function normalizeBankBlueprintRow(row = {}, index = 0) {
    return {
        id: row.id || `row-${index + 1}`,
        count: Math.max(0, Math.floor(safeNumber(row.count))),
        type: safeText(row.type) || 'all',
        difficulty: safeText(String(row.difficulty || 'all')) || 'all',
        chapter: safeText(row.chapter || 'all') || 'all',
        scope: isAllowedBankScope(row.scope) ? row.scope : 'all',
    };
}

function normalizeExamDeliveryConfig(config = {}, fallback = {}) {
    const source = config?.source === EXAM_DELIVERY_SOURCE_BANK
        ? EXAM_DELIVERY_SOURCE_BANK
        : EXAM_DELIVERY_SOURCE_FIXED;
    const bankPolicy = config?.bankPolicy && typeof config.bankPolicy === 'object' ? config.bankPolicy : {};
    const fallbackVariant = source === EXAM_DELIVERY_SOURCE_BANK
        ? EXAM_DELIVERY_VARIANT_PER_STUDENT
        : EXAM_DELIVERY_VARIANT_FIXED;
    const variantMode = source === EXAM_DELIVERY_SOURCE_FIXED
        ? EXAM_DELIVERY_VARIANT_FIXED
        : normalizeDeliveryVariant(config?.variantMode, fallbackVariant);

    return {
        source,
        variantMode,
        bankPolicy: {
            subject: safeText(bankPolicy.subject) || safeText(fallback.subject),
            grade: safeText(bankPolicy.grade) || safeText(fallback.grade),
            scope: isAllowedBankScope(bankPolicy.scope) ? bankPolicy.scope : 'all',
            rows: Array.isArray(bankPolicy.rows)
                ? bankPolicy.rows.map((row, index) => normalizeBankBlueprintRow(row, index)).filter((row) => row.count > 0)
                : [],
        },
    };
}

function createSeededRandom(seedInput = '') {
    const text = String(seedInput || 'seed');
    let seed = 0;
    for (let index = 0; index < text.length; index += 1) {
        seed = Math.imul(seed ^ text.charCodeAt(index), 2654435761) >>> 0;
    }
    if (seed === 0) seed = 0x6d2b79f5;

    return () => {
        seed += 0x6d2b79f5;
        let value = seed;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleWithRandom(items = [], random = Math.random) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(random() * (index + 1));
        [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
    }
    return next;
}

function getBankItemChapter(item = {}) {
    return safeText(item.chapter || item.sectionTitle || '');
}

function resolveEffectiveBankScope(policyScope = 'all', rowScope = 'all') {
    if (rowScope && rowScope !== 'all') return rowScope;
    return policyScope || 'all';
}

function matchesDeliveryRow(item = {}, deliveryConfig = {}, row = {}) {
    const policy = deliveryConfig.bankPolicy || {};
    const effectiveScope = resolveEffectiveBankScope(policy.scope, row.scope);
    const chapter = getBankItemChapter(item);

    if (policy.subject && item.subject !== policy.subject) return false;
    if (policy.grade && item.grade !== policy.grade) return false;
    if (effectiveScope !== 'all' && item.scope !== effectiveScope) return false;
    if (row.type && row.type !== 'all' && item.type !== row.type) return false;
    if (row.difficulty && row.difficulty !== 'all' && String(item.difficulty || 1) !== String(row.difficulty)) return false;
    if (row.chapter && row.chapter !== 'all') {
        if (row.chapter === '__none__') {
            return !chapter;
        }
        return chapter === row.chapter;
    }

    return true;
}

function getBankItemKey(item = {}) {
    return item.id || item.sourceQuestionId || `${item.sourceExamId || 'exam'}:${item.number || item.order || 0}`;
}

function buildQuestionFromBankItem(item = {}, index = 0) {
    return {
        id: item.id || `bank-${index + 1}`,
        number: index + 1,
        order: index + 1,
        type: item.type || 'mcq',
        points: safeNumber(item.points) || 1,
        optionLayout: item.optionLayout || null,
        content_text: item.content_text || '',
        content_html: item.content_html || '',
        choices: Array.isArray(item.choices)
            ? item.choices.map((choice) => ({
                letter: choice.letter,
                text: choice.text || '',
                html: choice.html || '',
            }))
            : [],
        correct_answer: item.correct_answer || null,
        explanation: item.explanation || null,
        explanation_html: item.explanation_html || null,
        difficulty: safeNumber(item.difficulty) || 1,
        chapter: getBankItemChapter(item) || null,
        sectionId: item.sectionId || null,
        sectionOrder: item.sectionOrder ?? null,
        sectionTag: item.sectionTag || null,
        sectionTitle: item.sectionTitle || null,
        sectionContextText: item.sectionContextText || null,
        sectionContextHtml: item.sectionContextHtml || null,
        sectionShuffleQuestions: item.sectionShuffleQuestions ?? null,
        sectionShuffleChoices: item.sectionShuffleChoices ?? null,
        sectionFixedPosition: item.sectionFixedPosition ?? null,
        sourceBankItemId: item.id || null,
        sourceBankScope: item.scope || null,
        sourceExamId: item.sourceExamId || null,
    };
}

async function loadBankItemsForExamDelivery(exam = {}) {
    const [privateSnapshot, systemSnapshot] = await Promise.all([
        db.collection('bankItems').where('ownerId', '==', exam.teacherId || '__missing__').get(),
        db.collection('bankItems').where('scope', '==', 'system').get(),
    ]);

    return [
        ...privateSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        ...systemSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);
}

function generateQuestionsFromBankItems(items = [], deliveryConfig = {}, seedInput = '') {
    if (!deliveryConfig.bankPolicy?.rows?.length) {
        throw new Error('Đề này chưa có ma trận câu hỏi từ ngân hàng.');
    }

    const random = createSeededRandom(seedInput);
    let remaining = [...items];
    const picked = [];
    let pendingRows = deliveryConfig.bankPolicy.rows.map((row, index) => ({ row, index }));

    while (pendingRows.length > 0) {
        const rankedRows = pendingRows
            .map((entry) => ({
                ...entry,
                candidates: remaining.filter((item) => matchesDeliveryRow(item, deliveryConfig, entry.row)),
            }))
            .sort((left, right) => (
                left.candidates.length - right.candidates.length
                || right.row.count - left.row.count
                || left.index - right.index
            ));

        const current = rankedRows[0];
        if (current.candidates.length < current.row.count) {
            throw new Error(`Ma trận dòng ${current.index + 1} không đủ câu để phát đề. Cần ${current.row.count}, hiện có ${current.candidates.length}.`);
        }

        const rowPicked = shuffleWithRandom(current.candidates, random).slice(0, current.row.count);
        picked.push(...rowPicked);

        const pickedKeys = new Set(rowPicked.map((item) => getBankItemKey(item)));
        remaining = remaining.filter((item) => !pickedKeys.has(getBankItemKey(item)));
        pendingRows = pendingRows.filter((entry) => entry.index !== current.index);
    }

    return shuffleWithRandom(picked, random).map((item, index) => buildQuestionFromBankItem(item, index));
}

exports.syncTeacherProfileStats = onDocumentWritten('users/{userId}', async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const userId = event.params.userId;

    const beforeTeacherId = before?.role === 'student' ? before.teacherId || null : null;
    const afterTeacherId = after?.role === 'student' ? after.teacherId || null : null;

    if (beforeTeacherId && beforeTeacherId !== afterTeacherId) {
        await applyTeacherStatsDelta(beforeTeacherId, { studentCount: -1, estimatedWriteOps: 1 });
    }
    if (afterTeacherId && beforeTeacherId !== afterTeacherId) {
        const teacherProfile = await getUserProfile(afterTeacherId);
        await applyTeacherStatsDelta(afterTeacherId, { studentCount: 1, estimatedWriteOps: 1 }, buildTeacherMetadata(teacherProfile || {}, {}));
    }

    const isTeacherAfter = after?.role === 'teacher' || after?.role === 'admin';
    const isTeacherBefore = before?.role === 'teacher' || before?.role === 'admin';

    if (isTeacherAfter) {
        await applyTeacherStatsDelta(userId, {}, buildTeacherMetadata(after, after));
    } else if (isTeacherBefore && !isTeacherAfter) {
        await db.doc(`teacherStats/${userId}`).set({
            teacherId: userId,
            teacherStatus: before?.teacherStatus || null,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }
});

exports.syncExamAggregates = onDocumentWritten('exams/{examId}', async (event) => {
    const before = event.data.before.exists ? { id: event.params.examId, ...event.data.before.data() } : null;
    const after = event.data.after.exists ? { id: event.params.examId, ...event.data.after.data() } : null;
    const examId = event.params.examId;
    const beforeAssetPaths = normalizeAssetPaths(before?.assetRefs);
    const afterAssetPaths = normalizeAssetPaths(after?.assetRefs);
    const removedAssetPaths = after
        ? beforeAssetPaths.filter((path) => !afterAssetPaths.includes(path))
        : beforeAssetPaths;

    if (removedAssetPaths.length > 0) {
        await cleanupStoragePaths(removedAssetPaths);
    }

    if (after) {
        await setExamStatsDocument(examId, after);
    } else {
        await db.doc(`examStats/${examId}`).delete().catch(() => null);
    }

    const affectedTeacherIds = new Set([before?.teacherId, after?.teacherId].filter(Boolean));
    for (const teacherId of affectedTeacherIds) {
        const teacherProfile = await getUserProfile(teacherId);
        const beforeMetrics = before?.teacherId === teacherId ? examMetricSnapshot(before) : {};
        const afterMetrics = after?.teacherId === teacherId ? examMetricSnapshot(after) : {};
        await applyTeacherStatsDelta(teacherId, diffMetricSnapshot(beforeMetrics, afterMetrics), buildTeacherMetadata(teacherProfile || {}, after || before || {}));
    }
});

exports.syncSharedLibraryAggregates = onDocumentWritten('sharedExams/{sharedExamId}', async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const affectedAdminIds = new Set([before?.ownerAdminId, after?.ownerAdminId].filter(Boolean));

    for (const adminId of affectedAdminIds) {
        const adminProfile = await getUserProfile(adminId);
        const beforeCount = before?.ownerAdminId === adminId ? 1 : 0;
        const afterCount = after?.ownerAdminId === adminId ? 1 : 0;
        await applyTeacherStatsDelta(adminId, { sharedExamCount: afterCount - beforeCount }, buildTeacherMetadata(adminProfile || {}, after || before || {}));
    }
});

exports.syncSessionAggregates = onDocumentWritten('sessions/{sessionId}', async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const cache = new Map();

    const beforeContext = await resolveSessionTeacherContext(before, cache);
    const afterContext = await resolveSessionTeacherContext(after, cache);
    const teacherIds = new Set([beforeContext.teacherId, afterContext.teacherId].filter(Boolean));

    for (const teacherId of teacherIds) {
        const teacherProfile = await getUserProfile(teacherId);
        const beforeForTeacher = beforeContext.teacherId === teacherId ? before : null;
        const afterForTeacher = afterContext.teacherId === teacherId ? after : null;
        const delta = {
            sessionCount: (afterForTeacher ? 1 : 0) - (beforeForTeacher ? 1 : 0),
            totalScore: safeNumber(afterForTeacher?.score) - safeNumber(beforeForTeacher?.score),
            totalQuestions: safeNumber(afterForTeacher?.total) - safeNumber(beforeForTeacher?.total),
            estimatedReadOps: (afterForTeacher ? safeNumber(afterForTeacher.total) + 2 : 0) - (beforeForTeacher ? safeNumber(beforeForTeacher.total) + 2 : 0),
            estimatedWriteOps: afterForTeacher && beforeForTeacher ? 1 : (afterForTeacher ? 1 : -1),
        };
        await applyTeacherStatsDelta(teacherId, delta, buildTeacherMetadata(teacherProfile || {}, { teacherName: afterContext.teacherName || beforeContext.teacherName }));
    }

    const examIds = new Set([beforeContext.examId, afterContext.examId].filter(Boolean));
    for (const examId of examIds) {
        const beforeForExam = beforeContext.examId === examId ? before : null;
        const afterForExam = afterContext.examId === examId ? after : null;
        const metadata = {
            examId,
            teacherId: afterContext.examId === examId ? afterContext.teacherId : beforeContext.teacherId,
            title: afterForExam?.examTitle || beforeForExam?.examTitle || afterContext.examTitle || beforeContext.examTitle,
            lastCompletedAt: afterForExam?.completedAt || undefined,
        };
        const delta = {
            sessionCount: (afterForExam ? 1 : 0) - (beforeForExam ? 1 : 0),
            totalScore: safeNumber(afterForExam?.score) - safeNumber(beforeForExam?.score),
            totalQuestions: safeNumber(afterForExam?.total) - safeNumber(beforeForExam?.total),
        };
        await applyExamStatsDelta(examId, metadata, delta);
    }
});

async function rebuildExamStatsForTeacher(teacherId, teacherProfile) {
    const examSnap = await db.collection('exams').where('teacherId', '==', teacherId).get();
    const studentSnap = await db.collection('users').where('teacherId', '==', teacherId).where('role', '==', 'student').get();

    const exams = examSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    let sessionCount = 0;
    let totalScore = 0;
    let totalQuestions = 0;
    let estimatedReadOps = 0;
    let estimatedWriteOps = exams.length;
    let sharedExamCount = 0;
    let importedExamCount = 0;
    let storageBytes = 0;
    let imageCount = 0;

    for (const exam of exams) {
        const sessionSnap = await db.collection('sessions').where('examId', '==', exam.id).get();
        const examSessions = sessionSnap.docs.map((snapshot) => snapshot.data());
        sessionCount += examSessions.length;
        totalScore += examSessions.reduce((sum, session) => sum + safeNumber(session.score), 0);
        totalQuestions += examSessions.reduce((sum, session) => sum + safeNumber(session.total), 0);
        estimatedReadOps += examSessions.reduce((sum, session) => sum + safeNumber(session.total) + 2, 0);
        estimatedWriteOps += examSessions.length;
        if (exam.sourceSharedExamId) importedExamCount += 1;
        storageBytes += safeNumber(exam.assetSummary?.imageBytes);
        imageCount += safeNumber(exam.assetSummary?.imageCount);

        await db.doc(`examStats/${exam.id}`).set({
            examId: exam.id,
            teacherId,
            teacherName: teacherProfile.displayName || teacherProfile.email || null,
            title: exam.title || null,
            status: exam.status || 'draft',
            questionCount: safeNumber(exam.questionCount),
            sessionCount: examSessions.length,
            totalScore: examSessions.reduce((sum, session) => sum + safeNumber(session.score), 0),
            totalQuestions: examSessions.reduce((sum, session) => sum + safeNumber(session.total), 0),
            lastCompletedAt: examSessions.map((session) => session.completedAt).filter(Boolean).sort().at(-1) || null,
            createdAt: exam.createdAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    if (teacherProfile.role === 'admin') {
        const sharedSnap = await db.collection('sharedExams').where('ownerAdminId', '==', teacherId).get();
        sharedExamCount = sharedSnap.size;
    }

    await db.doc(`teacherStats/${teacherId}`).set({
        teacherId,
        ...buildTeacherMetadata(teacherProfile, teacherProfile),
        studentCount: studentSnap.size,
        examCount: exams.length,
        activeExamCount: exams.filter((exam) => exam.status === 'active').length,
        draftExamCount: exams.filter((exam) => exam.status !== 'active').length,
        sharedExamCount,
        importedExamCount,
        sessionCount,
        totalScore,
        totalQuestions,
        estimatedReadOps,
        estimatedWriteOps,
        storageBytes,
        imageCount,
        updatedAt: FieldValue.serverTimestamp(),
        rebuiltAt: FieldValue.serverTimestamp(),
    }, { merge: true });
}

exports.cleanupExpiredSessions = onSchedule({
    schedule: 'every day 03:15',
    timeZone: 'Asia/Ho_Chi_Minh',
}, async () => {
    const cutoffMillis = Date.now() - (SESSION_RETENTION_YEARS * 365 * 24 * 60 * 60 * 1000);
    const cutoffTimestamp = Timestamp.fromMillis(cutoffMillis);

    let deletedSessions = 0;
    let deletedAssets = 0;

    for (let batchIndex = 0; batchIndex < SESSION_CLEANUP_MAX_BATCHES; batchIndex += 1) {
        const snapshot = await db.collection('sessions')
            .where('completedAt', '<=', cutoffTimestamp)
            .orderBy('completedAt', 'asc')
            .limit(SESSION_CLEANUP_BATCH_SIZE)
            .get();

        if (snapshot.empty) break;

        const batch = db.batch();
        const assetPaths = [];
        snapshot.docs.forEach((docSnapshot) => {
            assetPaths.push(...collectSessionSubmissionAssetPaths(docSnapshot.data()));
            batch.delete(docSnapshot.ref);
        });

        const normalizedAssetPaths = normalizeAssetPaths(assetPaths);
        await cleanupStoragePaths(normalizedAssetPaths);
        await batch.commit();

        deletedSessions += snapshot.size;
        deletedAssets += normalizedAssetPaths.length;

        if (snapshot.size < SESSION_CLEANUP_BATCH_SIZE) break;
    }

    console.log('cleanupExpiredSessions completed', {
        deletedSessions,
        deletedAssets,
        cutoffIso: new Date(cutoffMillis).toISOString(),
    });
});

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function isExpiredStudent(profile = {}) {
    const expiryMillis = toMillis(profile.teacherExpiry);
    return expiryMillis != null && expiryMillis < Date.now();
}

exports.getQuizLaunchData = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập');
    }

    const examId = request.data?.examId;
    const previewStudentId = request.data?.previewStudentId || null;
    if (!examId || typeof examId !== 'string') {
        throw new HttpsError('invalid-argument', 'Thiếu examId hợp lệ');
    }

    const actorSnapshot = await db.doc(`users/${request.auth.uid}`).get();
    if (!actorSnapshot.exists) {
        throw new HttpsError('permission-denied', 'Không tìm thấy hồ sơ tài khoản');
    }
    const actor = { uid: request.auth.uid, ...actorSnapshot.data() };

    let targetStudent = actor;
    const isPreviewMode = Boolean(previewStudentId);

    if (isPreviewMode) {
        if (!['teacher', 'admin'].includes(actor.role)) {
            throw new HttpsError('permission-denied', 'Chỉ giáo viên mới được xem preview học sinh');
        }

        const previewSnapshot = await db.doc(`users/${previewStudentId}`).get();
        if (!previewSnapshot.exists) {
            throw new HttpsError('not-found', 'Không tìm thấy học sinh preview');
        }

        const previewStudent = { uid: previewStudentId, ...previewSnapshot.data() };
        if (previewStudent.role !== 'student') {
            throw new HttpsError('failed-precondition', 'Tài khoản preview không phải học sinh');
        }
        if (actor.role !== 'admin' && previewStudent.teacherId !== actor.uid) {
            throw new HttpsError('permission-denied', 'Bạn không được preview học sinh này');
        }

        targetStudent = previewStudent;
    } else if (actor.role !== 'student') {
        throw new HttpsError('permission-denied', 'Chỉ tài khoản học sinh mới có thể vào thi');
    }

    const examSnapshot = await db.doc(`exams/${examId}`).get();
    if (!examSnapshot.exists) {
        throw new HttpsError('not-found', 'Đề thi không tồn tại');
    }
    const exam = { id: examId, ...examSnapshot.data() };

    if (exam.status !== 'active') {
        throw new HttpsError('failed-precondition', 'Đề thi này hiện chưa được mở cho học sinh');
    }
    if (!targetStudent.teacherId || exam.teacherId !== targetStudent.teacherId) {
        throw new HttpsError('permission-denied', 'Đề thi này không thuộc lớp của bạn');
    }

    if (!isPreviewMode) {
        if (targetStudent.blocked === true) {
            throw new HttpsError('permission-denied', 'Tài khoản của bạn đang bị khóa');
        }
        if (isExpiredStudent(targetStudent)) {
            throw new HttpsError('failed-precondition', 'Quyền truy cập lớp của bạn đã hết hạn');
        }
    }

    let attemptCount = 0;
    if (!isPreviewMode) {
        const sessionSnapshot = await db.collection('sessions').where('studentId', '==', actor.uid).get();
        attemptCount = sessionSnapshot.docs.filter((snapshot) => snapshot.data().examId === examId).length;
    }

    const deliveryConfig = normalizeExamDeliveryConfig(exam.deliveryConfig, {
        subject: exam.subject || '',
        grade: exam.grade || '',
    });

    if (deliveryConfig.source === EXAM_DELIVERY_SOURCE_BANK && deliveryConfig.variantMode !== EXAM_DELIVERY_VARIANT_FIXED) {
        try {
            const bankItems = await loadBankItemsForExamDelivery(exam);
            const attemptOrdinal = attemptCount + 1;
            const seedParts = [
                examId,
                targetStudent.uid || request.auth.uid,
                deliveryConfig.variantMode,
            ];

            if (deliveryConfig.variantMode === EXAM_DELIVERY_VARIANT_PER_ATTEMPT) {
                seedParts.push(`attempt:${attemptOrdinal}`);
            }

            const questions = generateQuestionsFromBankItems(bankItems, deliveryConfig, seedParts.join('|'));
            return {
                questions,
                attemptCount,
            };
        } catch (error) {
            console.error('dynamic bank delivery failed', error);
            throw new HttpsError('failed-precondition', error.message || 'Không thể phát đề ngẫu nhiên từ ngân hàng.');
        }
    }

    const questionSnapshot = await db.collection(`exams/${examId}/questions`).get();
    const questions = questionSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));

    return {
        questions,
        attemptCount,
    };
});

exports.adminRebuildUsageStats = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập');
    }

    const actorSnapshot = await db.doc(`users/${request.auth.uid}`).get();
    const actor = actorSnapshot.exists ? actorSnapshot.data() : null;
    if (actor?.role !== 'admin') {
        throw new HttpsError('permission-denied', 'Chỉ super admin mới được tái tạo thống kê');
    }

    const teacherId = request.data?.teacherId || null;
    if (teacherId) {
        const teacherSnapshot = await db.doc(`users/${teacherId}`).get();
        if (!teacherSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy giáo viên');
        await rebuildExamStatsForTeacher(teacherId, teacherSnapshot.data());
        return { processed: 1, teacherId };
    }

    const teachersSnapshot = await db.collection('users').where('role', 'in', ['teacher', 'admin']).get();
    let processed = 0;
    for (const snapshot of teachersSnapshot.docs) {
        await rebuildExamStatsForTeacher(snapshot.id, snapshot.data());
        processed += 1;
    }
    return { processed };
});

// ── LIVE CLASSROOM: Server-side reveal & scoring ──────────────────────────────
exports.revealLiveAnswers = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập');
    }

    const { roomCode } = request.data || {};
    if (!roomCode || typeof roomCode !== 'string') {
        throw new HttpsError('invalid-argument', 'Thiếu roomCode hợp lệ');
    }

    const roomRef = db.doc(`liveRooms/${roomCode}`);
    const keyRef = db.doc(`liveRooms/${roomCode}/private/answerKey`);
    const [roomSnap, keySnap] = await Promise.all([roomRef.get(), keyRef.get()]);

    if (!roomSnap.exists) throw new HttpsError('not-found', 'Không tìm thấy phòng');
    const room = roomSnap.data();
    if (room.teacherId !== request.auth.uid) throw new HttpsError('permission-denied', 'Bạn không phải chủ phòng');
    if (room.status !== 'question') throw new HttpsError('failed-precondition', 'Phòng không đang ở phase câu hỏi');

    const answerKeys = keySnap.exists ? (keySnap.data().keys || []) : [];
    const qIdx = room.currentQIdx;
    const q = room.questions?.[qIdx] || {};
    const answerKey = answerKeys[qIdx] || {};
    const correctAnswer = answerKey.correct_answer ?? null;
    const questionPoints = answerKey.points ?? q.points ?? 1;
    const questionType = answerKey.type ?? q.type ?? 'mcq';
    const qAnswers = room.answers?.[qIdx] || {};
    const duration = room.questionDuration || 30;
    const startMs = typeof room.questionStartAt?.toMillis === 'function'
        ? room.questionStartAt.toMillis() : Date.now() - duration * 1000;
    const liveMode = room.mode;
    const millionaireLadder = room.millionaire?.ladder || [];
    const currentStep = millionaireLadder[qIdx] || null;

    function defaultScore() {
        return { score: 0, correct: 0, wrong: 0, streak: 0, level: 0, safePrize: 0, safeLevel: 0, lastCorrectAtMs: 0, eliminatedAtLevel: 0 };
    }
    function isCorrect(answer) {
        if (questionType === 'mcq' || questionType === 'tf') return answer === correctAnswer;
        if (questionType === 'short_answer') return String(answer || '').trim().toLowerCase() === String(correctAnswer || '').trim().toLowerCase();
        return false;
    }
    function streakBonus(streak) {
        if (streak >= 5) return 100;
        if (streak >= 4) return 75;
        if (streak >= 3) return 50;
        return 0;
    }

    const newScores = { ...(room.scores || {}) };
    const newEliminated = [...(room.eliminated || [])];

    // Score players who answered
    Object.entries(qAnswers).forEach(([uid, data]) => {
        if (newEliminated.includes(uid)) return;
        const answerMs = typeof data.answeredAt?.toMillis === 'function'
            ? data.answeredAt.toMillis() : startMs + duration * 1000;
        const elapsed = Math.max(0, (answerMs - startMs) / 1000);
        const speedBonus = liveMode === 'speed'
            ? Math.max(0, Math.floor((duration - elapsed) / duration * 200)) : 0;
        const answer = (data && typeof data === 'object' && 'answer' in data) ? data.answer : data;
        const correct = isCorrect(answer);
        if (!newScores[uid]) newScores[uid] = defaultScore();

        if (correct) {
            if (liveMode === 'millionaire') {
                const nextLevel = qIdx + 1;
                const safePrize = currentStep?.isCheckpoint ? currentStep.amount : (newScores[uid].safePrize || 0);
                const safeLevel = currentStep?.isCheckpoint ? nextLevel : (newScores[uid].safeLevel || 0);
                newScores[uid] = { ...newScores[uid], score: currentStep?.amount || (newScores[uid].score || 0), correct: (newScores[uid].correct || 0) + 1, streak: (newScores[uid].streak || 0) + 1, level: nextLevel, safePrize, safeLevel, lastCorrectAtMs: answerMs };
            } else {
                const newStreak = (newScores[uid].streak || 0) + 1;
                const sb = (liveMode === 'classic' || liveMode === 'speed') ? streakBonus(newStreak) : 0;
                newScores[uid].score = (newScores[uid].score || 0) + questionPoints * 100 + speedBonus + sb;
                newScores[uid].correct = (newScores[uid].correct || 0) + 1;
                newScores[uid].streak = newStreak;
                newScores[uid].lastCorrectAtMs = answerMs;
            }
        } else {
            newScores[uid].wrong = (newScores[uid].wrong || 0) + 1;
            newScores[uid].streak = 0;
            if (liveMode === 'millionaire') {
                newScores[uid].score = newScores[uid].safePrize || 0;
                newScores[uid].eliminatedAtLevel = newScores[uid].level || 0;
                newScores[uid].lastCorrectAtMs = newScores[uid].lastCorrectAtMs || answerMs;
                if (!newEliminated.includes(uid)) newEliminated.push(uid);
            } else if (liveMode === 'golden_bell') {
                if (!newEliminated.includes(uid)) newEliminated.push(uid);
            }
        }
    });

    // Penalise no-answer players
    Object.keys(room.participants || {}).forEach(uid => {
        if (!qAnswers[uid] && !newEliminated.includes(uid)) {
            if (!newScores[uid]) newScores[uid] = defaultScore();
            newScores[uid].wrong = (newScores[uid].wrong || 0) + 1;
            newScores[uid].streak = 0;
            if (liveMode === 'millionaire') {
                newScores[uid].score = newScores[uid].safePrize || 0;
                newScores[uid].eliminatedAtLevel = newScores[uid].level || 0;
                if (!newEliminated.includes(uid)) newEliminated.push(uid);
            } else if (liveMode === 'golden_bell') {
                if (!newEliminated.includes(uid)) newEliminated.push(uid);
            }
        }
    });

    // Team scoring
    const updateData = {
        status: ((liveMode === 'golden_bell' || liveMode === 'millionaire') &&
            Object.keys(room.participants || {}).length - newEliminated.length <= 1) ? 'ended' : 'reveal',
        scores: newScores,
        eliminated: newEliminated,
        [`revealedCorrectAnswers.${qIdx}`]: correctAnswer,
    };
    if (room.teamMode && room.teams) {
        const newTeamScores = {};
        Object.entries(room.teams).forEach(([teamKey, memberUids]) => {
            newTeamScores[teamKey] = memberUids.reduce((sum, uid) => sum + (newScores[uid]?.score || 0), 0);
        });
        updateData.teamScores = newTeamScores;
    }

    await roomRef.update(updateData);
    return { success: true, status: updateData.status };
});

// ── LIVE CLASSROOM: Scheduled cleanup of ended/expired rooms ──────────────────
exports.cleanupExpiredLiveRooms = onSchedule({
    schedule: 'every day 04:00',
    timeZone: 'Asia/Ho_Chi_Minh',
}, async () => {
    const endedCutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const expiredCutoff = Timestamp.fromMillis(Date.now() - 6 * 60 * 60 * 1000);
    let deletedCount = 0;

    // Delete rooms that ended >24 hours ago
    const endedSnap = await db.collection('liveRooms')
        .where('status', '==', 'ended')
        .where('createdAt', '<=', endedCutoff)
        .limit(200).get();

    // Delete rooms with expired expiresAt
    const expiredSnap = await db.collection('liveRooms')
        .where('expiresAt', '<=', expiredCutoff)
        .limit(200).get();

    const allDocs = [...new Map([...endedSnap.docs, ...expiredSnap.docs].map(d => [d.id, d])).values()];

    if (allDocs.length > 0) {
        const batch = db.batch();
        allDocs.forEach(docSnap => {
            batch.delete(db.doc(`liveRooms/${docSnap.id}/private/answerKey`));
            batch.delete(docSnap.ref);
        });
        await batch.commit();
        deletedCount = allDocs.length;
    }

    console.log('cleanupExpiredLiveRooms completed', { deletedCount });
});