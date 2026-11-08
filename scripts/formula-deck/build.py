# Adds the worked example (slides 16-25) to the formula deck: cloned from the deck's own shapes (base.pptx, the 16 slides
# before it), every number recomputed by hand from the formulas on the slides and asserted against what the app's
# calculation returns, so a change in src/calc that moves a number stops the build.
#   AXISPILOT_DECK=tmp/formula-deck npx vitest run scripts/formula-deck/values.test.ts
#   uvx --no-config --with python-pptx python scripts/formula-deck/build.py [out.pptx]
# It writes to tmp/ unless told otherwise: edits made to docs/ in PowerPoint are not in base.pptx and would be lost.
import copy
import json
import math
import re
import sys
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.chart.data import XyChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches, Pt

A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS = {'a': A, 'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
q = lambda tag: '{%s}%s' % (A, tag)
E = 914400

HERE = Path(__file__).resolve().parent
WORK = HERE.parent.parent / 'tmp' / 'formula-deck'
src = HERE / 'base.pptx'
out = sys.argv[1] if len(sys.argv) > 1 else WORK / 'AxisPilot-선정수식.pptx'
values = json.loads((WORK / 'values.json').read_text(encoding='utf-8'))
ex = values['example']
whatif = {c['name']: c for c in values['whatIf']}
motorM = values['nextMotor']


def same(a, b, tol=1e-3):
    assert abs(a - b) <= tol * max(abs(b), 1e-9), (a, b)
    return a


def check(label, group):
    return next(c for c in group if c['label'] == label)


# ---------- hand calculation, against the app ----------
G = 9.81
ax, mo, kit, ctl = ex['axis'], ex['motor'], ex['kit'], ex['controller']
S, v, a_, m_load = 0.5, 0.5, 2.0, 15.0
x, y, z = 0.05, 0.03, 0.08
dwell, eta, mu, dS, T0 = 0.5, 0.9, 0.05, ax['feed'], ax['T0']
Ta = v / a_
Sa = v * Ta / 2
Sc = S - 2 * Sa
Tc = Sc / v
tmove = 2 * Ta + Tc
tf = 2 * tmove + dwell
same(Ta, ex['profile']['accelTime']); same(Sa, ex['profile']['accelDistance']); same(tmove, ex['profile']['moveTime']); same(tf, ax['cycle'])

N = 60000 * v / dS
omega = 2 * math.pi * v / (dS / 1000)
alpha = 2 * math.pi * a_ / (dS / 1000)
m = m_load + ax['slideMass']
J = ax['J0'] + ax['JH'] * S + ax['JL'] * m_load
same(m, ax['movingMass']); same(J, ax['inertia']); same(N, ex['drive']['speed'])

Fext = mu * m * G
F = {k: m * s * a_ + Fext for k, s in (('acc', 1), ('run', 0), ('dec', -1))}
Tj = {k: J * 1e-4 * alpha * s for k, s in (('acc', 1), ('run', 0), ('dec', -1))}
Tf = Fext * dS / (2000 * math.pi)
Tax = {k: Tj[k] + Tf + T0 for k in Tj}
got = {round(s['a']): s for s in ex['samples'] if s['dir'] == 1}
same(F['acc'], got[2]['force']); same(Fext, got[0]['force']); same(F['dec'], got[-2]['force'])
same(Tax['acc'], got[2]['torque']); same(Tax['run'], got[0]['torque']); same(Tax['dec'], got[-2]['torque'])
same(F['acc'], check('이송력 Fx', ex['checks'])['value'])

Fz, Ft = m * G, m * a_
Mx = y * Fz
My = x * Fz + z * Ft
Mz = y * Ft
rates = [('Fz', Fz, ax['Fz'], 'N'), ('Mx', Mx, ax['Mx'], 'Nm'), ('My', My, ax['My'], 'Nm'), ('Mz', Mz, ax['Mz'], 'Nm')]
fv = sum(r[1] / r[2] for r in rates)
same(fv, ax['fv'])
Lguide = 5000 / fv ** 3
same(Lguide, next(i for i in ex['info'] if i['label'] == '가이드 예상 수명')['value'])

Lspan = 500 + ax['base']
E_ = 70000
Fd, Wd = m * G, ax['axisMass'] * G
d1 = Fd * Lspan ** 3 / (48 * E_ * ax['Iy'])
d2 = 5 * Wd * Lspan ** 3 / (384 * E_ * ax['Iy'])
same(d1 + d2, check('처짐', ex['checks'])['value'])

fw = 1.5
weights = [(abs(F['acc']), Sa), (abs(F['run']), Sc), (abs(F['dec']), Sa)]
Fm = (sum(f ** 3 * s for f, s in weights) / S) ** (1 / 3)
Lscrew = (ax['Ca'] / (fw * Fm)) ** 3 * dS
same(Lscrew, next(i for i in ex['info'] if i['label'] == '볼스크류 예상 수명')['value'])

JM = mo['inertia']
rotor = JM * 1e-4 * alpha
TM = {'acc': Tax['acc'] / eta + rotor, 'run': Tax['run'] / eta, 'dec': Tax['dec'] / eta - rotor}
same(TM['acc'], ex['drive']['peak']); same(TM['run'], check('등속 구간 토크', ex['drive']['checks'])['value'])
Trms = math.sqrt(2 * (TM['acc'] ** 2 * Ta + TM['run'] ** 2 * Tc + TM['dec'] ** 2 * Ta) / tf)
same(Trms, ex['drive']['rms'])
ratio = J / JM
same(ratio, ex['drive']['ratio'])
assert TM['dec'] > 0  # no regeneration
assert ctl['resistor']['averagePower'] == 0

Jk = kit['J']
kitRotor = Jk * 1e-4 * alpha
Tkit = Tax['acc'] / eta + kitRotor
same(Tkit, check('키트 전달 토크', kit['checks'])['value'])
ratioK = (J + Jk) / JM
same(ratioK, check('관성비 (키트 포함)', kit['checks'])['value'])
TMk = TM['acc'] + kitRotor
same(TMk, check('최대 토크 (키트 포함)', kit['checks'])['value'])
TMkdec = TM['dec'] - kitRotor
Trmsk = math.sqrt(2 * ((TMk) ** 2 * Ta + TM['run'] ** 2 * Tc + TMkdec ** 2 * Ta) / tf)
same(Trmsk, check('실효 토크 (키트 포함)', kit['checks'])['value'])

Irms = Trms / mo['kt']
Ipk = TM['acc'] / mo['kt']
same(Irms, ctl['rmsCurrent']); same(Ipk, ctl['peakCurrent'])
drv = ctl['controller']
cable = ctl['cables'][0]

# ---------- deck building blocks ----------
prs = Presentation(str(src))
tpl = list(prs.slides[3].shapes)
T_BADGE, T_BADGE_TX, T_TITLE, T_CARD, T_HEAD = (tpl[i]._element for i in (0, 1, 2, 3, 4))
T_DARK = tpl[15]._element
T_NUM = tpl[18]._element
tbl7 = [s for s in prs.slides[6].shapes if s.has_table][0]._element
LAYOUT = prs.slides[3].slide_layout


class Slide:
    def __init__(self, title):
        self.s = prs.slides.add_slide(LAYOUT)
        tree = self.s.shapes._spTree
        for sh in list(self.s.shapes):
            tree.remove(sh._element)
        self.tree = tree
        self.n = 2
        self.add(T_BADGE)
        badge = self.add(T_BADGE_TX)
        badge.find('.//' + q('t')).text = '예'
        t = self.add(T_TITLE)
        t.find('.//' + q('t')).text = title
        self.num = T_NUM

    def add(self, tpl_el):
        el = copy.deepcopy(tpl_el)
        el.find('.//p:cNvPr', NS).set('id', str(self.n))
        self.n += 1
        self.tree.append(el)
        return el

    def place(self, el, X, Y, W, H):
        off, ext = el.find('.//' + q('off')), el.find('.//' + q('ext'))
        off.set('x', str(int(X * E))); off.set('y', str(int(Y * E)))
        ext.set('cx', str(int(W * E))); ext.set('cy', str(int(H * E)))

    def card(self, X, Y, W, H, dark=False, name='card'):
        el = self.add(T_DARK if dark else T_CARD)
        self.place(el, X, Y, W, H)
        el.find('.//p:cNvPr', NS).set('name', name)
        # the same corner radius whatever the size
        el.find('.//' + q('gd')).set('fmla', 'val %d' % round(0.08 / min(W, H) * 100000))
        return el

    def text(self, X, Y, W, H, lines, size=16, color='tx1', bold=False, math_=False, anchor='t', after=4, algn=None):
        el = self.add(T_HEAD)
        self.place(el, X, Y, W, H)
        body = el.find('.//p:txBody', NS)
        body.find(q('bodyPr')).set('anchor', anchor)
        for p in body.findall(q('p')):
            body.remove(p)
        for line in ([lines] if isinstance(lines, str) else lines):
            paragraph(body, line, size, color, bold, math_, after, algn)
        return el

    def head(self, X, Y, W, text_, dark=False):
        return self.text(X, Y, W, 0.4, text_, 14, 'accent1' if dark else 'accent2', True, anchor='ctr', after=0)

    def table(self, X, Y, widths, rows, rowh=0.4, size=13, align=None, status_col=None, math_cols=()):
        g = self.add(tbl7)
        tbl = g.find('.//' + q('tbl'))
        trs = tbl.findall(q('tr'))
        head_tr, body_tr = trs[0], trs[1]
        grid = tbl.find(q('tblGrid'))
        for c in list(grid):
            grid.remove(c)
        for w in widths:
            etree.SubElement(grid, q('gridCol')).set('w', str(int(w * E)))
        for tr in trs:
            tbl.remove(tr)
        for r, row in enumerate(rows):
            tr = copy.deepcopy(head_tr if r == 0 else body_tr)
            tr.set('h', str(int(rowh * E)))
            tcs = tr.findall(q('tc'))
            first, rest = tcs[0], tcs[1]
            for tc in tcs:
                tr.remove(tc)
            insert_at = 0
            for c, val in enumerate(row):
                tc = copy.deepcopy(first if c == 0 else rest)
                body = tc.find(q('txBody'))
                for p in body.findall(q('p')):
                    body.remove(p)
                color = 'bg1' if r == 0 else 'tx2' if c == 0 else 'tx1'
                is_bold = r == 0 or c == 0
                srgb = None
                if r and status_col == c:
                    is_bold = True
                    srgb = {'적합': '1D8049', '경고': 'C25E00', '불합격': 'C8322B'}.get(val)
                paragraph(body, val, size, color, is_bold, r > 0 and c in math_cols, 0, (align or {}).get(c), srgb=srgb)
                tr.insert(insert_at, tc)
                insert_at += 1
            # after the cells comes nothing else in these tables
            tbl.append(tr)
        self.place_frame(g, X, Y, sum(widths), rowh * len(rows))
        return g

    def place_frame(self, g, X, Y, W, H):
        xf = g.find('p:xfrm', NS)
        off, ext = xf.find(q('off')), xf.find(q('ext'))
        off.set('x', str(int(X * E))); off.set('y', str(int(Y * E)))
        ext.set('cx', str(int(W * E))); ext.set('cy', str(int(H * E)))

    def finish(self):
        self.add(self.num)


HANGUL = re.compile(r'([ㄱ-힣①-⑩]+(?:[ ·,()/]*[ㄱ-힣①-⑩]+)*)')
SUBSUP = re.compile(r'([_^])\{([^}]*)\}')


def add_font(rPr, face):
    for tag, cs in (('latin', '0'), ('ea', '-122'), ('cs', '-120')):
        f = etree.SubElement(rPr, q(tag))
        f.set('typeface', face); f.set('pitchFamily', '34'); f.set('charset', cs)


def run(p, text_, size, color, bold, face, baseline=None, srgb=None):
    if not text_:
        return
    r = etree.SubElement(p, q('r'))
    rPr = etree.SubElement(r, q('rPr'))
    rPr.set('lang', 'ko-KR'); rPr.set('sz', str(int(size * 100))); rPr.set('dirty', '0')
    if bold:
        rPr.set('b', '1')
    if baseline:
        rPr.set('baseline', str(baseline))
    fill = etree.SubElement(rPr, q('solidFill'))
    if srgb:
        etree.SubElement(fill, q('srgbClr')).set('val', srgb)
    else:
        etree.SubElement(fill, q('schemeClr')).set('val', color)
    if face:
        add_font(rPr, face)
    etree.SubElement(r, q('t')).text = text_


def paragraph(body, line, size, color, bold, math_, after, algn=None, srgb=None):
    p = etree.SubElement(body, q('p'))
    pPr = etree.SubElement(p, q('pPr'))
    pPr.set('indent', '0'); pPr.set('marL', '0')
    if algn:
        pPr.set('algn', algn)
    if after:
        etree.SubElement(etree.SubElement(pPr, q('spcAft')), q('spcPts')).set('val', str(after * 100))
    etree.SubElement(pPr, q('buNone'))
    pos = 0
    pieces = []
    for m in SUBSUP.finditer(line):
        pieces.append((line[pos:m.start()], None))
        pieces.append((m.group(2), -25000 if m.group(1) == '_' else 30000))
        pos = m.end()
    pieces.append((line[pos:], None))
    for piece, baseline in pieces:
        for i, part in enumerate(HANGUL.split(piece)):
            if not part:
                continue
            face = 'Malgun Gothic' if i % 2 else ('Cambria Math' if math_ else None)
            run(p, part, size, color, bold, face, baseline, srgb)


# number format helpers
def f(v_, n=3):
    return f'{v_:,.{n}f}'


def pct(a, b):
    return f'{a / b * 100:.0f}%'


# ---------- slides ----------
made = []

# 1. inputs and result
s = Slide('계산 예시: 조건을 넣으면 이렇게 선정됩니다')
s.table(0.6, 1.5, [2.2, 2.5], [['입력', '값'], ['스트로크', '500 mm'], ['속도', '0.5 m/s'], ['가속도', '2 m/s²'], ['저크', '0 (사다리꼴)'], ['부하', '15 kg'], ['무게중심 X / Y / Z', '50 / 30 / 80 mm'], ['설치 방향', '바닥'], ['휴지 시간', '0.5 s']], rowh=0.45)
s.card(5.6, 1.5, 7.15, 4.05, dark=True, name='선정 결과')
s.head(5.85, 1.62, 6.6, '선정 결과: 모두 적합', dark=True)
rows = [('① 축', f"{ax['order']['model']}  (품번 {ax['order']['partNumber']})"), ('② 모터', f"{mo['id']}  (품번 {mo['pn']})"), ('③ 감속기', '사용 안 함 (직결)'), ('④ 연결키트', f"{kit['product']}  (품번 {kit['part']})"), ('드라이브', f"{drv['model']}  (품번 {drv['partNumber']})")]
yy = 2.12
for label, val in rows:
    s.text(5.85, yy, 1.4, 0.6, label, 15, 'accent1', True, anchor='ctr', after=0)
    s.text(7.2, yy, 5.4, 0.6, val, 15, 'bg1', anchor='ctr', after=0)
    yy += 0.66
s.text(0.6, 5.72, 12.15, 0.8, ['기본 설정: 효율 η 0.9, 마찰 μ 0.05, 커플링 관성 0, 외력 Fc와 가이드 저항 FG 0. 모터는 적합 목록에서 브레이크 없는 가장 작은 것을 골랐습니다.', '이어지는 숫자는 수식에 직접 대입한 값이며, 앱의 계산 코드(src/calc)를 같은 입력으로 실행한 결과와 대조했습니다.'], 12, 'accent5', after=3)
s.finish(); made.append(s)

# 2. motion profile with a native chart
s = Slide('예시 1. 모션 프로파일: 시간을 먼저 정합니다')
s.card(0.6, 1.5, 6.0, 4.75, name='프로파일 계산')
s.head(0.85, 1.62, 5.5, '사다리꼴 (저크 0)')
s.text(0.85, 2.1, 5.55, 3.2, [
    f'T_{{a}} = v / a = 0.5 / 2 = {Ta:.2f} s',
    f'S_{{a}} = v·T_{{a}} / 2 = 0.5 × 0.25 / 2 = {Sa * 1000:.1f} mm',
    f'S_{{c}} = S − 2·S_{{a}} = 500 − 125 = {Sc * 1000:.0f} mm',
    f'T_{{c}} = S_{{c}} / v = 0.375 / 0.5 = {Tc:.2f} s',
    f't_{{move}} = 2·T_{{a}} + T_{{c}} = 0.5 + 0.75 = {tmove:.2f} s',
    f't_{{f}} = 1.25 + 0.5 + 1.25 = {tf:.1f} s',
], 16, 'tx1', math_=True, after=7)
s.text(0.85, 5.3, 5.55, 0.8, ['2·S_{a} = 125 mm가 스트로크 500 mm보다 짧아 설정 속도 0.5 m/s에 도달합니다.', 't_{f}: 전진 + 휴지 + 복귀, 실효 토크의 분모가 됩니다.'], 12, 'accent5', after=3)
pts = [(0, 0), (Ta, v), (Ta + Tc, v), (tmove, 0), (tmove + dwell, 0), (tmove + dwell + Ta, -v), (tmove + dwell + Ta + Tc, -v), (tf, 0)]
cd = XyChartData()
ser = cd.add_series('속도')
for px, py in pts:
    ser.add_data_point(px, py)
gf = s.s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER_LINES_NO_MARKERS, Inches(6.85), Inches(1.5), Inches(5.9), Inches(4.75), cd)
gf.name = '속도 프로파일 차트'
ch = gf.chart
ch.has_legend = False
ch.has_title = True
ch.chart_title.text_frame.text = '속도 v [m/s], 한 사이클 3.0 s'
tr_ = ch.chart_title.text_frame.paragraphs[0].runs[0]
tr_.font.size = Pt(14); tr_.font.bold = True
ch.font.size = Pt(12)
ch.font.name = 'Malgun Gothic'
sr = ch.plots[0].series[0]
sr.smooth = False
from pptx.enum.dml import MSO_THEME_COLOR
sr.format.line.color.theme_color = MSO_THEME_COLOR.ACCENT_2
sr.format.line.width = Pt(2.5)
va, ca = ch.value_axis, ch.category_axis
va.minimum_scale, va.maximum_scale, va.major_unit = -0.75, 0.75, 0.25
ca.minimum_scale, ca.maximum_scale, ca.major_unit = 0, 3, 0.5
va.major_gridlines.format.line.color.rgb = __import__('pptx.dml.color', fromlist=['RGBColor']).RGBColor(0xD5, 0xDD, 0xE9)
ca.has_major_gridlines = False
va.tick_labels.number_format = '0.00'; va.tick_labels.number_format_is_linked = False
ca.tick_labels.number_format = '0.0'; ca.tick_labels.number_format_is_linked = False
from pptx.enum.chart import XL_TICK_LABEL_POSITION
ca.tick_label_position = XL_TICK_LABEL_POSITION.LOW
ca.has_title = True
ca.axis_title.text_frame.text = '시간 t [s]'
ca.axis_title.text_frame.paragraphs[0].runs[0].font.size = Pt(12)
ca.axis_title.text_frame.paragraphs[0].runs[0].font.bold = False
s.finish(); made.append(s)

