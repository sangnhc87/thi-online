/**
 * Starter exam seeded for every new teacher (2 MCQ + 2 T/F + 2 short_answer).
 * The exam is created once when the teacher has 0 exams on first login.
 */
import { addDoc, collection, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { buildExamSearchFields } from './search';

function th(text = '') {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}
function ch(letter, text) {
    return { letter, text, html: th(text) };
}

const STARTER_QUESTIONS = [
    /* ── 2 MCQ ─────────────────────────────────────────────── */
    {
        number: 1, order: 1, type: 'mcq',
        content_text: 'Kết quả của phép tính 12 × 8 là bao nhiêu?',
        content_html: th('Kết quả của phép tính 12 × 8 là bao nhiêu?'),
        choices: [ch('A', '84'), ch('B', '88'), ch('C', '96'), ch('D', '100')],
        correct_answer: 'C',
        explanation: '12 × 8 = 96',
        explanation_html: th('12 × 8 = 96'),
        difficulty: 1, points: 1, chapter: 'Chương 1 – Số học',
    },
    {
        number: 2, order: 2, type: 'mcq',
        content_text: 'Tam giác có ba cạnh bằng nhau được gọi là tam giác gì?',
        content_html: th('Tam giác có ba cạnh bằng nhau được gọi là tam giác gì?'),
        choices: [ch('A', 'Tam giác vuông'), ch('B', 'Tam giác đều'), ch('C', 'Tam giác cân'), ch('D', 'Tam giác nhọn')],
        correct_answer: 'B',
        explanation: 'Tam giác đều có 3 cạnh bằng nhau và 3 góc đều bằng 60°.',
        explanation_html: th('Tam giác đều có 3 cạnh bằng nhau và 3 góc đều bằng 60°.'),
        difficulty: 1, points: 1, chapter: 'Chương 2 – Hình học',
    },

    /* ── 2 Đúng/Sai ─────────────────────────────────────────── */
    {
        number: 3, order: 3, type: 'tf',
        content_text: 'Xét các phát biểu sau về số nguyên tố:',
        content_html: th('Xét các phát biểu sau về số nguyên tố:'),
        choices: [
            ch('a', 'Số 2 là số nguyên tố chẵn duy nhất.'),
            ch('b', 'Số 1 là số nguyên tố.'),
            ch('c', 'Mọi số nguyên tố lớn hơn 2 đều là số lẻ.'),
            ch('d', 'Số 9 là số nguyên tố vì 9 = 3 × 3.'),
        ],
        correct_answer: 'DSDS',
        explanation: 'a) Đúng. b) Sai – số 1 không phải số nguyên tố. c) Đúng. d) Sai – 9 = 3×3 nên là hợp số.',
        explanation_html: th('a) Đúng. b) Sai – số 1 không phải số nguyên tố. c) Đúng. d) Sai – 9 = 3×3 nên là hợp số.'),
        difficulty: 2, points: 1, chapter: 'Chương 1 – Số học',
    },
    {
        number: 4, order: 4, type: 'tf',
        content_text: 'Xét các phát biểu sau về hình học phẳng:',
        content_html: th('Xét các phát biểu sau về hình học phẳng:'),
        choices: [
            ch('a', 'Hình vuông là trường hợp đặc biệt của hình chữ nhật.'),
            ch('b', 'Hai đường thẳng song song thì cắt nhau tại một điểm.'),
            ch('c', 'Chu vi hình tròn bán kính r bằng 2πr.'),
            ch('d', 'Diện tích tam giác = đáy × chiều cao (không chia 2).'),
        ],
        correct_answer: 'DSDS',
        explanation: 'a) Đúng. b) Sai – song song thì không cắt nhau. c) Đúng. d) Sai – S = (đáy × chiều cao) / 2.',
        explanation_html: th('a) Đúng. b) Sai – song song thì không cắt nhau. c) Đúng. d) Sai – S = (đáy × chiều cao) / 2.'),
        difficulty: 2, points: 1, chapter: 'Chương 2 – Hình học',
    },

    /* ── 2 Điền số (short_answer) ────────────────────────────── */
    {
        number: 5, order: 5, type: 'short_answer',
        content_text: 'Tính: 125 ÷ 5 = ?',
        content_html: th('Tính: 125 ÷ 5 = ?'),
        choices: [],
        correct_answer: '25',
        explanation: '125 ÷ 5 = 25',
        explanation_html: th('125 ÷ 5 = 25'),
        difficulty: 1, points: 1, chapter: 'Chương 1 – Số học',
    },
    {
        number: 6, order: 6, type: 'short_answer',
        content_text: 'Một hình chữ nhật có chiều dài 8 cm và chiều rộng 5 cm. Diện tích là bao nhiêu cm²?',
        content_html: th('Một hình chữ nhật có chiều dài 8 cm và chiều rộng 5 cm. Diện tích là bao nhiêu cm²?'),
        choices: [],
        correct_answer: '40',
        explanation: 'S = dài × rộng = 8 × 5 = 40 cm²',
        explanation_html: th('S = dài × rộng = 8 × 5 = 40 cm²'),
        difficulty: 1, points: 1, chapter: 'Chương 2 – Hình học',
    },
];

/**
 * Creates the starter exam for a new teacher, then marks them as seeded.
 * @returns {Promise<string>} The created exam ID.
 */
export async function seedStarterExam(user, userProfile) {
    const title = 'Đề mẫu – Toán THCS (2 TN + 2 Đ/S + 2 điền số)';

    const examRef = await addDoc(collection(db, 'exams'), {
        title,
        subject: 'Toán',
        grade: 'THCS',
        teacherId: user.uid,
        teacherName: userProfile?.displayName || user.email || 'Giáo viên',
        status: 'draft',
        questionCount: STARTER_QUESTIONS.length,
        duration: 15,
        maxAttempts: 1,
        shuffleQuestions: false,
        shuffleChoices: false,
        showResult: true,
        sourceFormat: 'starter',
        sourceLabel: 'Đề mẫu khởi động',
        importQuality: {
            score: 100,
            questionCount: STARTER_QUESTIONS.length,
            validQuestions: STARTER_QUESTIONS.length,
            issueQuestions: [],
            warningCount: 0,
            teacherReviewed: true,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildExamSearchFields({ title, subject: 'Toán', grade: 'THCS', teacherName: userProfile?.displayName || user.email }),
    });

    const batch = writeBatch(db);
    STARTER_QUESTIONS.forEach((q) => {
        const qRef = doc(collection(db, 'exams', examRef.id, 'questions'));
        batch.set(qRef, q);
    });
    await batch.commit();

    // Mark so we don't seed again
    await updateDoc(doc(db, 'users', user.uid), { starterExamSeeded: true });

    return examRef.id;
}
