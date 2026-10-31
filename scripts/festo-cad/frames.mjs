// Writes the frame JSON (data/README.md, "Drawings") for Festo axis, kit and gearbox STEP files and Apex gearbox files
// (`apexFrames`) that have none, from their geometry:
//   node scripts/festo-cad/frames.mjs [--dry-run] [--force] [file.stp …]
// Festo's CADENAS models share one layout: length along z, base at y = 0, slide on top (+y), centred on x = 0.
// Per family: the motor end (+z for ELGT, ELGD and EGC/EGC-HD spindle axes, −z for ESBF; belt axes: the head and
// side where a shaft cover cap (CUP) is missing), the drive face (largest planar face at that end, facing out;
// belt axes: on the head's side face), the shaft centre (spindle: the outermost small face at that end, i.e. the
// shaft tip; belt: the cover cap on the other side of that head), the slide mounting surface (top of the slide
// part; ESBF: the piston rod end) and the length change (the profile's longest stretch without end features, the
// parts beyond it moving along). Prints what it found; check new families in the 3D preview.
// Mounting kits (EAMM-A axial: axis face below, motor face on top, at the coupling; EAMM-U parallel: both faces on
// +z, the axis shaft at the lower y — the pulley kits' axis pulley at the origin, the coupling kits' motor coupling at
// the origin with the axis the centre distance towards −y) take the outermost housing face around each shaft that
// the bolts crossing it pass through. Gearboxes (EMGA: output flange on top, input below or, -A- angle gearboxes, on
// the side the body reaches out to) take the outermost flange face with no wider face right behind it. Festo Korea's
// SA kits (`saKitFrames`, BF…/EB…/GD… in any orientation) find the shaft from the coupling or base plate and the sides
// from the screws: tips out of the axis face, heads outside the motor face.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { root } from './parts.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))

const require = createRequire(import.meta.url)
const occt = await require(join(root, 'node_modules/occt-import-js'))()

const axesDir = join(root, 'data/axes/Festo/Drawings')
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.stp$/i.test(e.name) ? [join(dir, e.name)] : [],
  )
const axes = readdirSync(join(root, 'data/axes/festo'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(root, 'data/axes/festo', f), 'utf8')).items)

const round = (v, step = 0.05) => Math.round(v / step) * step + 0 // + 0: no -0
const fixed = (v) => Number(round(v).toFixed(2))

// ---- STEP: part instances with their placement and transform ----
function parseEntities(text) {
  const map = new Map()
  const data = text.slice(text.indexOf('DATA;'))
  for (const m of data.matchAll(/#(\d+)\s*=\s*([\s\S]*?);\s*(?=#\d+\s*=|ENDSEC)/g)) map.set(Number(m[1]), m[2].replace(/\s+/g, ' '))
  return map
}
const refsOf = (body) => [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
const numbers = (body) => body.match(/\(([^()]*)\)\s*\)\s*$/)[1].split(',').map(Number)

function placementTransform(e, id) {
  const [loc, z, x] = refsOf(e.get(id))
  const p = numbers(e.get(loc))
  const zz = z ? numbers(e.get(z)) : [0, 0, 1]
  const xx = x ? numbers(e.get(x)) : [1, 0, 0]
  const yy = [zz[1] * xx[2] - zz[2] * xx[1], zz[2] * xx[0] - zz[0] * xx[2], zz[0] * xx[1] - zz[1] * xx[0]]
  return { p, cols: [xx, yy, zz] }
}

/** Instances of the top assembly: child placement id, transform, and the points of the child's geometry. */
function instances(text) {
  const e = parseEntities(text)
  const out = []
  for (const [id, body] of e) {
    if (!body.startsWith('ITEM_DEFINED_TRANSFORMATION')) continue
    const [p1, p2] = refsOf(body)
    // the representation relationship using this transformation names the child representation
    let child = null
    for (const b of e.values())
      if (b.includes(`REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${id})`)) {
        child = refsOf(b.slice(b.indexOf('REPRESENTATION_RELATIONSHIP(')))[0]
        break
      }
    const t1 = placementTransform(e, p1)
    const t2 = placementTransform(e, p2)
    const name = child && /^SHAPE_REPRESENTATION\(\s*'([^']*)'/.exec(e.get(child) ?? '')?.[1]
    out.push({ placement: p2, child, name: name?.trim() ?? null, identity: isIdentity(t1) && isIdentity(t2), t2 })
  }
  return out
}
const isIdentity = (t) =>
  t.p.every((v) => Math.abs(v) < 1e-6) && t.cols.every((c, i) => c.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9))

