import { describe, expect, it } from 'vitest'
import { yEndClashes, type BodyMesh } from './clearance'
import type { ComboPart } from './combo'
import type { Vec3 } from './step'

/** a closed box mesh (12 triangles) */
function cube(part: number, lo: Vec3, hi: Vec3): BodyMesh {
  const v: Vec3[] = []
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) v.push([x, y, z])
  // corners: index = 4·ix + 2·iy + iz
  const faces = [
    [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
  ]
  const index = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])
  return { part, name: '', positions: new Float32Array(v.flat()), index: new Uint32Array(index) }
}

const identity = { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3], t: [0, 0, 0] as Vec3 }
const parts: ComboPart[] = [
  { role: 'axis', name: 'X axis', transform: identity, axis: 'x' },
  { role: 'axis', name: 'Z axis', transform: identity, axis: 'z' },
  { role: 'adapter', name: 'Y–Z plate', transform: identity, axis: 'y' },
  { role: 'axis', name: 'Y axis', transform: identity, axis: 'y' },
]
// an X profile along x at y 300…400, z −100…0; a Z profile hanging to z −150 at y −50…50 (the Y slide in the middle)
const xProfile = cube(0, [-1000, 300, -100], [200, 400, 0])
const zProfile = cube(1, [-200, -50, -150], [-100, 50, 300])
const y = { travel: [0, 1, 0] as Vec3, stroke: 500, offset: 0 }

describe('Y end clearance', () => {
  it('finds the Z axis running into an X axis at the end of the Y travel', () => {
    // at +250 the Z profile spans y 200…300 plus: it reaches into the X profile (y 300…400) only past 250 + 50 = 300
    expect(yEndClashes(parts, [xProfile, zProfile], { ...y, stroke: 500 })).toEqual([])
    expect(yEndClashes(parts, [xProfile, zProfile], { ...y, stroke: 600 })).toEqual([{ end: 1, moving: 'Z axis', fixed: 'X axis' }])
  })

  it('measures the ends from where the slide is drawn', () => {
    // drawn 100 mm towards the far end: the far end is only 150 mm away
    expect(yEndClashes(parts, [xProfile, zProfile], { ...y, stroke: 600, offset: 100 })).toEqual([])
    expect(yEndClashes(parts, [xProfile, zProfile], { ...y, stroke: 600, offset: -100 })).toEqual([{ end: 1, moving: 'Z axis', fixed: 'X axis' }])
  })

  it('leaves a Z axis clear above the X axes alone, and the Y axis itself out', () => {
    const high = cube(1, [-200, -50, 10], [-100, 50, 300])
    const yProfile = cube(3, [-100, -400, 0], [0, 400, 100])
    expect(yEndClashes(parts, [xProfile, high, yProfile], { ...y, stroke: 1000 })).toEqual([])
  })

  it('checks the gantry kit on the Y slide too', () => {
    const plate = cube(2, [-120, -60, -120], [-100, 60, 200])
    expect(yEndClashes(parts, [xProfile, plate], { ...y, stroke: 800 }).map((c) => c.moving)).toEqual(['Y–Z plate'])
  })
})
