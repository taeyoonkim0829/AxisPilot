import type { ReactNode } from 'react'
import { gantryAxes, type GantryInputs } from '../calc/gantry'
import type { AxisAdapter } from '../data/types'
import type { GantryAxis } from '../calc/gantry'
import type { ComboOptions } from '../cad/combo'
import { adapterDrawingFor, bracketDrawingUrl, mountingDrawingFor, type BeamMeta, type Drawing } from '../cad/drawings'
import { beamTooShort, buildGantry, type GantryAxisDrawing, type GantryJointDrawing } from '../cad/gantry'
import { useT } from '../i18n'
import type { GantryAxisResult } from '../selection'
import { jointAccessories, type GantryJoint } from '../calc/gantryKits'
import { adapters } from '../data'
import { comboInputs, comboKey, shaftTooShort } from './comboInputs'
import { ComboPreviewPanel } from './ComboPreviewPanel'
import { StatusBadge } from './common'
import { fmt } from './format'
import { loadText, useComboPreview } from './useComboPreview'

const roleWords: Record<string, string> = { axis: '축', kit: '연결키트', gearbox: '감속기', motor: '모터', shaft: '연결축' }

/**
 * The whole gantry assembled: every axis's combination (its step 5) and the gantry kits joining them (data/adapters,
 * from the axis data sheets' combination tables), 3D preview, STEP and DXF.
 */
