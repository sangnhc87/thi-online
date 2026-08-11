import { DEFAULT_GAMIFICATION } from './gamification';
import { buildExamSearchFields } from './search';

const SAMPLE_PUBLISHED_AT = new Date('2026-03-28T09:00:00.000Z');

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function toHtml(value = '') {
    return escapeHtml(value).replace(/\n/g, '<br>');
}

function createChoice(letter, text) {
    return {
        letter,
        text,
        html: toHtml(text),
    };
}

function createSectionMeta({
    id,
    order,
    tag = 'g',
    title,
    contextText = '',
    shuffleQuestions = true,
    shuffleChoices = true,
    fixedPosition = false,
}) {
    return {
        sectionId: id,
        sectionOrder: order,
        sectionTag: tag,
        sectionTitle: title,
        sectionContextText: contextText,
        sectionContextHtml: toHtml(contextText),
        sectionShuffleQuestions: shuffleQuestions,
        sectionShuffleChoices: shuffleChoices,
        sectionFixedPosition: fixedPosition,
    };
}

function createMcqQuestion({
    number,
    content,
    choices,
    correct,
    explanation,
    points = 1,
    section,
}) {
    return {
        number,
        order: number,
        type: 'mcq',
        content_text: content,
        content_html: toHtml(content),
        choices: choices.map(([letter, text]) => createChoice(letter, text)),
        correct_answer: correct,
        explanation: explanation || null,
        explanation_html: explanation ? toHtml(explanation) : null,
        points,
        ...(section || {}),
    };
}

function createShortAnswerQuestion({
    number,
    content,
    answer,
    explanation,
    points = 1,
    section,
}) {
    return {
        number,
        order: number,
        type: 'short_answer',
        content_text: content,
        content_html: toHtml(content),
        choices: [],
        correct_answer: answer,
        explanation: explanation || null,
        explanation_html: explanation ? toHtml(explanation) : null,
        points,
        ...(section || {}),
    };
}

function buildSampleExam({
    id,
    title,
    subject,
    grade,
    duration,
    summary,
    highlights = [],
    sampleCategory,
    questions,
    shuffleQuestions = true,
    shuffleChoices = true,
    gamification = {},
}) {
    return {
        id,
        title,
        subject,
        grade,
        duration,
        summary,
        highlights,
        sampleCategory,
        sampleCategoryLabel: sampleCategory === 'english' ? 'Tiếng Anh' : 'Toán',
        questionCount: questions.length,
        maxAttempts: 1,
        shuffleQuestions,
        shuffleChoices,
        showResult: true,
        antiCheat: null,
        gamification: {
            ...DEFAULT_GAMIFICATION,
            ...gamification,
        },
        ownerAdminId: 'system-samples',
        ownerAdminName: 'Thi Online',
        ownerRole: 'system',
        sourceFormat: 'sample-library',
        sourceLabel: 'Kho đề mẫu hệ thống',
        published: true,
        publishedAt: SAMPLE_PUBLISHED_AT,
        updatedAt: SAMPLE_PUBLISHED_AT,
        importCount: 0,
        assetSummary: { imageCount: 0, imageBytes: 0 },
        questions,
        ...buildExamSearchFields({
            title,
            subject,
            grade,
            teacherName: 'Thi Online',
        }),
    };
}

const englishReadingSection = createSectionMeta({
    id: 'english-reading-passage',
    order: 1,
    tag: 'g',
    title: 'Reading passage',
    contextText: 'Read the following passage and choose the best answer for each question.\n\nGreen School Day is a monthly event at Nguyen Du School. Students bring reusable bottles, collect old paper, and plant small trees around the playground. At first, some students thought the event would take too much time. However, after a few weeks, many classes became more excited because the school looked cleaner and greener.',
    shuffleQuestions: true,
    shuffleChoices: true,
});

const englishGrammarSection = createSectionMeta({
    id: 'english-grammar-context',
    order: 2,
    tag: 'g_codinhdapan',
    title: 'Grammar and vocabulary',
    contextText: 'Choose the best answer to complete each sentence.',
    shuffleQuestions: true,
    shuffleChoices: false,
});

const englishNoticeSection = createSectionMeta({
    id: 'english-notice-order',
    order: 1,
    tag: 'g_khongtron',
    title: 'Notices and school rules',
    contextText: 'Read the notice below and answer the questions in order.\n\nLibrary Notice\nStudents may borrow two books at a time. All borrowed books must be returned within seven days. Food and drinks are not allowed in the reading area.',
    shuffleQuestions: false,
    shuffleChoices: true,
});

