import type { ReactNode } from 'react'
import type { AxisEvaluation } from '../calc/axisSelection'
import type { DriveEvaluation } from '../calc/motorSelection'
import type { Requirements } from '../calc/types'
import {
  assemblyWarnings,
  buildCombo,
  connectorSide,
  DRIVE_POSITIONS,
  drivePositionWords,
  mirroredDrive,
  motorFacesTwin,
  shaftDrivePosition,
  SIDES,
  twinPositionWords,
  twinOrientation,
  type ComboOptions,
  type PartRole,
} from '../cad/combo'
import { shaftDrawingFor, type AxisMeta, type Drawing } from '../cad/drawings'
import type { Kit } from '../data/types'
import { useT } from '../i18n'
import { comboInputs, comboKey, shaftTooShort } from './comboInputs'
import { ComboPreviewPanel } from './ComboPreviewPanel'
import type { NoteTranslator } from './useComboPreview'
import { RadioGroup } from './common'
import { mountingLabel, rodsLabel, sideLabel } from './format'
import { loadText, useComboPreview } from './useComboPreview'

interface Props {
  /** step number: 5 after the gearbox, else 4 */
  no: number
  axis: AxisEvaluation | null
  drive: DriveEvaluation | null
  kit: Kit | null
  req: Requirements
  /** assembly orientation (kept in Workspace, the report prints it) */
  sides: ComboOptions
  onSides: (sides: ComboOptions) => void
  /** motor sync: offer the facing arrangement (single axis screen) */
  facingChoice?: boolean
  /** gantry: the tabs choosing which axis's drawing, or the whole gantry's, step 5 shows */
  tabs?: ReactNode
}

const roleLabel: Record<PartRole, string> = { axis: '축', kit: '연결키트', gearbox: '감속기', motor: '모터', shaft: '연결축', adapter: '조합 키트', guide: '가이드' }

