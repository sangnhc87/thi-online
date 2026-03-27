import os
import json
import re
import base64
import subprocess
import tempfile
import shutil
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

ALLOWED_EXTENSIONS = {'.docx'}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def parse_pandoc_json(ast):
    """Recursively extract text from Pandoc AST nodes."""
    if isinstance(ast, str):
        return ast
    if isinstance(ast, list):
        return ''.join(parse_pandoc_json(item) for item in ast)
    if isinstance(ast, dict):
        t = ast.get('t', '')
        c = ast.get('c', '')
        if t == 'Str':
            return str(c)
        if t == 'Space':
            return ' '
        if t == 'SoftBreak':
            return '\n'
        if t == 'LineBreak':
            return '\n'
        if t == 'Math':
            # c = [MathType, tex_string]
            if isinstance(c, list) and len(c) == 2:
                math_type = c[0]
                tex = c[1]
                if isinstance(math_type, dict) and math_type.get('t') == 'DisplayMath':
                    return f'$$${tex}$$$'
                return f'$${tex}$$'
            return str(c)
        if t == 'Image':
            # c = [Attr, [Inline], Target]
            if isinstance(c, list) and len(c) >= 3:
                target = c[2]
                if isinstance(target, list) and len(target) >= 1:
                    return f'[IMG:{target[0]}]'
            return '[IMG]'
        if t in ('Emph', 'Strong', 'Strikeout', 'Superscript', 'Subscript',
                  'SmallCaps', 'Underline', 'Span'):
            return parse_pandoc_json(c)
        if t == 'Para':
            return parse_pandoc_json(c)
        if t in ('Plain',):
            return parse_pandoc_json(c)
        if t == 'RawInline':
            if isinstance(c, list) and len(c) == 2:
                return c[1]
            return str(c)
        if t == 'Link':
            if isinstance(c, list) and len(c) >= 2:
                return parse_pandoc_json(c[1])
            return ''
        if t == 'Quoted':
            if isinstance(c, list) and len(c) >= 2:
                return '"' + parse_pandoc_json(c[1]) + '"'
            return ''
        if t == 'Code':
            if isinstance(c, list) and len(c) >= 2:
                return c[1]
            return str(c)
        if 'c' in ast:
            return parse_pandoc_json(c)
    return ''


def extract_inline_html(inlines, images_dir):
    """Convert Pandoc AST inline elements to minimal HTML."""
    parts = []
    for node in inlines:
        if isinstance(node, str):
            parts.append(node)
            continue
        t = node.get('t', '')
        c = node.get('c', '')
        if t == 'Str':
            parts.append(str(c))
        elif t == 'Space':
            parts.append(' ')
        elif t == 'SoftBreak':
            parts.append(' ')
        elif t == 'LineBreak':
            parts.append('<br>')
        elif t == 'Strong':
            parts.append(f'<strong>{extract_inline_html(c, images_dir)}</strong>')
        elif t == 'Emph':
            parts.append(f'<em>{extract_inline_html(c, images_dir)}</em>')
        elif t == 'Underline':
            parts.append(f'<u>{extract_inline_html(c, images_dir)}</u>')
        elif t == 'Strikeout':
            parts.append(f'<s>{extract_inline_html(c, images_dir)}</s>')
        elif t == 'Superscript':
            parts.append(f'<sup>{extract_inline_html(c, images_dir)}</sup>')
        elif t == 'Subscript':
            parts.append(f'<sub>{extract_inline_html(c, images_dir)}</sub>')
        elif t == 'Math':
            if isinstance(c, list) and len(c) == 2:
                math_type, tex = c
                if isinstance(math_type, dict) and math_type.get('t') == 'DisplayMath':
                    parts.append(f'<span class="math display">{tex}</span>')
                else:
                    parts.append(f'<span class="math inline">{tex}</span>')
        elif t == 'Image':
            if isinstance(c, list) and len(c) >= 3:
                target = c[2]
                if isinstance(target, list) and len(target) >= 1:
                    img_src = target[0]
                    parts.append(f'<img src="{img_src}" />')
        elif t == 'Code':
            if isinstance(c, list) and len(c) >= 2:
                parts.append(f'<code>{c[1]}</code>')
        elif t == 'RawInline':
            if isinstance(c, list) and len(c) == 2:
                parts.append(c[1])
        elif t == 'Span':
            if isinstance(c, list) and len(c) >= 2:
                parts.append(extract_inline_html(c[1], images_dir))
        elif t == 'Quoted':
            if isinstance(c, list) and len(c) >= 2:
                parts.append('"')
                parts.append(extract_inline_html(c[1], images_dir))
                parts.append('"')
        elif t == 'Link':
            if isinstance(c, list) and len(c) >= 2:
                parts.append(extract_inline_html(c[1], images_dir))
        else:
            parts.append(parse_pandoc_json(node))
    return ''.join(parts)


