import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export async function logAuditEvent(payload) {
    if (!payload?.actorId || !payload?.action) return;

    await addDoc(collection(db, 'auditLogs'), {
        actorId: payload.actorId,
        actorRole: payload.actorRole || null,
        actorName: payload.actorName || null,
        action: payload.action,
        targetType: payload.targetType || null,
        targetId: payload.targetId || null,
        teacherId: payload.teacherId || null,
        studentId: payload.studentId || null,
        examId: payload.examId || null,
        metadata: payload.metadata || {},
        createdAt: serverTimestamp(),
    });
}