export function GantryDrawing({
  gantry,
  results,
  assemblies,
  tabs,
}: {
  gantry: GantryInputs
  results: GantryAxisResult[]
  assemblies: Record<GantryAxis, ComboOptions>
  /** step 5's tabs (each axis's drawing, the whole gantry's) */
  tabs?: ReactNode
}) {
  const t = useT()
  const order = gantryAxes(gantry.config)
  const inputs = order.map((a) => {
    const r = results.find((x) => x.axis === a)
    const s = r?.sel
    return { a, r, ...(r?.req && s ? comboInputs(s.selectedAxis, s.selectedDrive, s.selectedKitEval?.kit ?? null, r.req) : null) }
  })
  const joints = results.flatMap((r) => (r.joint ? [r.joint] : []))
  const jointDrawings: GantryJointDrawing[] = joints.map((j) => ({
    base: j.base,
    carried: j.carried,
    kits: j.kits.map((kit) => ({ kit, drawing: adapterDrawingFor(kit), mountings: mountingDrawingFor(kit) })),
    offset: j.offset,
    flange: j.flange,
    driveSign: j.driveSign,
    beam: j.beam && {
      bracket: j.beam.bracket,
      drawing: adapterDrawingFor(j.beam.bracket) as Drawing<BeamMeta> | null,
      length: j.beam.length,
      at: j.beam.at,
      plate: j.beam.plate && { kit: j.beam.plate, drawing: adapterDrawingFor(j.beam.plate) },
    },
  }))
  const complete = inputs.every((i) => i.selection && i.found)
  const ready = complete && inputs.every((i) => i.found!.missing.length === 0)
  const key = complete
    ? [
        ...inputs.map((i) => {
          const o = assemblies[i.a]
          return `${i.a}:${comboKey(i.selection!, i.req!, i.twin)}|${o.kitSide}|${o.motorConnector}|${o.drive.otherEnd}${o.drive.otherSide}|${JSON.stringify([o.twinDrive, o.twinKitSide, o.twinMotorConnector])}`
        }),
        ...jointDrawings.map(
          (j) =>
            `${j.base}${j.carried}:${j.kits.map((k) => k.kit.id).join('+')}@${JSON.stringify(j.offset)}${j.flange ?? ''}${j.driveSign ?? ''}${j.beam ? `|${j.beam.bracket.id}:${j.beam.length}:${j.beam.at}:${j.beam.plate?.kit.id ?? ''}` : ''}`,
        ),
        JSON.stringify(gantry.offsets),
        gantry.zMode,
        gantry.xMounting,
        gantry.yMounting,
      ].join('#')
    : ''
  const state = useComboPreview(key, ready, () =>
    buildGantry(
      gantry,
      inputs.map((i): GantryAxisDrawing => ({ axis: i.a, sel: i.selection!, found: i.found!, req: i.req!, options: assemblies[i.a], twin: i.twin })),
      jointDrawings,
      loadText,
    ),
  )
  const name = () => `Gantry_${gantry.config.toUpperCase()}_${inputs.map((i) => i.selection!.axisModel).join('_')}`
  const title = (c: { name: string }) => [
    c.name,
    `Gantry ${gantry.config.toUpperCase()}, axes at the start position; gantry kits from the axis data sheets.`,
    'Third-angle projection, units: mm. 3D models: manufacturer CAD data (see STEP header for licence).',
  ]
  const missing = inputs.flatMap((i) => (i.found?.missing.length ? [`${i.a.toUpperCase()}: ${i.found.missing.map((m) => t(roleWords[m] ?? m)).join(', ')}`] : []))
  const unkitted = state.shown?.combo.unkitted ?? []
  // parts the drawing leaves out because a spacing is too short (the checks above fail or warn for the same reason)
  const shortened = [
    ...joints.flatMap((j) =>
      j.beam && beamTooShort(j.beam)
        ? [t('{pair}: {base}축 간격이 짧아 빔(L {length} mm, 최소 {min} mm)을 도면에서 뺐습니다. {base}축 간격을 늘리세요.', {
            pair: `${j.base.toUpperCase()}–${j.carried.toUpperCase()}`,
            base: j.base.toUpperCase(),
            length: Math.round(j.beam.length),
            min: j.beam.bracket.beam!.length[0],
          })]
        : [],
    ),
    ...results.flatMap((r) => {
      const axis = r.sel?.selectedAxis
      return axis?.shaft && axis.layout.mode === 'twinShaft' && shaftTooShort(axis)
        ? [t('{axis}축: 축 간격이 짧아 연결축 공칭 길이 LN {length} mm가 최소 {min} mm보다 짧습니다. 도면에서 연결축을 뺐습니다. 축 간격을 {need} mm 이상으로 늘리세요.', {
            axis: r.axis.toUpperCase(),
            length: axis.shaft.length,
            min: axis.shaft.shaft.lengthRange[0],
            need: axis.shaft.shaft.lengthRange[0] + axis.shaft.driveWidth,
          })]
        : []
    }),
  ]

  return (
    <section className="panel step" id="step-drawing">
      <header className="step-head">
        <h2>
          <span className="step-no">5</span> {t('조합 도면')}
        </h2>
        {tabs}
        <span className="muted">{t('{config} 조합 · 각 축의 5단계 조합 도면과 조합 키트로 조립합니다.', { config: gantry.config.toUpperCase() })}</span>
      </header>
      {!complete ? (
        <p className="empty">{t('모든 축의 축, 모터, 연결키트를 선택하면 조합축 도면을 만듭니다.')}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('결합')}</th>
                  <th>{t('판정')}</th>
                  <th>{t('조합 키트')}</th>
                  <th>{t('품번')}</th>
                  <th>{t('수량')}</th>
                  <th>{t('비고')}</th>
                </tr>
              </thead>
              <tbody>
                {joints.map((j) => (
                  <tr key={`${j.base}${j.carried}`}>
                    <td>{t('{carried}축 → {base}축 슬라이드', { carried: j.carried.toUpperCase(), base: j.base.toUpperCase() })}</td>
                    <td>
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="model">{j.kit ? jointModels(j).map((k) => <div key={k.model}>{k.model}</div>) : '—'}</td>
                    <td className="num">{j.kit ? jointModels(j).map((k) => <div key={k.model}>{k.partNumber ?? t('주문 제작')}</div>) : '—'}</td>
                    <td className="num">{j.kit ? jointModels(j).map((k) => <div key={k.model}>{k.n}</div>) : '—'}</td>
                    <td className="muted">
                      {j.status !== 'ok' ? t(j.note, j.noteArgs) : ''}
                      {j.kit?.hand && ' '}
                      {j.kit?.hand && t('브래킷 벽은 {axis}축이 놓인 쪽으로 뻗습니다(ML/MR, 조립 설명서).', { axis: j.carried.toUpperCase() })}
                      {placementNotes(j).map((n) => (
                        <span key={n.text}>
                          {' '}
                          {t(n.text, n.args)}
                        </span>
                      ))}
                      {j.beam && (
                        <span>
                          {' '}
                          {t('{beam}: 주문 제작 크로스 빔, 길이 L {length} mm ({base}축 간격 {spacing} mm − 2 × {end} mm), {kits} 사이에 볼트 고정.', {
                            beam: j.beam.bracket.model,
                            length: fmt(j.beam.length, 1),
                            base: j.base.toUpperCase(),
                            spacing: fmt(j.beam.length + 2 * j.beam.bracket.beam!.end, 1),
                            end: fmt(j.beam.bracket.beam!.end, 1),
                            kits: j.kits.map((k) => k.model).join(' / '),
                          })}
                          {bracketDrawingUrl(j.beam.bracket.drawing) && (
                            <>
                              {' '}
                              <a href={bracketDrawingUrl(j.beam.bracket.drawing)!} target="_blank" rel="noreferrer">
                                {t('제작 도면 (PDF)')}
                              </a>
                            </>
                          )}
                        </span>
                      )}
                      {[...new Set(j.kits.filter((k) => k.custom && !j.beam).map((k) => k.drawing))].map(
                        (d) =>
                          bracketDrawingUrl(d) && (
                            <span key={d}>
                              {' '}
                              {t(j.kit?.joint === 'plate' ? '주문 제작 어댑터 플레이트입니다.' : '주문 제작 앵글 브래킷입니다(MR은 ML의 대칭).')}{' '}
                              <a href={bracketDrawingUrl(d)!} target="_blank" rel="noreferrer">
                                {t('제작 도면 (PDF)')}
                              </a>
                            </span>
                          ),
                      )}
                      {jointAccessories(j, adapters).map((x) => (
                        <span key={x.partNumber}>
                          {' '}
                          {x.n
                            ? t('함께 주문: {model} ({partNumber}) × {n}', { model: x.model, partNumber: x.partNumber, n: x.n })
                            : t('함께 주문: {model} ({partNumber})', { model: x.model, partNumber: x.partNumber })}
                        </span>
                      ))}
                      {j.kits.some((k) => !adapterDrawingFor(k)) ? ` ${t('도면 없음')}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-print">
            {t(
              '조합 키트는 ELGT-BS, ELGD 데이터시트의 조합표 기준입니다. EGC는 Festo 키트가 없어 주문 제작 브래킷(앵글 브래킷, 어댑터 플레이트)을 씁니다. 축은 시작 위치에 그리며, 위쪽 축은 조립 설명서대로 키트가 잡는 위치(핀과 볼트 구멍)에 붙이고, 그 데이터가 없는 키트는 입력한 장착 오프셋을 따릅니다. 키트가 없는 결합은 입력한 장착 위치에 축만 배치합니다. 키트에 축을 고정하는 프로파일 마운팅(EAHF)과 슬롯 너트는 도면에 없습니다.',
            )}
            {unkitted.length > 0 && (
              <span className="warn-text"> {t('키트 없이 배치한 결합: {pairs}', { pairs: unkitted.join(', ') })}</span>
            )}
          </p>
          {shortened.map((w) => (
            <p key={w} className="warn-text small-print">
              {w}
            </p>
          ))}
          {missing.length > 0 && (
            <p className="muted small-print">{t('도면이 없는 부품이 있어 조합할 수 없습니다: {parts}. 관리자에게 문의하세요.',{ parts: missing.join(' · ') })}</p>
          )}
          <ComboPreviewPanel state={state} ready={ready} onStep={() => state.exportStep(name)} onDxf={() => state.exportDxf(name, title)} />
        </>
      )}
    </section>
  )
}

/** The joint's parts by model: the kits (a mirrored pair under two X axes is two rows), a beam and its plate */
function jointModels(j: GantryJoint) {
  return [
    ...kitModels(j.kits),
    ...(j.beam ? [{ model: `${j.beam.bracket.model} (L ${fmt(j.beam.length, 0)} mm)`, partNumber: null, n: 1 }] : []),
    ...(j.beam?.plate ? kitModels([j.beam.plate]) : []),
  ]
}

/** The joint's kits by model (a mirrored pair under two X axes is two rows) */
function kitModels(kits: AxisAdapter[]) {
  // custom brackets (made to order) have no part number
  const out: { model: string; partNumber: string | null; n: number }[] = []
  for (const k of kits) {
    const row = out.find((r) => r.model === k.model)
    if (row) row.n++
    else out.push({ model: k.model, partNumber: k.partNumber, n: 1 })
  }
  return out
}

/** Where the kit holds the carried axis (Korean source text with arguments) */
function placementNotes(j: GantryJoint): { text: string; args: Record<string, string> }[] {
  if (!j.aligned) return []
  const args: Record<string, string> = { axis: j.carried.toUpperCase(), base: j.base.toUpperCase() }
  if (j.beam)
    return [
      j.beam.plate
        ? { text: '{axis}축은 빔 앞면 패드의 {plate}에 구동부를 위로 매답니다(패드 중심: 빔 가운데에서 {at} mm, 장착 위치).', args: { ...args, plate: j.beam.plate.model, at: fmt(j.beam.at, 1) } }
        : {
            text: '{axis}축은 키트처럼 핀과 볼트로 빔 앞면에 고정합니다(프로파일 아랫면의 핀 구멍과 나사 구멍, 볼트 머리는 빔 안쪽). {axis}축 중심: 빔 가운데에서 {at} mm(장착 위치).',
            args: { ...args, at: fmt(j.beam.at, 1) },
          },
      { text: '{base}축 간격은 입력값 그대로 씁니다(빔 길이로 맞춤).', args },
    ]
  const custom = j.kit?.custom
  const nut = j.kit?.accessories.find((x) => /^(NST|ABAN)/.test(x.model))?.model ?? ''
  const out = [
    custom
      ? j.kit!.joint === 'plate'
        ? { text: '{axis}축은 플레이트 앞면에 프로파일 아랫면 홈의 슬롯 너트({nut})로 클램프하고(받침턱으로 직각 맞춤), 위쪽 끝 헤드를 플레이트 위에 둡니다.', args: { ...args, nut } }
        : { text: '{axis}축은 옆면을 브래킷 받침턱에 얹고 프로파일 아랫면 홈의 슬롯 너트({nut})로 브래킷 벽에 클램프합니다. 가까운 끝 헤드는 벽 뒤에 둡니다.', args: { ...args, nut } }
      : j.pinned
        ? { text: '{axis}축은 키트의 핀과 볼트가 프로파일 아랫면의 핀 구멍과 나사 구멍에 들어가도록 모터 쪽 끝을 키트에 고정합니다(조립 설명서).', args }
        : { text: '{axis}축은 키트의 원통 핀 위에 얹고 끝을 콘솔 끝에서 77.5 mm(간격 A)에 맞춥니다(조립 설명서).', args },
    j.span || j.kit?.joint === 'plate'
      ? { text: '장착 위치의 {axis} 이동 방향 값은 쓰지 않습니다.', args }
      : { text: '장착 위치의 {axis} 이동 방향 값은 놓이는 쪽(+/−)만 정합니다.', args },
  ]
  if (j.mountings)
    out.push({
      text: '두 번째 {base}축 키트에서는 {axis}축 프로파일을 {model} {n}개로 클램프합니다(키트 벽의 M5 구멍, 프로파일 홈 어디서나). {base}축 간격을 나사 구멍 간격(100 mm)에 맞출 필요가 없습니다.',
      args: { ...args, model: j.mountings.model, n: String(j.mountings.quantity) },
    })
  else if (j.span && custom)
    out.push({
      text: '두 번째 {base}축 브래킷에서도 같은 슬롯 너트로 {axis}축 프로파일을 어디서나 클램프합니다. {base}축 간격은 {axis}축 끝 헤드가 두 번째 브래킷 벽 뒤로 나가는 범위에서 자유롭게 정할 수 있습니다.',
      args,
    })
  else if (j.span && !j.pinned)
    out.push({
      text: '두 번째 {base}축 키트에서도 {axis}축 프로파일을 프로파일 마운팅(EAHF)으로 클램프하므로, {base}축 간격은 {axis}축이 그 마운팅을 모두 덮는 범위에서 자유롭게 정할 수 있습니다.',
      args,
    })
  return out
}