def blocks_to_html(blocks, images_dir):
    """Convert a list of block elements to HTML string."""
    parts = []
    for block in blocks:
        t = block.get('t', '')
        c = block.get('c', '')
        if t == 'Para':
            parts.append(f'<p>{extract_inline_html(c, images_dir)}</p>')
        elif t == 'Plain':
            parts.append(extract_inline_html(c, images_dir))
        elif t == 'OrderedList':
            if isinstance(c, list) and len(c) >= 2:
                items_html = ''.join(
                    f'<li>{blocks_to_html(item, images_dir)}</li>' for item in c[1]
                )
                parts.append(f'<ol>{items_html}</ol>')
        elif t == 'BulletList':
            items_html = ''.join(
                f'<li>{blocks_to_html(item, images_dir)}</li>' for item in c
            )
            parts.append(f'<ul>{items_html}</ul>')
        elif t == 'RawBlock':
            if isinstance(c, list) and len(c) == 2:
                parts.append(c[1])
        elif t in ('Header',):
            if isinstance(c, list) and len(c) >= 3:
                level = c[0]
                parts.append(f'<h{level}>{extract_inline_html(c[2], images_dir)}</h{level}>')
        else:
            text = parse_pandoc_json(block)
            if text.strip():
                parts.append(f'<p>{text}</p>')
    return ''.join(parts)


