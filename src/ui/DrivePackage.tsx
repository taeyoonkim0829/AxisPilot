import type { CableChoice, ControllerSelection } from '../calc/controllerSelection'
import { useT } from '../i18n'
import { CheckTable, NumberField } from './common'
import { cableRoleLabel, fmt } from './format'
import { KitNotes } from './KitStep'

const orderLabel: Record<Exclude<CableChoice['order'], 'standard'>, string> = {
  variable: '가변 길이',
  modular: '모듈러 ({module})',
  rounded: '표준 길이로 올림',
}

/** Festo drive package of the selected motor: servo drive, cables and braking resistor, with their checks. */
export function DrivePackage({
  selection,
  cableLength,
  onCableLength,
  hideTitle,
}: {
  selection: ControllerSelection
  cableLength: number
  /** omitted in the report */
  onCableLength?: (length: number) => void
  /** the report's chapter heading names it already */
  hideTitle?: boolean
}) {
  const t = useT()
  const { controller, preferred, cables, resistor } = selection
  return (
    <div className="drive-package">
      {!hideTitle && <h4>{t('드라이브 · 케이블 · 제동저항')}</h4>}
      {onCableLength && (
        <div className="drive-package-length">
          <NumberField
            label={t('모터 케이블 길이')}
            unit="m"
            value={cableLength}
            min={0.5}
            step={0.5}
            hint={selection.maxCableLength != null ? t('최대 {n} m (드라이브 · 케이블 기준)', { n: fmt(selection.maxCableLength, 3) }) : undefined}
            low={selection.maxCableLength != null && cableLength > selection.maxCableLength}
            onChange={onCableLength}
          />
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('구분')}</th>
              <th>{t('형식')}</th>
              <th>{t('주문번호')}</th>
              <th>{t('비고')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('서보 드라이브')}</td>
              <td className="model">{controller?.model ?? '—'}</td>
              <td>{controller?.partNumber ?? '—'}</td>
              <td className="muted">
                {controller &&
                  t('{supply} · 정격 {nominal} A / 최대 {peak} A', {
                    supply: controller.supply,
                    nominal: fmt(controller.nominalCurrent, 1),
                    peak: fmt(controller.peakCurrent, 1),
                  })}
                {preferred && ` · ${t('Festo 추천 조합: {model}', { model: preferred.model })}`}
              </td>
            </tr>
            {cables.map((c) => (
              <tr key={c.role}>
                <td>{t(cableRoleLabel[c.role])}</td>
                <td className="model">{c.type}</td>
                <td>{c.partNumber ?? '—'}</td>
                <td className="muted">
                  {[
                    c.crossSection != null ? `${fmt(c.crossSection, 2)} mm²` : null,
                    `${fmt(c.length, 1)} m`,
                    c.order === 'standard' ? null : t(orderLabel[c.order], { module: c.module ?? '' }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
              </tr>
            ))}
            <tr>
              <td>{t('제동저항')}</td>
              <td className={resistor.required && resistor.item ? 'model' : undefined}>
                {resistor.required ? (resistor.item?.model ?? '—') : t(controller?.internalResistor ? '내장 제동저항' : '불필요')}
              </td>
              <td>{resistor.required ? (resistor.item?.partNumber ?? '—') : '—'}</td>
              <td className="muted">
                {t('회생 평균 {avg} W · 최대 {peak} W · 1회 {energy} Ws', {
                  avg: fmt(resistor.averagePower, 1),
                  peak: fmt(resistor.peakPower, 0),
                  energy: fmt(resistor.eventEnergy, 1),
                })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CheckTable checks={selection.checks} />
      {selection.notes.length > 0 && <KitNotes notes={selection.notes} />}
    </div>
  )
}