// ---- meshes (occt): names, boxes, planar faces ----
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
    // planar faces perpendicular to a coordinate axis k
    const faces = []
    for (const f of m.brep_faces) {
      let area = 0
      const n = [0, 0, 0]
      const flo = [Infinity, Infinity, Infinity]
      const fhi = [-Infinity, -Infinity, -Infinity]
      let ok = true
      let normal = null
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
          for (let k = 0; k < 3; k++) n[k] = unit[k]
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
    return { name: m.name ?? '', lo, hi, faces, points: p }
  })
}

const centre = (lo, hi, k) => (lo[k] + hi[k]) / 2
/** fasteners, couplings, fittings: never the drive face or the slide */
const hardware = (name) => /EAMC|ISO|DIN|GUK|AEVU|M\d+x/i.test(name)

function frames(file, model) {
  const text = readFileSync(file, 'latin1')
  const ms = meshes(text)
  // the body: largest box (an ESBF piston rod is as long as the cylinder)
  const volume = (m) => (m.hi[0] - m.lo[0]) * (m.hi[1] - m.lo[1]) * (m.hi[2] - m.lo[2])
  const profile = ms.reduce((a, b) => (volume(b) > volume(a) ? b : a))
  const length = profile.hi[2] - profile.lo[2]
  const width = profile.hi[0] - profile.lo[0]
  const x0 = centre(profile.lo, profile.hi, 0)
  const family = /^ESBF/.test(model) ? 'ESBF' : /-TB-/.test(model) ? 'TB' : 'BS'
  const others = ms.filter((m) => m !== profile)

  // motor end (±z) and, for belt axes, the kit side (±x)
  let motor = /^ESBF/.test(model) ? -1 : 1
  let side = 1
  // shaft cover caps: CADENAS names them (CUP); the ELGT-TB-…-CS models (Creo, from Festo) name no parts, so there
  // a cap is a thin square-boxed disc across x at the profile's side
  const named = others.some((m) => /CUP/.test(m.name))
  const isCap = (m) => {
    if (named) return /CUP/.test(m.name)
    const [dx, dy, dz] = [0, 1, 2].map((k) => m.hi[k] - m.lo[k])
    return dx < 3 && dy > 20 && Math.abs(dy - dz) < 2 && Math.abs(centre(m.lo, m.hi, 0) - x0) > 0.4 * width
  }
  if (family === 'TB') {
    const caps = others.filter(isCap)
    const at = (end, s) => caps.some((c) => Math.sign(centre(c.lo, c.hi, 2) - centre(profile.lo, profile.hi, 2)) === end && Math.sign(centre(c.lo, c.hi, 0) - x0) === s)
    const open = [1, -1].flatMap((end) => [1, -1].filter((s) => !at(end, s)).map((s) => ({ end, s })))
    if (open.length === 1) {
      motor = open[0].end
      side = open[0].s
    } else if (open.length === 0) {
      // every shaft end capped (EGC-HD-TB): the drive head is the one the slide starts at, as on the other belt axes
      const slides = others.filter((m) => !hardware(m.name) && !isCap(m) && !/AK\)/.test(m.name) && m.hi[0] - m.lo[0] > 0.6 * width)
      const s = slides.reduce((a, b) => (b.hi[1] > a.hi[1] ? b : a))
      motor = Math.sign(centre(s.lo, s.hi, 2) - centre(profile.lo, profile.hi, 2))
      side = 1
    } else throw new Error(`belt axis: ${open.length} open shaft ends, cannot tell the drive head`)
  }

  // slide
  let slide
  if (family === 'ESBF') {
    const rod = others.filter((m) => !hardware(m.name)).reduce((a, b) => (b.hi[2] > a.hi[2] ? b : a))
    slide = { origin: [fixed(x0), fixed(centre(rod.lo, rod.hi, 1)), fixed(rod.hi[2])], normal: [0, 1, 0], travel: [0, 0, 1] }
  } else {
    // wide, on top, within the profile's length (end caps reach beyond it)
    const candidates = others.filter(
      (m) =>
        !hardware(m.name) &&
        m.hi[0] - m.lo[0] > 0.6 * width &&
        m.hi[2] - m.lo[2] < 0.9 * length &&
        m.lo[2] > profile.lo[2] &&
        m.hi[2] < profile.hi[2] &&
        m.hi[1] > 0.8 * profile.hi[1],
    )
    if (candidates.length === 0) throw new Error('no slide part found')
    const s = candidates.reduce((a, b) => (b.hi[1] > a.hi[1] ? b : a))
    slide = { origin: [fixed(x0), fixed(s.hi[1]), fixed(centre(s.lo, s.hi, 2))], normal: [0, 1, 0], travel: [0, 0, -motor], part: s }
  }

  // drive
  let drive
  const structural = ms.filter((m) => !hardware(m.name) && m !== slide.part)
  if (family === 'TB') {
    const caps = others.filter((m) => isCap(m) && Math.sign(centre(m.lo, m.hi, 2) - centre(profile.lo, profile.hi, 2)) === motor)
    const cap = caps[0]
    const shaft = [centre(cap.lo, cap.hi, 1), centre(cap.lo, cap.hi, 2)]
    const faces = structural
      .flatMap((m) => m.faces)
      .filter((f) => f.k === 0 && f.sign === side && f.lo[2] < shaft[1] && f.hi[2] > shaft[1] && f.lo[1] < shaft[0] && f.hi[1] > shaft[0])
    if (faces.length === 0) throw new Error('no side face at the drive shaft')
    const face = faces.reduce((a, b) => (b.pos * side > a.pos * side ? b : a))
    drive = { origin: [fixed(face.pos), fixed(shaft[0]), fixed(shaft[1])], axis: [side, 0, 0], up: [0, 1, 0] }
  } else {
    const out = structural.flatMap((m) => m.faces).filter((f) => f.k === 2 && f.sign === motor)
    const extreme = Math.max(...out.map((f) => f.pos * motor))
    const near = out.filter((f) => f.pos * motor > extreme - 80)
    // the outermost face of a quarter of the cross-section or more: the end face the kit sits on (not the shaft,
    // the centering collar or, further in, the profile end hidden in an end cap)
    const section = width * (profile.hi[1] - profile.lo[1])
    const face = near.filter((f) => f.area > 0.25 * section).reduce((a, b) => (b.pos * motor > a.pos * motor ? b : a))
    const tips = near.filter((f) => f.area < 0.2 * face.area && f.pos * motor > face.pos * motor)
    if (tips.length === 0) throw new Error('no shaft beyond the drive face')
    const tip = tips.reduce((a, b) => (b.pos * motor > a.pos * motor ? b : a))
    drive = {
      origin: [fixed(centre(tip.lo, tip.hi, 0)), fixed(centre(tip.lo, tip.hi, 1)), fixed(face.pos)],
      axis: [0, 0, motor],
      up: [0, 1, 0],
    }
  }

  // length change: the longest stretch of the profile without end features (its own faces across the length,
  // other parts that do not run along it), parts beyond it on the far side move along
  const dir = family === 'ESBF' ? motor : -motor
  const blocked = [
    ...profile.faces.filter((f) => f.k === 2).map((f) => [f.pos, f.pos]),
    ...others.filter((m) => m.hi[2] - m.lo[2] < 0.6 * length).map((m) => [m.lo[2], m.hi[2]]),
  ].sort((a, b) => a[0] - b[0])
  let best = null
  let at = profile.lo[2]
  for (const [lo, hi] of [...blocked, [profile.hi[2], profile.hi[2]]]) {
    if (lo > at && (!best || lo - at > best[1] - best[0])) best = [at, lo]
    at = Math.max(at, hi)
  }
  const range = [Math.ceil(best[0] + 5), Math.floor(best[1] - 5)]
  const edge = dir > 0 ? range[1] : range[0]
  const beyond = (m) => (dir > 0 ? m.lo[2] > edge : m.hi[2] < edge)

  // the length change needs the profile as a part of its own (CADENAS: "<partNumber> <model>…"); the ELGT-TB-…-CS
  // models name no parts, but ELGT-TB is ordered at its standard strokes only and each one has its own file
  const stretchable = /\d{5,}/.test(profile.name)
  // placements of the moving parts, matched to the meshes by the box of their geometry
  let move = []
  if (stretchable) {
    const inst = instances(text)
    const profileInst = matchInstance(inst, profile, text)
    if (!profileInst) throw new Error('no placement for the profile')
    move = others.filter(beyond).map((m) => {
      const i = matchInstance(inst, m, text)
      if (!i) throw new Error(`no placement for ${m.name}`)
      return i.placement
    })
  }

  // parts running along the whole axis change length with it (ESBF piston rod)
  const also = family === "ESBF" ? others.filter((m) => m.hi[2] - m.lo[2] >= 0.6 * length).map((m) => m.name) : []
  const stroke = strokeOf(model)
  const json = {
    stroke,
    drive,
    slide: {
      origin: slide.origin,
      normal: slide.normal,
      travel: slide.travel,
      // belt axes: the side across the profile the slide stands out to (its front), when it is not centred
      ...(family === 'TB' && Math.abs(centre(slide.part.lo, slide.part.hi, 0) - x0) > 1
        ? { front: [Math.sign(centre(slide.part.lo, slide.part.hi, 0) - x0), 0, 0] }
        : {}),
    },
    ...(stretchable
      ? { stretch: { part: profile.name, ...(also.length ? { also } : {}), axis: 2, dir, range, ...(move.length ? { move } : {}) } }
      : {}),
    // the profile's mounting face (underside), middle of its length: where a gantry kit holds a carried axis
    profile: { origin: [fixed(x0), fixed(profile.lo[1]), fixed(centre(profile.lo, profile.hi, 2))], normal: [0, -1, 0] },
  }
  return { json, info: `${family} motor ${motor > 0 ? '+z' : '-z'}${family === 'TB' ? ` side ${side > 0 ? '+x' : '-x'}` : ''}, ${stretchable ? `range ${range}, moving ${move.length}` : 'no length change'}, profile ${fixed(length)} mm` }
}

