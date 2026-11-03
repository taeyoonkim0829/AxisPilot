import type { DrawMesh } from './dxf'

// The assembled STEP is tessellated by OpenCascade in a web worker (`occt.worker.ts`, loaded on first use): reading
// a combination takes a few seconds, which would otherwise freeze the page each time the open preview follows the
// selection. Without worker support (tests) it runs on the calling thread.

export interface PartMesh extends DrawMesh {
  /** index of the assembly part (order of `Combo.parts`) */
  part: number
  positions: Float32Array
  index: Uint32Array
  normals: Float32Array | null
  /** feature edges for the 3D view (line segment pairs, xyz), computed in the worker */
  edges?: Float32Array
  name: string
  /** the maker's colour of the body (linear RGB 0–1), null when its file gives none; faces may override it */
  color: number[] | null
  faces: { first: number; last: number; color: number[] | null }[]
}

/** Crease angle (degrees) above which a mesh edge is drawn in the 3D view */
export const EDGE_ANGLE = 25

export interface TessellateRequest {
  id: number
  step: Uint8Array
  partCount: number
}
export type TessellateReply = { id: number; meshes: PartMesh[] } | { id: number; error: string }

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (m: PartMesh[]) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./occt.worker.ts', import.meta.url), { type: 'module' })
  w.addEventListener('message', (e: MessageEvent<TessellateReply>) => {
    const job = pending.get(e.data.id)
    if (!job) return
    pending.delete(e.data.id)
    if ('error' in e.data) job.reject(new Error(e.data.error))
    else job.resolve(e.data.meshes)
  })
  // a crashed worker (e.g. out of memory) fails its jobs; the next request starts a new one
  w.addEventListener('error', (e) => {
    e.preventDefault()
    for (const job of pending.values()) job.reject(new Error(e.message || 'Tessellation worker failed'))
    pending.clear()
    w.terminate()
    if (worker === w) worker = null
  })
  worker = w
  return w
}

/** Meshes of the assembly, each tagged with the top-level part it belongs to. */
export async function tessellate(step: string, partCount: number): Promise<PartMesh[]> {
  const bytes = new TextEncoder().encode(step)
  if (typeof Worker === 'undefined') return (await import('./occtMesh')).meshStep(bytes, partCount)
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const request: TessellateRequest = { id, step: bytes, partCount }
    getWorker().postMessage(request, [bytes.buffer])
  })
}
