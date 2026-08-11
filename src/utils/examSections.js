const TYPE_SECTION_LABELS = {
    mcq: 'Phan trac nghiem',
    tf: 'Phan dung / sai',
    short_answer: 'Phan tra loi ngan',
    essay: 'Phan tu luan',
};

function normalizeTag(tag = 'g') {
    return (tag || 'g').toString().trim().toLowerCase();
}

function hasExplicitSection(question = {}) {
    return Boolean(
        question.sectionId
        || question.sectionTag
        || question.sectionContextText
        || question.sectionContextHtml,
    );
}

function shouldGroupByType(questions = []) {
    if (questions.some((question) => hasExplicitSection(question))) return false;
    const types = new Set((questions || []).map((question) => question?.type).filter(Boolean));
    return types.size > 1;
}

function createTypeMeta(type = 'mcq') {
    return {
        key: `type:${type || 'other'}`,
        title: TYPE_SECTION_LABELS[type] || 'Phan cau hoi',
        tag: null,
        contextText: '',
        contextHtml: '',
        shuffleQuestions: true,
        shuffleChoices: type !== 'essay',
        fixedPosition: false,
        questionLimit: null,
        explicit: false,
        type,
    };
}

function createQuestionMeta(question = {}, index = 0) {
    if (!hasExplicitSection(question)) {
        return {
            key: '__default',
            title: null,
            tag: null,
            contextText: '',
            contextHtml: '',
            shuffleQuestions: true,
            shuffleChoices: question.type !== 'essay',
            fixedPosition: false,
            questionLimit: question.sectionQuestionLimit ?? null,
            explicit: false,
            type: question.type || null,
            sectionId: null,
            sectionOrder: index,
        };
    }

    return {
        key: `section:${question.sectionId || `${question.sectionTag || 'section'}:${question.sectionOrder ?? index}`}`,
        title: question.sectionTitle || null,
        tag: question.sectionTag || null,
        contextText: question.sectionContextText || '',
        contextHtml: question.sectionContextHtml || '',
        shuffleQuestions: question.sectionShuffleQuestions !== false,
        shuffleChoices: question.sectionShuffleChoices !== false,
        fixedPosition: Boolean(question.sectionFixedPosition),
        questionLimit: Number(question.sectionQuestionLimit) > 0 ? Number(question.sectionQuestionLimit) : null,
        explicit: true,
        type: question.type || null,
        sectionId: question.sectionId || null,
        sectionOrder: question.sectionOrder ?? index,
    };
}

function shuffleArray(items = []) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
    }
    return next;
}

function getDisplayLetter(type = 'mcq', index = 0) {
    if (type === 'tf') return String.fromCharCode(97 + index);
    return String.fromCharCode(65 + index);
}

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitLeadingHtml(value = '') {
    const source = String(value || '');
    const match = source.match(/^((?:<[^>]+>\s*)*)([\s\S]*)$/);
    return {
        prefix: match?.[1] || '',
        body: match?.[2] || source,
    };
}

function buildChoiceMarkerRegex(choice = {}, questionType = 'mcq', index = 0) {
    const baseLetter = String(
        choice.originLetter
        || choice.displayLetter
        || choice.letter
        || getDisplayLetter(questionType, index)
        || '',
    ).trim();

    if (!baseLetter) return null;

    const variants = [...new Set([
        baseLetter,
        baseLetter.toUpperCase(),
        baseLetter.toLowerCase(),
    ])]
        .filter(Boolean)
        .map(escapeRegExp);

    if (!variants.length) return null;
    return new RegExp(`^\\s*(?:${variants.join('|')})\\s*[.):]\\s*`, 'i');
}