// ---- mounting kits and gearboxes ----
/** screws (their thread runs into the mating part) */
const screw = (name) => /(ISO|DIN)[- ]?\d+.*M\d+x/i.test(name)
/** not the housing: fasteners, nuts, sealing washers (NBR), couplings (EAMC/EAMD), pulleys (EAMH), the centring
 * ring going into the axis (EAML), the counter bearing (EAMG) */
const kitHardware = (name) => hardware(name) || /(^|\s)M\d+(-\w+)?\s*$|NBR|(^|\s)EAM[CDGHL]-/i.test(name)
const contains = (f, c, k) => [0, 1, 2].filter((j) => j !== k).every((j, i) => f.lo[j] - 0.5 <= c[i] && f.hi[j] + 0.5 >= c[i])
const fill = (f, k) => {
  const [a, b] = [0, 1, 2].filter((j) => j !== k)
  return f.area / Math.max(1e-9, (f.hi[a] - f.lo[a]) * (f.hi[b] - f.lo[b]))
}

/**
 * Kit flange face at shaft centre c = [x, y] facing `sign` along z: the outermost housing face around the centre
 * that the bolts crossing it pass through (a centring spigot is smaller than the bolt pattern, a raised pad the
 * partner sits on is not), and not a thin ring (a spigot without bolts nearby)
 */
