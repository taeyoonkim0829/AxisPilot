// Writes the motor frame JSON (data/README.md, "Drawings": `flange`) for motor STEP files whose flange is not at
// z = 0 with the shaft along +z (the Festo convention, which needs no JSON), from their geometry:
//   node scripts/festo-cad/motor-frames.mjs [--dry-run] [--force] file.stp …
// Written for Siemens 1FK2 / 1FL6 (CADClick exports, each in its own orientation). Per file:
// - shaft: the round part at one end of the overall box (two equal cross extents, narrower than the body), its
//   direction the side it reaches out to;
// - flange face: the outermost planar face facing the shaft side, around the shaft centre, at least half the body
//   width, with no wider face right behind it (a centring spigot sits on the flange; it is narrower, and the flange
//   is behind it);
// - connector: the side across the shaft the body reaches out furthest to (the connector housing).
// `flange.axis` points into the motor body, `flange.up` is the connector side (the default connector direction).
// Prints what it found; files where the shaft or the connector is unclear are left out (check them by hand).
// --shaft=+z: take only shaft candidates pointing that way (LS files: a round encoder cover at the back end also
// reads as a shaft; their shafts all point +z).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root } from './parts.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const shaftArg = args.find((a) => a.startsWith('--shaft='))?.slice(8) ?? null
const files = args.filter((a) => !a.startsWith('--'))

const require = createRequire(import.meta.url)
const occt = await require(join(root, 'node_modules/occt-import-js'))()

const round = (v, step = 0.05) => Math.round(v / step) * step + 0 // + 0: no -0
const fixed = (v) => Number(round(v).toFixed(2))
const centre = (lo, hi, k) => (lo[k] + hi[k]) / 2

/** meshes with their boxes and planar faces perpendicular to a coordinate axis (as in frames.mjs) */
function meshes(text) {
  const r = occt.ReadStepFile(new TextEncoder().encode(text), null)
  if (!r.success) throw new Error('occt could not read the file')
  return r.meshes.map((m) => {
    const p = m.attributes.position.array
    const idx = m.index.array
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k])
        hi[k] = Math.max(hi[k], p[i + k])
      }
    const faces = []
    for (const f of m.brep_faces) {
      let area = 0
      let normal = null
      let ok = true
      const flo = [Infinity, Infinity, Infinity]
      const fhi = [-Infinity, -Infinity, -Infinity]
      for (let t = f.first; t <= f.last; t++) {
        const [a, b, c] = [idx[3 * t] * 3, idx[3 * t + 1] * 3, idx[3 * t + 2] * 3]
        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
        const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const len = Math.hypot(...cr)
        area += len / 2
        if (len > 1e-9) {
          const unit = cr.map((x) => x / len)
          if (!normal) normal = unit
          else if (unit[0] * normal[0] + unit[1] * normal[1] + unit[2] * normal[2] < 0.9999) ok = false
        }
        for (const q of [a, b, c])
          for (let k = 0; k < 3; k++) {
            flo[k] = Math.min(flo[k], p[q + k])
            fhi[k] = Math.max(fhi[k], p[q + k])
          }
      }
      if (!ok || !normal || area < 1) continue
      for (const k of [0, 1, 2])
        if (Math.abs(Math.abs(normal[k]) - 1) < 1e-4) faces.push({ k, sign: Math.sign(normal[k]), pos: flo[k], area, lo: flo, hi: fhi })
    }
    return { lo, hi, faces }
  })
}

