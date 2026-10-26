// Frame JSONs for the gantry kits in data/adapters/Festo/Drawings (EHAM-AK/-MA, EAHF-E24-…-P-D…/-B4), from their
// geometry and the axes' hole patterns. `base`: the centre of the kit's pins into the base slide (the slide's pin
// holes sit at its centre), axis +y into the kit, up across the carried travel. `carried`: where the carried axis's
// profile underside sits (axis from the kit towards the carried slide, up along the carried travel, z in Festo's
// files), across the travel on the profile's centreline: EHAM-AK-L9 / EHAM-MA-L9 pin the ELGT profile (its pin holes
// and threaded holes, assembly instructions 8140647 / 8140638), EHAM-AK-E24 carries the ELGD profile on its
// cylindrical pin (instructions 8238670: the profile's lower edge on the pin). Angle kits: the outermost large x+
// face of the wall; plates (EHAM-MA): the top face; EAHF profile mountings: the profile on the base slide (y = 0)
// between the jaws.
// It also prints, per kit, where the carried axis goes (`end`, `pinned`, `threads`, `screws` in data/adapters).
//   node scripts/festo-cad/adapter-frames.mjs [--dry-run]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root } from './parts.mjs'

const require = createRequire(import.meta.url)
const occt = await require(join(root, 'node_modules/occt-import-js'))()
const dir = join(root, 'data/adapters/Festo/Drawings')
const axisDir = join(root, 'data/axes/Festo/Drawings')
const dryRun = process.argv.includes('--dry-run')
const fixed = (v) => Number((Math.round(v / 0.05) * 0.05 + 0).toFixed(2))
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a, b) => a.map((x, i) => x - b[i])
const add = (a, b) => a.map((x, i) => x + b[i])
const scale = (a, k) => a.map((x) => x * k)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
/** A rotation as three column images: x ↦ cols[0] … */
const rot = (m, v) => add(add(scale(m[0], v[0]), scale(m[1], v[1])), scale(m[2], v[2]))

/** Meshes with their bounding boxes and planar faces; `holes(k)`: faces round about axis k (bores, slot ends). */
function meshes(text) {
  const r = occt.ReadStepFile(new TextEncoder().encode(text), null)
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
    const faces = m.brep_faces.map((f) => {
      const n = [0, 0, 0]
      const flo = [Infinity, Infinity, Infinity]
      const fhi = [-Infinity, -Infinity, -Infinity]
      // largest share of each triangle normal component (a bore's wall has none along its axis)
      const along = [0, 0, 0]
      for (let t = f.first; t <= f.last; t++) {
        const v = [0, 1, 2].map((k) => [0, 1, 2].map((j) => p[idx[3 * t + k] * 3 + j]))
        const c = cross(sub(v[1], v[0]), sub(v[2], v[0]))
        const len = Math.hypot(...c)
        for (let i = 0; i < 3; i++) {
          n[i] += c[i] / 2
          if (len > 1e-9) along[i] = Math.max(along[i], Math.abs(c[i]) / len)
        }
        for (const q of v)
          for (let k = 0; k < 3; k++) {
            flo[k] = Math.min(flo[k], q[k])
            fhi[k] = Math.max(fhi[k], q[k])
          }
      }
      return { n, area: Math.hypot(...n), lo: flo, hi: fhi, along }
    })
    return { name: m.name ?? '', lo, hi, faces }
  })
}

/**
 * Bores in a mounting face (normal along file axis k, at `at`): round faces starting at the face, as centres in the
 * other two coordinates with their diameter; slots (two half-round ends) as segments.
 */