/** Step 5: the manufacturers' CAD models of the selection, assembled — 3D preview, STEP and DXF export. */
export function DrawingStep({ no, axis, drive, kit, req: input, sides, onSides, facingChoice = true, tabs }: Props) {
  const t = useT()
  const { selection, found, twin, req } = comboInputs(axis, drive, kit, input)
  const parallel = kit?.type === 'parallel'
  const connector = connectorSide(sides, parallel)
  // belt axes: the motor on either drive shaft end, the axis either way round
  const axisMeta = (found?.axis?.meta as AxisMeta | null | undefined) ?? null
  const turnable = axis?.axis.drive === 'belt' && axisMeta != null
  // with a connecting shaft the motor sits on the shaft end away from the second axis
  const shaftTwin = axis?.layout.mode === 'twinShaft'
  // motor sync: side by side (slides up) or turned on their sides, the slides facing each other
  const facing = facingChoice && axis?.layout.mode === 'twinMotor' && sides.twinFacing === true
  const drivePosition = shaftTwin && turnable ? shaftDrivePosition(axisMeta!, req.mounting, sides.drive) : sides.drive
  const positionIndex = DRIVE_POSITIONS.findIndex((p) => p.otherEnd === drivePosition.otherEnd && p.otherSide === drivePosition.otherSide)
  const positions = turnable
    ? [0, 1, 2, 3].filter((i) => !shaftTwin || !motorFacesTwin(axisMeta!, req.mounting, DRIVE_POSITIONS[i])).sort(
        (a, b) =>
          drivePositionWords(axisMeta!, req.mounting, DRIVE_POSITIONS[a], facing ? 1 : 0).order -
          drivePositionWords(axisMeta!, req.mounting, DRIVE_POSITIONS[b], facing ? 1 : 0).order,
      )
    : []
  // motor sync: the second axis's drive position (default: the mirror image of the first)
  const twinTurnable = turnable && axis?.layout.mode === 'twinMotor'
  const twinPosition = twinTurnable ? (sides.twinDrive ?? mirroredDrive(axisMeta, drivePosition)) : null
  const twinIndex = twinPosition
    ? DRIVE_POSITIONS.findIndex((p) => p.otherEnd === twinPosition.otherEnd && p.otherSide === twinPosition.otherSide)
    : -1
  // named by the direction the motor points, as on the first axis
  const twinPositions = twinTurnable
    ? [0, 1, 2, 3].sort(
        (a, b) =>
          twinPositionWords(axisMeta!, req.mounting, DRIVE_POSITIONS[a], facing).order -
          twinPositionWords(axisMeta!, req.mounting, DRIVE_POSITIONS[b], facing).order,
      )
    : []
  const positionLabel = (i: number) => {
    const w = drivePositionWords(axisMeta!, req.mounting, DRIVE_POSITIONS[i], facing ? 1 : 0)
    return `${t(w.end)} · ${t(w.side)}`
  }
  const twinPositionLabel = (i: number) => {
    const w = twinPositionWords(axisMeta!, req.mounting, DRIVE_POSITIONS[i], facing)
    return `${t(w.end)} · ${t(w.side)}`
  }
  // motor sync: the second axis's kit side and connector (default: like the first)
  const twinMotor = axis?.layout.mode === 'twinMotor'
  // the sides mean the same directions as on the first axis
  const twinSides = twinOrientation(sides)
  const twinConnector = connectorSide(twinSides, parallel)
  // a change on the first axis keeps the second's kit side and connector as they are (fixed first); its motor
  // position keeps mirroring the first's until it is picked
  const own = (change: Partial<ComboOptions>) =>
    onSides({
      ...sides,
      ...(twinMotor
        ? {
            twinKitSide: twinSides.kitSide,
            // null: automatic (towards its own kit side), as on the first axis
            twinMotorConnector: twinSides.motorConnector,
          }
        : {}),
      ...change,
    })
  // an electric cylinder: no slide, and with the EAGF drawn its guide rods above and below or left and right
  const eagf = selection?.guide?.guide.kind === 'cylinder' && found?.guide != null
  const cylinder = axis?.axis.family === 'ESBF' ? { eagf } : null
  const rods = sides.guideRods ?? 'upDown'
  const shaftDrawing = axis?.shaft ? shaftDrawingFor(axis.shaft.shaft) : null
  const key = selection
    ? [
        comboKey(selection, req, twin),
        parallel ? sides.kitSide : '',
        connector,
        turnable ? positionIndex : '',
        twinTurnable ? twinIndex : '',
        twinMotor && parallel ? twinSides.kitSide : '',
        twinMotor ? twinConnector : '',
        facing ? 'facing' : '',
        eagf ? rods : '',
      ].join('|')
    : ''
  const ready = found != null && found.missing.length === 0
  const state = useComboPreview(key, ready, () =>
    buildCombo(selection!, found!, req, loadText, { ...sides, twinDrive: twinPosition, twinFacing: facing }, twin),
  )
  const partsName = (c: { parts: { name: string }[] }) => c.parts.map((p) => p.name).join('_')
  // the drawing's title and notes (the PDF in the app language, the DXF in English)
  const dxfTitle = (c: { name: string }, tr: NoteTranslator) => {
    const where = [drivePosition.otherEnd && tr('축의 반대쪽 끝'), drivePosition.otherSide && tr('반대쪽 축 끝')].filter(Boolean).join(', ')
    const kitMotor = (s: typeof sides) => tr('병렬 키트: 모터 {side}', { side: tr(sideLabel[s.kitSide]) })
    const assembly = [
      turnable && positionIndex > 0 && where && tr('구동부: {where}', { where }),
      parallel && kitMotor(sides),
      tr('모터 커넥터 {side}', { side: tr(sideLabel[connector]) }),
      facing && tr('슬라이드 마주 보기'),
      eagf && tr('가이드 로드 {rods}', { rods: tr(rodsLabel[rods]) }),
    ].filter(Boolean)
    const second = twinMotor ? [parallel && kitMotor(twinSides), tr('모터 커넥터 {side}', { side: tr(sideLabel[twinConnector]) })].filter(Boolean) : []
    return [
      c.name,
      tr('스트로크 {stroke} mm, 설치: {mounting}, 무게 중심 (x, y, z) = ({x}, {y}, {z}) mm', {
        stroke: selection!.stroke,
        mounting: tr(mountingLabel[req.mounting]),
        x: req.cog.x,
        y: req.cog.y,
        z: req.cog.z,
      }),
      tr('조립 방향 (모터 쪽에서 봄): {assembly}', { assembly: assembly.join(', ') }) +
        (second.length ? `; ${tr('두 번째 축: {assembly}', { assembly: second.join(', ') })}` : ''),
      tr('3D 모델: 제조사 CAD 데이터 (라이선스는 STEP 파일 헤더 참조).'),
    ]
  }

  // the drawing's specification table: the axis data and the operating conditions
  const specs = (tr: NoteTranslator): [string, string][] => {
    const e = axis!
    const a = e.axis
    const speed = e.checks.find((c) => c.label === '속도')?.limit ?? a.maxSpeed
    const r1 = (v: number) => String(Math.round(v * 10) / 10)
    return [
      [tr('스트로크'), `${selection!.stroke} mm`],
      [tr('제품 중량'), `${r1(e.axisMass)} kg`],
      [tr('가반하중 (부하 질량)'), `${req.payload} kg`],
      a.drive === 'spindle'
        ? [tr('볼스크류 리드 / 직경'), `${a.spindlePitch ?? '—'} / ${a.spindleDiameter ?? '—'} mm`]
        : [tr('풀리 직경 / 회전당 이송량'), `${a.pulleyDiameter ?? '—'} mm / ${r1(e.feed)} mm`],
      [tr('최대 속도'), `${speed} m/s`],
      [tr('최대 허용 가속도'), `${a.maxAcceleration} m/s²`],
      [tr('최대 이송력'), `${a.maxFeedForce} N`],
      ...(a.repeatability != null ? [[tr('반복 정밀도'), `±${a.repeatability} mm`] as [string, string]] : []),
      [tr('운전 조건 (속도 / 가속도)'), `${req.velocity} m/s / ${req.acceleration} m/s²`],
    ]
  }

  const rows: { role: PartRole; model: string; drawing: Drawing | null; note: string | null; warn?: boolean }[] =
    selection && found
      ? [
          {
            role: 'axis',
            model: axis!.order.model,
            drawing: found.axis,
            note:
              [
                found.axis && found.axis.meta && (found.axis.meta as { stroke: number }).stroke !== selection.stroke
                  ? t('스트로크 {from} mm 모델을 {to} mm로 길이 보정', {
                      from: (found.axis.meta as { stroke: number }).stroke,
                      to: selection.stroke,
                    })
                  : null,
                // additional slides are copies of the model's slide: a long / extended one is drawn at its own length
                axis!.options?.slides.length
                  ? axis!.axis.slideLength != null && axis!.axis.additionalSlide && axis!.axis.slideLength !== axis!.axis.additionalSlide.length
                    ? t('추가 슬라이드 {codes}: 기존 슬라이드 모델로 그림 (실제 길이 {length} mm)', {
                        codes: axis!.options.slides.join(' + '),
                        length: axis!.axis.additionalSlide.length,
                      })
                    : t('추가 슬라이드 {codes} 포함, 슬라이드 중심 간격 {pitch} mm', { codes: axis!.options.slides.join(' + '), pitch: axis!.options.pitches.map((p) => Math.round(p * 1000)).join(' / ') })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || null,
          },
          { role: 'kit', model: selection.kit.product, drawing: found.kit, note: found.kit && !found.kit.meta ? t('정합 정보(JSON) 없음') : null },
          ...(selection.gearbox
            ? [
                {
                  role: 'gearbox' as const,
                  model: selection.gearbox.model,
                  drawing: found.gearbox,
                  note: found.gearbox && !found.gearbox.meta ? t('정합 정보(JSON) 없음') : null,
                },
              ]
            : []),
          {
            role: 'motor',
            model: selection.motor.model,
            drawing: found.motor,
            note: found.motorOtherOptions
              ? t('같은 모터의 다른 옵션 도면')
              : found.motorSameOutline
                ? t('외형 치수가 같은 모터의 도면')
                : null,
          },
          ...(selection.guide
            ? [
                {
                  role: 'guide' as const,
                  model:
                    selection.guide.offsets.length > 1 ? `${selection.guide.model} × ${selection.guide.offsets.length}` : selection.guide.model,
                  drawing: found.guide,
                  warn: !found.guide,
                  note: !found.guide
                    ? t('도면이 없어 조합 도면에서 뺐습니다')
                    : (found.guide.meta?.stroke ?? selection.guide.stroke) !== selection.guide.stroke
                      ? t('스트로크 {from} mm 모델을 {to} mm로 길이 보정', { from: found.guide.meta!.stroke, to: selection.guide.stroke })
                      : null,
                },
              ]
            : []),
          ...(axis!.shaft
            ? [
                {
                  role: 'shaft' as const,
                  model: axis!.shaft.model,
                  drawing: shaftDrawing,
                  warn: shaftTooShort(axis!),
                  note: shaftTooShort(axis!)
                    ? t('축 간격이 짧아 연결축 공칭 길이 LN {length} mm가 최소 {min} mm보다 짧습니다. 도면에서 연결축을 뺐습니다. 축 간격을 {need} mm 이상으로 늘리세요.', {
                        length: axis!.shaft.length,
                        min: axis!.shaft.shaft.lengthRange[0],
                        need: axis!.shaft.shaft.lengthRange[0] + axis!.shaft.driveWidth,
                      })
                    : shaftDrawing && shaftDrawing.meta && (shaftDrawing.meta as { length: number }).length !== axis!.shaft.length
                      ? t('공칭 길이 {from} mm 모델을 {to} mm로 길이 보정', {
                          from: (shaftDrawing.meta as { length: number }).length,
                          to: axis!.shaft.length,
                        })
                      : null,
                },
              ]
            : []),
        ]
      : []

  const warnings = [...new Set([...assemblyWarnings(sides, parallel, cylinder), ...(twinMotor ? assemblyWarnings(twinSides, parallel, cylinder) : [])])]

  return (
    <section className="panel step" id="step-drawing">
      <header className="step-head">
        <h2>
          <span className="step-no">{no}</span> {t('도면')}
        </h2>
        {tabs}
        {selection && <span className="muted">{t('설치 방향: {mounting}', { mounting: t(mountingLabel[req.mounting]) })}</span>}
      </header>
      {!selection ? (
        <p className="empty">{t('축, 모터, 연결키트를 선택하면 제조사 도면으로 조합 모델을 만듭니다.')}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('구분')}</th>
                  <th>{t('모델명')}</th>
                  <th>{t('도면 파일')}</th>
                  <th>{t('비고')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.role}>
                    <td>{t(roleLabel[r.role])}</td>
                    <td className="model">{r.model}</td>
                    <td className={r.drawing ? undefined : 'fail-text'}>
                      {r.drawing ? [r.drawing.partNumber, r.drawing.model].filter(Boolean).join(' ') : t('도면 없음')}
                    </td>
                    <td className={r.warn ? 'warn-text' : 'muted'}>{r.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {axis && axis.layout.mode !== 'single' && (
            <p className="muted small-print">
              {t(
                axis.layout.mode === 'twinMotor'
                  ? facing
                    ? '두 축(모터·키트 포함)을 옆으로 세워 슬라이드가 서로 마주보게 배치합니다. 축 간격은 두 슬라이드 면 사이 거리입니다. 계산은 슬라이드가 위를 향한 설치 방향 기준이므로 가이드 하중을 따로 확인하세요.'
                    : '두 번째 축(모터·키트 포함)을 축 간격만큼 옆에 함께 배치합니다.'
                  : axis.layout.mode === 'twinShaft'
                    ? twin?.shaft
                      ? '두 번째 축을 축 간격만큼 옆에 배치하고 연결축(KSK)으로 잇습니다. 모터는 두 번째 축 반대쪽 샤프트 끝에 둡니다.'
                      : '두 번째 축을 축 간격만큼 옆에 함께 배치합니다. 연결축은 도면에 포함되지 않습니다.'
                    : axis.guide
                      ? '가이드 축을 축–가이드 간격만큼 옆에 배치하고 슬라이드 높이를 축 슬라이드에 맞춥니다.'
                      : 'LM 가이드는 도면에 포함되지 않습니다.',
              )}
            </p>
          )}
          {!ready && (
            <p className="muted small-print">
              {t('도면이 없는 부품이 있어 조합할 수 없습니다: {parts}. 관리자에게 문의하세요.', {
                parts: rows
                  .filter((r) => found?.missing.includes(r.role))
                  .map((r) => `${t(roleLabel[r.role])} ${r.model}`)
                  .join(', '),
              })}
            </p>
          )}
          <div className="drawing-sides">
            {facingChoice && twinMotor && (
              <>
                <span>{t('축 배치')}</span>
                <RadioGroup
                  options={['side', 'facing'] as const}
                  value={facing ? 'facing' : 'side'}
                  onChange={(a) => onSides({ ...sides, twinFacing: a === 'facing' })}
                  label={(a) => t(a === 'facing' ? '슬라이드 마주보기' : '나란히 (슬라이드 위)')}
                />
              </>
            )}
            {eagf && (
              <>
                <span>{t('가이드 방향 (EAGF 로드 위치)')}</span>
                <RadioGroup
                  options={['upDown', 'leftRight'] as const}
                  value={rods}
                  onChange={(guideRods) => onSides({ ...sides, guideRods })}
                  label={(g) => t(rodsLabel[g])}
                />
              </>
            )}
            {turnable && (
              <>
                <span>{t(twinTurnable ? '모터 위치 (첫 번째 축, 정면도 기준)' : '모터 위치 (정면도 기준)')}</span>
                <RadioGroup
                  options={positions}
                  value={positionIndex}
                  onChange={(i) => own({ drive: DRIVE_POSITIONS[i] })}
                  label={positionLabel}
                />
              </>
            )}
            {twinTurnable && (
              <>
                <span>{t('모터 위치 (두 번째 축, 정면도 기준)')}</span>
                <RadioGroup
                  options={twinPositions}
                  value={twinIndex}
                  onChange={(i) => onSides({ ...sides, twinDrive: DRIVE_POSITIONS[i] })}
                  label={twinPositionLabel}
                />
              </>
            )}
            {parallel && (
              <>
                <span>{t(twinMotor ? '키트 조립 방향 (첫 번째 축, 모터 위치)' : '키트 조립 방향 (모터 위치)')}</span>
                <RadioGroup
                  options={SIDES}
                  value={sides.kitSide}
                  onChange={(kitSide) => own({ kitSide })}
                  label={(s) => t(sideLabel[s])}
                />
              </>
            )}
            <span>{t(twinMotor ? '모터 조립 방향 (첫 번째 축, 커넥터)' : '모터 조립 방향 (커넥터)')}</span>
            <RadioGroup
              options={SIDES}
              value={connector}
              onChange={(motorConnector) => own({ motorConnector })}
              label={(s) => t(sideLabel[s])}
            />
            {twinMotor && parallel && (
              <>
                <span>{t('키트 조립 방향 (두 번째 축, 모터 위치)')}</span>
                <RadioGroup
                  options={SIDES}
                  value={twinSides.kitSide}
                  onChange={(twinKitSide) => onSides({ ...sides, twinKitSide })}
                  label={(s) => t(sideLabel[s])}
                />
              </>
            )}
            {twinMotor && (
              <>
                <span>{t('모터 조립 방향 (두 번째 축, 커넥터)')}</span>
                <RadioGroup
                  options={SIDES}
                  value={twinConnector}
                  onChange={(twinMotorConnector) => onSides({ ...sides, twinMotorConnector })}
                  label={(s) => t(sideLabel[s])}
                />
              </>
            )}
            {warnings.length > 0 && (
              <p className="muted small-print">
                {warnings.map((w) => (
                  <span key={w} className="warn-text">
                    {' '}
                    {t(w)}
                  </span>
                ))}
              </p>
            )}
          </div>
          <ComboPreviewPanel
            state={state}
            ready={ready}
            onStep={() => state.exportStep(partsName)}
            onDxf={() => state.exportDxf(partsName, dxfTitle, specs)}
            onPdf={() => state.exportPdf(partsName, dxfTitle, specs)}
          />
        </>
      )}
    </section>
  )
}
