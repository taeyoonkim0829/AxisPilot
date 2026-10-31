---
name: AxisPilot
description: Festo axis, motor, gearbox and kit sizing, laid out as a route sign on crystal glass
colors:
  sign-blue: "#0a5a8a"
  sign-blue-deep: "#08486f"
  sign-ink: "#ffffff"
  sign-ink-2: "#a9c3d6"
  signal-yellow: "#f2b705"
  signal-ink: "#1a1400"
  signal-soft: "rgb(242 183 5 / 0.12)"
  ground: "#060a12"
  surface: "rgb(255 255 255 / 0.055)"
  surface-2: "rgb(255 255 255 / 0.05)"
  surface-solid: "rgb(14 21 32 / 0.94)"
  line: "rgb(255 255 255 / 0.11)"
  line-strong: "rgb(255 255 255 / 0.2)"
  text: "#e6edf5"
  muted: "#a3b1c2"
  accent: "#38bdf8"
  accent-ink: "#04111c"
  accent-soft: "rgb(56 189 248 / 0.16)"
  ok: "#4ade80"
  warn: "#fb923c"
  fail: "#f87171"
typography:
  sign-value:
    fontFamily: "Barlow Semi Condensed, Pretendard Variable, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.15
  step-title:
    fontFamily: "Pretendard Variable, Malgun Gothic, sans-serif"
    fontSize: "17px"
    fontWeight: 650
  body:
    fontFamily: "Pretendard Variable, Malgun Gothic, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "Barlow Semi Condensed, Pretendard Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    fontFeature: "tnum"
  label:
    fontFamily: "Pretendard Variable, Malgun Gothic, sans-serif"
    fontSize: "12px"
    fontWeight: 400
rounded:
  sm: "5px"
  md: "6px"
  lg: "8px"
  panel: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
components:
  route-box:
    backgroundColor: "transparent"
    textColor: "{colors.sign-ink}"
    rounded: "{rounded.md}"
    size: "42px"
  route-box-active:
    backgroundColor: "{colors.signal-yellow}"
    textColor: "{colors.signal-ink}"
  step-number:
    backgroundColor: "linear-gradient(160deg, #ffe27a, #f2b705 55%, #c98d00)"
    textColor: "{colors.signal-ink}"
    rounded: "8px"
    size: "28px"
  segmented-active:
    backgroundColor: "rgb(255 255 255 / 0.14)"
    textColor: "{colors.text}"
  row-selected:
    backgroundColor: "{colors.signal-soft}"
  panel:
    backgroundColor: "{colors.surface}"
    backdropFilter: "blur(24px) saturate(170%)"
    rounded: "{rounded.panel}"
    padding: "18px 20px"
  input:
    backgroundColor: "rgb(0 0 0 / 0.28)"
    rounded: "10px"
    height: "38px"
---

# Design System: AxisPilot

## Overview

**Creative North Star: "The Route Sign"**

The selection chain axis → motor → gearbox → kit is a route, and the app shows it as a DIN direction sign: a rail across the top with four numbered route boxes, chevrons between them, each carrying the chosen part number and its verdict. Everything below the rail is a quiet, dense working surface on **crystal glass**: a navy-black ground with three coloured lights (cyan top left, teal right, violet below), fixed, and clear glass panels moving over it that catch the light on their rims (a light rim brightest at the top left, a faint diagonal sheen, a deep shadow), with tables of exact numbers. Buttons are **prism glass**: thin and clear with a light rim, the one filled action (PDF로 내보내기) in a prism gradient (white, cyan, violet).

It is an operating tool, so the world contributes only type, palette, density and the one signature move (the rail). Controls stay standard web controls.

**Key Characteristics:**
- The shell and the panels are glass over one dark ground; the workspace stays neutral.
- Signal yellow means "your route" and nothing else.
- Every number and part number is set in a condensed DIN-like face with tabular figures.
- Every verdict sits next to its computed value and limit.

## Colors

Restrained workspace on a dark ground lit in three colours. The app is dark only; the PDF report keeps the light tokens (below).

