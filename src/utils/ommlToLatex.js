/**
 * OMML (Office Math Markup Language) → LaTeX converter.
 * Converts <m:oMath> / <m:oMathPara> elements from Word DOCX XML to LaTeX strings.
 */

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/* ── helpers ──────────────────────────────────────────────── */
function kids(el, tag) {
    const r = [];
    if (!el) return r;
    for (const c of el.childNodes)
        if (c.nodeType === 1 && c.localName === tag && c.namespaceURI === M) r.push(c);
    return r;
}
function kid(el, tag) { return kids(el, tag)[0] || null; }

function attr(el, tag) {
    const c = kid(el, tag);
    if (!c) return null;
    return c.getAttributeNS(M, 'val') || c.getAttribute('m:val') || c.getAttribute('val') || null;
}

/* ── Unicode → LaTeX map ─────────────────────────────────── */
const UMAP = {
    '×':'\\times ','÷':'\\div ','±':'\\pm ','∓':'\\mp ',
    '≤':'\\leq ','≥':'\\geq ','≠':'\\neq ','≈':'\\approx ','≡':'\\equiv ',
    '∞':'\\infty ','∈':'\\in ','∉':'\\notin ','⊂':'\\subset ','⊃':'\\supset ',
    '⊆':'\\subseteq ','⊇':'\\supseteq ','∪':'\\cup ','∩':'\\cap ',
    '∅':'\\emptyset ','∀':'\\forall ','∃':'\\exists ','∄':'\\nexists ',
    '→':'\\to ','←':'\\leftarrow ','↔':'\\leftrightarrow ',
    '⇒':'\\Rightarrow ','⇐':'\\Leftarrow ','⇔':'\\Leftrightarrow ',
    '∴':'\\therefore ','∵':'\\because ','∝':'\\propto ',
    '∂':'\\partial ','∇':'\\nabla ','ℏ':'\\hbar ','ℓ':'\\ell ',
    'α':'\\alpha ','β':'\\beta ','γ':'\\gamma ','δ':'\\delta ',
    'ε':'\\varepsilon ','ζ':'\\zeta ','η':'\\eta ','θ':'\\theta ',
    'ι':'\\iota ','κ':'\\kappa ','λ':'\\lambda ','μ':'\\mu ',
    'ν':'\\nu ','ξ':'\\xi ','π':'\\pi ','ρ':'\\rho ',
    'σ':'\\sigma ','τ':'\\tau ','υ':'\\upsilon ','φ':'\\varphi ',
    'χ':'\\chi ','ψ':'\\psi ','ω':'\\omega ',
    'Γ':'\\Gamma ','Δ':'\\Delta ','Θ':'\\Theta ','Λ':'\\Lambda ',
    'Ξ':'\\Xi ','Π':'\\Pi ','Σ':'\\Sigma ','Φ':'\\Phi ',
    'Ψ':'\\Psi ','Ω':'\\Omega ',
    '⋅':'\\cdot ','…':'\\ldots ','⋯':'\\cdots ','⋮':'\\vdots ','⋱':'\\ddots ',
    '′':'\'','″':'\'\'','‴':'\'\'\'',
    '°':'^{\\circ}',
    '√':'\\sqrt ','∠':'\\angle ',
    '⊥':'\\perp ','∥':'\\parallel ',
    '←':'\\leftarrow ','↑':'\\uparrow ','↓':'\\downarrow ',
    '⟨':'\\langle ','⟩':'\\rangle ',
};

function mapChars(s) {
    let o = '';
    for (const ch of s) o += UMAP[ch] || ch;
    return o;
}

/* ── element dispatcher ───────────────────────────────────── */
function cvt(el) {
    if (!el || el.nodeType !== 1) return '';
    switch (el.localName) {
        case 'oMathPara': return kids(el, 'oMath').map(m => cvtChildren(m)).join(' \\\\ ');
        case 'oMath':     return cvtChildren(el);
        case 'r':         return cvtRun(el);
        case 'f':         return cvtFrac(el);
        case 'rad':       return cvtRad(el);
        case 'sSup':      return cvtSup(el);
        case 'sSub':      return cvtSub(el);
        case 'sSubSup':   return cvtSubSup(el);
        case 'sPre':      return cvtPre(el);
        case 'nary':      return cvtNary(el);
        case 'd':         return cvtDelim(el);
        case 'func':      return cvtFunc(el);
        case 'acc':       return cvtAcc(el);
        case 'bar':       return cvtBar(el);
        case 'limLow':    return cvtLimLow(el);
        case 'limUpp':    return cvtLimUpp(el);
        case 'groupChr':  return cvtGroupChr(el);
        case 'eqArr':     return cvtEqArr(el);
        case 'm':         return cvtMatrix(el);
        case 'box':       { const e = kid(el, 'e'); return e ? cvtChildren(e) : ''; }
        case 'borderBox': { const e = kid(el, 'e'); return e ? `\\boxed{${cvtChildren(e)}}` : ''; }
        default:          return cvtChildren(el);
    }
}