export function stripChoiceLabelPrefix(value = '', choice = {}, questionType = 'mcq', index = 0) {
    const regex = buildChoiceMarkerRegex(choice, questionType, index);
    if (!regex) return String(value || '');

    const { prefix, body } = splitLeadingHtml(value);
    const normalizedBody = body
        .replace(/^(?:&nbsp;|&#160;|\s)*/i, '')
        .replace(regex, '')
        .replace(/^(?:&nbsp;|&#160;|\s)*/i, '');

    return `${prefix}${normalizedBody}`;
}

export function getChoiceDisplayText(choice = {}, questionType = 'mcq', index = 0) {
    return stripChoiceLabelPrefix(choice.text || '', choice, questionType, index);
}

export function getChoiceDisplayContent(choice = {}, questionType = 'mcq', index = 0) {
    return stripChoiceLabelPrefix(choice.html || choice.text || '', choice, questionType, index);
}

export function stripQuestionNumberPrefix(value = '', question = {}, index = 0) {
    const questionNumber = Number(question?.number || index + 1);
    if (!questionNumber) return String(value || '');

    const { prefix, body } = splitLeadingHtml(value);
    const regex = new RegExp(
        `^\\s*(?:(?:Câu|Question)\\s*${questionNumber}|Q\\s*${questionNumber}|\\(Q\\s*${questionNumber}\\))\\s*[.:)]\\s*(?:&nbsp;|&#160;|\\s)*`,
        'i',
    );

    return `${prefix}${body.replace(regex, '')}`;
}

function normalizeChoicesForDelivery(question = {}) {
    return (question.choices || []).map((choice, index) => {
        const originLetter = choice.originLetter || choice.letter || getDisplayLetter(question.type, index);
        const displayLetter = getDisplayLetter(question.type, index);

        return {
            ...choice,
            originLetter,
            letter: displayLetter,
            displayLetter,
            isCorrect: Boolean(choice.isCorrect || (question.correct_answer && originLetter === question.correct_answer)),
        };
    });
}

export function getSectionSettings(tag = 'g') {
    const normalizedTag = normalizeTag(tag);
    let shuffleQuestions = true;
    let shuffleChoices = true;
    let fixedPosition = false;
    let questionLimit = null;

    const limitMatch = normalizedTag.match(/(?:^|_)lay(\d+)(?:_|$)/i);
    if (limitMatch) {
        const parsedLimit = Number(limitMatch[1]);
        questionLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
    }

    if (normalizedTag.includes('codinhtoanbo')) {
        shuffleQuestions = false;
        shuffleChoices = false;
        fixedPosition = true;
    } else {
        if (normalizedTag.includes('khongtron')) shuffleQuestions = false;
        if (normalizedTag.includes('codinhdapan') || normalizedTag.includes('essay')) shuffleChoices = false;
        if (normalizedTag.includes('codinh')) fixedPosition = true;
    }

    return {
        tag: normalizedTag,
        shuffleQuestions,
        shuffleChoices,
        fixedPosition,
        questionLimit,
    };
}

export function parseSectionTagLine(text = '') {
    const match = (text || '').trim().match(/^<\s*(\/?)\s*(g(?:_[a-z0-9]+)*)\s*>$/i);
    if (!match) return null;

    const tag = normalizeTag(match[2]);
    if (match[1]) {
        return {
            type: 'end',
            tag,
        };
    }

    return {
        type: 'start',
        ...getSectionSettings(tag),
    };
}

export function parseQuestionLine(text = '') {
    const classicMatch = (text || '').match(/^(?:Cau|Câu|Question|Q)\s*(\d+)\s*[.:)]\s*(.*)$/i);
    if (classicMatch) {
        return {
            number: Number(classicMatch[1]) || 0,
            content: classicMatch[2]?.trim() || '',
        };
    }

    const placeholderMatch = (text || '').match(/^\(Q(\d+)\)\s*(.*)$/i);
    if (placeholderMatch) {
        return {
            number: Number(placeholderMatch[1]) || 0,
            content: placeholderMatch[2]?.trim() || '',
        };
    }

    return null;
}

export function buildSectionTag(section = {}) {
    const tokens = ['g'];
    const rawTag = normalizeTag(section.sectionTag || section.tag || 'g');

    if (rawTag.includes('essay')) tokens.push('essay');
    else if (rawTag.includes('tf')) tokens.push('tf');

    const shuffleQuestions = section.sectionShuffleQuestions ?? section.shuffleQuestions;
    const shuffleChoices = section.sectionShuffleChoices ?? section.shuffleChoices;
    const fixedPosition = section.sectionFixedPosition ?? section.fixedPosition;
    const questionLimit = Number(section.sectionQuestionLimit ?? section.questionLimit) || 0;

    if (fixedPosition && shuffleQuestions === false && shuffleChoices === false) {
        tokens.push('codinhtoanbo');
    } else {
        if (shuffleQuestions === false) tokens.push('khongtron');
        if (shuffleChoices === false && !tokens.includes('essay')) tokens.push('codinhdapan');
        if (fixedPosition) tokens.push('codinh');
    }

    if (questionLimit > 0) tokens.push(`lay${questionLimit}`);

    return tokens.filter(Boolean).join('_');
}

export function getSectionDisplayTitle(question = {}) {
    if (question.sectionTitle) return question.sectionTitle;
    if (question.sectionTag?.includes('essay')) return 'Writing / Essay';
    if (question.sectionTag?.includes('tf')) return 'True / False';

    const contextText = (question.sectionContextText || '').toLowerCase();
    if (contextText.includes('passage') || contextText.includes('read the following')) return 'Reading passage';
    if (contextText.includes('listen')) return 'Listening';
    if (contextText.includes('cloze') || contextText.includes('fill in the blank')) return 'Cloze test';
    if (question.sectionTag?.includes('khongtron')) return 'Passage giu thu tu';
    if (question.type && TYPE_SECTION_LABELS[question.type]) return TYPE_SECTION_LABELS[question.type];
    return 'Phan cau hoi';
}

export function getQuestionSectionKey(question = {}, index = 0, questions = []) {
    if (hasExplicitSection(question)) {
        return `section:${question.sectionId || `${question.sectionTag || 'section'}:${question.sectionOrder ?? index}`}`;
    }
    if (shouldGroupByType(questions)) {
        return `type:${question.type || 'other'}`;
    }
    return '__default';
}

export function groupQuestionsBySection(questions = []) {
    const grouped = [];
    const groupMap = new Map();
    const groupByType = shouldGroupByType(questions);

    (questions || []).forEach((question, index) => {
        const meta = hasExplicitSection(question)
            ? createQuestionMeta(question, index)
            : groupByType
                ? createTypeMeta(question.type)
                : createQuestionMeta(question, index);

        if (!groupMap.has(meta.key)) {
            groupMap.set(meta.key, {
                key: meta.key,
                meta,
                questions: [],
            });
            grouped.push(groupMap.get(meta.key));
        }

        groupMap.get(meta.key).questions.push(question);
    });

    return grouped;
}

export function orderQuestionsForDelivery(questions = [], options = {}) {
    const shuffleQuestions = options.shuffleQuestions !== false;
    const shuffleChoices = options.shuffleChoices !== false;
    const groups = groupQuestionsBySection(questions);
    const ordered = [];

    groups.forEach((group, groupIndex) => {
        let sectionQuestions = [...group.questions];

        if (shuffleQuestions && group.meta.shuffleQuestions !== false) {
            sectionQuestions = shuffleArray(sectionQuestions);
        }

        const sectionLimit = Number(group.meta.questionLimit) || 0;
        if (sectionLimit > 0 && sectionQuestions.length > sectionLimit) {
            sectionQuestions = sectionQuestions.slice(0, sectionLimit);
        }

        sectionQuestions.forEach((question, index) => {
            let nextQuestion = { ...question };

            const nextChoices = Array.isArray(question.choices) && question.choices.length > 1
                ? (shuffleChoices && group.meta.shuffleChoices !== false ? shuffleArray(question.choices) : [...question.choices])
                : [...(question.choices || [])];
            nextQuestion = {
                ...nextQuestion,
                choices: normalizeChoicesForDelivery({ ...question, choices: nextChoices }),
            };

            ordered.push({
                ...nextQuestion,
                deliverySection: {
                    ...group.meta,
                    title: group.meta.title || getSectionDisplayTitle(question),
                    groupIndex,
                    isSectionStart: index === 0,
                    questionIndexInSection: index + 1,
                    questionCountInSection: sectionQuestions.length,
                    questionLimit: sectionLimit || null,
                    hasSections: groups.length > 1,
                },
            });
        });
    });

    return ordered;
}