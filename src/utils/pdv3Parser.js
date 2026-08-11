const LATEX_BLOCK_REGEX = /\\begin\s*\{\s*(ex|vd|bt|dl|dn|tc)\s*\}\s*(\[[^\]]*\])?([\s\S]*?)\\end\s*\{\s*\1\s*\}/gim;
const QUESTION_MARKER_REGEX = /%%--\s*Câu\s+(\d+)\s*:?\s*--%%/gi;

function normalizeSource(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ');
}

function stripCommentsKeepMarkers(source) {
    return normalizeSource(source)
        .split('\n')
        .map((line) => {
            if (/^\s*%%--\s*Câu\s+\d+\s*:?\s*--%%/i.test(line)) {
                return line.trim();
            }

            if (/^\s*%/.test(line)) {
                return '';
            }

            return line.replace(/(^|[^\\])%.*$/, '$1');
        })
        .join('\n');
}

function cleanupText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, '    ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function getLineNumberFromIndex(source, index) {
    return source.slice(0, Math.max(index, 0)).split('\n').length;
}

function readBalancedBlock(text, startIndex, openChar = '{', closeChar = '}') {
    let cursor = startIndex;
    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor += 1;
    }

    if (text[cursor] !== openChar) {
        return null;
    }

    let depth = 1;
    for (let index = cursor + 1; index < text.length; index += 1) {
        if (text[index] === '\\') {
            index += 1;
            continue;
        }

        if (text[index] === openChar) {
            depth += 1;
        } else if (text[index] === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return {
                    startIndex: cursor,
                    endIndex: index,
                    content: text.slice(cursor + 1, index),
                };
            }
        }
    }

    return null;
}

function findCommand(text, commandNames) {
    let earliest = null;

    commandNames.forEach((commandName) => {
        const match = new RegExp(`\\\\${commandName}\\b`, 'i').exec(text);
        if (!match) {
            return;
        }

        if (!earliest || match.index < earliest.index) {
            earliest = {
                commandName,
                index: match.index,
                length: match[0].length,
            };
        }
    });

    return earliest;
}

function extractCommandArguments(text, commandNames, argumentCount, { allowOptionalBracket = false } = {}) {
    const command = findCommand(text, commandNames);
    if (!command) {
        return null;
    }

    let cursor = command.index + command.length;
    let optionalArgument = null;

    if (allowOptionalBracket) {
        const optionalBlock = readBalancedBlock(text, cursor, '[', ']');
        if (optionalBlock) {
            optionalArgument = optionalBlock.content;
            cursor = optionalBlock.endIndex + 1;
        }
    }

    const args = [];
    for (let count = 0; count < argumentCount; count += 1) {
        const block = readBalancedBlock(text, cursor, '{', '}');
        if (!block) {
            return null;
        }

        args.push(block.content);
        cursor = block.endIndex + 1;
    }

    return {
        name: command.commandName,
        start: command.index,
        end: cursor,
        args,
        optionalArgument,
    };
}

function removeRange(text, start, end) {
    return `${text.slice(0, start)}${text.slice(end)}`.trim();
}

function collectMarkers(source) {
    return [...source.matchAll(QUESTION_MARKER_REGEX)].map((match) => ({
        number: Number(match[1]),
        index: match.index,
    }));
}

function resolveQuestionNumber(markers, blockIndex, fallbackNumber) {
    const marker = [...markers].reverse().find((item) => item.index < blockIndex);
    return marker?.number || fallbackNumber;
}

function parseChoiceCommand(content, commandName, labels) {
    const command = extractCommandArguments(content, [commandName], labels.length);
    if (!command) {
        return null;
    }

    const choices = command.args.map((choiceText, index) => {
        const trimmed = cleanupText(choiceText);
        const isCorrect = /^\\True\b/i.test(trimmed);

        return {
            label: labels[index],
            text: cleanupText(trimmed.replace(/^\\True\b\s*/i, '').replace(/^\\False\b\s*/i, '')),
            isCorrect,
        };
    });

    return {
        choices,
        remaining: removeRange(content, command.start, command.end),
    };
}