function cvtChildren(el) {
    let r = '';
    for (const c of el.childNodes) if (c.nodeType === 1) r += cvt(c);
    return r;
}

/* ── run (m:r) ────────────────────────────────────────────── */
function cvtRun(el) {
    const t = kid(el, 't');
    if (!t) return '';
    let text = t.textContent || '';

    const rPr = kid(el, 'rPr');
    let isNormal = false;
    if (rPr) {
        if (kid(rPr, 'nor')) isNormal = true;
        const sty = attr(rPr, 'sty');
        if (sty === 'p') isNormal = true;
    }

    text = mapChars(text);
    if (isNormal && text.length > 1) return `\\text{${text}}`;
    return text;
}

/* ── fraction ─────────────────────────────────────────────── */
function cvtFrac(el) {
    const pr = kid(el, 'fPr');
    const type = pr ? attr(pr, 'type') : null;
    const n = kid(el, 'num'), d = kid(el, 'den');
    const nL = n ? cvtChildren(n) : '', dL = d ? cvtChildren(d) : '';
    if (type === 'skw' || type === 'lin') return `{${nL}}/{${dL}}`;
    return `\\frac{${nL}}{${dL}}`;
}

/* ── radical ──────────────────────────────────────────────── */
function cvtRad(el) {
    const pr = kid(el, 'radPr');
    const hide = pr ? attr(pr, 'degHide') : null;
    const deg = kid(el, 'deg'), e = kid(el, 'e');
    const eL = e ? cvtChildren(e) : '';
    if (hide === '1' || hide === 'on' || !deg || !cvtChildren(deg).trim())
        return `\\sqrt{${eL}}`;
    return `\\sqrt[${cvtChildren(deg)}]{${eL}}`;
}

/* ── super / sub / subsup / pre ───────────────────────────── */
function cvtSup(el) {
    const e = kid(el, 'e'), s = kid(el, 'sup');
    return `{${e ? cvtChildren(e) : ''}}^{${s ? cvtChildren(s) : ''}}`;
}
function cvtSub(el) {
    const e = kid(el, 'e'), s = kid(el, 'sub');
    return `{${e ? cvtChildren(e) : ''}}_{${s ? cvtChildren(s) : ''}}`;
}
function cvtSubSup(el) {
    const e = kid(el, 'e'), sb = kid(el, 'sub'), sp = kid(el, 'sup');
    return `{${e ? cvtChildren(e) : ''}}_{${sb ? cvtChildren(sb) : ''}}^{${sp ? cvtChildren(sp) : ''}}`;
}
function cvtPre(el) {
    const e = kid(el, 'e'), sb = kid(el, 'sub'), sp = kid(el, 'sup');
    return `{}_{${sb ? cvtChildren(sb) : ''}}^{${sp ? cvtChildren(sp) : ''}}{${e ? cvtChildren(e) : ''}}`;
}

/* ── n-ary (∑ ∫ ∏ …) ──────────────────────────────────────── */
const NARY_MAP = {
    '∑':'\\sum','∏':'\\prod','∐':'\\coprod',
    '∫':'\\int','∬':'\\iint','∭':'\\iiint','∮':'\\oint',
    '⋃':'\\bigcup','⋂':'\\bigcap','⋁':'\\bigvee','⋀':'\\bigwedge',
};
function cvtNary(el) {
    const pr = kid(el, 'naryPr');
    const ch = pr ? attr(pr, 'chr') : null;
    const subH = pr ? attr(pr, 'subHide') : null;
    const supH = pr ? attr(pr, 'supHide') : null;
    const sb = kid(el, 'sub'), sp = kid(el, 'sup'), e = kid(el, 'e');
    const cmd = NARY_MAP[ch || '∫'] || (ch ? `\\operatorname{${ch}}` : '\\int');
    let r = cmd;
    if (subH !== '1' && subH !== 'on' && sb) r += `_{${cvtChildren(sb)}}`;
    if (supH !== '1' && supH !== 'on' && sp) r += `^{${cvtChildren(sp)}}`;
    if (e) r += ` ${cvtChildren(e)}`;
    return r;
}

/* ── delimiter (parentheses, brackets, …) ─────────────────── */
const DMAP = {'(':'(',')':')', '[':'[',']':']', '{':'\\{','}':'\\}',
    '|':'|','‖':'\\|', '⌈':'\\lceil','⌉':'\\rceil', '⌊':'\\lfloor','⌋':'\\rfloor',
    '⟨':'\\langle','⟩':'\\rangle', '':'.' };