function bores(ms, k, at) {
  const [a, b] = [0, 1, 2].filter((i) => i !== k)
  const round = []
  const halves = []
  for (const m of ms)
    for (const f of m.faces) {
      if (f.along[k] > 0.2 || Math.min(Math.abs(f.lo[k] - at), Math.abs(f.hi[k] - at)) > 1.5) continue
      const da = f.hi[a] - f.lo[a]
      const db = f.hi[b] - f.lo[b]
      const c = [(f.lo[a] + f.hi[a]) / 2, (f.lo[b] + f.hi[b]) / 2]
      if (da > 2 && da < 14 && Math.abs(da - db) < 0.3) round.push({ c, d: da })
      else if (da > 2 && da < 14 && Math.abs(db - da / 2) < 0.3) halves.push({ c, d: da })
    }
  const slots = []
  for (const h of halves) {
    const o = halves.find((x) => x !== h && Math.abs(x.c[0] - h.c[0]) < 0.1 && Math.abs(x.d - h.d) < 0.1 && Math.abs(x.c[1] - h.c[1]) < 2 * h.d)
    // the half-round ends face away from each other: the slot spans between their straight sides
    if (o && h.c[1] < o.c[1]) slots.push({ a: [h.c[0], h.c[1] + h.d / 4], b: [o.c[0], o.c[1] - o.d / 4], d: h.d })
  }
  const unique = round.filter((r, i) => round.findIndex((x) => Math.hypot(x.c[0] - r.c[0], x.c[1] - r.c[1]) < 0.2 && Math.abs(x.d - r.d) < 0.2) === i)
  return { round: unique, slots, plane: [a, b] }
}

const hardware = (name) => /ISO|DIN|H7x|^\d+ \d+H7/i.test(name)
const isPin = (name) => /H7x|ISO 2338|DIN 6325/i.test(name)
const isScrew = (name) => /4762|14579|DIN.?912/i.test(name)
const centre = (m) => scale(add(m.lo, m.hi), 0.5)
/** a fastener's diameter: the smaller extent across its axis (the longest extent) */
const size = (m) => {
  const e = sub(m.hi, m.lo)
  const k = e.indexOf(Math.max(...e))
  return Math.min(...e.filter((_, i) => i !== k))
}

/** The axis drawing a kit's carried axis is checked against (one of its standard strokes ≥ 300 mm). */
function carriedAxisFile(model) {
  const elgt = /^EHAM-(?:AK|MA)-L9-\d+-L9-(\d+)/.exec(model)
  const elgd = /^EHAM-AK-E24-\d+-E24-(\d+)/.exec(model)
  const re = elgt ? new RegExp(`^\\d+_ELGT-BS-${elgt[1]}-(\\d+)-10P\\.stp$`) : elgd ? new RegExp(`^\\d+_ELGD-BS-KF-${elgd[1]}-(\\d+)-0H-10P-L\\.stp$`) : null
  if (!re) return null
  const sub = elgt ? 'ELGT' : 'ELGD'
  const files = readdirSync(join(axisDir, sub))
    .map((f) => [f, re.exec(f)])
    .filter(([, m]) => m && Number(m[1]) >= 300)
    .sort((x, y) => Number(x[1][1]) - Number(y[1][1]))
  return files.length ? join(axisDir, sub, files[0][0]) : null
}

/**
 * The ELGT profile on the kit's carried pins and screws: the rotation (profile normal into the kit, travel along
 * ±up) and offset that put every pin into a pin bore or slot and every screw on a threaded bore of the profile.
 * Returns the kit-coordinate images of the axis drive origin and travel, and the profile's centreline across.
 */