function kitFace(ms, c, sign, bolts, k = 2, housing = (m) => !kitHardware(m.name)) {
  const [a, b] = [0, 1, 2].filter((j) => j !== k)
  const faces = ms
    .filter(housing)
    .flatMap((m) => m.faces)
    .filter((f) => f.k === k && f.sign === sign && contains(f, c, k))
  if (faces.length === 0) throw new Error(`no face at ${c} facing ${sign > 0 ? '+z' : '-z'}`)
  const largest = Math.max(...faces.map((f) => f.area))
  const ok = faces.filter((f) => {
    if (f.area < 0.05 * largest || fill(f, k) < 0.2) return false
    const crossing = bolts.filter((s) => s.lo[k] < f.pos - 0.1 && s.hi[k] > f.pos + 0.1)
    return crossing.every((s) => contains(f, [centre(s.lo, s.hi, a), centre(s.lo, s.hi, b)], k))
  })
  if (ok.length === 0) throw new Error(`no flange face at ${c}`)
  return ok.reduce((a, b) => (b.pos * sign > a.pos * sign ? b : a))
}

function kitFrames(file, model) {
  const ms = meshes(readFileSync(file, 'latin1'))
  const screws = ms.filter((m) => screw(m.name))
  const xy = (m) => [centre(m.lo, m.hi, 0), centre(m.lo, m.hi, 1)]
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const frame = (c, pos, axis, up) => ({ origin: [fixed(c[0]), fixed(c[1]), fixed(pos)], axis, up })
  if (/^EAMM-U-/.test(model)) {
    // parallel: both flanges face +z, the axis at the lower y (pulley kits: the two pulleys, the axis one at the
    // origin with the centring ring and counter bearing; coupling kits (T42/T46): the motor coupling at the origin,
    // the axis the centre distance (last number of the type) towards −y)
    const pulleys = ms.filter((m) => /(^|\s)EAMH-/.test(m.name)).map(xy).sort((a, b) => a[1] - b[1])
    let axis, motor
    if (pulleys.length === 2) [axis, motor] = pulleys
    else {
      const coupling = ms.find((m) => /(^|\s)EAMC-/.test(m.name))
      if (!coupling) throw new Error('no pulleys or coupling')
      motor = xy(coupling)
      axis = [motor[0], motor[1] - Number(/-(\d+)(-S1)?$/.exec(model)[1])]
    }
    const near = (c, other) => screws.filter((s) => dist(xy(s), c) < dist(xy(s), other))
    const a = kitFace(ms, axis, 1, near(axis, motor))
    const m = kitFace(ms, motor, 1, near(motor, axis))
    const json = { axisFace: frame(axis, a.pos, [0, 0, -1], [0, -1, 0]), motorFace: frame(motor, m.pos, [0, 0, 1], [0, 1, 0]) }
    return { json, info: `parallel, axis at y ${fixed(axis[1])}, motor at y ${fixed(motor[1])}, faces z ${fixed(a.pos)} / ${fixed(m.pos)}` }
  }
  // axial: the axis below (−z), the motor on top, the shaft through the coupling
  const coupling = ms.find((m) => /(^|\s)EAM[CD]-/.test(m.name))
  const c = coupling ? xy(coupling) : [0, 0]
  const a = kitFace(ms, c, -1, screws)
  const m = kitFace(ms, c, 1, screws)
  if (m.pos <= a.pos) throw new Error('motor face not above the axis face')
  const json = { axisFace: frame(c, a.pos, [0, 0, 1], [0, 1, 0]), motorFace: frame(c, m.pos, [0, 0, 1], [0, 1, 0]) }
  return { json, info: `axial, faces z ${fixed(a.pos)} / ${fixed(m.pos)}` }
}