### Primary
- **Accent** (#38bdf8): input focus, links, the motion profile trace. Only the filled PDF로 내보내기 action takes the **prism** fill (`--prism`: #e0f2fe → #7dd3fc → #38bdf8 → #a78bfa at 120°, dark ink #04111c, a white top highlight, a cyan glow). The logo's teal is not a UI colour: green tones are reserved for verdicts.
- **Sign Blue** (#0a5a8a): solid marks that need white text (notice dialog head, its OK button). Deep variant (#08486f) for hover.

### Secondary
- **Signal Yellow** (#f2b705): the active route box on the rail, step number boxes, the selected row outline, selection highlight, focus ring. Soft variant (yellow at 12%) fills the selected row.

### Neutral
- **Ground** (#060a12): page background, with three coloured lights as fixed background layers (`--glow-1/2/3`: cyan 30%, teal 14%, violet 24%; no yellow, which means the route only) for the glass to reflect; no grid, lines or drawings behind the work, so nothing competes with the numbers.
- **Surface** (white at 5.5%) glass panels, **Surface 2** (white at 5%) hover and fills inside panels, **Surface Solid** (rgb(14 21 32 / 0.94)) sticky table heads and the notice dialog, which content scrolls under.
- **Line** (white at 11%) / **Line Strong** (white at 20%): dividers, input borders, the input switches' outlines.
- **Text** (#e6edf5), **Muted** (#a3b1c2): secondary labels and units.

### State
- **OK** (#4ade80), **Warn** (#fb923c), **Fail** (#f87171): verdicts and ratio bars (under 80% ok, up to 100% warn, over fail), with soft variants at 14%.

### Report
The calculation report (`.report-stage`) is white paper and keeps the light tokens: sign blue #005a8c, signal yellow #ffcc00, ground #eef1f4, surface #ffffff, text #1a1d21, muted #5b6672, accent #0077b6, ok #1d8049, warn #c25e00, fail #c8322b.

### Named Rules
**The Reserved Yellow Rule.** Signal yellow marks the selected route only. Never use it for warnings, decoration or emphasis; amber-orange (#c25e00) is the warning colour.

**The Glass Over Ground Rule.** Only the shell and the panels are glass (`.app .panel`, `.app .rail`: `--glass-fill`, `backdrop-filter: blur(24px) saturate(170%)`, the rim `--glass-rim` as a 1px masked border in `::before`, the sheen `--glass-sheen` in `::after`); anything content scrolls under (table heads, dialogs) is nearly opaque so text never sits on text.

## Typography

**Data Font:** Barlow Semi Condensed (bundled via @fontsource), falling back to Pretendard.
**Body Font:** Pretendard Variable (bundled), falling back to Malgun Gothic.

**Character:** Korean text in a neutral workhorse sans; every figure and part number in a narrow road-sign face so long codes fit and columns align.

### Hierarchy
- **Logo** (`.page-brand`, 32px high): the AxisPilot logo on its own, outside the rail, its dark-background version (`axispilot-logo-dark.svg`) in both themes because the page is dark. Above 1000px it is fixed like the rail, beside it over the 320px condition column (22px in from its left edge, centred in the rail's height, above the scroll veil); at 1000px and below (the rail stacks into a column at the top of the page) it stands above the rail, centred (20px above, 4px below), and the rail sits 16px above the mode switch, the same space as below it.
- **Sign value** (600, 20px, 1.15): part numbers on the rail.
- **Step title** (650, 17px): panel headings.
- **Body** (400, 14px, 1.5): labels, notes, Korean copy.
- **Data** (500–600, 15px, tabular): table numbers, part numbers, input values (17px in inputs).
- **Label** (400, 12px, muted): field labels, units, column heads.

### Named Rules
**The Figures Are Signage Rule.** Any number a user compares (value, limit, ratio, part number) uses the data face with tabular figures. Korean words never do.

## Layout

A floating sticky rail (100px high, 12px from the top, `--rail-top`, over the results column only, as wide as its panels, rounded like them; the logo beside it over the condition column) over a centered 1600px workspace: a 320px sticky condition panel on the left and the results column on the right (axis step, motion profile, motor, gearbox, kit), 20px gaps. The condition panel is a sticky box starting 20px below the rail that scrolls on its own (`.inputs`); the results scroll with the page, so the wheel works anywhere, and pass under the rail: once the page has scrolled, a veil (`.rail-veil`: fixed from the window top to 48px below the rail, blur 14px, navy 55% → 35%, full blur to 20px below the rail (the condition panel's sticky top), fading out over the last 28px; the sticky condition panel, z-index 10, stays above it) blurs what is under and around the rail, and the rail's own glass blurs 1.5× harder (`.rail.over`); the footer ends the results column; a click on a route box scrolls the page to the step, stopping below the rail. Below 1280px the rail drops its brand block; below 1000px the rail becomes static, signs go 2×2 (1 column under 560px) and the layout stacks.

PDF export (PDF로 내보내기) renders a separate report (`Report.tsx`, mounted off screen at A4 content width, 703px) to a PDF that opens in a new tab: six chapters, each on a new page, with a sign-blue chapter bar, label/value spec tables and the check tables. The report always uses the light tokens. Chapter 1's meta line ends in `.report-link` (웹에서 이 계산 열기: accent colour, underlined), which the PDF makes a link to the same calculation on the web.

## Elevation & Depth

Glass layers. Panels are crystal glass over the fixed ground: a fill from white 13% (top left) to 3%, the light rim, a top inner highlight (white 40%) and a deep two-step shadow (`0 40px 80px -30px` black 75%, `0 12px 24px -12px` black 60%). The rail is the same glass, darker (`--glass-rail`), so it reads as floating above the work. Inputs are set into the glass (black 28%, inner shadow, 1px white-12% ring); route and step boxes are cut yellow gems (`--gem`, white top highlight, darker lower edge, yellow glow).

## Shapes

Rounded glass: panels and the rail 20px (`--panel-radius`), inputs and buttons 10px, segment tracks 12px with 9px pieces, route boxes 10px, step boxes 8px. Inactive route boxes are clear glass with a 1px rim.

## Components

- **Drive package (motor details, report)**: 13px `h4`, the 모터 케이블 길이 field (max 220px wide), a parts table (구분 · 형식 · 주문번호 · 비고, model names in the model font, notes muted), the required currents in small print, then the check table and the notes list.
- **Kit cell (motor table)**: verdict dot only (the word as tooltip) + kit name in muted text, one line, name cut with an ellipsis at 190px (full name in the title).
- **추가 검토사항 (kit step, report)**: a 13px `h4` (8px below it, like the other detail headings) and a plain bulleted list (`.kit-notes`, 1.6 line height) under the kit check table; notes are advice, so no status colour.
- **Combination drawing (step 5)**: parts table (구분 · 모델명 · 도면 파일 · 비고), then prism glass action buttons (`.action-btn`: clear with a 1px white-22% rim and a top highlight, brighter rim and a cyan glow on hover) for 3D 미리보기 / STEP / DXF with the progress text muted beside them. `.drawing-sides` sits above the buttons: label + small segmented rows (키트 조립 방향 for a parallel kit only, 모터 조립 방향 always: 상/하/좌/우) and a muted note on the viewpoint, with `.warn-text` lines when the connector faces the axis or the kit is set to 상 (usable stroke may be shorter). The 3D viewer (`.combo-viewer`) is a bordered box: a `--surface-2` bar with the view switch (등각/정면/평면/우측면, small segmented) and the colour legend, over a `min(480px, 70vh)` canvas. Part colours: axis #b9c1cb, kit #8d97a3, gearbox #5f7088, motor #343a42, connecting shaft #7a8794, gantry kit #a1866a, edges in the text colour at 30%; the centre of gravity is a #d6392b ball with a dashed leader from the slide centre, drawn over the parts.
- **Route sign (rail)**: numbered box + step name (12px) + part number (20px) + verdict dot and the tightest check (`속도 100%`). The whole sign is a button that scrolls to its step; the step in view gets the yellow box and a 5px yellow underline. Part number and detail stay on one line in both languages (ellipsis, full name in the title); the four columns size to their content, and below 1280px the part number drops to 17px.
- **Step panel**: header strip with a yellow 28px number box, title, counts and toggles; body with filters, then table, then evidence (세부사항).
- **Verdict badge**: coloured 8px dot + word, never a filled pill.
- **Ratio cell**: percentage in the data face + 44px bar (ok under 80%, warn, fail).
- **Selected row**: soft yellow fill + 2px yellow inset ring.
- **Inputs**: 38px, data face 17px, unit at right, no spin buttons; invalid gets a red border and red soft ring.
- **Gantry 조합축 도면**: its own panel below the open axis's steps (after that axis's step 5 조합 도면), whichever axis tab is open (joint table: 결합 · 판정 · 조합 키트 · 품번 · 수량 · 비고, then the same action buttons and viewer).
- **Segmented toggles**: separate rounded pieces in a dark clear track (black 30%, 1px white-12% ring, 3px padding and gaps); the active piece is clear glass (white 14%, 1px white-22% ring, top highlight) in the text colour; the prism stays the PDF action's. Every one-of choice (`RadioGroup`, `.segmented.sliding`: screen switch, mounting, accel input, application, 축 구성, axis drive, motor maker, power supply, gearbox, profile view, 3D view, …) carries that glass on a thumb behind the pieces (`.segmented-thumb`, `useSlideThumb`) that slides to the picked one; the gantry axis tabs in the rail slide their frame the same way (`.rail-axis-thumb`) (240 ms, cubic-bezier(0.32, 0.72, 0, 1); off under reduced motion). A labelled option row under the step filters (`.axis-options`, `.filter-group`: muted 12px label + segmented control) for single choices such as the axis order options; a number field there (`.filter-group .field`, 슬라이드 중심 간격) sits on the same line: label, a 96 × 32px input, the hint after it. A field holding a value that is accepted but below what will be used (`NumberField` `low`: a slide spacing under the selected axis's minimum) takes a light red fill (`.field-low`).
- **Error panel**: replaces the results column when the calculation fails; fail-soft fill, fail border and title, the error text on a white block, an outlined fail-colour 다시 시도 button. The inputs stay usable.
- **Step filter rows** (`.step-filters .segmented`): wrap onto more lines when they do not fit (Festo motor series on a phone), never run off the screen.
- **Segmented grid** (`.segmented-grid`, 축 구성 in the inputs): four choices two per row in a grid instead of one overflowing row; pieces 3px apart like the other segments.
- **Heading unit** (`.heading-unit`, 부하 무게 중심 (mm)): a muted 12px regular unit after the heading when a row of fields is too narrow for a unit inside each.
- **Screen switch**: 단축 선정 / 조합축 선정 as a full-width segmented control at the top of the input column, above the first input box (사용 조건 / 조합축 구성): a segment track, the active screen in the segment glass, labels 600.
- **Gantry axis inputs** (`.gantry-motion`, 축별 운전 조건): per axis a 24px axis-letter box alone (the axis name only as its aria-label), axes split by a 1px line.
- **Gantry axis tabs** (`.rail-axes`, the rail's top row on the gantry screen, 52px, the rail 152px high there): one tab per axis in X, Y, Z order, a 30px axis-letter box (clear glass; the open axis's a yellow gem), a 11px line with the verdict, 몇 번째 선정 (the selection runs Z → Y → X) and the carried load, then the axis part number in the data face (16px). The open axis's frame (white 7%, top highlight, 2px yellow underline) slides between the tabs (`.rail-axis-thumb`); the lower row keeps the open axis's four route signs. At the top of the results the 하중 조건 panel (`.gantry-load-list`): label / value in the data face / muted explanation, in an auto-fit grid.
- **Chart spans**: dwell shaded `--surface-2`, press (press move + hold) shaded `--accent-soft`, each labelled above the plot. The jerk track is left out when the jerk is zero throughout (no jerk limit); every track keeps at least one tick besides 0, labelled with the decimals the ticks need.

## Do's and Don'ts

- **Do** show computed value / limit beside every verdict.
- **Do** keep part numbers whole; let them wrap, never truncate them in exports.
- **Don't** use yellow for anything except the selected route.
- **Don't** add cards, kickers or decorative icons to the workspace; the rail is the only expressive element.
- **Don't** add motion beyond 120–200ms state transitions.
