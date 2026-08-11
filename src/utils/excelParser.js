import * as XLSX from 'xlsx';
import { parseText } from './docxParser';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function normalizeHeader(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function escapeHtml(value) {
    return (value || '')
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

const HEADER_ALIASES = {
    number: ['stt', 'so thu tu', 'number', 'no'],
    type: ['type', 'loai', 'question type', 'dang cau hoi'],
    content: ['question', 'content', 'noi dung', 'cau hoi', 'de bai'],
    answer: ['answer', 'correct answer', 'dap an', 'correct'],
    explanation: ['explanation', 'solution', 'loi giai', 'giai thich'],
    points: ['points', 'score', 'diem'],
    subject: ['subject', 'mon', 'mon hoc'],
    grade: ['grade', 'khoi', 'lop'],
    A: ['a', 'option a', 'dap an a', 'lua chon a'],
    B: ['b', 'option b', 'dap an b', 'lua chon b'],
    C: ['c', 'option c', 'dap an c', 'lua chon c'],
    D: ['d', 'option d', 'dap an d', 'lua chon d'],
    E: ['e', 'option e', 'dap an e', 'lua chon e'],
    F: ['f', 'option f', 'dap an f', 'lua chon f'],
    G: ['g', 'option g', 'dap an g', 'lua chon g'],
    H: ['h', 'option h', 'dap an h', 'lua chon h'],
    tfA: ['a statement', 'menh de a', 'a)', 'statement a'],
    tfB: ['b statement', 'menh de b', 'b)', 'statement b'],
    tfC: ['c statement', 'menh de c', 'c)', 'statement c'],
    tfD: ['d statement', 'menh de d', 'd)', 'statement d'],
};

function resolveHeaderMap(headerRow) {
    const normalized = headerRow.map(normalizeHeader);
    const result = {};

    Object.entries(HEADER_ALIASES).forEach(([key, aliases]) => {
        const index = normalized.findIndex((value) => aliases.includes(value));
        if (index >= 0) result[key] = index;
    });

    return result;
}

function inferQuestionType(row, headerMap) {
    const rawType = headerMap.type != null ? row[headerMap.type] : '';
    const normalized = normalizeHeader(rawType);

    if (['mcq', 'multiple choice', 'trac nghiem'].includes(normalized)) return 'mcq';
    if (['tf', 'true false', 'dung sai'].includes(normalized)) return 'tf';
    if (['short answer', 'short', 'tu luan ngan'].includes(normalized)) return 'short_answer';
    if (['essay', 'tu luan'].includes(normalized)) return 'essay';

    const hasChoices = LETTERS.some((letter) => headerMap[letter] != null && row[headerMap[letter]]);
    const hasTfStatements = ['tfA', 'tfB', 'tfC', 'tfD'].some((key) => headerMap[key] != null && row[headerMap[key]]);
    if (hasTfStatements) return 'tf';
    if (hasChoices) return 'mcq';
    return 'short_answer';
}

function buildChoicesFromRow(row, headerMap, type) {
    if (type === 'tf') {
        return ['tfA', 'tfB', 'tfC', 'tfD']
            .map((key, index) => {
                const cellIndex = headerMap[key];
                const text = cellIndex != null ? row[cellIndex] : '';
                if (!text) return null;
                return {
                    letter: String.fromCharCode(97 + index),
                    text: String(text).trim(),
                    html: escapeHtml(String(text).trim()),
                };
            })
            .filter(Boolean);
    }

    return LETTERS
        .map((letter) => {
            const cellIndex = headerMap[letter];
            const text = cellIndex != null ? row[cellIndex] : '';
            if (!text) return null;
            return {
                letter,
                text: String(text).trim(),
                html: escapeHtml(String(text).trim()),
            };
        })
        .filter(Boolean);
}

function rowToQuestion(row, headerMap, index) {
    const content = headerMap.content != null ? String(row[headerMap.content] || '').trim() : '';
    if (!content) return null;

    const type = inferQuestionType(row, headerMap);
    const choices = buildChoicesFromRow(row, headerMap, type);
    const answer = headerMap.answer != null ? String(row[headerMap.answer] || '').trim() : '';
    const explanation = headerMap.explanation != null ? String(row[headerMap.explanation] || '').trim() : '';

    return {
        number: headerMap.number != null && row[headerMap.number] ? Number(row[headerMap.number]) : index + 1,
        type,
        content_text: content,
        content_html: escapeHtml(content),
        choices,
        correct_answer: answer || null,
        explanation: explanation || null,
        explanation_html: explanation ? escapeHtml(explanation) : null,
        points: headerMap.points != null && row[headerMap.points] ? Number(row[headerMap.points]) || 1 : 1,
    };
}

function looksLikeStructuredSheet(rows, headerMap) {
    if (!rows.length) return false;
    if (headerMap.content != null) return true;
    return LETTERS.some((letter) => headerMap[letter] != null) || ['tfA', 'tfB', 'tfC', 'tfD'].some((key) => headerMap[key] != null);
}

export async function parseExcelFile(file) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const warnings = [];
    const questions = [];

    workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!rows.length) return;

        const headerMap = resolveHeaderMap(rows[0]);
        if (looksLikeStructuredSheet(rows, headerMap)) {
            rows.slice(1).forEach((row, index) => {
                const question = rowToQuestion(row, headerMap, questions.length + index);
                if (question) questions.push(question);
            });
            return;
        }

        const sheetText = rows
            .map((row) => row.map((cell) => String(cell || '').trim()).filter(Boolean).join(' '))
            .filter(Boolean)
            .join('\n');

        if (sheetText) {
            const parsed = parseText(sheetText);
            parsed.forEach((question) => questions.push(question));
            warnings.push(`Sheet "${sheetName}" được đọc theo chuẩn văn bản.`);
        }
    });

    return {
        questions: questions.map((question, index) => ({ ...question, number: index + 1 })),
        imageFiles: [],
        imageMap: {},
        warnings,
        sourceFormat: 'excel',
        sourceLabel: 'Excel (.xlsx/.xls)',
    };
}