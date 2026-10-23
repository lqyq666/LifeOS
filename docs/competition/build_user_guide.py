"""Build the editable Markdown into an A4 PDF and a matching public HTML guide.

Requires reportlab; uses LIFEOS_PDF_FONT or an installed Chinese sans-serif font.
Run: python docs/competition/build_user_guide.py
"""
from pathlib import Path
from hashlib import sha256
import html
import os
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle

ROOT = Path(__file__).resolve().parent
NAME = 'LifeOS_User_Guide_and_Submission_Checklist_20261023'
FONT = next((Path(p) for p in [os.environ.get('LIFEOS_PDF_FONT', ''),
    'C:/Windows/Fonts/simhei.ttf', '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf']
    if p and Path(p).is_file()), None)
if FONT is None:
    raise SystemExit('Set LIFEOS_PDF_FONT to a Chinese TrueType sans-serif font.')
pdfmetrics.registerFont(TTFont('LifeOS', str(FONT)))
BLUE = colors.HexColor('#245AC8')
body = ParagraphStyle('Body', fontName='LifeOS', fontSize=10.2, leading=16.5,
    textColor=colors.HexColor('#111111'), spaceAfter=10, wordWrap='CJK', alignment=TA_LEFT)
styles = {
    'body': body,
    'title': ParagraphStyle('Title', parent=body, fontSize=21, leading=29, textColor=BLUE, spaceAfter=19),
    'heading': ParagraphStyle('Heading', parent=body, fontSize=13, leading=20, textColor=BLUE, spaceBefore=7, spaceAfter=15),
    'quote': ParagraphStyle('Quote', parent=body, fontSize=10, leftIndent=10, rightIndent=8,
        borderColor=colors.HexColor('#D5D5D5'), borderWidth=.6, borderPadding=8, spaceAfter=13),
    'cell': ParagraphStyle('Cell', parent=body, fontSize=9, leading=14, spaceAfter=0),
}

def inline(value):
    value = html.escape(value)
    value = re.sub(r'\[([^\]]+)\]\((https://[^\s)]+)\)', r'<link href="\2" color="#245AC8">\1</link>', value)
    # Use the same Chinese font for emphasis, avoiding synthetic missing bold glyphs.
    return re.sub(r'\*\*(.+?)\*\*', r'<font color="#245AC8">\1</font>', value)

text = (ROOT / (NAME + '.md')).read_text(encoding='utf-8')
story = []
web = []
lines = text.splitlines()
i = 0
while i < len(lines):
    line = lines[i].strip()
    i += 1
    if not line:
        continue
    if line == '<!-- page -->':
        story.append(PageBreak())
        web.append('<hr>')
    elif line.startswith('|'):
        rows = [line]
        while i < len(lines) and lines[i].strip().startswith('|'):
            rows.append(lines[i].strip())
            i += 1
        data = [[inline(c.strip()) for c in row.strip('|').split('|')] for row in rows
                if not re.fullmatch(r'[| :\-]+', row)]
        table = Table([[Paragraph(c, styles['cell']) for c in row] for row in data],
            colWidths=[66, 90, 94, 78, 70, 109.276-0], repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F3F5F8')),
            ('LINEBELOW', (0, 0), (-1, -1), .5, colors.HexColor('#D5D5D5')),
            ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
        story.extend([table, Spacer(1, 14)])
        web.append('<div class="table-scroll"><table>' + ''.join('<tr>' + ''.join(
            f'<{"th" if n == 0 else "td"}>{c}</{"th" if n == 0 else "td"}>' for c in row) + '</tr>'
            for n, row in enumerate(data)) + '</table></div>')
    else:
        kind, tag = ('title', 'h1') if line.startswith('# ') else ('heading', 'h2') if line.startswith('## ') else ('quote', 'blockquote') if line.startswith('> ') else ('body', 'p')
        value = re.sub(r'^(?:#{1,2}|>) ', '', line)
        story.append(Paragraph(inline(value), styles[kind]))
        web.append(f'<{tag}>{inline(value)}</{tag}>')

def frame(canvas, doc):
    w, h = A4
    canvas.setFont('LifeOS', 9)
    canvas.setFillColor(BLUE)
    canvas.drawString(44, h-32, 'LifeOS')
    canvas.setStrokeColor(colors.HexColor('#D5D5D5'))
    canvas.line(44, h-41, w-44, h-41)
    canvas.setFillColor(colors.HexColor('#555555'))
    canvas.setFont('LifeOS', 8)
    canvas.drawString(44, 27, 'LifeOS · 作品使用说明与提交清单')
    canvas.drawRightString(w-44, 27, f'{doc.page} / 5')

pdf = SimpleDocTemplate(str(ROOT / (NAME+'.pdf')), pagesize=A4, rightMargin=44,
    leftMargin=44, topMargin=59, bottomMargin=48,
    title='LifeOS 作品使用说明与提交清单', author='LifeOS', pageCompression=1)
pdf.build(story, onFirstPage=frame, onLaterPages=frame)
markup = ''.join(web).replace('<link href=', '<a href=').replace('</link>', '</a>')
markup = re.sub(r' color="#[A-Fa-f0-9]+"', '', markup).replace('<font>', '<span>').replace('</font>', '</span>')
(ROOT/'guide.html').write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>LifeOS 作品使用说明</title>
<style>body{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:#111;max-width:900px;margin:0 auto;padding:32px 20px;line-height:1.85}h1,h2,a{color:#245AC8}h1{font-size:28px}h2{font-size:21px}p{margin:16px 0}blockquote{margin:16px 0;padding:12px;border-left:3px solid #d5d5d5;color:#555}table{border-collapse:collapse;min-width:750px;font-size:14px}td,th{border-bottom:1px solid #d5d5d5;padding:10px;text-align:left;vertical-align:top}th{background:#f3f5f8}.table-scroll{overflow-x:auto}hr{border:0;border-top:1px solid #d5d5d5;margin:35px 0}a{overflow-wrap:anywhere}</style>
<nav><a href="https://github.com/lqyq666/LifeOS/tree/competition/20261023/docs/competition">材料中心</a> · <a href="/">体验 LifeOS</a></nav><main>''' + markup + '</main></html>', encoding='utf-8', newline='\n')
public_names = ['index.html', 'guide.html', 'DELIVERY_STATUS.md', NAME+'.md',
    'build_user_guide.py', 'LINKS_READY_20261023.md', 'LifeOS_Submission_Links_20261023.txt']
(ROOT/'SHA256SUMS.txt').write_bytes(''.join(sha256((ROOT/n).read_bytes()).hexdigest()+'  '+n+'\n'
    for n in public_names if (ROOT/n).is_file()).encode('utf-8'))
print(ROOT/(NAME+'.pdf'))
