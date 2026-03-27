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
    Expected DOCX format:
      Câu 1: Question text...
      A. Choice A
      B. Choice B
      C. Choice C
      D. Choice D
      (Đáp án: B)  -- optional answer marker
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
            paragraphs.append({'text': text, 'html': html, 'block': block})
        elif t == 'Header':
            if isinstance(c, list) and len(c) >= 3:
                text = parse_pandoc_json(c[2]).strip()
                html = extract_inline_html(c[2], images_dir)
                paragraphs.append({'text': text, 'html': html, 'block': block})
        elif t == 'OrderedList':
            # Handle ordered list items as individual paragraphs
            if isinstance(c, list) and len(c) >= 2:
                for item_blocks in c[1]:
                    for ib in item_blocks:
                        ibt = ib.get('t', '')
                        ibc = ib.get('c', '')
                        if ibt in ('Para', 'Plain'):
                            text = parse_pandoc_json(ibc).strip()
                            html = extract_inline_html(ibc, images_dir)
                            paragraphs.append({'text': text, 'html': html, 'block': ib})
        elif t == 'BulletList':
            for item_blocks in c:
                for ib in item_blocks:
                    ibt = ib.get('t', '')
                    ibc = ib.get('c', '')
                    if ibt in ('Para', 'Plain'):
                        text = parse_pandoc_json(ibc).strip()
                        html = extract_inline_html(ibc, images_dir)
                        paragraphs.append({'text': text, 'html': html, 'block': ib})

    # Patterns for question detection
    # "Câu 1:", "Câu 1.", "Câu 1)", "Question 1:", "1.", "1)" etc.
    question_pattern = re.compile(
        r'^(?:Câu|Question|Q)\s*(\d+)\s*[.:)]\s*(.*)',
        re.IGNORECASE | re.DOTALL
    )
    # "A.", "A)", "a.", "a)" at the start of a line
    choice_pattern = re.compile(
        r'^([A-Da-d])\s*[.)]\s*(.*)',
        re.DOTALL
    )
    # Answer marker: "Đáp án: B", "Answer: C", "ĐÁ: A"
    answer_pattern = re.compile(
        r'(?:Đáp án|ĐÁ|Answer|Correct)\s*[:=]\s*([A-Da-d])',
        re.IGNORECASE
    )

    questions = []
    current_question = None

    for para in paragraphs:
        text = para['text']
        html = para['html']

        # Check for answer marker
        answer_match = answer_pattern.search(text)
        if answer_match and current_question:
            current_question['correct_answer'] = answer_match.group(1).upper()
            continue

        # Check for new question
        q_match = question_pattern.match(text)
        if q_match:
            if current_question:
                questions.append(current_question)
            q_num = int(q_match.group(1))
            q_text = q_match.group(2).strip()
            # Get HTML version: remove the "Câu X:" prefix from HTML
            q_html = re.sub(
                r'^(?:Câu|Question|Q)\s*\d+\s*[.:)]\s*',
                '',
                html,
                flags=re.IGNORECASE
            )
            current_question = {
                'number': q_num,
                'content_text': q_text,
                'content_html': q_html,
                'choices': [],
                'correct_answer': None,
            }
            continue

        # Check for choice
        c_match = choice_pattern.match(text)
        if c_match and current_question:
            letter = c_match.group(1).upper()
            c_text = c_match.group(2).strip()
            c_html = re.sub(
                r'^[A-Da-d]\s*[.)]\s*',
                '',
                html,
                flags=re.DOTALL
            )
            current_question['choices'].append({
                'letter': letter,
                'text': c_text,
                'html': c_html,
            })
            continue

        # Otherwise append to current question content (multi-paragraph question)
        if current_question and not current_question['choices']:
            current_question['content_text'] += '\n' + text
            current_question['content_html'] += '<br>' + html

    # Don't forget the last question
    if current_question:
        questions.append(current_question)

    return questions


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
