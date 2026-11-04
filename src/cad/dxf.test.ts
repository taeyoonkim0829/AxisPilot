import { describe, expect, it } from 'vitest'
import { drawingPdf } from './drawingPdf'
import { drawingDxf, mountingHoles, type DrawMesh } from './dxf'

/** a box mesh, one B-rep face per side */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): DrawMesh {
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ].flat()
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]
  const index = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])
  return { positions: p, index, faces: quads.map((_, i) => ({ first: i * 2, last: i * 2 + 1 })) }
}

/** the wall of a vertical hole (one B-rep face, 24 segments) from z0 up to z1 */
function hole(x: number, y: number, d: number, z0: number, z1: number): DrawMesh {
  const n = 24
  const p: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    p.push(x + (d / 2) * Math.cos(a), y + (d / 2) * Math.sin(a), z0, x + (d / 2) * Math.cos(a), y + (d / 2) * Math.sin(a), z1)
  }
  const index: number[] = []
  for (let i = 0; i < n; i++) {
    const [a, b, c, e] = [2 * i, 2 * i + 1, (2 * i + 2) % (2 * n), (2 * i + 3) % (2 * n)]
    index.push(a, c, b, b, c, e)
  }
  return { positions: p, index, faces: [{ first: 0, last: 2 * n - 1 }] }
}

/** the group-code pairs of the ENTITIES section */
function entities(dxf: string) {
  const lines = dxf.split('\n')
  const start = lines.indexOf('ENTITIES')
  const list: { type: string; codes: Map<string, string[]> }[] = []
  for (let i = start + 1; i < lines.length - 1; i += 2) {
    if (lines[i] === '0') {
      if (lines[i + 1] === 'ENDSEC') break
      list.push({ type: lines[i + 1], codes: new Map() })
    } else {
      const codes = list[list.length - 1].codes
      codes.set(lines[i], [...(codes.get(lines[i]) ?? []), lines[i + 1]])
    }
  }
  return list
}

describe('KS drawing sheet', () => {
  // an axis-like body 1000 × 100 × 80 mm with a motor block
  const meshes = [box(0, -50, -80, 1000, 50, 0), box(-150, -30, -70, 0, 30, -10)]
  const dxf = drawingDxf({
    meshes,
    cog: [500, 0, 50],
    title: ['ELGT-BS-90-500-20P_EAMM-A-T46-60P_EMMT-AS-60-S-HS-B', 'Stroke 500 mm, mounting: floor'],
    parts: [
      { role: 'axis', name: 'ELGT-BS-90-500-20P' },
      { role: 'kit', name: 'EAMM-A-T46-60P' },
      { role: 'motor', name: 'EMMT-AS-60-S-HS-B' },
    ],
    date: '2026-11-04',
    stroke: { from: [0, 0, 0], to: [500, 0, 0], length: 500 },
    specs: [['Product mass', '8.7 kg'], ['Max. permissible acceleration', '50 m/s²']],
  })
  const list = entities(dxf)
  const texts = list.filter((e) => e.type === 'TEXT').map((e) => e.codes.get('1')![0])

  it('picks the smallest sheet on which the views fit at 1:3 or larger and draws the model full size inside it', () => {
    // 1150 mm long: A2 at 1:3 (the model space is full size, the sheet 3 × its paper size)
    expect(texts).toContain('1:3')
    expect(dxf).toMatch(/\$LTSCALE\n40\n3\n/)
    const xs = list.flatMap((e) => (e.codes.get('10') ?? []).map(Number))
    const ys = list.flatMap((e) => (e.codes.get('20') ?? []).map(Number))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(594 * 3 + 1e-6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(420 * 3 + 1e-6)
  })

  it('has the title block, parts list, projection and the overall dimensions once each', () => {
    // the stroke above the front view, the specification table (DXF: ASCII spelling of the symbols)
    for (const t of ['STROKE 500', 'SPECIFICATIONS', 'Product mass', '50 m/s^2', 'Note']) expect(texts).toContain(t)
    for (const t of ['TITLE', 'SCALE', 'PROJ.', 'UNIT', 'mm', 'DWG. NO.', 'AP-20261104', 'NO.', 'QTY', 'ELGT-BS-90-500-20P', 'MOTOR'])
      expect(texts).toContain(t)
    // length 1150, height 80, depth 100 — each once
    expect(texts.filter((t) => t === '1150')).toHaveLength(1)
    expect(texts.filter((t) => t === '80')).toHaveLength(1)
    expect(texts.filter((t) => t === '100')).toHaveLength(1)
    // filled arrowheads on the four dimension lines (three overall, the stroke), wide polylines for the outlines and the border
    expect(list.filter((e) => e.type === 'SOLID')).toHaveLength(8)
    expect(list.some((e) => e.type === 'POLYLINE' && e.codes.get('8')![0] === 'BORDER' && Math.abs(Number(e.codes.get('40')![0]) - 0.7 * 3) < 1e-6)).toBe(true)
    expect(list.some((e) => e.type === 'POLYLINE' && e.codes.get('8')![0] === 'OUTLINE')).toBe(true)
    // centre of gravity lines in the two-dot chain line type
    expect(dxf).toMatch(/LAYER\n2\nCOG\n70\n0\n62\n1\n6\nPHANTOM/)
  })

  it('dimensions the mounting holes on the bottom view: the pitch chain, the row spacing and a callout', () => {
    // two rows (y ±20) of Ø5.5 holes every 100 mm from x = 100 to 800, 10 mm deep into the underside
    const holes = [100, 200, 300, 400, 500, 600, 700, 800].flatMap((x) => [hole(x, -20, 5.5, -80, -70), hole(x, 20, 5.5, -80, -70)])
    const axis = [box(0, -50, -80, 1000, 50, 0), ...holes]
    expect(mountingHoles(axis)!.holes).toHaveLength(16)
    // a hole that does not open at the bottom is not one
    expect(mountingHoles([box(0, -50, -80, 1000, 50, 0), hole(100, 0, 5.5, -60, -50)])).toBeNull()
    const sheet = entities(drawingDxf({ meshes: [...axis, box(-150, -30, -70, 0, 30, -10)], cog: null, title: ['Holes'], axisMeshes: axis }))
    const t = sheet.filter((e) => e.type === 'TEXT').map((e) => e.codes.get('1')![0])
    // from the axis end: 8 equal pitches of 100 merged, then the rest to the far end; 40 between the rows
    expect(t).toContain('8x100(=800)')
    expect(t).toContain('200')
    expect(t).toContain('40')
    expect(t).toContain('16x%%c5.5')
  })

  it('writes the same sheet as a PDF page of the sheet size (A2 landscape)', async () => {
    const blob = drawingPdf({ meshes, cog: [500, 0, 50], title: ['Test'], date: '2026-11-04' })
    const pdf = new TextDecoder('latin1').decode(await blob.arrayBuffer())
    expect(pdf.startsWith('%PDF')).toBe(true)
    // MediaBox in points: 594 × 420 mm
    const [, w, h] = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!
    expect(Number(w)).toBeCloseTo((594 * 72) / 25.4, 1)
    expect(Number(h)).toBeCloseTo((420 * 72) / 25.4, 1)
    expect(pdf).toContain('(1:3)')
  })
})
