import { useEffect, useMemo, useRef, useState } from 'react'
import type { Combo } from '../cad/combo'
import type { Drawing } from '../cad/drawings'
import type { PartMesh } from '../cad/occt'
import { stepText } from '../cad/stepText'
import { useT } from '../i18n'
import { isStaleBuild, STALE_BUILD_NOTICE } from './staleBuild'

// Building, previewing and exporting an assembled combination (step 5 and the gantry drawing).

/** Drawing files fetched once per page (a rebuild for another spacing or orientation reuses them); failures are
 *  dropped, and only the last FILES_KEPT used stay (an ELGT-TB-…-CS file is 25–33 MB, one per stroke) */
const fileCache = new Map<string, Promise<string>>()
const FILES_KEPT = 20 // a gantry drawing uses up to ~15 files (axes, kits, motors, gearboxes, gantry kits, shaft)

async function fetchText(d: Drawing, attempts = 2): Promise<string> {
  try {
    const res = await fetch(d.url)
    if (!res.ok) throw new Error(`${d.path}: ${res.status}`)
    return await stepText(await res.arrayBuffer())
  } catch (e) {
    // A network error (server reloading, file locked by a sync client) is retried once after a short pause
    if (attempts > 1 && e instanceof TypeError) {
      await new Promise((r) => setTimeout(r, 500))
      return fetchText(d, attempts - 1)
    }
    throw e instanceof TypeError ? new Error(`${d.path}: ${e.message}`) : e
  }
}

export const loadText = (d: Drawing) => {
  let text = fileCache.get(d.url)
  if (text) fileCache.delete(d.url) // re-inserted below: Map order = last use
  else {
    text = fetchText(d)
    text.catch(() => fileCache.delete(d.url))
  }
  fileCache.set(d.url, text)
  if (fileCache.size > FILES_KEPT) fileCache.delete(fileCache.keys().next().value!)
  return text
}

/** ms an input change must settle before the open preview is rebuilt (typing 1500 builds once, not four times) */
const REBUILD_DELAY = 400

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_')

/**
 * A combination built once per `key` (the inputs it depends on) and cached, with its meshes for the 3D preview and
 * the DXF; once opened, the preview follows the inputs. `build` is called only when the key changes.
 */
export function useComboPreview<C extends Combo>(key: string, ready: boolean, build: () => Promise<C>) {
  const t = useT()
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef<{ key: string; combo: Promise<C>; meshes?: Promise<PartMesh[]> } | null>(null)
  const [shown, setShown] = useState<{ key: string; combo: C; meshes: PartMesh[] } | null>(null)
  // stable between renders: the viewer rebuilds its scene (and WebGL context) whenever a prop changes
  const shownRoles = useMemo(() => shown?.combo.parts.map((p) => p.role) ?? [], [shown])

  const entryFor = () => {
    if (cache.current?.key !== key) cache.current = { key, combo: build() }
    return cache.current
  }
  const meshesFor = async () => {
    const entry = entryFor()
    const combo = await entry.combo
    entry.meshes ??= import('../cad/occt').then((m) => m.tessellate(combo.step, combo.parts.length))
    return { combo, meshes: await entry.meshes }
  }
  const fail = (e: unknown) => {
    cache.current = null
    setError(isStaleBuild(e) ? STALE_BUILD_NOTICE : String(e instanceof Error ? e.message : e))
  }
  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await job()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const showPreview = () =>
    run(t('3D 모델을 만드는 중…'), async () => {
      const { combo, meshes } = await meshesFor()
      setShown({ key, combo, meshes })
      setPreview(true)
    })
  const exportStep = (name: (c: C) => string) =>
    run(t('STEP 파일을 만드는 중…'), async () => {
      const combo = await entryFor().combo
      download(`${fileSafe(name(combo))}.step`, combo.step, 'application/step')
    })
  const exportDxf = (name: (c: C) => string, title: (c: C) => string[]) =>
    run(t('DXF 도면을 만드는 중…'), async () => {
      const { combo, meshes } = await meshesFor()
      const { drawingDxf } = await import('../cad/dxf')
      download(`${fileSafe(name(combo))}.dxf`, drawingDxf({ meshes, cog: combo.cog, title: title(combo), parts: combo.parts.map(({ role, name }) => ({ role, name })) }), 'application/dxf')
    })

  const stale = preview && ready && shown != null && shown.key !== key
  useEffect(() => {
    if (!stale) return
    let cancelled = false
    const timer = setTimeout(() => {
      meshesFor()
        .then(({ combo, meshes }) => {
          if (cancelled) return
          setShown({ key, combo, meshes })
          setError(null)
        })
        .catch((e: unknown) => {
          if (!cancelled) fail(e)
          else cache.current = null
        })
    }, REBUILD_DELAY)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, stale]) // eslint-disable-line react-hooks/exhaustive-deps -- rebuild when the inputs change

  /** the combination and its meshes, built (and cached) without opening the preview: for checks on the geometry */
  const meshes = meshesFor
  return { preview, busy, error, shown, shownRoles, stale, showPreview, exportStep, exportDxf, meshes }
}
