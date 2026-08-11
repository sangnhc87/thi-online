import { parseDocx, parseText } from './docxParser';
import { parseExcelFile } from './excelParser';
import { looksLikePdv3LatexSource, parsePdv3LatexSource } from './pdv3Parser';
import { getChoiceDisplayContent, getChoiceDisplayText } from './examSections';
import { parseTexContent } from './texParser';

function normalizeQuestions(questions = []) {
    return questions.map((question, index) => ({
        ...question,
        number: index + 1,
        choices: (question.choices || []).map((choice, choiceIndex) => {
            const text = getChoiceDisplayText(choice, question.type, choiceIndex);
            const content = choice.html ? getChoiceDisplayContent(choice, question.type, choiceIndex) : '';

            return {
                ...choice,
                text,
                html: content || text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            };
        }),
        content_html: question.content_html || (question.content_text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'),
        explanation_html: question.explanation_html || (question.explanation ? question.explanation.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') : null),
        resourceLinks: Array.isArray(question.resourceLinks) ? question.resourceLinks : [],
        sectionResourceLinks: Array.isArray(question.sectionResourceLinks) ? question.sectionResourceLinks : [],
    }));
}

async function parseTextFile(file, sourceFormat, sourceLabel) {
    const text = await file.text();
    const groupCount = (text.match(/^<\s*g(?:_[a-z0-9]+)?\s*>$/gim) || []).length;
    const warnings = [`File ${sourceLabel} được đọc theo chuẩn văn bản tron-de.`];
    if (groupCount > 0) {
        warnings.push(`Phat hien ${groupCount} nhom cau hoi kieu de Tieng Anh / theo phan.`);
    }
    return {
        questions: normalizeQuestions(parseText(text)),
        imageFiles: [],
        imageMap: {},
        warnings,
        sourceFormat,
        sourceLabel,
        examMeta: null,
    };
}

export function parseManualExamSource(text) {
    const source = String(text || '');
    const trimmed = source.trim();

    if (!trimmed) {
        return {
            questions: [],
            imageFiles: [],
            imageMap: {},
            warnings: [],
            sourceFormat: 'manual',
            sourceLabel: 'Soạn từ mã nguồn',
            examMeta: null,
        };
    }

    if (looksLikePdv3LatexSource(trimmed)) {
        const result = parsePdv3LatexSource(trimmed);
        return {
            questions: normalizeQuestions(result.questions),
            imageFiles: [],
            imageMap: {},
            warnings: result.warnings || [],
            sourceFormat: 'pdv3',
            sourceLabel: result.sourceLabel || 'PDV3 / ex',
            examMeta: null,
        };
    }

    const groupCount = (trimmed.match(/^<\s*g(?:_[a-z0-9]+)?\s*>$/gim) || []).length;
    const warnings = [];
    if (groupCount > 0) {
        warnings.push(`Phat hien ${groupCount} nhom cau hoi kieu de Tieng Anh / theo phan.`);
    }

    return {
        questions: normalizeQuestions(parseText(trimmed)),
        imageFiles: [],
        imageMap: {},
        warnings,
        sourceFormat: 'manual',
        sourceLabel: 'Văn bản thường',
        examMeta: null,
    };
}

// ── JSON parser ──────────────────────────────────────────────────────────────
function escHtmlSimple(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

async function parseJsonFile(file) {
    const text = await file.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('File JSON không hợp lệ. Hãy mở file bằng Notepad hoặc VS Code để kiểm tra cú pháp.');
    }

    // Support both a plain array and { questions: [...] }
    const rawList = Array.isArray(data)
        ? data
        : (data.questions || data.data || data.items || []);

    if (!Array.isArray(rawList) || rawList.length === 0) {
        throw new Error('Không tìm thấy danh sách câu hỏi. File JSON cần có trường "questions": [ ... ].');
    }

    const examMeta = !Array.isArray(data) ? {
        title: data.title || data.name || null,
        subject: data.subject || data.mon || null,
        duration: data.duration || data.time || null,
    } : null;

    const questions = rawList.map((q, i) => {
        const type = (['mcq', 'tf', 'short_answer', 'essay'].includes(String(q.type || '').toLowerCase())
            ? String(q.type).toLowerCase()
            : 'mcq');

        const contentText = String(q.content || q.question || q.text || q.stem || q.noidung || '');

        // Build content HTML — support embedded image or image URL
        let contentHtml = q.content_html || q.html || escHtmlSimple(contentText);
        if (q.image_url && typeof q.image_url === 'string') {
            contentHtml += `<br><img src="${q.image_url}" alt="" style="max-width:100%;border-radius:4px;" />`;
        }
        if (q.image && typeof q.image === 'string' && q.image.startsWith('data:')) {
            contentHtml += `<br><img src="${q.image}" alt="" style="max-width:100%;border-radius:4px;" />`;
        }

        // Build choices — support { letter, text } or { key, value } or just array of strings
        const rawChoices = q.choices || q.options || q.answers || [];
        const choices = rawChoices.map((c, ci) => {
            // Bare string shorthand: ["Đáp án A", "Đáp án B", ...]
            if (typeof c === 'string') {
                const letter = String.fromCharCode(65 + ci); // A, B, C …
                return { letter, text: c, html: escHtmlSimple(c) };
            }
            const letter = String(c.letter || c.key || c.id || String.fromCharCode(65 + ci)).toUpperCase();
            const text = String(c.text || c.content || c.value || c.noidung || '');
            let html = c.html || escHtmlSimple(text);
            if (c.image_url) html += `<img src="${c.image_url}" alt="" style="max-height:3em;vertical-align:middle;" />`;
            if (c.image && c.image.startsWith('data:')) html += `<img src="${c.image}" alt="" style="max-height:3em;vertical-align:middle;" />`;
            return { letter, text, html };
        });

        const correctAnswer = q.answer || q.correct_answer || q.correctAnswer || q.dapan || null;
        const explanation = q.explanation || q.solution || q.explain || q.loigiai || null;
        const explanationHtml = q.explanation_html || q.solution_html || (explanation ? escHtmlSimple(String(explanation)) : null);
        const points = Number(q.points || q.score || q.diem || 1) || 1;

        return {
            number: i + 1,
            type,
            content_text: contentText,
            content_html: contentHtml,
            choices,
            correct_answer: correctAnswer ? String(correctAnswer) : null,
            explanation: explanation ? String(explanation) : null,
            explanation_html: explanationHtml,
            points,
            resourceLinks: Array.isArray(q.resourceLinks) ? q.resourceLinks : [],
            sectionResourceLinks: Array.isArray(q.sectionResourceLinks) ? q.sectionResourceLinks : [],
        };
    });

    const warnings = [`Đã đọc ${questions.length} câu từ file JSON.`];
    if (examMeta?.title) warnings.push(`Tên đề từ JSON: "${examMeta.title}"`);
    const imgCount = questions.filter(q => q.content_html.includes('<img ')).length;
    if (imgCount > 0) warnings.push(`${imgCount} câu hỏi có ảnh từ URL (ảnh không được upload vào hệ thống, chỉ liên kết).`);

    return {
        questions: normalizeQuestions(questions),
        imageFiles: [],
        imageMap: {},
        warnings,
        sourceFormat: 'json',
        sourceLabel: 'JSON (.json)',
        examMeta,
    };
}

export async function parseImportedExamFile(file) {
    const extension = (file.name.split('.').pop() || '').toLowerCase();

    if (extension === 'docx') {
        const result = await parseDocx(file);
        return {
            ...result,
            questions: normalizeQuestions(result.questions),
            warnings: result.warnings || [],
            sourceFormat: 'docx',
            sourceLabel: 'Word (.docx)',
            examMeta: null,
        };
    }

    if (['txt', 'md'].includes(extension)) {
        return parseTextFile(file, extension, extension === 'txt' ? 'Text (.txt)' : 'Markdown/Text (.md)');
    }

    if (['xlsx', 'xls'].includes(extension)) {
        const result = await parseExcelFile(file);
        return { ...result, questions: normalizeQuestions(result.questions), examMeta: null };
    }

    if (['tex', 'latex'].includes(extension)) {
        const result = parseTexContent(await file.text());
        return { ...result, questions: normalizeQuestions(result.questions), examMeta: null };
    }

    if (extension === 'json') {
        return parseJsonFile(file);
    }

    throw new Error('Định dạng chưa được hỗ trợ. Hãy dùng .docx, .txt, .xlsx/.xls, .tex hoặc .json');
}


export const IMPORT_FILE_ACCEPT = '.docx,.txt,.md,.xlsx,.xls,.tex,.latex,.json';