# 3. speed, mass, inertia
s = Slide('예시 2. 회전수, 이동 질량, 부하 관성')
W = 3.9
cards = [
    (0.6, '회전수 · 각가속도', [f'N = 60000 × 0.5 / 20 = {N:.0f} rpm', f'ω = 2π × 0.5 / 0.02 = {omega:.1f} rad/s', f'α = 2π × 2 / 0.02 = {alpha:.1f} rad/s²'], '리드 dS = 20 mm/rev, 감속기 없음 (i = 1)'),
    (4.725, '이동 질량', [f'm = m_{{부하}} + m_{{슬라이드}}', f'm = 15 + {ax["slideMass"]} = {m:.3f} kg'], f'슬라이드 질량 {ax["slideMass"]} kg은 데이터 시트 값'),
    (8.85, '부하 관성 [kg·cm²]', ['J = J_{0} + J_{H}·S + J_{L}·m_{부하}', f'J = {ax["J0"]} + {ax["JH"]} × 0.5', f'    + {ax["JL"]} × 15 = {J:.4f}'], 'S는 m 단위 주문 스트로크, 관성 계수는 데이터 시트 값'),
]
for X, h, lines, note in cards:
    s.card(X, 1.5, W, 2.75, name=h)
    s.head(X + 0.2, 1.62, W - 0.4, h)
    s.text(X + 0.2, 2.1, W - 0.35, 1.4, lines, 15, 'tx1', math_=True, after=6)
    s.text(X + 0.2, 3.55, W - 0.35, 0.6, note, 12, 'accent5', after=0)
