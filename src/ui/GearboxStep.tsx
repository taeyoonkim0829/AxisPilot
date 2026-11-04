import type { DriveEvaluation } from '../calc/motorSelection'
import { Ratio, StatusBadge } from './common'
import { SpeedRatio } from './MotorStep'
import { useT } from '../i18n'

interface Props {
  /** Every compatible gearbox for the selected motor */
  options: DriveEvaluation[]
  selected: DriveEvaluation
  onSelect: (gearboxId: string) => void
}

/** 감속기 선정 inside the motor step, below the motor list (only with 감속기 사용). */
export function GearboxChoice({ options, selected, onSelect }: Props) {
  const t = useT()
  const selectedId = selected.gearbox?.id ?? null
  return (
    <div className="detail" id="step-gearbox">
      <header className="step-head">
        <h2>
          <span className="step-no">3</span> {t('감속기 선정')}
        </h2>
      </header>
      <p className="muted small-print">
        {t('추천 감속기(통과하는 가장 낮은 감속비)가 적용되어 있습니다. 다른 감속기를 누르면 바꿀 수 있습니다.')}
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('판정')}</th>
              <th>{t('메이커')}</th>
              <th>{t('모델명')}</th>
              <th className="num">{t('감속비')}</th>
              <th>{t('최대 토크')}</th>
              <th>{t('실효 토크')}</th>
              <th>{t('회전수')}</th>
              <th>{t('관성비')}</th>
            </tr>
          </thead>
          <tbody>
            {options.map((d) => {
              const id = d.gearbox?.id ?? null
              const inertia = d.checks.find((c) => c.label === '관성비')
              return (
                <tr
                  key={id ?? 'direct'}
                  className={id === selectedId ? 'selected' : ''}
                  onClick={() => id && onSelect(id)}
                  tabIndex={0}
                  onKeyDown={(k) => k.key === 'Enter' && id && onSelect(id)}
                >
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td>{d.gearbox?.maker ?? '—'}</td>
                  <td className="model">{d.gearbox?.model ?? '—'}</td>
                  <td className="num">{d.gearbox ? `${d.gearbox.ratio}:1` : '—'}</td>
                  <td>
                    <Ratio ratio={d.peakTorque / d.motor.peakTorque} />
                  </td>
                  <td>
                    <Ratio ratio={d.rmsTorque / d.motor.ratedTorque} />
                  </td>
                  <td>
                    <SpeedRatio drive={d} />
                  </td>
                  <td>
                    <Ratio ratio={inertia?.ratio ?? null} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