function motorFrame(file) {
  const ms = meshes(readFileSync(file, 'latin1'))
  const lo = [0, 1, 2].map((k) => Math.min(...ms.map((m) => m.lo[k])))
  const hi = [0, 1, 2].map((k) => Math.max(...ms.map((m) => m.hi[k])))
  const across = (k) => [0, 1, 2].filter((j) => j !== k)

  // flange face facing `sign` along k around the centre c: the outermost face of half the body width or more
  // with no wider face right behind it
  const flangeAt = (k, sign, c) => {
    const [i, j] = across(k)
    const width = (f) => Math.max(f.hi[i] - f.lo[i], f.hi[j] - f.lo[j])
    const bodyWidth = Math.min(hi[i] - lo[i], hi[j] - lo[j])
    const list = ms
      .flatMap((m) => m.faces)
      .filter(
        (f) =>
          f.k === k &&
          f.sign === sign &&
          f.lo[i] - 0.5 <= c[0] &&
          f.hi[i] + 0.5 >= c[0] &&
          f.lo[j] - 0.5 <= c[1] &&
          f.hi[j] + 0.5 >= c[1] &&
          width(f) >= 0.5 * bodyWidth,
      )
    const ok = list.filter((f) => !list.some((g) => (f.pos - g.pos) * sign > 0 && (f.pos - g.pos) * sign <= 15 && width(g) > 1.1 * width(f)))
    if (ok.length === 0) return null
    const face = ok.reduce((a, b) => (b.pos * sign > a.pos * sign ? b : a))
    return { face, width: width(face) }
  }

  // shaft: a round part (a featherkey makes one side a little longer) at an end of the overall box, centred on a
  // flange face behind it (a round connector housing is not)
  const shafts = []
  for (const k of [0, 1, 2])
    for (const sign of [1, -1]) {
      const end = sign > 0 ? hi[k] : lo[k]
      const [i, j] = across(k)
      for (const m of ms) {
        if (Math.abs((sign > 0 ? m.hi[k] : m.lo[k]) - end) > 0.5 || m.hi[k] - m.lo[k] < 10) continue
        const [a, b] = [i, j].map((q) => m.hi[q] - m.lo[q])
        if (Math.abs(a - b) > 0.25 * Math.min(a, b)) continue
        // a featherkey shifts the box centre by up to the difference of the extents; the flange centre is used
        const d = Math.min(a, b)
        const c = [centre(m.lo, m.hi, i), centre(m.lo, m.hi, j)]
        const flange = flangeAt(k, sign, c)
        if (!flange || flange.width < 1.5 * d) continue
        const fc = [centre(flange.face.lo, flange.face.hi, i), centre(flange.face.lo, flange.face.hi, j)]
        if (Math.hypot(fc[0] - c[0], fc[1] - c[1]) > Math.max(2, Math.abs(a - b))) continue
        shafts.push({ k, sign, m, d, c: fc, flange })
      }
    }
  if (process.env.DEBUG)
    console.log(shafts.map((s) => `${s.sign > 0 ? '+' : '-'}${'xyz'[s.k]} d${fixed(s.d)} [${s.m.lo.map(fixed)}]-[${s.m.hi.map(fixed)}]`), lo.map(fixed), hi.map(fixed))
  if (shaftArg) shafts.splice(0, shafts.length, ...shafts.filter((s) => `${s.sign > 0 ? '+' : '-'}${'xyz'[s.k]}` === shaftArg))
  if (shafts.length === 0) throw new Error('no shaft found')
  const { k, sign, d, c, flange } = shafts.reduce((a, b) => (b.d < a.d ? b : a))
  if (shafts.some((s) => s.k !== k || s.sign !== sign)) throw new Error(`shaft candidates on ${shafts.length} sides`)
  const [i, j] = across(k)
  const face = flange.face
  const width = () => flange.width

  // connector: the side across the shaft the body reaches out furthest to
  const reach = [i, j].flatMap((q, n) => [
    { q, s: 1, r: hi[q] - c[n] },
    { q, s: -1, r: c[n] - lo[q] },
  ])
  reach.sort((a, b) => b.r - a.r)
  if (reach[0].r - reach[1].r < 5) throw new Error(`connector side unclear (${reach.map((x) => fixed(x.r)).join(', ')})`)
  const up = [0, 0, 0]
  up[reach[0].q] = reach[0].s
  const origin = [0, 0, 0]
  origin[k] = fixed(face.pos)
  origin[i] = fixed(c[0])
  origin[j] = fixed(c[1])
  const axis = [0, 0, 0]
  axis[k] = -sign
  const json = { flange: { origin, axis, up } }
  const dir = (v) => `${v.find((x) => x) > 0 ? '+' : '-'}${'xyz'[v.findIndex((x) => x)]}`
  return {
    json,
    info: `shaft ${dir(axis.map((x) => -x))} (part ${fixed(d)} wide) reaching ${fixed(Math.abs((sign > 0 ? hi[k] : lo[k]) - face.pos))}, flange ${fixed(width(face))} at ${'xyz'[k]} = ${fixed(face.pos)}, connector ${dir(up)} (${fixed(reach[0].r)} vs ${fixed(reach[1].r)})`,
    convention: origin.every((v) => Math.abs(v) < 0.1) && axis[2] === -1 && up[1] === 1,
  }
}

const format = (json) => `{\n  "flange": { "origin": ${JSON.stringify(json.flange.origin).replaceAll(',', ', ')}, "axis": ${JSON.stringify(json.flange.axis).replaceAll(',', ', ')}, "up": ${JSON.stringify(json.flange.up).replaceAll(',', ', ')} }\n}\n`

let written = 0
for (const file of files) {
  const out = file.replace(/\.(stp|step)$/i, '.json')
  if (existsSync(out) && !force && !dryRun) continue
  const name = file.split(/[\\/]/).pop()
  try {
    const { json, info, convention } = motorFrame(file)
    console.log(`${name}: ${info}${convention ? ' (Festo convention: no JSON needed)' : ''}`)
    if (convention) continue
    if (dryRun) console.log(JSON.stringify(json))
    else {
      writeFileSync(out, format(json))
      written++
    }
  } catch (err) {
    console.log(`${name}: FAILED ${err.message}`)
  }
}
console.log(`${written} written`)
