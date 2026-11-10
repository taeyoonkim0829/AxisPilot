import { args, pointOf, refList, refs, typeOf, type StepFile, type Vec3 } from './step'

// Product structure of a STEP file: PRODUCT → formation → PRODUCT_DEFINITION → shape → representations.

const ofType = (file: StepFile, type: string) => [...file.entities].filter(([, b]) => typeOf(b) === type)

/** Shape representation of a product definition */
export function shapeOf(file: StepFile, pd: number): number | null {
  const pds = ofType(file, 'PRODUCT_DEFINITION_SHAPE').find(([, b]) => refs(b).at(-1) === pd)?.[0]
  if (pds == null) return null
  const sdr = ofType(file, 'SHAPE_DEFINITION_REPRESENTATION').find(([, b]) => refs(b)[0] === pds)
  return sdr ? refs(sdr[1])[1] : null
}

/** The top product definition: the one that is never a component (`related`) of an assembly usage. */
export function rootDefinition(file: StepFile): number {
  const nauo = ofType(file, 'NEXT_ASSEMBLY_USAGE_OCCURRENCE').map(([, b]) => refs(b))
  const related = new Set(nauo.map((r) => r[1]))
  const pds = ofType(file, 'PRODUCT_DEFINITION').map(([id]) => id)
  const root = pds.find((id) => !related.has(id) && (nauo.length === 0 || nauo.some((r) => r[0] === id)))
  if (root == null) throw new Error('STEP: no root product definition')
  return root
}

/** Product definition whose PRODUCT name contains `name` (or matches it) */
export function definitionByName(file: StepFile, name: string | RegExp): number | null {
  const product = ofType(file, 'PRODUCT').find(([, b]) => (typeof name === 'string' ? args(b)[0].includes(name) : name.test(args(b)[0])))?.[0]
  return product == null ? null : definitionOf(file, product)
}

/** Product definition of a PRODUCT */
export function definitionOf(file: StepFile, product: number): number | null {
  const formation = [...file.entities].find(
    ([, b]) => typeOf(b).startsWith('PRODUCT_DEFINITION_FORMATION') && refs(b)[0] === product,
  )?.[0]
  return ofType(file, 'PRODUCT_DEFINITION').find(([, b]) => refs(b)[0] === formation)?.[0] ?? null
}

/**
 * Where a part's shape representation sits in its assembly: the origin and axes (columns) of the placement its
 * ITEM_DEFINED_TRANSFORMATION maps it to, or null when it is not placed (the root, a single-part file). Assumes the
 * transformation's first placement is the identity, as CADENAS writes it.
 */
export function placementOf(file: StepFile, rep: number): { origin: Vec3; axes: [Vec3, Vec3, Vec3] } | null {
  for (const body of file.entities.values()) {
    const rel = /REPRESENTATION_RELATIONSHIP\s*\([^()]*?,\s*#(\d+)\s*,\s*#\d+\s*\)/.exec(body)
    const idt = /REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)/.exec(body)
    if (!rel || !idt || Number(rel[1]) !== rep) continue
    return placementAxes(file, refs(file.entities.get(Number(idt[1])) ?? '')[1] ?? -1)
  }
  return null
}

/** Origin and axes (columns) of an AXIS2_PLACEMENT_3D */
export function placementAxes(file: StepFile, placement: number): { origin: Vec3; axes: [Vec3, Vec3, Vec3] } | null {
  const [location, z, x] = refs(file.entities.get(placement) ?? '')
  const origin = pointOf(file.entities.get(location) ?? '')
  if (!origin) return null
  const dir = (id: number | undefined, fallback: Vec3) =>
    id == null ? fallback : (pointOf((file.entities.get(id) ?? '').replace(/^DIRECTION/, 'CARTESIAN_POINT')) ?? fallback)
  const zz = dir(z, [0, 0, 1])
  const xx = dir(x, [1, 0, 0])
  const yy: Vec3 = [zz[1] * xx[2] - zz[2] * xx[1], zz[2] * xx[0] - zz[0] * xx[2], zz[0] * xx[1] - zz[1] * xx[0]]
  return { origin, axes: [xx, yy, zz] }
}

/** Every placement (AXIS2_PLACEMENT_3D id) a part's shape representation is mapped to, one per instance */
export function placementIdsOf(file: StepFile, rep: number): number[] {
  const ids: number[] = []
  for (const body of file.entities.values()) {
    const rel = /REPRESENTATION_RELATIONSHIP\s*\([^()]*?,\s*#(\d+)\s*,\s*#\d+\s*\)/.exec(body)
    const idt = /REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)/.exec(body)
    if (!rel || !idt || Number(rel[1]) !== rep) continue
    const placement = refs(file.entities.get(Number(idt[1])) ?? '')[1]
    if (placement != null) ids.push(placement)
  }
  return ids
}

/** Solids (MANIFOLD_SOLID_BREP, BREP_WITH_VOIDS) of a shape representation, directly or via a relationship */
export function solidsOf(file: StepFile, rep: number): number[] {
  const reps = [rep]
  for (const [, b] of ofType(file, 'SHAPE_REPRESENTATION_RELATIONSHIP')) {
    const r = refs(b)
    if (r[0] === rep) reps.push(r[1])
    else if (r[1] === rep) reps.push(r[0])
  }
  const solids: number[] = []
  for (const id of reps) {
    const body = file.entities.get(id)
    if (!body) continue
    for (const item of refList(args(body)[1] ?? '')) {
      const t = typeOf(file.entities.get(item) ?? '')
      if (t === 'MANIFOLD_SOLID_BREP' || t === 'BREP_WITH_VOIDS') solids.push(item)
    }
  }
  return [...new Set(solids)]
}