function pinFit(kitMs, carried, axisFile, reach) {
  const meta = JSON.parse(readFileSync(axisFile.replace(/\.stp$/, '.json'), 'utf8'))
  const ms = meshes(readFileSync(axisFile, 'latin1'))
  const nf = meta.profile.normal
  const k = nf.findIndex((x) => Math.abs(x) > 0.5)
  const face = bores(ms, k, meta.profile.origin[k])
  const tf = meta.slide.travel
  const nk = carried.axis
  const uk = carried.up
  const across = cross(nk, uk)
  const pins = kitMs.filter((m) => isPin(m.name))
  const screws = kitMs.filter((m) => isScrew(m.name))
  const inPlane = (p) => [dot(p, across), dot(p, uk)]
  const fits = []
  for (const s of [1, -1]) {
    if (reach && s !== reach) continue
    // file → kit rotation: profile normal into the kit, travel along s·up
    const af = cross(nf, tf)
    const m = [nf, tf, af]
    const img = [scale(nk, -1), scale(uk, s), cross(scale(nk, -1), scale(uk, s))]
    // columns: images of the file's unit vectors
    const R = [0, 1, 2].map((i) => add(add(scale(img[0], m[0][i]), scale(img[1], m[1][i])), scale(img[2], m[2][i])))
    const toKit = (h) => {
      const p = [0, 0, 0]
      p[face.plane[0]] = h[0]
      p[face.plane[1]] = h[1]
      p[k] = meta.profile.origin[k]
      return rot(R, p)
    }
    const pinD = size(pins[0])
    const candidates = face.round.filter((h) => Math.abs(h.d - pinD) < 0.6)
    for (const h of candidates) {
      const T = sub(centre(pins[0]), toKit(h.c))
      const at = (p) => inPlane(add(toKit(p), T))
      const hit = (p, d) => {
        const q = inPlane(centre(p))
        if (face.round.some((x) => Math.abs(x.d - d) < 0.7 && Math.hypot(...sub(at(x.c), q)) < 0.6)) return true
        return face.slots.some((x) => {
          if (Math.abs(x.d - d) > 0.7) return false
          const [a, b] = [at(x.a), at(x.b)]
          const t = Math.max(0, Math.min(1, dot([...sub(q, a), 0], [...sub(b, a), 0]) / Math.max(1e-9, dot([...sub(b, a), 0], [...sub(b, a), 0]))))
          return Math.hypot(...sub(q, add(a, scale(sub(b, a), t)))) < 0.6
        })
      }
      // the screw's nominal size from its name (M6x12): a threaded bore's core is 0.75–0.9 of it
      const threadD = (sc) => {
        const m = Number(/M(\d+)/.exec(sc.name)?.[1])
        return face.round.find((x) => x.d < m && x.d > 0.7 * m && Math.hypot(...sub(at(x.c), inPlane(centre(sc)))) < 0.6)
      }
      if (pins.every((p) => hit(p, size(p))) && screws.every((sc) => threadD(sc))) {
        const drive = add(rot(R, meta.drive.origin), T)
        const centreline = add(toKit([0, 0]), T)
        // threaded bores (the size the screws went into) along the travel from the drive origin
        const tapped = screws.map(threadD)
        const rows = [
          ...new Set(
            face.round
              .filter((x) => tapped.some((t) => Math.abs(t.d - x.d) < 0.05))
              .map((x) => fixed(dot(sub(toKit(x.c), toKit(meta.drive.origin.filter((_, i) => i !== k))), scale(uk, s)))),
          ),
        ].sort((x, y) => x - y)
        fits.push({ s, drive, centreline, rows, body: scale(uk, s) })
      }
    }
  }
  return fits[0] ?? null
}

/** Half the width of an ELGD profile's underside across the travel (the face at the profile frame). */
function profileHalfWidth(axisFile) {
  const meta = JSON.parse(readFileSync(axisFile.replace(/\.stp$/, '.json'), 'utf8'))
  const ms = meshes(readFileSync(axisFile, 'latin1'))
  const k = meta.profile.normal.findIndex((x) => Math.abs(x) > 0.5)
  const a = [0, 1, 2].find((i) => i !== k && Math.abs(meta.slide.travel[i]) < 0.5)
  let lo = Infinity
  let hi = -Infinity
  for (const m of ms)
    for (const f of m.faces)
      if (f.area > 50 && Math.abs(f.n[k]) > 0.999 * f.area && Math.abs(f.lo[k] - meta.profile.origin[k]) < 0.1) {
        lo = Math.min(lo, f.lo[a])
        hi = Math.max(hi, f.hi[a])
      }
  return (hi - lo) / 2
}

/** The B4 jaw's hole pattern (M6 clearance) on its underside, in the file's first instance (the jaw at +x). */
function jawSeat(body) {
  const holes = bores([body[0]], 1, 0).round
  if (holes.length !== 4) throw new Error(`B4: ${holes.length} holes in the jaw`)
  const c = [0, 1].map((i) => holes.reduce((s, h) => s + h.c[i], 0) / holes.length)
  if (c[0] <= 0) throw new Error('B4: the first jaw is not at +x')
  return { origin: [fixed(c[0]), 0, fixed(c[1])], axis: [0, 1, 0], up: [0, 0, 1] }
}