s.card(0.6, 4.5, 12.15, 1.75, dark=True, name='중간 결과')
for X, big, small in ((0.9, f'{N:,.0f} rpm', '모터 회전수'), (4.95, f'{m:.3f} kg', '가감속되는 질량'), (9.1, f'{J:.3f} kg·cm²', '구동축 기준 부하 관성')):
    s.text(X, 4.68, 3.7, 0.85, big, 30, 'accent1', True, anchor='ctr', after=0)
    s.text(X, 5.53, 3.7, 0.45, small, 14, 'bg1', anchor='ctr', after=0)
s.finish(); made.append(s)

# 4. axis torque by segment
s = Slide('예시 3. 구간별 힘과 축 토크: 가속 구간이 최대')
s.card(0.6, 1.5, 12.15, 2.25, name='가속 구간 대입')
s.head(0.85, 1.6, 8, '가속 구간 대입 (μ = 0.05, T_{0} = 0.2 Nm)')
s.text(0.85, 2.05, 11.7, 1.6, [
    f'F_{{ext}} = μ·m·g = 0.05 × {m:.3f} × 9.81 = {Fext:.2f} N',
    f'F = m·a + F_{{ext}} = {m:.3f} × 2 + {Fext:.2f} = {F["acc"]:.2f} N',
    f'T_{{axis}} = J·10⁻⁴·α + F_{{ext}}·dS / (2000π) + T_{{0}} = {Tj["acc"]:.4f} + {Tf:.4f} + 0.2 = {Tax["acc"]:.4f} Nm',
], 16, 'tx1', math_=True, after=5)
rows = [['구간', '가속도 [m/s²]', '이송력 F [N]', '가속 토크 [Nm]', '외력 토크 [Nm]', 'T_{0} [Nm]', 'T_{axis} [Nm]']]
for k, name, acc in (('acc', '가속', '+2'), ('run', '등속', '0'), ('dec', '감속', '−2')):
    rows.append([name, acc, f(F[k], 2).replace('-', '−'), f(Tj[k], 4).replace('-', '−'), f(Tf, 4), '0.2', f(Tax[k], 4)])