function cvtDelim(el) {
    const pr = kid(el, 'dPr');
    let beg = pr ? attr(pr, 'begChr') : null;
    let end = pr ? attr(pr, 'endChr') : null;
    if (beg === null) beg = '(';
    if (end === null) end = ')';
    const L = DMAP[beg] !== undefined ? DMAP[beg] : beg;
    const R = DMAP[end] !== undefined ? DMAP[end] : end;
    const eList = kids(el, 'e');
    const sep = (pr ? attr(pr, 'sepChr') : null) || (eList.length > 1 ? ', ' : '');
    const inner = eList.map(e => cvtChildren(e)).join(sep);
    return `\\left${L} ${inner} \\right${R}`;
}

/* ── function (sin, cos, …) ──────────────────────────────── */
const KNOWN_FN = new Set(['sin','cos','tan','csc','sec','cot','sinh','cosh','tanh',
    'arcsin','arccos','arctan','ln','log','exp','lim','min','max','inf','sup',
    'det','dim','gcd','ker','deg','hom','arg']);
function cvtFunc(el) {
    const fN = kid(el, 'fName'), e = kid(el, 'e');
    let name = fN ? cvtChildren(fN).trim() : '';
    const eL = e ? cvtChildren(e) : '';
    const clean = name.replace(/\\text\{(.+?)\}/, '$1').replace(/\\/g, '');
    if (KNOWN_FN.has(clean)) return `\\${clean} ${eL}`;
    return `\\operatorname{${clean}} ${eL}`;
}

/* ── accent (hat, tilde, vec, …) ──────────────────────────── */
const ACC_MAP = {'\u0302':'\\hat','\u02C6':'\\hat', '\u0303':'\\tilde','\u02DC':'\\tilde',
    '\u0304':'\\bar','\u02C9':'\\bar', '\u0307':'\\dot','\u02D9':'\\dot',
    '\u0308':'\\ddot', '\u20D7':'\\vec','→':'\\vec', '\u0306':'\\breve', '\u030C':'\\check'};
function cvtAcc(el) {
    const pr = kid(el, 'accPr'), e = kid(el, 'e');
    const ch = pr ? attr(pr, 'chr') : null;
    const cmd = ch ? (ACC_MAP[ch] || '\\hat') : '\\hat';
    return `${cmd}{${e ? cvtChildren(e) : ''}}`;
}

/* ── bar (overline / underline) ──────────────────────────── */
function cvtBar(el) {
    const pr = kid(el, 'barPr'), e = kid(el, 'e');
    const pos = pr ? attr(pr, 'pos') : 'top';
    const eL = e ? cvtChildren(e) : '';
    return pos === 'bot' ? `\\underline{${eL}}` : `\\overline{${eL}}`;
}

/* ── limits ───────────────────────────────────────────────── */
function cvtLimLow(el) {
    const e = kid(el, 'e'), lim = kid(el, 'lim');
    return `{${e ? cvtChildren(e) : ''}}_{${lim ? cvtChildren(lim) : ''}}`;
}
function cvtLimUpp(el) {
    const e = kid(el, 'e'), lim = kid(el, 'lim');
    return `{${e ? cvtChildren(e) : ''}}^{${lim ? cvtChildren(lim) : ''}}`;
}

/* ── group character (underbrace, overbrace) ──────────────── */
function cvtGroupChr(el) {
    const pr = kid(el, 'groupChrPr');
    const ch = pr ? attr(pr, 'chr') : null;
    const pos = pr ? attr(pr, 'pos') : 'bot';
    const e = kid(el, 'e'), eL = e ? cvtChildren(e) : '';
    if (ch === '⏟' || pos === 'bot') return `\\underbrace{${eL}}`;
    if (ch === '⏞') return `\\overbrace{${eL}}`;
    return pos === 'top' ? `\\overbrace{${eL}}` : `\\underbrace{${eL}}`;
}

/* ── equation array ──────────────────────────────────────── */
function cvtEqArr(el) {
    const eList = kids(el, 'e');
    const lines = eList.map(e => cvtChildren(e));
    return `\\begin{aligned} ${lines.join(' \\\\ ')} \\end{aligned}`;
}

/* ── matrix ──────────────────────────────────────────────── */
function cvtMatrix(el) {
    const rows = kids(el, 'mr');
    const lines = rows.map(row => kids(row, 'e').map(e => cvtChildren(e)).join(' & '));
    return `\\begin{matrix} ${lines.join(' \\\\ ')} \\end{matrix}`;
}

/* ── public API ──────────────────────────────────────────── */

/** Convert a single <m:oMath> element to a LaTeX string. */
export function ommlToLatex(oMathEl) {
    return cvtChildren(oMathEl).trim();
}

/** Returns true if the element is <m:oMathPara> (display math). */
export function isDisplayMath(el) {
    return el.localName === 'oMathPara';
}
