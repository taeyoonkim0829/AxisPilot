import { track } from '../analytics'
import { useEffect, useRef, useState } from 'react'
import { translate, type Lang } from '../i18n'
import { shareUrl, type Shared } from '../share'
import { openPendingTab, reportTitle, reportToPdf } from './pdfExport'
import { isStaleBuild, STALE_BUILD_NOTICE } from './staleBuild'

/**
 * PDF export: `start` opens the waiting tab inside the click and mounts the report (render it off screen into
 * `reportRef` while `exporting`); the PDF then replaces the waiting page. `name` goes into the file name; `share`
 * gives the state the report's link opens on the web.
 */
export function useReportExport(lang: Lang, name: string | null, share: () => Shared) {
  const [exporting, setExporting] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)
  const pdfTab = useRef<Window | null>(null)
  const start = () => {
    pdfTab.current = openPendingTab(lang)
    track('report_pdf_export')
    setExporting(true)
  }
  useEffect(() => {
    if (!exporting || !reportRef.current || !name) return
    const title = reportTitle(name, lang)
    const root = reportRef.current
    shareUrl(share())
      .then((link) => reportToPdf(root, title, link))
      .then((blob) => {
        const url = URL.createObjectURL(new File([blob], `${title}.pdf`, { type: 'application/pdf' }))
        const tab = pdfTab.current
        if (tab && !tab.closed) tab.location.href = url
        else window.open(url, '_blank')
      })
      .catch((error: unknown) => {
        pdfTab.current?.close()
        window.alert(
          isStaleBuild(error)
            ? translate(lang, STALE_BUILD_NOTICE)
            : `${translate(lang, 'PDF를 만들지 못했습니다.')}\n${String(error)}`,
        )
      })
      .finally(() => setExporting(false))
  }, [exporting]) // eslint-disable-line react-hooks/exhaustive-deps -- runs once per export
  return { exporting, start, reportRef }
}