right = {i: 'r' for i in range(1, 7)}
s.table(0.6, 3.95, [1.55, 1.75, 1.75, 1.85, 1.85, 1.35, 2.05], rows, rowh=0.42, align=right, math_cols=range(1, 7))
s.text(0.6, 5.8, 12.15, 0.7, [f'판정: 이송력 {F["acc"]:.2f} N ≤ F_{{x,max}} {ax["Fx"]} N, 부하율 {pct(F["acc"], ax["Fx"])}. 복귀(−방향)는 부호만 반대입니다.', '감속 구간에도 T_{axis}가 양수입니다. 마찰과 무부하 토크가 감속 토크보다 커서 모터가 계속 밀어 줍니다.'], 13, 'tx1', after=3)
s.finish(); made.append(s)

# 5. guide
s = Slide('예시 4. 가이드: 무게중심 오프셋이 모멘트가 됩니다')
s.card(0.6, 1.5, 5.75, 3.05, name='하중 대입')
s.head(0.85, 1.6, 5.3, '힘과 모멘트 (x 50, y 30, z 80 mm)')
s.text(0.85, 2.05, 5.4, 2.4, [
    f'F_{{z}} = m·g = {m:.3f} × 9.81 = {Fz:.1f} N',
    f'F_{{t}} = m·a = {m:.3f} × 2 = {Ft:.1f} N',
    f'M_{{x}} = y·F_{{z}} = 0.03 × {Fz:.1f} = {Mx:.2f} Nm',
    f'M_{{y}} = x·F_{{z}} + z·F_{{t}} = {x * Fz:.2f} + {z * Ft:.2f} = {My:.2f} Nm',
    f'M_{{z}} = y·F_{{t}} = 0.03 × {Ft:.1f} = {Mz:.2f} Nm',
], 15, 'tx1', math_=True, after=5)
rows = [['항목', '하중', '허용값', '비율']]
for name, val, lim, unit in rates:
    rows.append([f'{name[0]}_{{{name[1]}}}', f'{val:.2f} {unit}', f'{lim:,} {unit}', f'{val / lim:.3f}'])
