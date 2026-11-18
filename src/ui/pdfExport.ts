// Calculation report → PDF, entirely in the browser. Each chapter is rendered to an image and placed on A4
// pages (a chapter taller than a page continues on the next), so Korean text needs no embedded PDF font.
import { translate, type Lang } from '../i18n'

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 12

/**
 * Builds the PDF from a mounted `Report`. The libraries load only when a PDF is made. `link`: the address the
 * report's `.report-link` lines open (a clickable area over each).
 */
export async function reportToPdf(root: HTMLElement, title: string, link?: string): Promise<Blob> {
  const [{ jsPDF }, { domToCanvas }] = await Promise.all([import('jspdf'), import('modern-screenshot')])
  await document.fonts.ready

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  pdf.setProperties({ title })
  const contentW = PAGE_W - 2 * MARGIN
  const contentH = PAGE_H - 2 * MARGIN
  let firstPage = true

  for (const chapter of root.querySelectorAll<HTMLElement>('.report-chapter')) {
    const canvas = await domToCanvas(chapter, { scale: 2, backgroundColor: '#ffffff' })
    const mmPerPx = contentW / canvas.width
    const pagePx = Math.floor(contentH / mmPerPx)
    // link lines in canvas px (the canvas is the chapter at `scale` 2)
    const box = chapter.getBoundingClientRect()
    const px = canvas.width / box.width
    const links = link
      ? [...chapter.querySelectorAll<HTMLElement>('.report-link')].map((el) => {
          const r = el.getBoundingClientRect()
          return { x: (r.left - box.left) * px, y: (r.top - box.top) * px, w: r.width * px, h: r.height * px }
        })
      : []
    for (let top = 0; top < canvas.height; top += pagePx) {
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = Math.min(pagePx, canvas.height - top)
      slice.getContext('2d')!.drawImage(canvas, 0, -top)
      if (!firstPage) pdf.addPage()
      firstPage = false
      pdf.addImage(slice, 'PNG', MARGIN, MARGIN, contentW, slice.height * mmPerPx, undefined, 'FAST')
      for (const l of links.filter((l) => l.y >= top && l.y < top + slice.height))
        pdf.link(MARGIN + l.x * mmPerPx, MARGIN + (l.y - top) * mmPerPx, l.w * mmPerPx, l.h * mmPerPx, { url: link })
    }
  }
  return pdf.output('blob')
}

/** Suggested file name / PDF title: 축선정_<axis model>_<yyyy-mm-dd> (AxisPilot_… in English). */
export function reportTitle(axisModel: string, lang: Lang, template = '축선정_{model}_{date}'): string {
  // Local date (toISOString would give the UTC date, a day early in Korea before 9:00)
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return translate(lang, template, { model: axisModel, date }).replace(/[\\/:*?"<>|]/g, '_')
}

/**
 * Opens a tab right away (inside the click, so popup blockers allow it) that shows a waiting message
 * until the PDF is ready.
 */
export function openPendingTab(lang: Lang): Window | null {
  const win = window.open('', '_blank')
  if (win) {
    const text = translate(lang, 'PDF 생성 중…')
    win.document.title = text
    win.document.body.style.cssText = 'font-family: sans-serif; display: grid; place-items: center; height: 100vh; margin: 0; color: #5b6672'
    win.document.body.textContent = text
  }
  return win
}
