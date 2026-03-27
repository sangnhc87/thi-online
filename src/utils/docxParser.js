/**
 * Client-side DOCX parser — no server needed.
 * Reads .docx (ZIP) → word/document.xml → extracts questions, choices, answers, images, explanations.
 * Compatible with tron-de-react DOCX format.
 */
import JSZip from 'jszip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

// ====== XML helpers ======
function getAll(el, ns, tag) {
    return el ? Array.from(el.getElementsByTagNameNS(ns, tag)) : [];
}
function getFirst(el, ns, tag) {
    return el ? el.getElementsByTagNameNS(ns, tag)[0] || null : null;
}

// ====== Text extraction ======
function getParaText(pEl) {
    let text = '';
    for (const r of getAll(pEl, W_NS, 'r')) {
        for (const t of getAll(r, W_NS, 't')) {
            text += t.textContent;
        }
    }
    return text.trim();
}

// ====== Check if paragraph has underline ======
function hasUnderline(pEl) {
    for (const r of getAll(pEl, W_NS, 'r')) {
        const rPr = getFirst(r, W_NS, 'rPr');
        if (!rPr) continue;
        const u = getFirst(rPr, W_NS, 'u');
        if (u) {
            const val = u.getAttributeNS(W_NS, 'val') || u.getAttribute('w:val') || '';
            if (val && val !== 'none') return true;
        }
    }
    return false;
}

// ====== Convert paragraph to HTML ======
function paraToHtml(pEl, imageMap) {
    const parts = [];
    for (const child of pEl.childNodes) {
        if (child.nodeType !== 1) continue;
        const localName = child.localName;

        if (localName === 'r') {
            // Check run properties
            const rPr = getFirst(child, W_NS, 'rPr');
            let prefix = '', suffix = '';
            if (rPr) {
                if (getFirst(rPr, W_NS, 'b')) { prefix += '<strong>'; suffix = '</strong>' + suffix; }
                if (getFirst(rPr, W_NS, 'i')) { prefix += '<em>'; suffix = '</em>' + suffix; }
                if (getFirst(rPr, W_NS, 'u')) {
                    const uVal = getFirst(rPr, W_NS, 'u').getAttributeNS(W_NS, 'val') ||
                                 getFirst(rPr, W_NS, 'u').getAttribute('w:val') || '';
                    if (uVal && uVal !== 'none') { prefix += '<u>'; suffix = '</u>' + suffix; }
                }
                if (getFirst(rPr, W_NS, 'strike')) { prefix += '<s>'; suffix = '</s>' + suffix; }
                if (getFirst(rPr, W_NS, 'vertAlign')) {
                    const va = getFirst(rPr, W_NS, 'vertAlign').getAttributeNS(W_NS, 'val') ||
                               getFirst(rPr, W_NS, 'vertAlign').getAttribute('w:val') || '';
                    if (va === 'superscript') { prefix += '<sup>'; suffix = '</sup>' + suffix; }
                    if (va === 'subscript') { prefix += '<sub>'; suffix = '</sub>' + suffix; }
                }
            }

            // Text
            let runText = '';
            for (const t of getAll(child, W_NS, 't')) {
                runText += t.textContent;
            }

            // Images inside run (w:drawing)
            const drawings = getAll(child, W_NS, 'drawing');
            for (const d of drawings) {
                // Look for a:blip with r:embed
                const blips = d.getElementsByTagNameNS(DRAWING_NS, 'blip');
                for (const blip of blips) {
                    const rId = blip.getAttributeNS(R_NS, 'embed') || blip.getAttribute('r:embed') || '';
                    if (rId && imageMap[rId]) {
                        runText += `<img src="${imageMap[rId]}" style="max-width:100%;vertical-align:middle;" />`;
                    }
                }
            }

            if (runText) parts.push(prefix + escapeHtml(runText).replace(/&lt;img /g, '<img ').replace(/&lt;\/img&gt;/g, '') + suffix);
        } else if (localName === 'hyperlink') {
            // Process runs inside hyperlink
            for (const r of getAll(child, W_NS, 'r')) {
                let t = '';
                for (const tEl of getAll(r, W_NS, 't')) t += tEl.textContent;
                parts.push(escapeHtml(t));
            }
        }
    }
    return parts.join('');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\$\$\$(.*?)\$\$\$/gs, '<span class="math display">$1</span>')
        .replace(/\$\$(.*?)\$\$/g, '<span class="math inline">$1</span>');
}

