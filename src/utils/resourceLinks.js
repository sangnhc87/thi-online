function storageAvailableDom() {
    return typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined';
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

function slugify(value) {
    return normalizeText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

export function inferResourceKind(href = '') {
    const normalizedHref = String(href || '').toLowerCase();

    if (!normalizedHref) return 'link';
    if (normalizedHref.startsWith('#')) return 'anchor';
    if (/(youtube\.com|youtu\.be|vimeo\.com)/.test(normalizedHref)) return 'video';
    if (/\.(pdf)(\?|$)/.test(normalizedHref)) return 'pdf';
    if (/\.(ppt|pptx|doc|docx|xls|xlsx|zip)(\?|$)/.test(normalizedHref)) return 'file';
    if (/\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/.test(normalizedHref)) return 'image';
    return 'link';
}

export function normalizeResourceLink(link = {}, defaults = {}) {
    const href = String(link.href || link.url || defaults.href || '').trim();
    if (!href) return null;

    const label = normalizeText(link.label || link.title || defaults.label || stripHtml(href));
    const scope = link.scope || defaults.scope || 'question';
    const source = link.source || defaults.source || 'html';
    const kind = link.kind || defaults.kind || inferResourceKind(href);

    return {
        id: link.id || `${scope}-${slugify(`${label}-${href}`) || Math.random().toString(36).slice(2, 8)}`,
        href,
        label: label || href,
        scope,
        source,
        kind,
    };
}

export function mergeResourceLinks(...groups) {
    const deduped = new Map();

    groups.flat().forEach((item) => {
        const normalized = normalizeResourceLink(item);
        if (!normalized) return;
        const key = `${normalized.scope}::${normalized.href}`;
        if (!deduped.has(key)) deduped.set(key, normalized);
    });

    return Array.from(deduped.values());
}

export function extractResourceLinksFromHtml(html = '', defaults = {}) {
    if (!html || !storageAvailableDom()) return [];

    try {
        const parser = new window.DOMParser();
        const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
        const anchors = Array.from(doc.querySelectorAll('a[href]'));
        return mergeResourceLinks(anchors.map((anchor, index) => ({
            id: `${defaults.scope || 'question'}-${index + 1}`,
            href: anchor.getAttribute('href') || '',
            label: normalizeText(anchor.textContent) || anchor.getAttribute('title') || anchor.getAttribute('href') || 'Liên kết',
            scope: defaults.scope || 'question',
            source: defaults.source || 'html',
            kind: inferResourceKind(anchor.getAttribute('href') || ''),
        })));
    } catch {
        return [];
    }
}

export function collectQuestionResourceGroups(question = {}) {
    const questionLinks = mergeResourceLinks(
        question.resourceLinks || [],
        extractResourceLinksFromHtml(question.content_html || '', { scope: 'question', source: 'content_html' }),
        extractResourceLinksFromHtml(question.explanation_html || '', { scope: 'question', source: 'explanation_html' }),
        ...(question.choices || []).map((choice) => extractResourceLinksFromHtml(choice.html || '', { scope: 'question', source: 'choice_html' })),
    );

    const sectionLinks = mergeResourceLinks(
        question.sectionResourceLinks || [],
        extractResourceLinksFromHtml(question.sectionContextHtml || '', { scope: 'section', source: 'section_html' }),
    );

    return {
        questionLinks,
        sectionLinks,
        allLinks: mergeResourceLinks(sectionLinks, questionLinks),
    };
}