/**
 * Festo Korea's SA kits (`<axis><size><A|U><flange>…-1000`, e.g. BF032A040M1B-1000; Creo exports in any orientation,
 * parts mostly unnamed): the shaft runs along the coupling (axial) or across the base plate (parallel). The screws
 * tell the sides: those holding the kit on the axis go in from inside the kit, their tips standing out of the axis
 * face; the motor's go in from the motor side, their heads outside the motor face. Axial: the axis end is where the
 * tips point out, the shaft centre the coupling's (else the screws'). Parallel: both faces lie on the side the screws
 * stand out of the housing; the axis shaft is at the screw group pointing out there (its pulley, else the group's
 * centre), the motor at the other group.
 */
const SA_COUPLING = /SFC|ALS-|SJC|SOHM|SDW|SHDW|DISK/i
const SA_PULLEY = /SAPL/i
function saKitFrames(file, model) {
  const ms = meshes(readFileSync(file, 'latin1'))
  const parallel = /^[A-Z]{2}\d{3}U/.test(model)
  const ext = (m, j) => m.hi[j] - m.lo[j]
  const volume = (m) => ext(m, 0) * ext(m, 1) * ext(m, 2)
  const coupling = ms.filter((m) => SA_COUPLING.test(m.name))
  const pulleys = ms.filter((m) => SA_PULLEY.test(m.name))
  let k
  if (!parallel && coupling.length) {
    // along the coupling: the extent that differs from the other two (its diameter twice)
    const e = [0, 1, 2].map((j) => Math.max(...coupling.map((m) => m.hi[j])) - Math.min(...coupling.map((m) => m.lo[j])))
    k = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 2, 0],
    ]
      .map(([a, b, c]) => [Math.abs(e[a] - e[b]), c])
      .sort((x, y) => x[0] - y[0])[0][1]
  } else {
    // the largest part's thin direction (parallel: the base plate; axial without a coupling: the flange)
    const big = ms.reduce((a, b) => (volume(b) > volume(a) ? b : a))
    k = [0, 1, 2].reduce((a, b) => (ext(big, b) < ext(big, a) ? b : a))
  }
  const [a, b] = [0, 1, 2].filter((j) => j !== k)
  // slender parts along k; a screw's head is the end with the larger radius
  const slender = (m) => Math.abs(ext(m, a) - ext(m, b)) < 1.5 && ext(m, a) <= 24 && ext(m, k) >= 1.8 * ext(m, a)
  const screws = []
  for (const m of ms) {
    if (!slender(m) || ext(m, a) < 2.5 || SA_COUPLING.test(m.name) || SA_PULLEY.test(m.name)) continue
    const c = [centre(m.lo, m.hi, a), centre(m.lo, m.hi, b)]
    let rLo = 0
    let rHi = 0
    for (let i = 0; i < m.points.length; i += 3) {
      const t = (m.points[i + k] - m.lo[k]) / ext(m, k)
      const r = Math.hypot(m.points[i + a] - c[0], m.points[i + b] - c[1])
      if (t < 0.12) rLo = Math.max(rLo, r)
      else if (t > 0.88) rHi = Math.max(rHi, r)
    }
    if (Math.abs(rLo - rHi) >= 0.4) screws.push({ ...m, c, tip: rLo > rHi ? 1 : -1 })
  }
  if (screws.length === 0) throw new Error('no screws to tell the axis side')
  const housing = (m) => !slender(m) && !SA_COUPLING.test(m.name) && !SA_PULLEY.test(m.name)
  const body = ms.filter(housing)
  const lo = Math.min(...body.map((m) => m.lo[k]))
  const hi = Math.max(...body.map((m) => m.hi[k]))
  const mean = (list) => [0, 1].map((i) => list.reduce((s, x) => s + x.c[i], 0) / list.length)
  const unit = (j, sign) => [0, 1, 2].map((i) => (i === j ? sign : 0))
  const at = (c, pos) => {
    const o = [0, 0, 0]
    o[a] = fixed(c[0])
    o[b] = fixed(c[1])
    o[k] = fixed(pos)
    return o
  }
  if (!parallel) {
    const mid = (lo + hi) / 2
    const endOf = (x) => (centre(x.lo, x.hi, k) < mid ? -1 : 1)
    // + for a screw pointing out of its end (axis side), − for one with its head out (motor side)
    const vote = screws.reduce((s, x) => s + (x.tip === endOf(x) ? endOf(x) : -endOf(x)), 0)
    if (vote === 0) throw new Error('screws do not tell the axis side')
    const axisEnd = Math.sign(vote)
    const span = (j) => (Math.min(...coupling.map((m) => m.lo[j])) + Math.max(...coupling.map((m) => m.hi[j]))) / 2
    const c = coupling.length ? [span(a), span(b)] : mean(screws)
    const fa = kitFace(ms, c, axisEnd, screws.filter((x) => endOf(x) === axisEnd), k, housing)
    const fm = kitFace(ms, c, -axisEnd, screws.filter((x) => endOf(x) !== axisEnd), k, housing)
    const axis = unit(k, -axisEnd)
    const up = unit(b, 1)
    const json = { axisFace: { origin: at(c, fa.pos), axis, up }, motorFace: { origin: at(c, fm.pos), axis, up } }
    const info = `SA axial along ${'xyz'[k]}, axis end ${axisEnd > 0 ? '+' : '-'}, faces ${fixed(fa.pos)} / ${fixed(fm.pos)}, screw vote ${vote}`
    return { json, info }
  }
  // the side the screws stand out of the housing: both faces lie there
  const out = screws.reduce((s, x) => s + (x.lo[k] < lo - 0.5 ? -1 : 0) + (x.hi[k] > hi + 0.5 ? 1 : 0), 0)
  if (out === 0) throw new Error('screws do not stand out on one side')
  const n = Math.sign(out)
  const axisScrews = screws.filter((x) => x.tip === n)
  const motorScrews = screws.filter((x) => x.tip === -n)
  if (!axisScrews.length || !motorScrews.length) throw new Error('no axis or no motor screws')
  const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1])
  const pulleyNear = (g) => {
    const p = pulleys.map((m) => [centre(m.lo, m.hi, a), centre(m.lo, m.hi, b)]).sort((u, v) => dist(u, g) - dist(v, g))[0]
    return p && dist(p, g) < 15 ? p : g
  }
  const ca = pulleyNear(mean(axisScrews))
  const cm = pulleyNear(mean(motorScrews))
  const fa = kitFace(ms, ca, n, axisScrews, k, housing)
  const fm = kitFace(ms, cm, n, motorScrews, k, housing)
  const d = dist(ca, cm)
  const dir = (u, v) => {
    const o = [0, 0, 0]
    o[a] = fixed((v[0] - u[0]) / d)
    o[b] = fixed((v[1] - u[1]) / d)
    return o
  }
  const json = {
    axisFace: { origin: at(ca, fa.pos), axis: unit(k, -n), up: dir(cm, ca) },
    motorFace: { origin: at(cm, fm.pos), axis: unit(k, n), up: dir(ca, cm) },
  }
  const info = `SA parallel across ${'xyz'[k]}, faces facing ${n > 0 ? '+' : '-'}${'xyz'[k]}, centre distance ${fixed(d)}, faces ${fixed(fa.pos)} / ${fixed(fm.pos)}`
  return { json, info }
}

