import { parseText } from './docxParser';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function stripComment(line) {
    let escaped = false;
    let result = '';
    for (const char of line) {
        if (char === '%' && !escaped) break;
        result += char;
        escaped = char === '\\' && !escaped;
    }
    return result;
}

function unwrapCommonCommands(value) {
    let output = value || '';
    const wrappers = ['textbf', 'textit', 'emph', 'underline', 'mathrm', 'mathbf', 'operatorname'];

    wrappers.forEach((command) => {
        const regex = new RegExp(String.raw`\\${command}\{([^{}]*)\}`, 'g');
        output = output.replace(regex, '$1');
    });

    output = output
        .replace(/\\item\s*/g, '')
        .replace(/\\par\s*/g, '\n')
        .replace(/\\\\/g, '\n')
        .replace(/~+/g, ' ')
        .replace(/\\begin\{[^}]+\}/g, '')
        .replace(/\\end\{[^}]+\}/g, '')
        .replace(/\\choice\s*/g, '')
        .replace(/\\CorrectChoice\s*/g, '')
        .replace(/\\True\s*/g, '')
        .replace(/\\False\s*/g, '')
        .trim();

    return output;
}

function escapeHtml(value) {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function finalizeQuestion(question, questions) {
    if (!question) return;
    question.number = questions.length + 1;
    question.content_text = question.content_text.trim();
    question.content_html = escapeHtml(question.content_text);
    question.choices = question.choices.map((choice) => ({
        letter: choice.letter,
        text: choice.text.trim(),
        html: escapeHtml(choice.text.trim()),
    }));
    if (question.explanation) question.explanation_html = escapeHtml(question.explanation.trim());
    if (!question.type) question.type = question.choices.length ? 'mcq' : 'short_answer';
    questions.push(question);
}

export function parseTexContent(input) {
    const cleaned = input
        .split('\n')
        .map(stripComment)
        .join('\n');

    if (/(?:Câu|Question|Q)\s*\d+/i.test(cleaned)) {
        return {
            questions: parseText(cleaned).map((question, index) => ({ ...question, number: index + 1 })),
            imageFiles: [],
            imageMap: {},
            warnings: ['File .tex được đọc theo chuẩn văn bản tron-de.'],
            sourceFormat: 'tex',
            sourceLabel: 'LaTeX (.tex)',
        };
    }

    const lines = cleaned.split('\n');
    const questions = [];
    const warnings = [];
    let current = null;
    let inSolution = false;
    let choiceIndex = 0;

    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;

        const questionMatch = line.match(/^\\question(?:\[[^\]]*\])?\s*(.*)$/i);
        if (questionMatch) {
            finalizeQuestion(current, questions);
            current = {
                type: null,
                content_text: unwrapCommonCommands(questionMatch[1]),
                content_html: '',
                choices: [],
                correct_answer: null,
                explanation: null,
                explanation_html: null,
            };
            inSolution = false;
            choiceIndex = 0;
            return;
        }

        if (!current) return;

        if (/^\\begin\{solution\}/i.test(line)) {
            inSolution = true;
            return;
        }

        if (/^\\end\{solution\}/i.test(line)) {
            inSolution = false;
            return;
        }

        const answerMatch = line.match(/^\\answer(?:choice)?\{([^}]*)\}/i);
        if (answerMatch) {
            current.correct_answer = unwrapCommonCommands(answerMatch[1]).trim() || current.correct_answer;
            return;
        }

        const choiceMatch = line.match(/^\\(CorrectChoice|choice)\s*(.*)$/);
        if (choiceMatch) {
            current.type = 'mcq';
            const letter = LETTERS[choiceIndex] || String(choiceIndex + 1);
            const text = unwrapCommonCommands(choiceMatch[2]);
            current.choices.push({ letter, text });
            if (choiceMatch[1] === 'CorrectChoice') current.correct_answer = letter;
            choiceIndex += 1;
            return;
        }

        const trueFalseMatch = line.match(/^\\(True|False)\s*(.*)$/i);
        if (trueFalseMatch) {
            current.type = 'tf';
            const letter = String.fromCharCode(97 + current.choices.length);
            current.choices.push({ letter, text: unwrapCommonCommands(trueFalseMatch[2]) });
            current.correct_answer = (current.correct_answer || '') + (trueFalseMatch[1].toLowerCase() === 'true' ? 'D' : 'S');
            return;
        }

        if (inSolution) {
            current.explanation = [current.explanation, unwrapCommonCommands(line)].filter(Boolean).join('\n');
            return;
        }

        current.content_text = [current.content_text, unwrapCommonCommands(line)].filter(Boolean).join('\n');
    });

    finalizeQuestion(current, questions);

    if (!questions.length) {
        const fallback = parseText(cleaned);
        return {
            questions: fallback.map((question, index) => ({ ...question, number: index + 1 })),
            imageFiles: [],
            imageMap: {},
            warnings: ['File .tex được fallback sang chuẩn văn bản.'],
            sourceFormat: 'tex',
            sourceLabel: 'LaTeX (.tex)',
        };
    }

    warnings.push('Hỗ trợ chuẩn \\question, \\choice, \\CorrectChoice, solution và fallback tron-de text.');

    return {
        questions,
        imageFiles: [],
        imageMap: {},
        warnings,
        sourceFormat: 'tex',
        sourceLabel: 'LaTeX (.tex)',
    };
}