rows.append(['합계 fv', '', '', f'{fv:.3f}'])
s.table(6.6, 1.5, [1.55, 1.6, 1.65, 1.35], rows, rowh=0.5, align={1: 'r', 2: 'r', 3: 'r'}, math_cols=(1, 2, 3))
s.card(0.6, 4.75, 12.15, 1.5, dark=True, name='가이드 결과')
s.text(0.9, 4.88, 3.4, 0.8, f'fv = {fv:.2f}', 30, 'accent1', True, anchor='ctr', after=0)
s.text(0.9, 5.65, 3.4, 0.4, '1 이하이면 적합', 14, 'bg1', anchor='ctr', after=0)
s.text(4.5, 4.88, 8.0, 0.65, f'수명 L = 5000 km / fv³ = 5000 / {fv:.3f}³ ≈ {Lguide:,.0f} km', 18, 'bg1', math_=True, anchor='ctr', after=0)
s.text(4.5, 5.5, 8.0, 0.6, f'비율이 가장 큰 항목은 M_{{y}} ({My / ax["My"]:.3f}): 무게중심을 낮추거나 이동 방향 오프셋 x를 줄이면 가장 많이 내려갑니다.', 13, 'bg1', after=0)
s.finish(); made.append(s)

# 6. deflection and screw life
s = Slide('예시 5. 처짐과 볼스크류 수명')
HW = 5.95
s.card(0.6, 1.5, HW, 3.3, name='처짐')
s.head(0.85, 1.6, 5.4, '처짐 (양 끝 지지, 지지 간격 730 mm)')
s.text(0.85, 2.05, 5.5, 2.0, [
    f'F = m·g = {Fd:.1f} N,   W = m_{{축}}·g = {ax["axisMass"]} × 9.81 = {Wd:.1f} N',
    f'F·L³ / (48·E·I) = {d1:.4f} mm',
    f'5·W·L³ / (384·E·I) = {d2:.4f} mm',
    f'δ = {d1:.4f} + {d2:.4f} = {d1 + d2:.4f} mm',
], 15, 'tx1', math_=True, after=6)
s.text(0.85, 4.05, 5.5, 0.65, [f'L = 500 + 기본 길이 {ax["base"]:.0f} = {Lspan:.0f} mm, E = 70000 N/mm², I_{{y}} = {ax["Iy"]:,} mm⁴ (바닥 설치), m_{{축}}: 축 전체 질량'], 12, 'accent5', after=0)
s.card(6.8, 1.5, HW, 3.3, name='볼스크류 수명')
s.head(7.05, 1.6, 5.4, '볼스크류 수명 (C_{a} = 7100 N, 리드 20 mm)')
s.text(7.05, 2.05, 5.5, 2.0, [
    f'F_{{m}} = ∛( Σ|F|³·거리 / Σ거리 )',
    f'= ∛( ({F["acc"]:.1f}³×62.5 + {F["run"]:.2f}³×375 + {abs(F["dec"]):.1f}³×62.5) / 500 )',
    f'= {Fm:.2f} N,   f_{{w}} = 1.5 (v ≤ 1 m/s)',
    f'L = (7100 / (1.5 × {Fm:.2f}))³ × 20 ≈ {Lscrew:.2e} km'.replace('e+0', ' × 10^{').replace(' km', '} km'),
], 15, 'tx1', math_=True, after=6)
s.text(7.05, 4.05, 5.5, 0.65, ['거리는 가속 62.5, 등속 375, 감속 62.5 mm. 앱의 수치 적분과 같은 값입니다. 5000 km 미만이면 경고입니다.'], 12, 'accent5', after=0)
s.card(0.6, 5.0, 12.15, 1.25, dark=True, name='처짐과 수명 결과')
s.text(0.9, 5.1, 5.7, 0.65, f'δ = {d1 + d2:.3f} mm ≤ 0.5 mm', 24, 'accent1', True, math_=True, anchor='ctr', after=0)
s.text(0.9, 5.72, 5.7, 0.4, f'부하율 {pct(d1 + d2, 0.5)}, 적합', 14, 'bg1', anchor='ctr', after=0)
s.text(7.05, 5.1, 5.5, 0.65, 'L ≫ 5000 km', 24, 'accent1', True, math_=True, anchor='ctr', after=0)
s.text(7.05, 5.72, 5.5, 0.4, '이 조건에서 스크류 수명은 제약이 아닙니다', 14, 'bg1', anchor='ctr', after=0)
s.finish(); made.append(s)

