import katex from 'katex';

export const MATH_GROUPS = [
    { label: 'Cơ bản', items: [
        { l: 'a/b', t: '\\frac{▫}{▫}' }, { l: '√x', t: '\\sqrt{▫}' }, { l: 'ⁿ√', t: '\\sqrt[▫]{▫}' },
        { l: 'x²', t: '{▫}^{2}' }, { l: 'xⁿ', t: '{▫}^{▫}' }, { l: 'xₙ', t: '{▫}_{▫}' },
        { l: '|x|', t: '\\left|▫\\right|' }, { l: '( )', t: '\\left(▫\\right)' }, { l: '[ ]', t: '\\left[▫\\right]' },
        { l: '{ }', t: '\\left\\{▫\\right\\}' }, { l: '±', t: '\\pm ' }, { l: '∓', t: '\\mp ' },
        { l: '×', t: '\\times ' }, { l: '÷', t: '\\div ' }, { l: '·', t: '\\cdot ' },
    ] },
    { label: 'Giải tích', items: [
        { l: '∑', t: '\\sum_{▫}^{▫}' }, { l: '∏', t: '\\prod_{▫}^{▫}' }, { l: '∫', t: '\\int_{▫}^{▫}' },
        { l: 'lim', t: '\\lim_{▫ \\to ▫}' }, { l: '∞', t: '\\infty ' }, { l: '∂', t: '\\partial ' },
        { l: 'd/dx', t: '\\frac{d}{dx}' }, { l: '→', t: '\\to ' }, { l: '∆', t: '\\Delta ' },
    ] },
    { label: 'So sánh', items: [
        { l: '≤', t: '\\leq ' }, { l: '≥', t: '\\geq ' }, { l: '≠', t: '\\neq ' },
        { l: '≈', t: '\\approx ' }, { l: '≡', t: '\\equiv ' }, { l: '∝', t: '\\propto ' },
        { l: '⇒', t: '\\Rightarrow ' }, { l: '⇔', t: '\\Leftrightarrow ' },
    ] },
    { label: 'Tập hợp', items: [
        { l: '∈', t: '\\in ' }, { l: '∉', t: '\\notin ' }, { l: '⊂', t: '\\subset ' },
        { l: '⊆', t: '\\subseteq ' }, { l: '∪', t: '\\cup ' }, { l: '∩', t: '\\cap ' },
        { l: '∅', t: '\\emptyset ' }, { l: '∀', t: '\\forall ' }, { l: '∃', t: '\\exists ' },
        { l: 'ℝ', t: '\\mathbb{R}' }, { l: 'ℕ', t: '\\mathbb{N}' }, { l: 'ℤ', t: '\\mathbb{Z}' },
    ] },
    { label: 'Hàm', items: [
        { l: 'sin', t: '\\sin ' }, { l: 'cos', t: '\\cos ' }, { l: 'tan', t: '\\tan ' },
        { l: 'log', t: '\\log ' }, { l: 'ln', t: '\\ln ' }, { l: 'e^x', t: 'e^{▫}' },
    ] },
    { label: 'Hy Lạp', items: [
        { l: 'α', t: '\\alpha ' }, { l: 'β', t: '\\beta ' }, { l: 'γ', t: '\\gamma ' },
        { l: 'δ', t: '\\delta ' }, { l: 'ε', t: '\\varepsilon ' }, { l: 'θ', t: '\\theta ' },
        { l: 'λ', t: '\\lambda ' }, { l: 'μ', t: '\\mu ' }, { l: 'π', t: '\\pi ' },
        { l: 'σ', t: '\\sigma ' }, { l: 'φ', t: '\\varphi ' }, { l: 'ω', t: '\\omega ' },
        { l: 'Ω', t: '\\Omega ' },
    ] },
    { label: 'Hình học', items: [
        { l: '°', t: '^{\\circ}' }, { l: '∠', t: '\\angle ' }, { l: '△', t: '\\triangle ' },
        { l: '⊥', t: '\\perp ' }, { l: '∥', t: '\\parallel ' },
        { l: '→v', t: '\\vec{▫}' }, { l: 'ā', t: '\\overline{▫}' },
    ] },
    { label: 'Hệ & ma trận', items: [
        { l: 'Hệ PT', t: '\\left\\{\\begin{aligned} ▫ &= ▫ \\\\ ▫ &= ▫ \\end{aligned}\\right.' },
        { l: 'cases', t: '\\begin{cases} ▫ & \\text{nếu } ▫ \\\\ ▫ & \\text{nếu } ▫ \\end{cases}' },
        { l: 'array', t: '\\begin{array}{l} ▫ \\\\ ▫ \\end{array}' },
        { l: '(matrix)', t: '\\begin{pmatrix} ▫ & ▫ \\\\ ▫ & ▫ \\end{pmatrix}' },
        { l: '[matrix]', t: '\\begin{bmatrix} ▫ & ▫ \\\\ ▫ & ▫ \\end{bmatrix}' },
        { l: 'và', t: '\\land ' },
        { l: 'hoặc', t: '\\lor ' },
    ] },
];