/**
 * EHAM-AK-E24: where the EAHF-E24-60-P-B4 jaws sit on the wall, one seat per jaw (assembly instructions 8238670:
 * the jaws' screws in the wall's M6 threads beside the profile, four along the travel per jaw). Each seat is the
 * jaw's `mounting` frame: on the wall face at the centre of its four threads, `axis` = the carried axis, `up` turned
 * so the jaw's lip (−x of the jaw file = −(axis × up)) points to the profile.
 */
function profileMountings(body, carried) {
  const k = carried.axis.findIndex((x) => Math.abs(x) > 0.5)
  const at = carried.origin[k]
  const { round, plane } = bores(body, k, at)
  const threads = round.filter((h) => h.d > 4.6 && h.d < 5.2)
  // the two thread columns either side of the profile centreline (the wall has further threads nearer the foot)
  const all = [...new Set(threads.map((h) => fixed(h.c[0])))]
  const centre = carried.origin[plane[0]]
  const pairs = all.flatMap((a) => all.filter((b) => b > a && a < centre && b > centre).map((b) => [a, b]))
  const columns = pairs.sort((p, q) => Math.abs((p[0] + p[1]) / 2 - centre) - Math.abs((q[0] + q[1]) / 2 - centre))[0]
  if (!columns || Math.abs((columns[0] + columns[1]) / 2 - centre) > 1.5) throw new Error(`E24 kit: no thread columns either side of the profile (${all})`)
  const middle = (columns[0] + columns[1]) / 2
  const seats = []
  for (const col of columns) {
    const along = threads.filter((h) => fixed(h.c[0]) === col).map((h) => h.c[1]).sort((a, b) => a - b)
    for (let i = 0; i < along.length; i += 4) {
      const group = along.slice(i, i + 4)
      if (group.length !== 4 || group[3] - group[0] > 61) throw new Error(`E24 kit: threads ${along} do not group by four`)
      const origin = [0, 0, 0]
      origin[k] = at
      origin[plane[0]] = col
      origin[plane[1]] = (group[0] + group[3]) / 2
      const inward = [0, 0, 0]
      inward[plane[0]] = middle - col
      const up = [carried.up, scale(carried.up, -1)].find((u) => dot(scale(cross(carried.axis, u), -1), inward) > 0)
      seats.push({ origin: origin.map(fixed), axis: carried.axis, up: up.map((x) => x + 0) })
    }
  }
  return seats
}