/**
 * EMGA: output flange at the top (shaft +z), input at the bottom (−z) or, for the angle gearboxes (-A-), on the side
 * the body reaches out to; each the largest face there (not the output spigot or shaft)
 */
function gearboxFrames(file, model) {
  const ms = meshes(readFileSync(file, 'latin1'))
  const body = ms.filter((m) => !hardware(m.name))
  const faces = body.flatMap((m) => m.faces)
  const lo = [0, 1, 2].map((k) => Math.min(...body.map((m) => m.lo[k])))
  const hi = [0, 1, 2].map((k) => Math.max(...body.map((m) => m.hi[k])))
  // flange face: the outermost face of half the body width or more with no wider face right behind it (a centring
  // spigot sits on the flange, a pocket for the partner's spigot lies behind it; either may have the larger area)
  const width = (f) => f.hi[0] - f.lo[0]
  const flangeFace = (k, sign, centred) => {
    const list = faces.filter((f) => f.k === k && f.sign === sign && (!centred || contains(f, [0, 0], k)) && width(f) >= 0.5 * (hi[0] - lo[0]))
    const ok = list.filter((f) => !list.some((g) => (f.pos - g.pos) * sign > 0 && (f.pos - g.pos) * sign <= 15 && width(g) > 1.1 * width(f)))
    if (ok.length === 0) throw new Error(`no flange face facing ${sign > 0 ? '+' : '-'}${'xyz'[k]}`)
    return ok.reduce((a, b) => (b.pos * sign > a.pos * sign ? b : a))
  }
  const output = flangeFace(2, 1, true)
  let input
  if (/^EMGA-\d+-A-/.test(model)) {
    const [k, sign] = [[0, 1], [0, -1], [1, 1], [1, -1]].reduce((a, b) =>
      (b[1] > 0 ? hi[b[0]] : -lo[b[0]]) > (a[1] > 0 ? hi[a[0]] : -lo[a[0]]) ? b : a,
    )
    const f = flangeFace(k, sign, false)
    const origin = [0, 1, 2].map((j) => fixed(j === k ? f.pos : centre(f.lo, f.hi, j)))
    input = { origin, axis: [0, 1, 2].map((j) => (j === k ? sign : 0)), up: [0, 0, 1] }
  } else {
    const f = flangeFace(2, -1, true)
    input = { origin: [0, 0, fixed(f.pos)], axis: [0, 0, -1], up: [0, 1, 0] }
  }
  const json = { output: { origin: [0, 0, fixed(output.pos)], axis: [0, 0, -1], up: [0, 1, 0] }, input }
  return { json, info: `output z ${fixed(output.pos)}, input ${JSON.stringify(input.origin)} → ${JSON.stringify(input.axis)}` }
}

