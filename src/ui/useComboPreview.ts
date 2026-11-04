import { useEffect, useMemo, useRef, useState } from 'react'
import type { Combo } from '../cad/combo'
import type { Drawing } from '../cad/drawings'
import type { SheetLabels } from '../cad/dxf'
import type { PartMesh } from '../cad/occt'
import { stepText } from '../cad/stepText'
import { translate, useT, type Args } from '../i18n'
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

export function download(name: string, content: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type }) : content)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** the 2D drawing's input (DXF and PDF): the meshes, COG, title and notes, and the parts list */
const drawingInput = (combo: Combo, meshes: PartMesh[], title: string[]) => ({
  meshes,
  cog: combo.cog,
  title,
  parts: combo.parts.map(({ role, name }) => ({ role, name })),
})

/** the PDF sheet's words in the app language (the DXF keeps the English defaults) */
const sheetLabels = (t: ReturnType<typeof useT>): SheetLabels => ({
  title: t('도명'),
  dwgNo: t('도번'),
  scale: t('척도'),
  projection: t('투상법'),
  unit: t('단위'),
  date: t('작성일'),
  drawn: t('작성'),
  no: t('품번'),
  part: t('품명'),
  model: t('규격 · 형식'),
  qty: t('수량'),
  notes: t('주기'),
  unitsNote: t('치수 단위는 mm, 투상법은 제3각법.'),
  cogNote: t('COG: 부하의 무게 중심 (가는 2점 쇄선).'),
  roles: {
    axis: t('축'),
    kit: t('연결키트'),
    gearbox: t('감속기'),
    motor: t('모터'),
    shaft: t('연결축'),
    adapter: t('조합 키트'),
    guide: t('가이드'),
  },
})

/** translates the drawing's notes: the app language for the PDF, English for the DXF (ASCII) */
export type NoteTranslator = (text: string, args?: Args) => string
const english: NoteTranslator = (text, args) => translate('en', text, args)

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
  const exportDxf = (name: (c: C) => string, title: (c: C, tr: NoteTranslator) => string[]) =>
    run(t('DXF 도면을 만드는 중…'), async () => {
      const { combo, meshes } = await meshesFor()
      const { drawingDxf } = await import('../cad/dxf')
      download(`${fileSafe(name(combo))}.dxf`, drawingDxf(drawingInput(combo, meshes, title(combo, english))), 'application/dxf')
    })
  const exportPdf = (name: (c: C) => string, title: (c: C, tr: NoteTranslator) => string[]) => {
    // the font first, within the click (the browser asks for the local font permission only then)
    const pdf = import('../cad/drawingPdf')
    const font = pdf.then((m) => m.loadKoreanFont())
    return run(t('PDF 도면을 만드는 중…'), async () => {
      const { combo, meshes } = await meshesFor()
      const { drawingPdf } = await pdf
      download(`${fileSafe(name(combo))}.pdf`, drawingPdf({ ...drawingInput(combo, meshes, title(combo, t)), labels: sheetLabels(t) }, await font), 'application/pdf')
    })
  }

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
  return { preview, busy, error, shown, shownRoles, stale, showPreview, exportStep, exportDxf, exportPdf, meshes }
}
