import type { Occt, OcctNode } from 'occt-import-js'
import type { PartMesh } from './occt'

// OpenCascade (occt-import-js, WebAssembly ~7.6 MB): reads the assembled STEP into triangle meshes. Runs in the
// tessellation worker (`occt.worker.ts`), so the page stays responsive while a model of a few MB is read.

let occt: Promise<Occt> | null = null

function loadOcct(): Promise<Occt> {
  occt ??= Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')]).then(
    ([{ default: init }, { default: wasmUrl }]) => init({ locateFile: () => wasmUrl }),
  )
  return occt
}

/** Meshes of the assembly, each tagged with the top-level part it belongs to (typed arrays, transferable). */
export async function meshStep(step: Uint8Array, partCount: number): Promise<PartMesh[]> {
  const lib = await loadOcct()
  const result = lib.ReadStepFile(step, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.0005,
    angularDeflection: 0.3,
  })
  if (!result.success) throw new Error('STEP could not be read')
  // descend through wrapper nodes to the level holding one node per part
  let level: OcctNode[] = [result.root]
  while (level.length === 1 && level[0].children.length > 0 && level[0].meshes.length === 0) level = level[0].children
  const partOf = new Map<number, number>()
  const walk = (node: OcctNode, part: number) => {
    for (const m of node.meshes) partOf.set(m, part)
    node.children.forEach((c) => walk(c, part))
  }
  if (level.length === partCount) level.forEach((node, i) => walk(node, i))
  return result.meshes.map((m, i) => ({
    part: partOf.get(i) ?? 0,
    name: m.name,
    positions: Float32Array.from(m.attributes.position.array),
    normals: m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null,
    index: Uint32Array.from(m.index.array),
    color: m.color ?? null,
    faces: m.brep_faces,
  }))
}
