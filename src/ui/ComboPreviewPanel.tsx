import { lazy, Suspense } from 'react'
import type { Combo } from '../cad/combo'
import { useT } from '../i18n'
import { useTheme } from './theme'
import { STALE_BUILD_NOTICE } from './staleBuild'
import type { useComboPreview } from './useComboPreview'

const ComboViewer = lazy(() => import('./ComboViewer'))

/** 3D 미리보기 / STEP / DXF / PDF buttons, progress and errors, and the viewer of a `useComboPreview` build. */
export function ComboPreviewPanel<C extends Combo>({
  state,
  ready,
  onStep,
  onDxf,
  onPdf,
}: {
  state: ReturnType<typeof useComboPreview<C>>
  ready: boolean
  onStep: () => void
  onDxf: () => void
  /** the same 2D drawing as a PDF */
  onPdf: () => void
}) {
  const t = useT()
  const [theme] = useTheme()
  const { preview, busy, error, shown, shownRoles, stale, showPreview } = state
  return (
    <>
      <div className="drawing-actions">
        <button type="button" className="action-btn" onClick={showPreview} disabled={!ready || busy != null}>
          {t(preview ? '3D 미리보기 새로 고침' : '3D 미리보기')}
        </button>
        <button type="button" className="action-btn" onClick={onStep} disabled={!ready || busy != null}>
          {t('STEP 내보내기')}
        </button>
        <button type="button" className="action-btn" onClick={onDxf} disabled={!ready || busy != null}>
          {t('DXF 내보내기')}
        </button>
        <button type="button" className="action-btn" onClick={onPdf} disabled={!ready || busy != null}>
          {t('PDF 도면 내보내기')}
        </button>
        {(busy ?? (stale && t('3D 모델을 만드는 중…'))) && <span className="muted">{busy ?? t('3D 모델을 만드는 중…')}</span>}
      </div>
      {error === STALE_BUILD_NOTICE ? (
        <p className="fail-text small-print">
          {t(STALE_BUILD_NOTICE)}{' '}
          <button type="button" className="action-btn" onClick={() => window.location.reload()}>
            {t('새로 고침')}
          </button>
        </p>
      ) : (
        error && <p className="fail-text small-print">{t('도면을 만들지 못했습니다: {error}', { error })}</p>
      )}
      {preview && shown && (
        <Suspense fallback={<p className="muted small-print">{t('3D 뷰어를 불러오는 중…')}</p>}>
          {/* key: the edge colour comes from the theme when the viewer is built */}
          <ComboViewer key={theme} meshes={shown.meshes} roles={shownRoles} cog={shown.combo.cog} />
        </Suspense>
      )}
    </>
  )
}
