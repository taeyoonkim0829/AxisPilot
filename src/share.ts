// Shared calculation: the inputs and choices of a screen packed into the address (`?r=…`), so a link (the PDF
// report carries one) opens the same calculation. JSON, deflated, base64url; read once at start-up.
import { defaultComboOptions, type ComboOptions } from './cad/combo'
import { defaultGantry, initialGantrySettings, type GantryAxis, type GantryInputs, type GantrySettings } from './calc/gantry'
import { defaultParallel, defaultPress, defaultSettings, type ParallelConfig, type Requirements, type Settings } from './calc/types'
import { noPicks, type Picks } from './selection'
import type { ProfileView } from './ui/ProfileChart'

export interface SingleShare {
  mode: 'single'
  req: Requirements
  settings: Settings
  picks: Picks
  profileView: ProfileView
  assembly: ComboOptions
}

export interface GantryShare {
  mode: 'gantry'
  gantry: GantryInputs
  gantrySettings: GantrySettings
  picks: Record<GantryAxis, Picks>
  views: Record<GantryAxis, ProfileView>
  assemblies: Record<GantryAxis, ComboOptions>
  /** the open axis tab */
  tab: GantryAxis
}

export type Shared = SingleShare | GantryShare

const PARAM = 'r'
/** format version, the first character of the value */
const VERSION = '1'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** bytes a shared state may unpack to (a real one is a few kB): a crafted link must not fill the tab's memory */
export const MAX_SHARED_BYTES = 1 << 20

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_SHARED_BYTES) {
      await reader.cancel()
      throw new Error('shared state too large')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const toBase64Url = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

export async function encodeShare(shared: Shared): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(shared))
  return VERSION + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

/** The shared state from an encoded value, filled up with today's defaults; null when it cannot be read. */
export async function decodeShare(value: string): Promise<Shared | null> {
  if (!value.startsWith(VERSION)) return null
  try {
    const bytes = await inflate(fromBase64Url(value.slice(VERSION.length)))
    return withDefaults(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

const perAxis = <T,>(read: (a: GantryAxis) => T): Record<GantryAxis, T> => ({ x: read('x'), y: read('y'), z: read('z') })

/** Fields added since the link was made take their defaults. */
function withDefaults(s: Partial<Shared> & { mode?: string }): Shared | null {
  if (s.mode === 'single') {
    const v = s as Partial<SingleShare>
    if (!v.req) return null
    return {
      mode: 'single',
      req: { ...v.req, press: { ...defaultPress, ...v.req.press } },
      settings: { ...defaultSettings, ...v.settings },
      picks: { ...noPicks, ...v.picks },
      profileView: v.profileView ?? 'cycle',
      assembly: { ...defaultComboOptions, ...v.assembly },
    }
  }
  if (s.mode === 'gantry') {
    const v = s as Partial<GantryShare>
    return {
      mode: 'gantry',
      gantry: gantryOf(v.gantry),
      gantrySettings: perAxis((a) => ({ ...initialGantrySettings[a], ...v.gantrySettings?.[a] })),
      picks: perAxis((a) => ({ ...noPicks, ...v.picks?.[a] })),
      views: perAxis((a) => v.views?.[a] ?? 'cycle'),
      assemblies: perAxis((a) => ({ ...defaultComboOptions, ...v.assemblies?.[a] })),
      tab: v.tab ?? 'z',
    }
  }
  return null
}

/** Gantry inputs from a link, the fields added since filled from the defaults; links made before Y could be a twin
 *  arrangement carry the X arrangement as `xParallel` */
function gantryOf(v: (Partial<GantryInputs> & { xParallel?: ParallelConfig }) | undefined): GantryInputs {
  const { xParallel, ...rest } = v ?? {}
  const parallel = { ...defaultGantry.parallel, ...rest.parallel, ...(xParallel ? { x: xParallel } : {}) }
  return {
    ...defaultGantry,
    ...rest,
    parallel: { x: { ...defaultParallel, ...parallel.x }, y: { ...defaultParallel, ...parallel.y } },
  }
}

/** The address that opens `shared`: this page with the state, #gantry for the gantry screen. */
export async function shareUrl(shared: Shared): Promise<string> {
  const url = new URL(window.location.pathname, window.location.origin)
  url.searchParams.set(PARAM, await encodeShare(shared))
  url.hash = shared.mode === 'gantry' ? 'gantry' : ''
  return url.toString()
}

/** The state the page was opened with, if any; the value is then taken out of the address. */
export async function readShared(): Promise<Shared | null> {
  const url = new URL(window.location.href)
  const value = url.searchParams.get(PARAM)
  if (!value) return null
  url.searchParams.delete(PARAM)
  window.history.replaceState(null, '', url.toString())
  return decodeShare(value)
}
