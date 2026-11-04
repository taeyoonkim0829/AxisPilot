import { orderKits, type KitEvaluation, type KitMatch, type KitNote, type KitType } from '../calc/kitSelection'
import type { Kit } from '../data/types'
import { useT } from '../i18n'
import { CheckTable, Ratio, StatusBadge } from './common'

interface Props {
  /** null until a motor is selected */
  match: KitMatch | null
  /** Standard kits of the match, ordered by `orderKits`, with their checks */
  rows: KitEvaluation[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** step number: 4 after the gearbox, else 3 */
  no: number
}

const typeLabel: Record<KitType, string> = { axial: '직렬', parallel: '병렬' }

export function KitStep({ match, rows, selectedId, onSelect, no }: Props) {
  const t = useT()
  const selectedEval = rows.find((e) => e.kit.id === selectedId)

  return (
    <section className="panel step" id="step-kit">
      <header className="step-head">
        <h2>
          <span className="step-no">{no}</span> {t('모터-축 연결키트')}
        </h2>
        {match && (
          <span className="muted">
            {t('축 {axis} · {side} {motor}', {
              axis: match.axisCode ?? '—',
              side: t(match.motorSide === 'gearbox' ? '감속기' : '모터'),
              motor: match.motorCode ?? '—',
            })}
          </span>
        )}
      </header>

      {!match ? (
        <p className="empty">{t('모터를 선택하면 축과 모터(감속기)의 인터페이스 코드에 맞는 키트를 찾습니다.')}</p>
      ) : (
        <>
          <KitTable match={match} rows={rows} selectedId={selectedId} onSelect={onSelect} />
          {selectedEval && <KitDetail evaluation={selectedEval} />}
          {match.special.length > 0 && <SpecialKits kits={orderKits(match.special)} />}
        </>
      )}
    </section>
  )
}

function KitTable({
  match,
  rows,
  selectedId,
  onSelect,
}: {
  match: KitMatch
  rows: KitEvaluation[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const t = useT()
  if (!match.axisCode)
    return <p className="empty">{t('이 축의 인터페이스 코드가 없어 연결키트를 찾을 수 없습니다. 관리자에게 문의하세요.')}</p>
  if (!match.motorCode) {
    return (
      <p className="empty">
        {match.motorSide === 'gearbox'
          ? t('이 감속기의 인터페이스 코드가 없어 연결키트를 찾을 수 없습니다. 관리자에게 문의하세요.')
          : t('이 모터의 인터페이스 코드가 없어 연결키트를 찾을 수 없습니다. 관리자에게 문의하세요.')}
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="empty">
        {t('축 {axis} · {motor} 조합의 연결키트가 없습니다.', { axis: match.axisCode, motor: match.motorCode })}
      </p>
    )
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('판정')}</th>
            <th>{t('연결 방식')}</th>
            <th>{t('견시창')}</th>
            <th>{t('모델명')}</th>
            <th>{t('커플링 / 풀리 품번')}</th>
            <th>{t('전달 토크')}</th>
            <th>{t('회전수')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ kit: k, status, checks }) => (
            <tr
              key={k.id}
              className={k.id === selectedId ? 'selected' : ''}
              onClick={() => onSelect(k.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(k.id)}
            >
              <td>
                <StatusBadge status={status} />
              </td>
              <td>{t(typeLabel[k.type])}</td>
              <td>{k.window ? 'O' : 'X'}</td>
              <td className="model">{k.product}</td>
              <td>{(k.type === 'axial' ? k.coupling : k.pulley) ?? '—'}</td>
              <td>
                <Ratio ratio={checks.find((c) => c.label === '키트 전달 토크')?.ratio ?? null} />
              </td>
              <td>
                <Ratio ratio={checks.find((c) => c.label === '키트 최대 회전수')?.ratio ?? null} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Kit checks and the points to look at beyond them */
function KitDetail({ evaluation }: { evaluation: KitEvaluation }) {
  const t = useT()
  const { kit, checks, notes } = evaluation
  return (
    <div className="detail">
      <h4>{t('{model} 세부사항', { model: kit.product })}</h4>
      <CheckTable checks={checks} />
      <KitSpecs kit={kit} />
      {notes.length > 0 && <KitNotes notes={notes} />}
    </div>
  )
}

export function KitSpecs({ kit }: { kit: Kit }) {
  const t = useT()
  const fmtOr = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${v} ${unit}`)
  return (
    <p className="muted small-print">
      {t('전달 토크 {torque} · 관성 {inertia} · 최대 회전수 {speed}', {
        torque: fmtOr(kit.transmissibleTorque, 'Nm'),
        inertia: fmtOr(kit.inertia, 'kg·cm²'),
        speed: fmtOr(kit.maxSpeed, 'rpm'),
      })}
      {kit.noLoadTorque != null && ` · ${t('무부하 토크 {torque}', { torque: `${kit.noLoadTorque} Nm` })}`}
    </p>
  )
}

export function KitNotes({ notes }: { notes: KitNote[] }) {
  const t = useT()
  return (
    <div className="kit-notes">
      <h4>{t('추가 검토사항')}</h4>
      <ul>
        {notes.map((n) => (
          <li key={n.text}>{t(n.text, n.args)}</li>
        ))}
      </ul>
    </div>
  )
}

function SpecialKits({ kits }: { kits: Kit[] }) {
  const t = useT()
  return (
    <div className="gearbox-pick">
      <h4>{t('SA 특수품 (참고용 · TEC 문의 필요)')}</h4>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('모델명')}</th>
              <th>{t('프로젝트')}</th>
              <th>{t('제작 대상 모터')}</th>
            </tr>
          </thead>
          <tbody>
            {kits.map((k) => (
              <tr key={k.id}>
                <td className="model">{k.product}</td>
                <td>{k.sa?.projectNo ?? '—'}</td>
                <td>{[k.sa?.motorMaker, k.sa?.motorModel].filter(Boolean).join(' ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