let written = 0
for (const f of readdirSync(dir).filter((f) => /\.stp$/i.test(f))) {
  const model = /^\d+_(.+)\.stp$/i.exec(f)[1]
  const ms = meshes(readFileSync(join(dir, f), 'latin1'))
  const body = ms.filter((m) => !hardware(m.name))
  // fasteners reaching below the mounting face into the base slide; its pin bores sit at the slide centre
  const into = ms.filter((m) => hardware(m.name) && m.lo[1] < -1)
  const basePins = into.filter((m) => isPin(m.name))
  const mid = (list, k) => (Math.min(...list.map((m) => m.lo[k])) + Math.max(...list.map((m) => m.hi[k]))) / 2
  const ref = basePins.length ? basePins : into
  const base = { origin: [fixed(mid(ref, 0)), 0, fixed(mid(ref, 2))], axis: [0, 1, 0], up: [1, 0, 0] }
  const above = ms.filter((m) => hardware(m.name) && m.lo[1] >= -1)
  let carried
  let mounting = null
  let mountings = []
  let info = ''
  if (/^EHAM-AK/.test(model)) {
    const faces = body.flatMap((m) => m.faces).filter((x) => Math.abs(x.n[0]) > 0.999 * x.area && x.n[0] > 0 && x.area > 1)
    const big = Math.max(...faces.map((x) => x.area))
    const wall = faces.filter((x) => x.area > 0.3 * big).reduce((a, b) => (b.lo[0] > a.lo[0] ? b : a))
    const same = faces.filter((x) => Math.abs(x.lo[0] - wall.lo[0]) < 1)
    let y = (Math.min(...same.map((x) => x.lo[1])) + Math.max(...same.map((x) => x.hi[1]))) / 2
    const lo = Math.min(...body.map((m) => m.lo[2]))
    const hi = Math.max(...body.map((m) => m.hi[2]))
    // the wall reaches from the foot along ±z
    const reach = Math.sign((lo + hi) / 2 - base.origin[2])
    const behind = reach > 0 ? base.origin[2] - lo : hi - base.origin[2]
    carried = { origin: [fixed(wall.lo[0]), 0, 0], axis: [1, 0, 0], up: [0, 0, 1] }
    const ahead = reach > 0 ? hi - base.origin[2] : base.origin[2] - lo
    const axisFile = carriedAxisFile(model)
    if (/-L9-/.test(model) && axisFile) {
      const fit = pinFit(above, carried, axisFile, reach)
      if (!fit) throw new Error(`${model}: no pin fit on ${axisFile}`)
      y = fit.centreline[1]
      const end = dot(sub(fit.drive, base.origin), fit.body)
      const screws = above.filter((m) => isScrew(m.name)).map((m) => dot(sub(centre(m), base.origin), fit.body))
      info = `pinned end ${fixed(end)} threads ${fit.rows.filter((x) => x > 0).slice(0, 2)} screws ${fixed(Math.min(...screws))}…${fixed(Math.max(...screws))}`
    } else if (/-E24-/.test(model) && axisFile) {
      // the profile rests on the cylindrical pin; its end at clearance A = 77.5 mm from the console end
      const pin = above.find((m) => isPin(m.name))
      y = pin.hi[1] + profileHalfWidth(axisFile)
      info = `rests on pin, end ${fixed(77.5 - behind)}`
      mountings = profileMountings(body, { ...carried, origin: [carried.origin[0], y, 0] })
      info += ` mountings ${mountings.map((m) => fixed(dot(sub(m.origin, base.origin), [0, 0, reach]))).join('/')}`
    }
    carried.origin[1] = fixed(y)
    info += ` wall ${fixed(-behind)}…${fixed(ahead)}`
  } else if (/^EHAM-MA/.test(model)) {
    const top = Math.max(...body.map((m) => m.hi[1]))
    carried = { origin: [0, fixed(top), 0], axis: [0, 1, 0], up: [0, 0, 1] }
    const axisFile = carriedAxisFile(model)
    const fit = axisFile && pinFit(above, carried, axisFile, 0)
    if (!fit) throw new Error(`${model}: no pin fit`)
    carried.origin[0] = fixed(fit.centreline[0])
    // the carried body's direction is free on a plate: given from the base origin along it
    const end = dot(sub(fit.drive, base.origin), fit.body)
    const screws = above.filter((m) => isScrew(m.name)).map((m) => dot(sub(centre(m), base.origin), fit.body))
    info = `pinned end ${fixed(end)} body ${fit.body} threads ${fit.rows.filter((x) => x > 0).slice(0, 2)} screws ${fixed(Math.min(...screws))}…${fixed(Math.max(...screws))}`
  } else {
    // EAHF: the jaws clamp the carried profile lying on the base slide
    base.origin = [0, 0, 0]
    carried = { origin: [0, 0, 0], axis: [0, 1, 0], up: [0, 0, 1] }
    // a pair of jaws (B4, for the 60 profile): one jaw on its own, the file's first instance, seated on its hole
    // pattern (the console's M6 threads), its lip towards −x
    if (/-B4$/.test(model)) mounting = jawSeat(body)
  }
  const frame = (f) => JSON.stringify(f).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }')
  const json = `{\n  "base": ${frame(base)},\n  "carried": ${frame(carried)}${mounting ? `,\n  "mounting": ${frame(mounting)}` : ''}${mountings.length ? `,\n  "mountings": [\n${mountings.map((m) => `    ${frame(m)}`).join(',\n')}\n  ]` : ''}\n}\n`
  console.log(model.padEnd(30), JSON.stringify(base.origin), JSON.stringify(carried.origin), info)
  if (!dryRun) {
    writeFileSync(join(dir, f.replace(/\.stp$/i, '.json')), json.replace(/,(\d|-)/g, ', $1'))
    written++
  }
}
console.log(`${written} written`)