function buildQuestionPayload({
    number,
    type,
    stem,
    choices = [],
    correctAnswer = null,
    explanation = null,
}) {
    return {
        number,
        type,
        content_text: stem,
        content_html: escapeHtml(stem),
        choices: choices.map((choice) => ({
            letter: choice.label,
            text: choice.text,
            html: escapeHtml(choice.text),
        })),
        correct_answer: correctAnswer,
        explanation,
        explanation_html: explanation ? escapeHtml(explanation) : null,
    };
}

function parseLatexBlock(content, { number, line, warnings }) {
    let working = cleanupText(content);
    let solution = '';

    const solutionCommand = extractCommandArguments(working, ['loigiai'], 1);
    if (solutionCommand) {
        solution = cleanupText(solutionCommand.args[0]);
        working = removeRange(working, solutionCommand.start, solutionCommand.end);
    }

    const trueFalse = parseChoiceCommand(working, 'choiceTF', ['a', 'b', 'c', 'd']);
    if (trueFalse) {
        const correctAnswer = trueFalse.choices.map((choice) => (choice.isCorrect ? 'D' : 'S')).join('');
        if (!trueFalse.choices.some((choice) => choice.isCorrect)) {
            warnings.push(`Dòng ${line}: Câu ${number} dạng đúng/sai chưa có mệnh đề nào được đánh dấu \\True.`);
        }

        return buildQuestionPayload({
            number,
            type: 'tf',
            stem: cleanupText(trueFalse.remaining),
            choices: trueFalse.choices,
            correctAnswer,
            explanation: solution || null,
        });
    }

    const multipleChoice = parseChoiceCommand(working, 'choice', ['A', 'B', 'C', 'D']);
    if (multipleChoice) {
        const correctChoices = multipleChoice.choices.filter((choice) => choice.isCorrect);
        if (correctChoices.length === 0) {
            warnings.push(`Dòng ${line}: Câu ${number} chưa có đáp án \\True.`);
        }
        if (correctChoices.length > 1) {
            warnings.push(`Dòng ${line}: Câu ${number} có nhiều hơn một đáp án \\True; hệ thống lấy ${correctChoices[0].label}.`);
        }

        return buildQuestionPayload({
            number,
            type: 'mcq',
            stem: cleanupText(multipleChoice.remaining),
            choices: multipleChoice.choices,
            correctAnswer: correctChoices[0]?.label || null,
            explanation: solution || null,
        });
    }

    const shortAnswer = extractCommandArguments(working, ['shortans', 'sh'], 1, { allowOptionalBracket: true });
    if (shortAnswer) {
        return buildQuestionPayload({
            number,
            type: 'short_answer',
            stem: cleanupText(removeRange(working, shortAnswer.start, shortAnswer.end)),
            correctAnswer: cleanupText(shortAnswer.args[0]),
            explanation: solution || null,
        });
    }

    return buildQuestionPayload({
        number,
        type: 'essay',
        stem: cleanupText(working),
        correctAnswer: solution || '',
        explanation: null,
    });
}

export function looksLikePdv3LatexSource(rawSource = '') {
    return /\\begin\s*\{\s*(ex|vd|bt|dl|dn|tc)\s*\}|\\choiceTF\b|\\choice\b|\\shortans\b|\\loigiai\b/i.test(String(rawSource || ''));
}

export function parsePdv3LatexSource(rawSource = '') {
    const source = stripCommentsKeepMarkers(rawSource);
    const matches = [...source.matchAll(LATEX_BLOCK_REGEX)];
    const markers = collectMarkers(source);
    const warnings = [];

    if (!matches.length) {
        return {
            questions: [],
            warnings: ['Không tìm thấy khối \\begin{ex} ... \\end{ex} hợp lệ trong nguồn hiện tại.'],
            sourceLabel: 'PDV3 / ex',
        };
    }

    const questions = matches.map((match, index) => {
        const number = resolveQuestionNumber(markers, match.index, index + 1);
        const line = getLineNumberFromIndex(source, match.index);
        return parseLatexBlock(match[3], { number, line, warnings });
    });

    return {
        questions,
        warnings,
        sourceLabel: 'PDV3 / ex',
    };
}