const englishSentenceSection = createSectionMeta({
    id: 'english-sentence-completion',
    order: 2,
    tag: 'g_codinhdapan',
    title: 'Sentence completion',
    contextText: 'Choose the best answer to complete each sentence.',
    shuffleQuestions: true,
    shuffleChoices: false,
});

const englishShortResponseSection = createSectionMeta({
    id: 'english-short-response',
    order: 3,
    tag: 'g_essay',
    title: 'Short response',
    contextText: 'Write one suitable word or phrase.',
    shuffleQuestions: false,
    shuffleChoices: false,
});

export const BUILT_IN_SAMPLE_EXAMS = [
    buildSampleExam({
        id: 'sample-math-algebra-10',
        title: 'Đề mẫu Toán 10 - Phương trình và hàm số cơ bản',
        subject: 'Toán',
        grade: 'Lớp 10',
        duration: 25,
        sampleCategory: 'math',
        summary: 'Bộ đề mẫu ngắn để giáo viên Toán nhập nhanh vào kho riêng, sửa theo lớp học và phát hành ngay.',
        highlights: ['6 trắc nghiệm + 2 tự luận ngắn', 'Hợp để kiểm tra đầu giờ', 'Có lời giải ngắn từng câu'],
        questions: [
            createMcqQuestion({
                number: 1,
                content: 'Giải phương trình \\(2x + 3 = 11\\).',
                choices: [['A', '2'], ['B', '3'], ['C', '4'], ['D', '5']],
                correct: 'C',
                explanation: 'Chuyển vế: 2x = 8 nên x = 4.',
            }),
            createMcqQuestion({
                number: 2,
                content: 'Tập xác định của hàm số \\(y = \\frac{1}{x - 1}\\) là',
                choices: [['A', 'Mọi số thực x'], ['B', '\\(x \\ne 1\\)'], ['C', '\\(x > 1\\)'], ['D', '\\(x < 1\\)']],
                correct: 'B',
                explanation: 'Mẫu số khác 0 nên x không được bằng 1.',
            }),
            createMcqQuestion({
                number: 3,
                content: 'Cho \\(f(x) = 2x^2 - 1\\). Giá trị của \\(f(2)\\) bằng',
                choices: [['A', '5'], ['B', '6'], ['C', '7'], ['D', '8']],
                correct: 'C',
                explanation: 'f(2) = 2 . 2^2 - 1 = 8 - 1 = 7.',
            }),
            createMcqQuestion({
                number: 4,
                content: 'Phương trình \\(x^2 - 5x + 6 = 0\\) có hai nghiệm là',
                choices: [['A', '1 và 6'], ['B', '2 và 3'], ['C', '-2 và -3'], ['D', '0 và 6']],
                correct: 'B',
                explanation: 'Phân tích thành (x - 2)(x - 3) = 0.',
            }),
            createMcqQuestion({
                number: 5,
                content: 'Trung điểm của đoạn thẳng nối A(1; 2) và B(5; 6) là',
                choices: [['A', '(3; 4)'], ['B', '(2; 4)'], ['C', '(3; 3)'], ['D', '(6; 8)']],
                correct: 'A',
                explanation: 'Lấy trung bình từng tọa độ: ((1+5)/2; (2+6)/2) = (3; 4).',
            }),
            createMcqQuestion({
                number: 6,
                content: 'Hệ số góc của đường thẳng đi qua hai điểm (0; 1) và (2; 5) là',
                choices: [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']],
                correct: 'B',
                explanation: 'Hệ số góc = (5 - 1) / (2 - 0) = 2.',
            }),
            createShortAnswerQuestion({
                number: 7,
                content: 'Nghiệm dương của phương trình \\(x^2 = 49\\) là bao nhiêu?',
                answer: '7',
                explanation: 'Hai nghiệm là -7 và 7, nghiệm dương là 7.',
            }),
            createShortAnswerQuestion({
                number: 8,
                content: 'Tính giá trị của \\(3^2 + 4^2\\).',
                answer: '25',
                explanation: '3^2 + 4^2 = 9 + 16 = 25.',
            }),
        ],
    }),
    buildSampleExam({
        id: 'sample-math-sequences-11',
        title: 'Đề mẫu Toán 11 - Lượng giác và dãy số',
        subject: 'Toán',
        grade: 'Lớp 11',
        duration: 25,
        sampleCategory: 'math',
        summary: 'Mẫu ngắn để giáo viên Toán có sẵn một bộ gợi ý về lượng giác, cấp số và hình học tọa độ.',
        highlights: ['5 trắc nghiệm + 2 tự luận ngắn', 'Hợp với bài tập luyện nhanh', 'Nội dung dễ sửa lại theo chương'],
        questions: [
            createMcqQuestion({
                number: 1,
                content: 'Giá trị của \\(\\sin 30^\\circ\\) là',
                choices: [['A', '\\(\\frac{1}{2}\\)'], ['B', '\\(\\frac{\\sqrt{2}}{2}\\)'], ['C', '\\(\\frac{\\sqrt{3}}{2}\\)'], ['D', '1']],
                correct: 'A',
                explanation: 'Công thức cơ bản: sin 30 độ = 1/2.',
            }),
            createMcqQuestion({
                number: 2,
                content: 'Giá trị của \\(\\cos 60^\\circ\\) là',
                choices: [['A', '0'], ['B', '\\(\\frac{1}{2}\\)'], ['C', '\\(\\frac{\\sqrt{2}}{2}\\)'], ['D', '\\(\\frac{\\sqrt{3}}{2}\\)']],
                correct: 'B',
                explanation: 'cos 60 độ = 1/2.',
            }),
            createMcqQuestion({
                number: 3,
                content: 'Trong cấp số cộng có \\(u_1 = 2\\), công sai \\(d = 3\\). Giá trị của \\(u_4\\) là',
                choices: [['A', '8'], ['B', '9'], ['C', '10'], ['D', '11']],
                correct: 'D',
                explanation: 'u4 = u1 + 3d = 2 + 3.3 = 11.',
            }),
            createMcqQuestion({
                number: 4,
                content: 'Trong cấp số nhân có \\(u_1 = 3\\), công bội \\(q = 2\\). Giá trị của \\(u_3\\) là',
                choices: [['A', '6'], ['B', '9'], ['C', '12'], ['D', '15']],
                correct: 'C',
                explanation: 'u3 = u1 . q^2 = 3 . 4 = 12.',
            }),
            createMcqQuestion({
                number: 5,
                content: 'Phương trình nào là đường tròn tâm O bán kính 3?',
                choices: [['A', 'x + y = 3'], ['B', '\\(x^2 + y^2 = 9\\)'], ['C', '\\(x^2 + y^2 = 3\\)'], ['D', '\\((x - 3)^2 + y^2 = 9\\)']],
                correct: 'B',
                explanation: 'Đường tròn tâm O bán kính R có dạng x^2 + y^2 = R^2.',
            }),
            createMcqQuestion({
                number: 6,
                content: 'Cho A(1; 2), B(4; 6). Tọa độ vectơ \\(\\overrightarrow{AB}\\) là',
                choices: [['A', '(3; 4)'], ['B', '(5; 8)'], ['C', '(1; 2)'], ['D', '(4; 6)']],
                correct: 'A',
                explanation: 'Lấy B - A = (4 - 1; 6 - 2) = (3; 4).',
            }),
            createShortAnswerQuestion({
                number: 7,
                content: 'Tổng của 5 số nguyên dương đầu tiên bằng bao nhiêu?',
                answer: '15',
                explanation: '1 + 2 + 3 + 4 + 5 = 15.',
            }),
        ],
    }),
    buildSampleExam({
        id: 'sample-english-reading-10',
        title: 'Đề mẫu Tiếng Anh 10 - Reading và grammar theo section',
        subject: 'Tiếng Anh',
        grade: 'Lớp 10',
        duration: 20,
        sampleCategory: 'english',
        summary: 'Mẫu đề theo section dành cho giáo viên Anh: có passage, section tag và giữ cấu trúc khi học sinh làm bài.',
        highlights: ['Có section reading + grammar', 'Mẫu tag g và g_codinhdapan', 'Hợp để sửa thành đề kiểm tra ngắn'],
        questions: [
            createMcqQuestion({
                number: 1,
                section: englishReadingSection,
                content: 'What did students bring to Green School Day?',
                choices: [['A', 'Reusable bottles'], ['B', 'Sports shoes'], ['C', 'Musical instruments'], ['D', 'New uniforms']],
                correct: 'A',
                explanation: 'The passage says students bring reusable bottles.',
            }),
            createMcqQuestion({
                number: 2,
                section: englishReadingSection,
                content: 'Why were some students unsure at first?',
                choices: [['A', 'They disliked trees'], ['B', 'They thought the event would take too much time'], ['C', 'They had no teacher'], ['D', 'They wanted to stay home']],
                correct: 'B',
                explanation: 'They first thought the event would take too much time.',
            }),
            createMcqQuestion({
                number: 3,
                section: englishReadingSection,
                content: 'What changed after a few weeks?',
                choices: [['A', 'The playground got smaller'], ['B', 'The school became noisier'], ['C', 'Many classes became more excited'], ['D', 'Students stopped collecting paper']],
                correct: 'C',
                explanation: 'The passage says many classes became more excited.',
            }),
            createMcqQuestion({
                number: 4,
                section: englishReadingSection,
                content: 'The word "greener" is closest in meaning to',
                choices: [['A', 'More crowded'], ['B', 'More environmentally friendly'], ['C', 'More expensive'], ['D', 'More traditional']],
                correct: 'B',
                explanation: 'Greener here means more friendly to the environment.',
            }),
            createMcqQuestion({
                number: 5,
                section: englishGrammarSection,
                content: 'If every class ____ one tree, the schoolyard will have more shade.',
                choices: [['A', 'plants'], ['B', 'plant'], ['C', 'planted'], ['D', 'planting']],
                correct: 'A',
                explanation: 'With "every class" in a type 1 conditional, the verb is "plants".',
            }),
            createMcqQuestion({
                number: 6,
                section: englishGrammarSection,
                content: 'Students bring reusable bottles ____ reduce plastic waste.',
                choices: [['A', 'to'], ['B', 'for'], ['C', 'at'], ['D', 'with']],
                correct: 'A',
                explanation: '"To" is used to express purpose.',
            }),
            createMcqQuestion({
                number: 7,
                section: englishGrammarSection,
                content: 'The club members were proud ____ their small project.',
                choices: [['A', 'in'], ['B', 'on'], ['C', 'of'], ['D', 'with']],
                correct: 'C',
                explanation: 'The correct collocation is "proud of".',
            }),
        ],
    }),
    buildSampleExam({
        id: 'sample-english-notice-11',
        title: 'Đề mẫu Tiếng Anh 11 - Notice, rules và short response',
        subject: 'Tiếng Anh',
        grade: 'Lớp 11',
        duration: 18,
        sampleCategory: 'english',
        summary: 'Mẫu English khác biệt hơn để giáo viên Anh có sẵn notice section, sentence completion và short response.',
        highlights: ['Có tag g_khongtron và g_essay', 'Mẫu notice / school rules', 'Nhập xong là có thể sửa thành đề riêng'],
        questions: [
            createMcqQuestion({
                number: 1,
                section: englishNoticeSection,
                content: 'How many books may students borrow at a time?',
                choices: [['A', 'One'], ['B', 'Two'], ['C', 'Three'], ['D', 'Four']],
                correct: 'B',
                explanation: 'The notice says students may borrow two books at a time.',
            }),
            createMcqQuestion({
                number: 2,
                section: englishNoticeSection,
                content: 'When must borrowed books be returned?',
                choices: [['A', 'The same day'], ['B', 'Within seven days'], ['C', 'After one month'], ['D', 'At the end of the year']],
                correct: 'B',
                explanation: 'Borrowed books must be returned within seven days.',
            }),
            createMcqQuestion({
                number: 3,
                section: englishNoticeSection,
                content: 'What is not allowed in the reading area?',
                choices: [['A', 'Notebooks'], ['B', 'School bags'], ['C', 'Food and drinks'], ['D', 'Dictionaries']],
                correct: 'C',
                explanation: 'The notice clearly states that food and drinks are not allowed.',
            }),
            createMcqQuestion({
                number: 4,
                section: englishSentenceSection,
                content: 'The word "borrow" is closest in meaning to',
                choices: [['A', 'Buy something forever'], ['B', 'Take something for a short time'], ['C', 'Break something'], ['D', 'Hide something']],
                correct: 'B',
                explanation: 'To borrow means to take something for a limited time and return it later.',
            }),
            createMcqQuestion({
                number: 5,
                section: englishSentenceSection,
                content: 'Students should speak quietly ____ others can study well.',
                choices: [['A', 'although'], ['B', 'so that'], ['C', 'but'], ['D', 'unless']],
                correct: 'B',
                explanation: '"So that" introduces purpose.',
            }),
            createShortAnswerQuestion({
                number: 6,
                section: englishShortResponseSection,
                content: 'Complete the sentence with one word: The library is a ____ place to read.',
                answer: 'quiet',
                explanation: 'A suitable one-word answer is "quiet".',
            }),
        ],
    }),
];

export function getBuiltInSampleExamById(sampleExamId) {
    return BUILT_IN_SAMPLE_EXAMS.find((exam) => exam.id === sampleExamId) || null;
}