# 7. motor
s = Slide('예시 6. 모터: 효율로 나누고 로터 관성을 더합니다')
s.card(0.6, 1.5, 12.15, 1.45, name='모터 토크 대입')
s.head(0.85, 1.58, 11, f'{mo["id"]}: J_{{M}} {JM} kg·cm², 정격 {mo["rated"]} Nm, 최대 {mo["peak"]} Nm, 허용 관성비 {mo["allow"]}')
s.text(0.85, 2.02, 11.7, 0.85, [f'T_{{M}} = T_{{axis}} / η + J_{{M}}·10⁻⁴·α = {Tax["acc"]:.4f} / 0.9 + {JM} × 10⁻⁴ × {alpha:.1f} = {Tax["acc"] / eta:.4f} + {rotor:.4f} = {TM["acc"]:.4f} Nm'], 16, 'tx1', math_=True, after=0, anchor='ctr')
rows = [['구간', 'T_{axis} [Nm]', 'T_{M} [Nm]', '시간 [s]'], ['가속', f(Tax['acc'], 4), f(TM['acc'], 4), f'{Ta:.2f}'], ['등속', f(Tax['run'], 4), f(TM['run'], 4), f'{Tc:.2f}'], ['감속', f(Tax['dec'], 4), f(TM['dec'], 4), f'{Ta:.2f}']]
s.table(0.6, 3.15, [1.1, 1.55, 1.45, 1.15], rows, rowh=0.44, align={1: 'r', 2: 'r', 3: 'r'}, math_cols=(1, 2, 3))
s.text(0.6, 4.98, 5.25, 1.3, ['복귀 이동도 크기는 같습니다.', f'감속에서도 T_{{M}} > 0 (토크와 회전 방향이 같음)이므로 회생 에너지가 생기지 않습니다. 제동저항도 필요 없습니다.'], 13, 'tx1', after=4)
s.card(6.1, 3.15, 6.65, 3.1, dark=True, name='모터 판정')
s.text(6.35, 3.25, 6.2, 2.9, [
    f'T_{{peak}} = {TM["acc"]:.3f} Nm ≤ {mo["peak"]} Nm  ({pct(TM["acc"], mo["peak"])})',
    f'T_{{rms}} = √( 2 × ({TM["acc"]:.3f}²×0.25 + {TM["run"]:.3f}²×0.75',
    f'     + {TM["dec"]:.3f}²×0.25) / 3.0 ) = {Trms:.3f} Nm ≤ {mo["rated"]} Nm  ({pct(Trms, mo["rated"])})',
    f'N = {N:.0f} rpm ≤ 정격 {mo["ratedSpeed"]} rpm  ({pct(N, mo["ratedSpeed"])})',
    f'J / J_{{M}} = {J:.4f} / {JM} = {ratio:.2f} ≤ {mo["allow"]}  ({pct(ratio, mo["allow"])})',
], 15, 'bg1', math_=True, after=7, anchor='ctr')
s.finish(); made.append(s)

