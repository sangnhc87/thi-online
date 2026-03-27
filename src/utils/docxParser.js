/**
 * Client-side DOCX parser — no server needed.
 * Reads .docx (ZIP) → word/document.xml → extracts questions, choices, answers, images, explanations.
 * Compatible with tron-de-react DOCX format.
 */
import JSZip from 'jszip';
import { ommlToLatex, isDisplayMath } from './ommlToLatex';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const O_NS = 'urn:schemas-microsoft-com:office:office';

// ====== XML helpers ======
function getAll(el, ns, tag) {
    return el ? Array.from(el.getElementsByTagNameNS(ns, tag)) : [];
}
function getFirst(el, ns, tag) {
    return el ? el.getElementsByTagNameNS(ns, tag)[0] || null : null;
}

// ====== Flatten paragraph children (unwrap mc:AlternateContent, w:ins, w:del, w:sdt, etc.) ======
function flattenParaChildren(parentEl) {
    const result = [];
    for (const child of parentEl.childNodes) {
        if (child.nodeType !== 1) continue;
        const ln = child.localName;
        const ns = child.namespaceURI;

        // mc:AlternateContent — prefer mc:Choice that contains OMML, else mc:Fallback
        if (ln === 'AlternateContent') {
            let chosen = null;
            for (const mc of child.childNodes) {
                if (mc.nodeType !== 1) continue;
                if (mc.localName === 'Choice') {
                    // Check if Choice has OMML math
                    if (mc.getElementsByTagNameNS(M_NS, 'oMath').length > 0 ||
                        mc.getElementsByTagNameNS(M_NS, 'oMathPara').length > 0) {
                        chosen = mc;
                        break;
                    }
                }
            }
            if (!chosen) {
                for (const mc of child.childNodes) {
                    if (mc.nodeType === 1 && mc.localName === 'Fallback') { chosen = mc; break; }
                }
            }
            if (!chosen) {
                for (const mc of child.childNodes) {
                    if (mc.nodeType === 1 && mc.localName === 'Choice') { chosen = mc; break; }
                }
            }
            if (chosen) result.push(...flattenParaChildren(chosen));
            continue;
        }

        // Wrapper elements — recurse into their children
        if ((ln === 'ins' || ln === 'del' || ln === 'moveTo' || ln === 'moveFrom') && ns === W_NS) {
            result.push(...flattenParaChildren(child));
            continue;
        }
        if (ln === 'sdt' && ns === W_NS) {
            const content = getFirst(child, W_NS, 'sdtContent');
            if (content) result.push(...flattenParaChildren(content));
            continue;
        }

        result.push(child);
    }
    return result;
}