// ====== Main parser ======
export async function parseDocx(file) {
    const zip = await JSZip.loadAsync(file);

    // 1. Parse word/document.xml
    const docXmlStr = await zip.file('word/document.xml').async('string');
    const parser = new DOMParser();
    const docXml = parser.parseFromString(docXmlStr, 'application/xml');
    const body = docXml.getElementsByTagNameNS(W_NS, 'body')[0];
    if (!body) throw new Error('Không tìm thấy nội dung trong file DOCX.');

    // 2. Parse relationships (for images)
    let relsMap = {};
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (relsFile) {
        const relsStr = await relsFile.async('string');
        const relsXml = parser.parseFromString(relsStr, 'application/xml');
        for (const rel of relsXml.getElementsByTagNameNS(RELS_NS, 'Relationship')) {
            const id = rel.getAttribute('Id');
            const target = rel.getAttribute('Target');
            if (id && target) relsMap[id] = target;
        }
    }

    // 3. Extract images as data URLs
    const imageMap = {}; // rId → dataURL
    const imageFiles = []; // for Firestore upload later
    for (const [rId, target] of Object.entries(relsMap)) {
        if (!target.match(/\.(png|jpg|jpeg|gif|bmp|tif|tiff|emf|wmf|svg)$/i)) continue;
        const imgPath = target.startsWith('/') ? target.substring(1) : `word/${target}`;
        const imgFile = zip.file(imgPath);
        if (!imgFile) continue;
        const blob = await imgFile.async('blob');
        const ext = target.split('.').pop().toLowerCase();
        const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', emf: 'image/emf', wmf: 'image/wmf', tif: 'image/tiff', tiff: 'image/tiff' };
        const mime = mimeMap[ext] || 'image/png';
        const dataUrl = await blobToDataURL(blob);
        imageMap[rId] = dataUrl;
        imageFiles.push({ rId, name: target.split('/').pop(), blob, mime });
    }

    // 4. Extract paragraphs
    const allP = getAll(body, W_NS, 'p');
    const paragraphs = allP.map(p => ({
        el: p,
        text: getParaText(p),
        html: paraToHtml(p, imageMap),
        underline: hasUnderline(p),
    }));

    // 5. Parse questions
    const questionPattern = /^(?:Câu|Question|Q)\s*(\d+)\s*[.:)]\s*(.*)/is;
    const mcqPattern = /^([A-D])\s*[.)]\s*(.*)/s;
    const tfPattern = /^([a-d])\s*\)\s*(.*)/s;
    const answerPattern = /^(?:Đáp án|ĐÁ|Answer|Correct)\s*[:=]\s*(.*)/i;
    const explPattern = /^(?:Lời giải|Giải thích|Giải|Explanation|Solution)\s*[:]\s*(.*)/i;

    const questions = [];
    let current = null;
    let collectingExplanation = false;

    const finalizeQuestion = (q) => {
        if (!q) return;
        delete q._collectingExpl;
        const hasMcq = q.choices.some(c => c.format === 'mcq');
        const hasTf = q.choices.some(c => c.format === 'tf');

        if (hasMcq && q.choices.length >= 2) {
            q.type = 'mcq';
            if (!q.correct_answer) {
                const underlined = q.choices.filter(c => c.underline);
                if (underlined.length === 1) q.correct_answer = underlined[0].letter;
            }
        } else if (hasTf) {
            q.type = 'tf';
            if (!q.correct_answer) {
                q.correct_answer = q.choices.map(c => c.underline ? 'D' : 'S').join('');
            }
        } else if (q.correct_answer && q.choices.length === 0) {
            q.type = 'short_answer';
        } else {
            q.type = 'mcq';
        }

        // Clean internal fields
        q.choices.forEach(c => { delete c.format; delete c.underline; });
        questions.push(q);
    };

    for (const para of paragraphs) {
        const { text, html, underline } = para;
        if (!text) continue;

        // Explanation
        const explMatch = text.match(explPattern);
        if (explMatch && current) {
            const explText = explMatch[1].trim();
            const explHtml = html.replace(/^(?:Lời giải|Giải thích|Giải|Explanation|Solution)\s*[:]\s*/i, '');
            current.explanation = explText;
            current.explanation_html = explHtml;
            collectingExplanation = true;
            continue;
        }

        if (collectingExplanation && current) {
            if (questionPattern.test(text) || mcqPattern.test(text) || tfPattern.test(text)) {
                collectingExplanation = false;
                // fall through
            } else {
                current.explanation = ((current.explanation || '') + '\n' + text).trim();
                current.explanation_html = ((current.explanation_html || '') + '<br>' + html).trim();
                continue;
            }
        }

        // Answer marker
        const ansMatch = text.match(answerPattern);
        if (ansMatch && current) {
            current.correct_answer = ansMatch[1].trim();
            continue;
        }

        // New question
        const qMatch = text.match(questionPattern);
        if (qMatch) {
            finalizeQuestion(current);
            collectingExplanation = false;
            const qHtml = html.replace(/^(?:Câu|Question|Q)\s*\d+\s*[.:)]\s*/i, '');
            current = {
                number: parseInt(qMatch[1]),
                content_text: qMatch[2].trim(),
                content_html: qHtml,
                choices: [],
                correct_answer: null,
                explanation: null,
                explanation_html: null,
            };
            continue;
        }

        // MCQ choice A. B. C. D.
        const mcqMatch = text.match(mcqPattern);
        if (mcqMatch && current) {
            collectingExplanation = false;
            const cHtml = html.replace(/^[A-D]\s*[.)]\s*/, '');
            current.choices.push({
                letter: mcqMatch[1].toUpperCase(),
                text: mcqMatch[2].trim(),
                html: cHtml,
                format: 'mcq',
                underline,
            });
            continue;
        }

        // TF choice a) b) c) d)
        const tfMatch = text.match(tfPattern);
        if (tfMatch && current) {
            collectingExplanation = false;
            const cHtml = html.replace(/^[a-d]\s*\)\s*/, '');
            current.choices.push({
                letter: tfMatch[1].toLowerCase(),
                text: tfMatch[2].trim(),
                html: cHtml,
                format: 'tf',
                underline,
            });
            continue;
        }

        // Multi-paragraph question content
        if (current && current.choices.length === 0 && !collectingExplanation) {
            current.content_text += '\n' + text;
            current.content_html += '<br>' + html;
        }
    }
    finalizeQuestion(current);

    return { questions, imageFiles, imageMap };
}

function blobToDataURL(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}