def parse_questions_from_ast(ast_data, images_dir):
    """
    Parse Pandoc AST JSON to extract questions.
    Supports the standard tron-de-react DOCX format:

    PART 1 — Multiple Choice (A. B. C. D.):
      Câu 1: Question text...
      A. Choice A
      B. Choice B (underline = correct, OR via "Đáp án: B")
      C. Choice C
      D. Choice D
      Đáp án: B          ← optional if underline used
      Lời giải: ...      ← optional explanation

    PART 2 — True/False (a) b) c) d)):
      Câu 5: Question text...
      a) Statement 1       ← underline = Đúng
      b) Statement 2
      c) Statement 3
      d) Statement 4
      Đáp án: DSDD        ← or via underline
      Lời giải: ...

    PART 3 — Short Answer:
      Câu 10: Question text...
      Đáp án: 13
      Lời giải: ...
    """
    blocks = ast_data.get('blocks', [])

    # First, convert all blocks to flat text paragraphs for pattern matching
    paragraphs = []
    for block in blocks:
        t = block.get('t', '')
        c = block.get('c', '')
        if t in ('Para', 'Plain'):
            text = parse_pandoc_json(c).strip()
            html = extract_inline_html(c, images_dir)
            has_underline = check_underline(c)
            paragraphs.append({'text': text, 'html': html, 'block': block, 'inlines': c, 'underline': has_underline})
        elif t == 'Header':
            if isinstance(c, list) and len(c) >= 3:
                text = parse_pandoc_json(c[2]).strip()
                html = extract_inline_html(c[2], images_dir)
                paragraphs.append({'text': text, 'html': html, 'block': block, 'inlines': c[2], 'underline': False})
        elif t == 'OrderedList':
            if isinstance(c, list) and len(c) >= 2:
                for item_blocks in c[1]:
                    for ib in item_blocks:
                        ibt = ib.get('t', '')
                        ibc = ib.get('c', '')
                        if ibt in ('Para', 'Plain'):
                            text = parse_pandoc_json(ibc).strip()
                            html = extract_inline_html(ibc, images_dir)
                            has_underline = check_underline(ibc)
                            paragraphs.append({'text': text, 'html': html, 'block': ib, 'inlines': ibc, 'underline': has_underline})
        elif t == 'BulletList':
            for item_blocks in c:
                for ib in item_blocks:
                    ibt = ib.get('t', '')
                    ibc = ib.get('c', '')
                    if ibt in ('Para', 'Plain'):
                        text = parse_pandoc_json(ibc).strip()
                        html = extract_inline_html(ibc, images_dir)
                        has_underline = check_underline(ibc)
                        paragraphs.append({'text': text, 'html': html, 'block': ib, 'inlines': ibc, 'underline': has_underline})

    # Patterns
    question_pattern = re.compile(
        r'^(?:Câu|Question|Q)\s*(\d+)\s*[.:)]\s*(.*)',
        re.IGNORECASE | re.DOTALL
    )
    # A. B. C. D. (uppercase + period) = MCQ choices
    mcq_choice_pattern = re.compile(r'^([A-D])\s*[.)]\s*(.*)', re.DOTALL)
    # a) b) c) d) (lowercase + parenthesis) = True/False statements
    tf_choice_pattern = re.compile(r'^([a-d])\s*\)\s*(.*)', re.DOTALL)
    # Answer marker: "Đáp án: B" or "Đáp án: DSDD" or "Đáp án: 13"
    answer_pattern = re.compile(r'(?:Đáp án|ĐÁ|Answer|Correct)\s*[:=]\s*(.*)', re.IGNORECASE)
    # Explanation marker: "Lời giải:" or "Giải:"
    explanation_pattern = re.compile(r'(?:Lời giải|Giải thích|Giải|Explanation|Solution)\s*[:]\s*(.*)', re.IGNORECASE)

    questions = []
    current_question = None

    def finalize_question(q):
        """Auto-classify and finalize a question before appending."""
        if not q:
            return
        choices = q.get('choices', [])
        # Determine type based on choice format
        has_mcq = any(c.get('format') == 'mcq' for c in choices)
        has_tf = any(c.get('format') == 'tf' for c in choices)

        if has_mcq and len(choices) >= 2:
            q['type'] = 'mcq'
            # If no answer from "Đáp án:" line, check underline
            if not q.get('correct_answer'):
                underlined = [i for i, c in enumerate(choices) if c.get('underline')]
                if len(underlined) == 1:
                    q['correct_answer'] = choices[underlined[0]]['letter']
        elif has_tf:
            q['type'] = 'tf'
            # Build DSDS answer from underlines if no text answer
            if not q.get('correct_answer'):
                tf_answer = ''
                for c in choices:
                    tf_answer += 'D' if c.get('underline') else 'S'
                if tf_answer:
                    q['correct_answer'] = tf_answer
        elif q.get('correct_answer') and not choices:
            q['type'] = 'short_answer'
        else:
            q['type'] = 'mcq'  # default fallback

        # Clean up internal fields
        for c in choices:
            c.pop('format', None)
            c.pop('underline', None)

        questions.append(q)

    for para in paragraphs:
        text = para['text']
        html = para['html']

        # Check for explanation marker
        expl_match = explanation_pattern.match(text)
        if expl_match and current_question:
            expl_text = expl_match.group(1).strip()
            expl_html = re.sub(
                r'^(?:Lời giải|Giải thích|Giải|Explanation|Solution)\s*[:]\s*',
                '', html, flags=re.IGNORECASE
            )
            current_question['explanation'] = expl_text
            current_question['explanation_html'] = expl_html
            continue

        # If we're already collecting explanation (multi-line)
        if current_question and current_question.get('_collecting_explanation'):
            # Check if this is a new question or choice — if so, stop collecting
            if question_pattern.match(text) or mcq_choice_pattern.match(text) or tf_choice_pattern.match(text):
                current_question.pop('_collecting_explanation', None)
                # fall through to normal processing
            else:
                current_question['explanation'] = (current_question.get('explanation', '') + '\n' + text).strip()
                current_question['explanation_html'] = (current_question.get('explanation_html', '') + '<br>' + html).strip()
                continue

        # Mark explanation collection if we just added one
        if current_question and current_question.get('explanation') and not current_question.get('_collecting_explanation'):
            current_question['_collecting_explanation'] = True

        # Check for answer marker
        answer_match = answer_pattern.match(text)
        if answer_match and current_question:
            answer_val = answer_match.group(1).strip()
            current_question['correct_answer'] = answer_val
            continue

        # Check for new question
        q_match = question_pattern.match(text)
        if q_match:
            finalize_question(current_question)
            q_num = int(q_match.group(1))
            q_text = q_match.group(2).strip()
            q_html = re.sub(
                r'^(?:Câu|Question|Q)\s*\d+\s*[.:)]\s*',
                '', html, flags=re.IGNORECASE
            )
            current_question = {
                'number': q_num,
                'content_text': q_text,
                'content_html': q_html,
                'choices': [],
                'correct_answer': None,
                'explanation': None,
                'explanation_html': None,
            }
            continue

        # Check for MCQ choice (A. B. C. D.)
        mcq_match = mcq_choice_pattern.match(text)
        if mcq_match and current_question:
            letter = mcq_match.group(1).upper()
            c_text = mcq_match.group(2).strip()
            c_html = re.sub(r'^[A-D]\s*[.)]\s*', '', html, flags=re.DOTALL)
            current_question['choices'].append({
                'letter': letter,
                'text': c_text,
                'html': c_html,
                'format': 'mcq',
                'underline': para['underline'],
            })
            # Reset explanation collection flag if we're now in choices
            current_question.pop('_collecting_explanation', None)
            continue

        # Check for TF choice (a) b) c) d))
        tf_match = tf_choice_pattern.match(text)
        if tf_match and current_question:
            letter = tf_match.group(1).lower()
            c_text = tf_match.group(2).strip()
            c_html = re.sub(r'^[a-d]\s*\)\s*', '', html, flags=re.DOTALL)
            current_question['choices'].append({
                'letter': letter,
                'text': c_text,
                'html': c_html,
                'format': 'tf',
                'underline': para['underline'],
            })
            current_question.pop('_collecting_explanation', None)
            continue

        # Otherwise append to current question content (multi-paragraph question)
        if current_question and not current_question['choices']:
            current_question['content_text'] += '\n' + text
            current_question['content_html'] += '<br>' + html

    # Don't forget the last question
    finalize_question(current_question)

    return questions