/**
 * Apex (Design Tool downloads, gearbox + motor adapter): the output shaft lies on a coordinate axis through the origin,
 * its tip the smallest face at a box end; the output flange is the outermost face towards the tip of half the widest
 * face's width or more with no wider face up to 20 mm behind it (the centring spigot: AB115 Ø110 on □115,
 * AE120 17.5 mm long), the input the outermost such
 * face at the other end or, right-angle gearboxes (…R), on the side the body reaches out to farthest.
 */
function apexFrames(file, model) {
  const faces = meshes(readFileSync(file, 'latin1')).flatMap((m) => m.faces)
  const lo = [0, 1, 2].map((k) => Math.min(...faces.map((f) => f.lo[k])))
  const hi = [0, 1, 2].map((k) => Math.max(...faces.map((f) => f.hi[k])))
  const width = (f) => Math.max(...[0, 1, 2].filter((j) => j !== f.k).map((j) => f.hi[j] - f.lo[j]))
  const end = (k, sign) => faces.filter((f) => f.k === k && f.sign === sign && Math.abs(f.pos - (sign > 0 ? hi[k] : lo[k])) < 0.1)
  const tips = [0, 1, 2].flatMap((k) => [1, -1].flatMap((sign) => end(k, sign).filter((f) => contains(f, [0, 0], k))))
  const tip = tips.reduce((a, b) => (width(b) < width(a) ? b : a))
  const flangeFace = (k, sign, centred) => {
    const side = faces.filter((f) => f.k === k && f.sign === sign && (!centred || contains(f, [0, 0], k)))
    const list = side.filter((f) => width(f) >= 0.5 * Math.max(...side.map(width)))
    const ok = list.filter((f) => !list.some((g) => (f.pos - g.pos) * sign > 0 && (f.pos - g.pos) * sign <= 20 && width(g) > 1.05 * width(f)))
    return ok.reduce((a, b) => (b.pos * sign > a.pos * sign ? b : a))
  }
  const k = tip.k
  const motorward = [0, 1, 2].map((j) => (j === k ? -tip.sign : 0))
  const output = flangeFace(k, tip.sign, true)
  let input, up
  if (/^A[BE]R/.test(model)) {
    const [kk, sign] = [0, 1, 2].filter((j) => j !== k).flatMap((j) => [[j, 1], [j, -1]])
      .reduce((a, b) => ((b[1] > 0 ? hi[b[0]] : -lo[b[0]]) > (a[1] > 0 ? hi[a[0]] : -lo[a[0]]) ? b : a))
    const f = flangeFace(kk, sign, false)
    const origin = [0, 1, 2].map((j) => fixed(j === kk ? f.pos : centre(f.lo, f.hi, j)))
    input = { origin, axis: [0, 1, 2].map((j) => (j === kk ? sign : 0)), up: motorward.map((v) => -v + 0) }
    up = input.axis // as on EMGA-…-A-: the output's up points to the side the input sits on
  } else {
    const f = flangeFace(k, -tip.sign, true)
    up = k === 1 ? [0, 0, 1] : [0, 1, 0]
    input = { origin: [0, 1, 2].map((j) => (j === k ? fixed(f.pos) : 0)), axis: motorward, up }
  }
  const json = { output: { origin: [0, 1, 2].map((j) => (j === k ? fixed(output.pos) : 0)), axis: motorward, up }, input }
  return { json, info: `output ${'xyz'[k]} ${fixed(output.pos)}, input ${JSON.stringify(input.origin)} → ${JSON.stringify(input.axis)}` }
}

