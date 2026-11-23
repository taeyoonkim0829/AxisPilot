import { useState } from 'react'
import type { AxisEvaluation } from '../calc/axisSelection'
import type { DriveEvaluation } from '../calc/motorSelection'
import type { Settings, VerticalDirection } from '../calc/types'
import { useT } from '../i18n'
import { ProfileChart, type ProfileView } from './ProfileChart'
import { fmt } from './format'

interface Props {
  axis: AxisEvaluation
  drive: DriveEvaluation | null
  settings: Settings
  /** direction of the forward move on a vertical axis, null otherwise */
  vertical: VerticalDirection | null
  view: ProfileView
  onView: (view: ProfileView) => void
}

export function MotionProfile({ axis, drive, settings, vertical, view, onView }: Props) {
  const [open, setOpen] = useState(true)
  return (
    <section className="panel">
      <ProfileChart
        axis={axis}
        drive={drive}
        settings={settings}
        vertical={vertical}
        open={open}
        onToggle={() => setOpen(!open)}
        view={view}
        onView={onView}
      />
      <ProfileNumbers axis={axis} />
    </section>
  )
}

/** Peak values and times of one move plus the cycle time; also used in the report. */
export function ProfileNumbers({ axis }: { axis: AxisEvaluation }) {
  const t = useT()
  const p = axis.profile
  return (
    <dl className="profile">
      <div>
        <dt>{t('최고 속도')}</dt>
        <dd>
          {fmt(p.peakVelocity, 3)} m/s{!p.reachedVelocity && <span className="warn-text"> ({t('설정 속도 미도달')})</span>}
        </dd>
      </div>
      <div>
        <dt>{t('최대 가속도')}</dt>
        <dd>{fmt(p.peakAcceleration, 2)} m/s²</dd>
      </div>
      <div>
        <dt>{t('가속 시간')}</dt>
        <dd>{fmt(p.accelTime, 3)} s</dd>
      </div>
      <div>
        <dt>{t('등속 시간')}</dt>
        <dd>{fmt(p.constantTime, 3)} s</dd>
      </div>
      <div>
        <dt>{t(axis.press ? '접근 시간' : '이동 시간 (편도)')}</dt>
        <dd>{fmt(p.moveTime, 3)} s</dd>
      </div>
      {axis.press && (
        <>
          <div>
            <dt>{t('압착 시간')}</dt>
            <dd>{fmt(axis.press.profile.moveTime, 3)} s</dd>
          </div>
          <div>
            <dt>{t('가압 유지')}</dt>
            <dd>{fmt(axis.press.holdTime, 3)} s</dd>
          </div>
        </>
      )}
      <div>
        <dt>{t('이동 시간 (왕복)')}</dt>
        <dd>{fmt(axis.cycleTime, 3)} s</dd>
      </div>
    </dl>
  )
}