def check_underline(inlines):
    """Check if any inline element in a Pandoc AST list has underline formatting."""
    if isinstance(inlines, list):
        for node in inlines:
            if isinstance(node, dict):
                t = node.get('t', '')
                c = node.get('c', '')
                if t == 'Underline':
                    return True
                # Recurse into containers
                if t in ('Strong', 'Emph', 'Span', 'Strikeout', 'Superscript', 'Subscript', 'SmallCaps'):
                    if check_underline(c):
                        return True
                if isinstance(c, list):
                    if check_underline(c):
                        return True
    return False


def collect_images(images_dir):
    """Collect all extracted images from the pandoc media directory."""
    images = []
    media_dir = Path(images_dir) / 'media'
    if not media_dir.exists():
        return images

    for img_path in sorted(media_dir.iterdir()):
        if img_path.is_file():
            with open(img_path, 'rb') as f:
                data = f.read()
            ext = img_path.suffix.lower()
            content_type_map = {
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.bmp': 'image/bmp',
                '.emf': 'image/emf',
                '.wmf': 'image/wmf',
                '.tif': 'image/tiff',
                '.tiff': 'image/tiff',
            }
            images.append({
                'name': f'media/{img_path.name}',
                'data_base64': base64.b64encode(data).decode('ascii'),
                'content_type': content_type_map.get(ext, 'application/octet-stream'),
            })
    return images


@app.route('/convert', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only .docx is allowed.'}), 400

    # Check file size
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return jsonify({'error': f'File too large. Max {MAX_FILE_SIZE // (1024*1024)} MB.'}), 400

    tmpdir = tempfile.mkdtemp()
    try:
        # Save uploaded file
        input_path = os.path.join(tmpdir, 'input.docx')
        file.save(input_path)

        # Run pandoc: DOCX → JSON AST, extracting media
        result = subprocess.run(
            [
                'pandoc',
                input_path,
                '-f', 'docx',
                '-t', 'json',
                '--extract-media', tmpdir,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            return jsonify({'error': f'Pandoc error: {result.stderr}'}), 500

        ast_data = json.loads(result.stdout)

        # Parse questions from AST
        questions = parse_questions_from_ast(ast_data, tmpdir)

        # Collect extracted images
        images = collect_images(tmpdir)

        return jsonify({
            'questions': questions,
            'images': images,
            'question_count': len(questions),
            'image_count': len(images),
        })

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Pandoc processing timed out'}), 504
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Failed to parse Pandoc output: {str(e)}'}), 500
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
