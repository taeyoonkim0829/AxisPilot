import { describe, expect, it } from 'vitest'
import { drawingDxf, type DrawMesh } from './dxf'

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
  })
  const list = entities(dxf)
  const texts = list.filter((e) => e.type === 'TEXT').map((e) => e.codes.get('1')![0])

  it('picks a standard scale and sheet and draws the model full size inside it', () => {
    // 1150 + 100 mm of views: A3 at 1:5 (the model space is full size, the sheet 5 × its paper size)
    expect(texts).toContain('1:5')
    expect(dxf).toMatch(/\$LTSCALE\n40\n5\n/)
    const xs = list.flatMap((e) => (e.codes.get('10') ?? []).map(Number))
    const ys = list.flatMap((e) => (e.codes.get('20') ?? []).map(Number))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(420 * 5 + 1e-6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(297 * 5 + 1e-6)
  })

  it('has the title block, parts list, projection and the overall dimensions once each', () => {
    for (const t of ['TITLE', 'SCALE', 'PROJ.', 'UNIT', 'mm', 'DWG. NO.', 'AP-20261104', 'NO.', 'QTY', 'ELGT-BS-90-500-20P', 'MOTOR'])
      expect(texts).toContain(t)
    // length 1150, height 80, depth 100 — each once
    expect(texts.filter((t) => t === '1150')).toHaveLength(1)
    expect(texts.filter((t) => t === '80')).toHaveLength(1)
    expect(texts.filter((t) => t === '100')).toHaveLength(1)
    // filled arrowheads on the dimension lines, wide polylines for the outlines and the border
    expect(list.filter((e) => e.type === 'SOLID')).toHaveLength(6)
    expect(list.some((e) => e.type === 'POLYLINE' && e.codes.get('8')![0] === 'BORDER' && Number(e.codes.get('40')![0]) === 0.7 * 5)).toBe(true)
    expect(list.some((e) => e.type === 'POLYLINE' && e.codes.get('8')![0] === 'OUTLINE')).toBe(true)
    // centre of gravity lines in the two-dot chain line type
    expect(dxf).toMatch(/LAYER\n2\nCOG\n70\n0\n62\n1\n6\nPHANTOM/)
  })
})