// ====== Text extraction ======
function getParaText(pEl) {
    let text = '';
    for (const child of flattenParaChildren(pEl)) {
        if (child.nodeType !== 1) continue;
        const ln = child.localName;
        if (ln === 'r' && child.namespaceURI === W_NS) {
            for (const t of getAll(child, W_NS, 't')) text += t.textContent;
        } else if (ln === 'hyperlink') {
            for (const r of getAll(child, W_NS, 'r'))
                for (const t of getAll(r, W_NS, 't')) text += t.textContent;
        } else if ((ln === 'oMath' || ln === 'oMathPara') && child.namespaceURI === M_NS) {
            const latex = ommlToLatex(child);
            if (latex) text += (ln === 'oMathPara' ? ` $$$${latex}$$$ ` : ` $$${latex}$$ `);
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
    for (const child of flattenParaChildren(pEl)) {
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

            // MathType / OLE objects inside run (w:object → v:shape → v:imagedata)
            const objects = getAll(child, W_NS, 'object');
            for (const obj of objects) {
                // Try to get fallback image from v:shape > v:imagedata
                const shapes = obj.getElementsByTagNameNS(VML_NS, 'shape');
                for (const shape of shapes) {
                    const imgData = shape.getElementsByTagNameNS(VML_NS, 'imagedata');
                    for (const id of imgData) {
                        const rId = id.getAttributeNS(R_NS, 'id') || id.getAttribute('r:id') || '';
                        if (rId && imageMap[rId]) {
                            runText += `<img src="${imageMap[rId]}" style="max-height:2em;vertical-align:middle;" class="mathtype-img" />`;
                        }
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
        } else if ((localName === 'oMath' || localName === 'oMathPara') && child.namespaceURI === M_NS) {
            // OMML equation → LaTeX
            const latex = ommlToLatex(child);
            if (latex) {
                if (localName === 'oMathPara') {
                    parts.push(`$$$${latex}$$$`);
                } else {
                    parts.push(`$$${latex}$$`);
                }
            }
        }
    }
    return parts.join('');
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ====== Serialize questions → plain text ======
export function questionsToText(questions) {
    return questions.map(q => {
        const lines = [`Câu ${q.number}: ${q.content_text || ''}`];
        for (const c of (q.choices || [])) {
            const pfx = q.type === 'tf' ? `${c.letter})` : `${c.letter}.`;
            lines.push(`${pfx} ${c.text || ''}`);
        }
        if (q.correct_answer) lines.push(`Đáp án: ${q.correct_answer}`);
        if (q.explanation) lines.push(`Lời giải: ${q.explanation}`);
        return lines.join('\n');
    }).join('\n\n');
}

// ====== Parse plain text → questions ======
export function parseText(text) {
    const qPat = /^(?:Câu|Question|Q)\s*(\d+)\s*[.:)]\s*(.*)/i;
    const mcqPat = /^([A-D])\s*[.)]\s*(.*)/;
    const tfPat = /^([a-d])\s*\)\s*(.*)/;
    const ansPat = /^(?:Đáp án|ĐÁ|Answer|Correct)\s*[:=]\s*(.*)/i;
    const explPat = /^(?:Lời giải|Giải thích|Giải|Explanation|Solution)\s*[:]\s*(.*)/i;

    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const lines = text.split('\n');
    const questions = [];
    let cur = null, collectExpl = false;

    const finalize = () => {
        if (!cur) return;
        const hasMcq = cur.choices.some(c => c._f === 'mcq');
        const hasTf = cur.choices.some(c => c._f === 'tf');
        if (hasMcq && cur.choices.length >= 2) cur.type = 'mcq';
        else if (hasTf) cur.type = 'tf';
        else if (cur.correct_answer && cur.choices.length === 0) cur.type = 'short_answer';
        else cur.type = 'mcq';
        cur.content_html = esc(cur.content_text);
        cur.choices.forEach(c => { c.html = esc(c.text); delete c._f; });
        if (cur.explanation) cur.explanation_html = esc(cur.explanation);
        questions.push(cur);
    };

    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;

        if (explPat.test(t) && cur) {
            cur.explanation = t.match(explPat)[1].trim();
            collectExpl = true; continue;
        }
        if (collectExpl && cur) {
            if (qPat.test(t)) { collectExpl = false; }
            else { cur.explanation = ((cur.explanation || '') + '\n' + t).trim(); continue; }
        }
        const ansM = t.match(ansPat);
        if (ansM && cur) { cur.correct_answer = ansM[1].trim(); continue; }

        const qM = t.match(qPat);
        if (qM) {
            finalize(); collectExpl = false;
            cur = { number: parseInt(qM[1]), content_text: qM[2].trim(), content_html: '', choices: [], correct_answer: null, explanation: null, explanation_html: null };
            continue;
        }
        const mcqM = t.match(mcqPat);
        if (mcqM && cur) { cur.choices.push({ letter: mcqM[1].toUpperCase(), text: mcqM[2].trim(), html: '', _f: 'mcq' }); continue; }
        const tfM = t.match(tfPat);
        if (tfM && cur) { cur.choices.push({ letter: tfM[1].toLowerCase(), text: tfM[2].trim(), html: '', _f: 'tf' }); continue; }

        if (cur && cur.choices.length === 0 && !collectExpl) cur.content_text += '\n' + t;
    }
    finalize();
    return questions;
}