# 8. kit and drive
s = Slide('예시 7. 연결키트와 드라이브')
s.card(0.6, 1.5, HW, 4.75, name='연결키트')
s.head(0.85, 1.6, 5.4, f'{kit["product"]}: 전달 {kit["T"]} Nm, {kit["N"]} rpm, J {Jk} kg·cm²')
s.text(0.85, 2.08, 5.5, 3.0, [
    f'T_{{kit}} = T_{{axis}} / η + J_{{kit}}·10⁻⁴·α',
    f'= {Tax["acc"] / eta:.4f} + {kitRotor:.4f} = {Tkit:.4f} Nm ≤ {kit["T"]} Nm',
    f'N_{{kit}} = {N:.0f} rpm ≤ {kit["N"]} rpm',
    '키트를 포함해 모터를 다시 판정합니다.',
    f'T_{{M}} = {TM["acc"]:.4f} + {kitRotor:.4f} = {TMk:.4f} Nm',
    f'T_{{rms}} = {Trmsk:.4f} Nm',
    f'관성비 = ({J:.4f} + {Jk}) / {JM} = {ratioK:.2f} ≤ {mo["allow"]}',
], 15, 'tx1', math_=True, after=6)
s.text(0.85, 5.3, 5.5, 0.85, '키트는 축과 모터의 인터페이스 코드로 찾고, 판정을 통과한 것 중 데이터 시트 값이 있는 키트를 먼저 추천합니다. 커플링 관성 자리에 키트 관성이 들어갑니다.', 12, 'accent5', after=0)
s.card(6.8, 1.5, HW, 4.75, name='드라이브')
s.head(7.05, 1.6, 5.4, f'{drv["model"]}')
s.text(7.05, 2.08, 5.5, 3.0, [
    f'k_{{t}} = {mo["kt"]} Nm/A (모터 데이터)',
    f'I_{{rms}} = {Trms:.3f} / {mo["kt"]} = {Irms:.2f} A ≤ {drv["nominalCurrent"]} A',
    f'I_{{peak}} = {TM["acc"]:.3f} / {mo["kt"]} = {Ipk:.2f} A ≤ {drv["peakCurrent"]} A',
    f'피크 지속: 전류가 {drv["nominalCurrent"]} A를 넘는 구간 없음 (≤ {drv["peakDuration"]} s)',
    f'모터 케이블: {cable["type"]}',
    f'     5 m 표준 길이, 품번 {cable["partNumber"]}',
    '제동저항: 회생 에너지 0, 외부 저항 불필요',
], 15, 'tx1', math_=True, after=6)
s.text(7.05, 5.3, 5.5, 0.85, '이 전압 등급(CMMT-AS, 400 V)에서 전류와 피크 지속을 만족하는 가장 작은 드라이브를 고릅니다. 드라이브 전류는 키트를 뺀 모터 토크로 계산합니다.', 12, 'accent5', after=0)
s.finish(); made.append(s)

# 9. summary
s = Slide('예시 결과: 모두 적합, 여유가 가장 적은 항목은 관성비')
items = [
    ('스트로크', '500 mm', f'{check("스트로크", ex["checks"])["limit"]} mm', 500 / check('스트로크', ex['checks'])['limit']), ('속도', '0.5 m/s', f'{ax["vmax"]} m/s', v / ax['vmax']), ('이송력 Fx', f'{F["acc"]:.1f} N', f'{ax["Fx"]} N', F['acc'] / ax['Fx']),
    ('가이드 fv', f'{fv:.3f}', '1', fv), ('처짐', f'{d1 + d2:.3f} mm', '0.5 mm', (d1 + d2) / 0.5),
    ('최대 토크 (키트 포함)', f'{TMk:.3f} Nm', f'{mo["peak"]} Nm', TMk / mo['peak']), ('실효 토크 (키트 포함)', f'{Trmsk:.3f} Nm', f'{mo["rated"]} Nm', Trmsk / mo['rated']), ('회전수 (정격 기준)', f'{N:.0f} rpm', f'{mo["ratedSpeed"]} rpm', N / mo['ratedSpeed']),
    ('관성비 (키트 포함)', f'{ratioK:.2f}', f'{mo["allow"]}', ratioK / mo['allow']), ('키트 전달 토크', f'{Tkit:.3f} Nm', f'{kit["T"]} Nm', Tkit / kit['T']), ('드라이브 정격 전류', f'{Irms:.2f} A', f'{drv["nominalCurrent"]} A', Irms / drv['nominalCurrent']),
]
items.sort(key=lambda i: -i[3])
rows = [['항목', '계산값', '허용값', '부하율', '판정']] + [[a, b, c, f'{d * 100:.0f}%', '적합'] for a, b, c, d in items]
s.table(0.6, 1.45, [3.6, 1.7, 1.6, 1.15, 1.0], rows, rowh=0.385, size=13, align={1: 'r', 2: 'r', 3: 'r', 4: 'ctr'}, status_col=4)
s.card(9.9, 1.45, 2.85, 4.235, dark=True, name='읽는 법')
s.text(10.1, 1.58, 2.45, 0.8, f'{ratioK:.1f} / {mo["allow"]}', 28, 'accent1', True, anchor='ctr', after=0)
s.text(10.1, 2.38, 2.45, 3.6, ['부하를 더 늘리면 먼저 걸리는 항목이 관성비입니다.', '토크는 정격의 절반 이하로 여유가 큽니다.', '이 모터는 힘보다 관성에서 한계가 먼저 옵니다.'], 14, 'bg1', after=9)
s.finish(); made.append(s)