export const MATH_WRAP_OPTIONS = [
    { id: 'inline-paren', label: '\\(...\\)', before: '\\(', after: '\\)' },
    { id: 'inline-dollar', label: '$...$', before: '$', after: '$' },
    { id: 'block-bracket', label: '\\[...\\]', before: '\\[', after: '\\]' },
    { id: 'block-dollar', label: '$$...$$', before: '$$', after: '$$' },
];

export const DEFAULT_MATH_WRAP = 'inline-paren';

export function wrapMathExpression(latex, wrapMode = DEFAULT_MATH_WRAP) {
    const cleanLatex = (latex || '').replace(/\u25AB/g, '').trim();
    const wrapper = MATH_WRAP_OPTIONS.find((item) => item.id === wrapMode) || MATH_WRAP_OPTIONS[0];
    return cleanLatex ? `${wrapper.before}${cleanLatex}${wrapper.after}` : '';
}

function renderMath(tex, displayMode) {
    try {
        return katex.renderToString(tex.trim(), { displayMode, throwOnError: false });
    } catch {
        return tex;
    }
}

function replaceWithTokens(input, regex, displayMode) {
    const tokens = [];
    const content = input.replace(regex, (...args) => {
        const groups = args.slice(1, -2);
        const tex = groups[groups.length - 1];
        const token = `@@MATH_${tokens.length}@@`;
        tokens.push({ token, html: renderMath(tex, displayMode) });
        return token;
    });
    return { content, tokens };
}

export function renderLatexContent(html) {
    if (!html) return '';

    let next = html;
    const allTokens = [];

    const replacements = [
        { regex: /\$\$\$([\s\S]+?)\$\$\$/g, displayMode: true },
        { regex: /\\\[([\s\S]+?)\\\]/g, displayMode: true },
        { regex: /(^|<br\s*\/?>(?:\s*)|\n\s*)\$\$([\s\S]+?)\$\$(?=(?:\s*<br\s*\/?>)|\s*$|\n)/gm, displayMode: true, preserveLead: true },
        { regex: /\\\(([\s\S]+?)\\\)/g, displayMode: false },
        { regex: /(^|[^$\\])\$([^$\n]+?)\$(?!\$)/g, displayMode: false, preserveLead: true },
        { regex: /\$\$([\s\S]+?)\$\$/g, displayMode: false },
    ];

    replacements.forEach(({ regex, displayMode, preserveLead }) => {
        if (!preserveLead) {
            const { content, tokens } = replaceWithTokens(next, regex, displayMode);
            next = content;
            allTokens.push(...tokens);
            return;
        }

        const tokens = [];
        next = next.replace(regex, (_, lead = '', tex = '') => {
            const token = `@@MATH_${allTokens.length + tokens.length}@@`;
            tokens.push({ token, html: renderMath(tex, displayMode) });
            return `${lead}${token}`;
        });
        allTokens.push(...tokens);
    });

    allTokens.forEach(({ token, html: tokenHtml }) => {
        next = next.replaceAll(token, tokenHtml);
    });

    return next;
}
