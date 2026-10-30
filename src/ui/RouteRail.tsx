import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AxisEvaluation } from '../calc/axisSelection'
import type { DriveEvaluation } from '../calc/motorSelection'
import type { Check, Status } from '../calc/types'
import { MOTOR_MAX_LABEL, type KitEvaluation } from '../calc/kitSelection'
import { koSubjectParticle, langSwitchLabel, useT, type Lang } from '../i18n'
import { pct, statusLabel } from './format'

interface Props {
  axis: AxisEvaluation | null
  drive: DriveEvaluation | null
  kit: KitEvaluation | null
  /** Builds the PDF and opens it in a new tab */
  onExport: () => void
  /** true while the PDF is being made */
  exporting: boolean
  lang: Lang
  onLang: (lang: Lang) => void
  /** Gantry: the X/Y/Z axis row above the open axis's signs */
  axes?: ReactNode
  /** What has to be selected before the PDF can be made (default: this axis's axis, motor and kit) */
  missing?: string[]
}

const stepIds = ['step-axis', 'step-motor', 'step-gearbox', 'step-kit'] as const

/** The most heavily loaded check, the number that decides the margin. */
function tightest(checks: Check[]): Check | null {
  return checks.reduce<Check | null>((max, c) => (c.ratio != null && (!max || c.ratio > (max.ratio ?? 0)) ? c : max), null)
}

/** Highlights the step section nearest the top of the viewport. */
function useActiveStep(): number {
  const [active, setActive] = useState(0)
  useEffect(() => {
    const els = stepIds.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e)
    const visible = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting)
        const first = stepIds.findIndex((id) => visible.get(id))
        if (first >= 0) setActive(first)
      },
      // the band just below the rail (taller with the gantry's axis row)
      { rootMargin: `-${Math.round((document.querySelector('.rail')?.getBoundingClientRect().bottom ?? 112) + 28)}px 0px -45% 0px` },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  return active
}

/** The page has scrolled, so content passes under the floating rail */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return scrolled
}

function Sign({
  no,
  name,
  value,
  status,
  detail,
  empty,
  active,
}: {
  no: number
  name: string
  value: string | null
  status?: Status
  detail?: string
  empty?: string
  active: boolean
}) {
  const t = useT()
  const go = () => document.getElementById(stepIds[no - 1])?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <li className={`sign${active ? ' sign-active' : ''}`}>
      <button type="button" className="sign-btn" onClick={go} aria-current={active ? 'step' : undefined}>
        <span className="sign-no">{no}</span>
        <span className="sign-body">
          <span className="sign-name">{name}</span>
          <span className={`sign-value${value ? '' : ' sign-empty'}`} title={value ?? undefined}>{value ?? empty ?? t('선택 안 됨')}</span>
          {(status || detail) && (
            <span className="sign-detail">
              {status && <span className={`sign-status sign-status-${status}`}>{t(statusLabel[status])}</span>}
              {detail && <span>{detail}</span>}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

export function RouteRail({ axis, drive, kit, onExport, exporting, lang, onLang, axes, missing: required }: Props) {
  const t = useT()
  const active = useActiveStep()
  const scrolled = useScrolled()
  const axisTight = axis && tightest(axis.checks)
  const driveTight = drive && tightest(drive.checks)
  // the advisory motor-torque check is not part of the kit verdict, so not its headline either
  const kitTight = kit && tightest(kit.checks.filter((c) => c.label !== MOTOR_MAX_LABEL))
  const g = drive?.gearbox

  const dialog = useRef<HTMLDialogElement>(null)
  const missing = required ?? [!axis && t('직교 축'), !drive && t('모터'), !kit && t('연결키트')].filter((m): m is string => !!m)
  const missingText = missing.join(', ')
  const exportClick = () => (missing.length ? dialog.current?.showModal() : onExport())

  return (
    <>
      <div className={`rail-veil${scrolled ? ' on' : ''}`} aria-hidden />
      <div className="page-brand">
        <img src={`${import.meta.env.BASE_URL}axispilot-logo-dark.svg`} alt="AxisPilot" width={171} height={32} />
      </div>
      <header className={`rail${scrolled ? ' over' : ''}`}>
        <div className="rail-inner">
          <div className="rail-brand">
            {/* the rail is sign blue in both themes, so the logo's dark-background version is used in both */}
            <img className="rail-logo" src={`${import.meta.env.BASE_URL}axispilot-logo-dark.svg`} alt="AxisPilot" width={171} height={32} />
          </div>
          <div className="rail-main">
            {axes}
            <ol className="signs" aria-label={t('선정 경로')}>
              <Sign
                no={1}
                name={t('직교 축')}
                value={axis?.order.model ?? null}
                status={axis?.status}
                detail={axisTight ? `${t(axisTight.label)} ${pct(axisTight.ratio)}` : undefined}
                active={active === 0}
              />
              <Sign
                no={2}
                name={t('모터')}
                value={drive ? drive.motor.model : null}
                status={drive?.status}
                detail={
                  drive ? `${drive.motor.maker}${driveTight ? ` · ${t(driveTight.label)} ${pct(driveTight.ratio)}` : ''}` : undefined
                }
                active={active === 1}
              />
              <Sign
                no={3}
                name={t('감속기')}
                value={drive ? (g ? g.model : t('감속기 미사용')) : null}
                detail={g ? `${g.maker} · ${g.ratio}:1` : undefined}
                active={active === 2}
              />
              <Sign
                no={4}
                name={t('연결키트')}
                value={kit?.kit.product ?? null}
                status={kit?.status}
                empty={drive ? t('해당 키트 없음') : undefined}
                detail={kit ? (kitTight ? `${t(kitTight.label)} ${pct(kitTight.ratio)}` : t('축 {axis} · {motor}', { axis: kit.kit.axisCode, motor: kit.kit.motorCode })) : undefined}
                active={active === 3}
              />
            </ol>
          </div>
          <div className="rail-actions">
            <button type="button" className="rail-action" onClick={exportClick} disabled={exporting}>
              {exporting ? t('PDF 생성 중…') : t('PDF로 내보내기')}
            </button>
            <button
              type="button"
              className="rail-action"
              lang={lang === 'ko' ? 'en' : 'ko'}
              onClick={() => onLang(lang === 'ko' ? 'en' : 'ko')}
            >
              {langSwitchLabel[lang]}
            </button>
          </div>
          <dialog ref={dialog} className="notice" aria-labelledby="notice-title">
            <h2 id="notice-title">{t('PDF로 내보낼 수 없습니다')}</h2>
            <p>
              {t('{items} 선정되지 않았습니다.', {
                items: lang === 'ko' ? missingText + koSubjectParticle(missingText) : missingText,
              })}
              <br />
              {t('직교 축, 모터, 연결키트를 먼저 선정하세요.')}
            </p>
            <form method="dialog">
              <button type="submit" className="notice-ok" autoFocus>
                {t('확인')}
              </button>
            </form>
          </dialog>
        </div>
      </header>
    </>
  )
}