# 10. what if
w = whatif
assert w['m25']['bad'][0][0] == '관성비' and w['s1000']['bad'][0][0] == '속도' and w['vertical']['bad'][0][0] == '등속 구간 토크'
assert not w['x200z200']['bad']
same(w['m25']['ratio'], (ax['J0'] + ax['JH'] * S + ax['JL'] * 25) / JM)
s = Slide('값을 바꾸면 달라지는 결과: 어느 항목이 먼저 걸리는가')
rows = [['바꾼 값', '달라지는 계산', '결과', '판정', '대응']]
rows.append(['부하 15 → 25 kg', f'J = {ax["J0"]} + {ax["JH"]} × 0.5 + {ax["JL"]} × 25 = {(ax["J0"] + ax["JH"] * S + ax["JL"] * 25):.3f}', f'관성비 {w["m25"]["ratio"]:.1f} > {mo["allow"]}', '불합격', f'{motorM["motor"]}: 관성비 {motorM["ratio"]:.1f}, 적합'])
rows.append(['스트로크 500 → 1000 mm', '스크류가 길어져 속도-스트로크 선도의 한계가 내려감', f'한계 {w["s1000"]["bad"][0][2]:.2f} m/s < 0.5 m/s', '불합격', '속도를 낮추거나 스핀들 서포트, 더 큰 축 검토'])
rows.append(['무게중심 X 200, Z 200 mm', 'M_{y} = 0.2 × F_{z} + 0.2 × F_{t}, 오프셋만큼 모멘트 증가', f'fv {w["x200z200"]["fv"]:.2f}', '적합', '적합이지만 여유가 적음, 수명 감소에 유의'])
rows.append(['설치 바닥 → 수직', '무게 m·g가 등속 구간에도 걸림 (상승)', f'등속 토크 {w["vertical"]["bad"][0][1]:.2f} > {mo["rated"]} Nm', '경고', '정격이 더 큰 모터 또는 감속기 검토'])
s.table(0.6, 1.5, [2.45, 4.05, 2.2, 0.85, 2.6], rows, rowh=0.72, size=13, status_col=3, align={3: 'ctr'})
s.card(0.6, 5.3, 12.15, 0.95, dark=True, name='맺음')
s.text(0.9, 5.36, 11.6, 0.83, '판정이 바뀌는 지점은 조건마다 다릅니다. 표의 값은 모두 같은 축과 모터로 앱에서 다시 계산한 결과입니다.', 15, 'bg1', anchor='ctr', after=0)
s.finish(); made.append(s)

# ---------- order: the example before the closing slide ----------
lst = prs.slides._sldIdLst
ids = list(lst)
closing = ids[15]
lst.remove(closing)
lst.append(closing)

# ---------- a stale sentence on the motor slide: the conservative check is gone from the app ----------
fixed = 0
STALE = ' (보수적 판정: 불합격)'
for sh in prs.slides[11].shapes:
    if not sh.has_text_frame:
        continue
    for p in sh.text_frame.paragraphs:
        text = ''.join(r.text for r in p.runs)
        at = text.find(STALE)
        if at < 0:
            continue
        # the sentence is split over runs by font: cut the characters wherever they fall
        pos = 0
        for r in p.runs:
            start, end = pos, pos + len(r.text)
            pos = end
            keep = ''.join(c for i, c in zip(range(start, end), r.text) if not at <= i < at + len(STALE))
            r.text = keep
        assert STALE not in ''.join(r.text for r in p.runs)
        fixed += 1
assert fixed == 1
print('stale runs fixed', fixed)
prs.save(str(out))
print('slides', len(prs.slides))
print(json.dumps({'Fext': Fext, 'Tacc': Tax['acc'], 'fv': fv, 'L': Lguide, 'd': d1 + d2, 'Fm': Fm, 'Ls': Lscrew, 'TM': TM, 'rms': Trms, 'ratio': ratio, 'ratioK': ratioK, 'Irms': Irms, 'Ipk': Ipk}, ensure_ascii=False))