/** The instance whose child geometry, transformed, has the box closest to the mesh's. */
function matchInstance(inst, mesh, text) {
  const e = (matchInstance.cache ??= new Map()).get(text) ?? parseEntities(text)
  matchInstance.cache.set(text, e)
  // same part name, nearest box centre: vertex boxes stay inside the tessellated ones (rounded faces bulge out,
  // a disc has a single vertex)
  const named = inst.filter((i) => i.name === mesh.name.trim())
  let best = null
  for (const i of named.length ? named : inst) {
    const box = (i.box ??= childBox(e, i))
    if (!box) continue
    const d = Math.hypot(...[0, 1, 2].map((k) => (box.lo[k] + box.hi[k] - mesh.lo[k] - mesh.hi[k]) / 2))
    if ((named.length || d < 6) && (!best || d < best.d)) best = { ...i, d }
  }
  return best
}

/** Box of the vertices of an instance's geometry, in assembly coordinates. */
function childBox(e, i) {
  if (!i.child) return null
  // shape representation → (relationship) → brep representation(s) → vertex points
  const reps = [i.child]
  for (const b of e.values())
    if (b.startsWith('SHAPE_REPRESENTATION_RELATIONSHIP') && refsOf(b).includes(i.child)) reps.push(...refsOf(b))
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const seen = new Set()
  const stack = [...new Set(reps)]
  let count = 0
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    const body = e.get(id)
    if (!body) continue
    if (body.startsWith('VERTEX_POINT')) {
      const p = numbers(e.get(refsOf(body)[0]))
      const [x, y, z] = i.t2.cols
      const w = [0, 1, 2].map((k) => i.t2.p[k] + x[k] * p[0] + y[k] * p[1] + z[k] * p[2])
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], w[k])
        hi[k] = Math.max(hi[k], w[k])
      }
      count++
      continue
    }
    if (/^(SHAPE_REPRESENTATION|PRODUCT|NEXT_ASSEMBLY|CONTEXT_DEPENDENT|ITEM_DEFINED|\(|GEOMETRIC_REPRESENTATION_CONTEXT|PRESENTATION|STYLED|MECHANICAL_DESIGN)/.test(body) && id !== reps[0] && !reps.includes(id)) continue
    for (const r of refsOf(body)) stack.push(r)
  }
  return count ? { lo, hi } : null
}

function strokeOf(model) {
  for (const a of axes) {
    const code = a.typeCode ?? a.model
    const re = new RegExp(`^${code.split('…').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)')}$`, 'i')
    const m = re.exec(model)
    if (m) return Number(m[1])
  }
  throw new Error(`no axis type in data/ for ${model}`)
}

/** one line per top-level key, as in the hand-written files */
const inline = (v) =>
  Array.isArray(v)
    ? `[${v.map(inline).join(', ')}]`
    : v && typeof v === 'object'
      ? `{ ${Object.entries(v)
          .map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
          .join(', ')} }`
      : JSON.stringify(v)
const format = (json) =>
  `{\n${Object.entries(json)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${inline(v)}`)
    .join(',\n')}\n}\n`

const files = only.length
  ? only
  : [axesDir, join(root, 'data/kits/Festo/Drawings'), join(root, 'data/gearboxes/Festo/Drawings'), join(root, 'data/gearboxes/Apex/Drawings')].flatMap(walk)
let written = 0
// --profile: add the `profile` frame to existing axis JSONs, keeping everything else
const profileOnly = args.includes('--profile')
for (const file of files) {
  const out = file.replace(/\.stp$/i, '.json')
  if (profileOnly) {
    if (!existsSync(out) || !resolve(file).startsWith(axesDir)) continue
    const old = JSON.parse(readFileSync(out, 'utf8'))
    if (old.profile && !force) continue
    try {
      const { json } = frames(file, /^\d+_(.+)\.stp$/i.exec(file.split(/[\\/]/).pop())[1])
      if (!dryRun) writeFileSync(out, format({ ...old, profile: json.profile }))
      else console.log(out, JSON.stringify(json.profile))
      written++
    } catch (err) {
      console.log(`${file}: FAILED ${err.message}`)
    }
    continue
  }
  if (existsSync(out) && !force && !dryRun) continue
  const name = file.split(/[\\/]/).pop()
  // Apex files have no part number: `ab0421-p0401100102.stp`
  const model = /^\d+_(.+)\.stp$/i.exec(name)?.[1] ?? name.replace(/\.stp$/i, '').toUpperCase()
  const make = /^EAMM-/.test(model) ? kitFrames : /^[A-Z]{2}\d{3}[AU]\d{3}/.test(model) ? saKitFrames : /^EMGA-/.test(model) ? gearboxFrames : /^A[BE]/.test(model) ? apexFrames : frames
  try {
    const { json, info } = make(file, model)
    console.log(`${model}: ${info}`)
    if (dryRun) console.log(JSON.stringify(json))
    else {
      writeFileSync(out, format(json))
      written++
    }
  } catch (err) {
    console.log(`${model}: FAILED ${err.message}`)
  }
}
console.log(`${written} written`)
