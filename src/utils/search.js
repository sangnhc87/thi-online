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

function prefixes(token, maxLength = 12) {
    const results = [];
    const limit = Math.min(token.length, maxLength);
    for (let index = 1; index <= limit; index += 1) {
        results.push(token.slice(0, index));
    }
    return results;
}

export function normalizeSearchTerm(value) {
    return normalizePart(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function buildSearchKeywords(parts = []) {
    const keywords = new Set();

    parts.forEach((part) => {
        tokenize(part).forEach((token) => {
            prefixes(token).forEach((prefix) => keywords.add(prefix));
        });
    });

    return Array.from(keywords).slice(0, 250);
}

export function buildUserSearchFields(profile = {}) {
    return {
        displayNameLower: normalizePart(profile.displayName),
        emailLower: normalizePart(profile.email),
        searchKeywords: buildSearchKeywords([
            profile.displayName,
            profile.email,
            profile.schoolName,
            profile.teacherName,
            profile.teacherSlug,
        ]),
    };
}

export function buildExamSearchFields(exam = {}) {
    return {
        titleLower: normalizePart(exam.title),
        searchKeywords: buildSearchKeywords([
            exam.title,
            exam.subject,
            exam.grade,
            exam.teacherName,
        ]),
    };
}