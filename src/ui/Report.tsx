import { useState, type ReactNode } from 'react'
import type { AxisEvaluation } from '../calc/axisSelection'
import type { KitMatch } from '../calc/kitSelection'
import { accelTimeFor } from '../calc/motionProfile'
import { gearboxChecks, type DriveEvaluation } from '../calc/motorSelection'
import type { GantryInputs } from '../calc/gantry'
import { jointAccessories, type GantryJoint } from '../calc/gantryKits'
import { adapters } from '../data'
import { verticalForward, type Requirements, type Settings, type Status } from '../calc/types'
import type { KitEvaluation } from '../calc/kitSelection'
import {
  assemblyWarnings,
  connectorSide,
  drivePositionWords,
  mirroredDrive,
  shaftDrivePosition,
  twinOrientation,
  twinPositionWords,
  type ComboOptions,
} from '../cad/combo'
import { axisDrawingsFor } from '../cad/drawings'
import { translateData, useLang, useT } from '../i18n'
import { CheckTable, StatusBadge } from './common'
import { partRows } from './reportRows'
import type { GantryAxisResult } from '../selection'
import { DrivePackage } from './DrivePackage'
import { KitNotes } from './KitStep'
import {
  axisDetailChecks,
  driveLabel,
  fmt,
  kgf,
  mountingLabel,
  moveLabel,
  parallelModeLabel,
  pressDirectionLabel,
  sideLabel,
  supplyLabel,
} from './format'
import { ProfileNumbers } from './MotionProfile'
import { ProfilePlot, type ProfileView } from './ProfileChart'

interface Props {
  req: Requirements
  settings: Settings
  axis: AxisEvaluation
  drive: DriveEvaluation | null
  /** Direct drive plus every compatible gearbox for the selected motor */
  kitMatch: KitMatch | null
  kit: KitEvaluation | null
  /** Motion profile view selected on screen */
  profileView: ProfileView
  /** assembly orientation chosen in step 5 */
  assembly: ComboOptions
  /** Gantry: which axis this report is for and what it carries (labels are Korean source text). Its chapters
   *  follow the gantry overview (`GantryOverview`, which carries the date and the web link): titles start with the
   *  axis, no meta line */
  gantry?: { axis: string; rows: [string, string][] }
}

type Row = [label: string, value: ReactNode]

/** Label/value pairs, two pairs per table row. Labels are Korean source text, translated here. */
function SpecTable({ rows }: { rows: Row[] }) {
  const t = useT()
  const pairs: Row[][] = []
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2))
  return (
    <table className="report-spec">
      <tbody>
        {pairs.map((pair) => (
          <tr key={pair[0][0]}>
            {pair.map(([label, value]) => (
              <Cell key={label} label={t(label)} value={value} />
            ))}
            {pair.length === 1 && <td colSpan={2} />}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Cell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <th>{label}</th>
      <td>{value ?? '—'}</td>
    </>
  )
}

/** Number with unit, or a dash when missing. */
function q(value: number | null | undefined, unit: string, digits = 3): string {
  return value == null ? '—' : `${fmt(value, digits)} ${unit}`
}

/** Report date and the link to this calculation on the web (the PDF lays the link over it, pdfExport) */
function ReportMeta({ date }: { date: string }) {
  const t = useT()
  return (
    <p className="report-meta">
      {t('직교 축 선정 계산서 · {date}', { date })} · <span className="report-link">{t('웹에서 이 계산 열기')}</span>
    </p>
  )
}

/** `axis`: the gantry axis the chapter is about, before the title */
function Chapter({ no, title, axis, children }: { no: number; title: string; axis?: string; children: ReactNode }) {
  return (
    <section className="report-chapter">
      <h2>
        <span className="step-no">{no}</span> {axis ? `${axis} · ${title}` : title}
      </h2>
      {children}
    </section>
  )
}

export function Report({ req, settings, axis, drive, kitMatch, kit: kitEval, profileView, assembly, gantry }: Props) {
  const kit = kitEval?.kit ?? null
  const t = useT()
  const lang = useLang()
  const a = axis.axis
  const g = drive?.gearbox ?? null
  const vertical = verticalForward(req)
  // belt axes: where the drive head and motor sit, as chosen in step 5
  const beltMeta = axis?.axis.drive === 'belt' ? (axisDrawingsFor(axis.axis, axis.order.stroke ?? req.stroke)[0]?.meta ?? null) : null
  // with a connecting shaft the motor sits on the shaft end away from the second axis, as in step 5
  const drivePosition =
    beltMeta && axis?.layout.mode === 'twinShaft' ? shaftDrivePosition(beltMeta, req.mounting, assembly.drive) : assembly.drive
  // motor sync, single axis screen: the axes turned on their sides, the slides facing each other, as in step 5
  const facing = !gantry && axis?.layout.mode === 'twinMotor' && assembly.twinFacing === true
  const words = beltMeta ? drivePositionWords(beltMeta, req.mounting, drivePosition, facing ? 1 : 0) : null
  const motorPosition = words ? `${t(words.end)} · ${t(words.side)}` : null
  // motor sync: the second axis's motor position (default the mirror image of the first), as in step 5
  const twinWords =
    beltMeta && axis?.layout.mode === 'twinMotor'
      ? twinPositionWords(beltMeta, req.mounting, assembly.twinDrive ?? mirroredDrive(beltMeta, drivePosition), facing)
      : null
  const twinMotorPosition = twinWords ? `${t(twinWords.end)} · ${t(twinWords.side)}` : null
  // motor sync: the second axis's kit side and connector, as in step 5
  const twinAssembly = axis?.layout.mode === 'twinMotor' ? twinOrientation(assembly) : null
  const times = t('배')
  const [today] = useState(() => new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US'))
  const layout = axis.layout
  const selection = partRows(axis, drive, kitEval, t)
  const noMotor = <p className="empty">{t('모터를 선택하지 않았습니다.')}</p>

  return (
    <div className="report">
      <Chapter no={1} axis={gantry?.axis} title={t('입력 데이터 · 선정 모델')}>
        {!gantry && <ReportMeta date={today} />}

        {gantry && (
          <>
            <h3>{t('조합축 {axis}', { axis: gantry.axis })}</h3>
            <SpecTable rows={gantry.rows} />
          </>
        )}

        <h3>{t('사용 조건')}</h3>
        <SpecTable
          rows={[
            ['축 설치 방향', t(mountingLabel[req.mounting])],
            ['스트로크', q(req.stroke, 'mm')],
            ['하중', q(req.payload, 'kg')],
            ['속도', q(req.velocity, 'm/s')],
            ['가속도', q(req.acceleration, 'm/s²')],
            ['가속 시간', q(accelTimeFor(req.velocity, req.acceleration, req.jerk), 's')],
            ['저크', req.jerk > 0 ? q(req.jerk, 'm/s³') : t('제한 없음 (사다리꼴)')],
            ['휴지 시간', q(settings.dwellTime, 's')],
            ['어플리케이션', t(axis.press ? '프레싱' : '일반')],
            ...(axis.press
              ? ([
                  ...(vertical ? [['압착 방향', t(pressDirectionLabel[req.press!.direction])] as Row] : []),
                  ['압착력', `${q(axis.press.force, 'N')} (${kgf(axis.press.force)})`],
                  ['압착 구간', q(axis.press.distance, 'mm')],
                  ['압착 속도', q(req.press!.speed, 'm/s')],
                  ['가압 유지 시간', q(axis.press.holdTime, 's')],
                ] as Row[])
              : []),
            ['무게 중심 X / Y / Z', `${fmt(req.cog.x)} / ${fmt(req.cog.y)} / ${fmt(req.cog.z)} mm`],
            ['축 구성', t(parallelModeLabel[layout.mode])],
            ...(layout.mode !== 'single'
              ? ([
                  [layout.guides ? '축–가이드 간격' : '축 간격', q(req.parallel!.spacing, 'mm')],
                  ...(layout.guides
                    ? ([
                        ['LM 가이드 수', String(layout.guides)],
                        ...(layout.guides >= 2
                          ? ([['축 위치', t(layout.isAxis[0] ? '가장자리' : '가운데')]] as Row[])
                          : []),
                        ['가이드 1개 이동 질량', q(req.parallel!.guideMass, 'kg')],
                      ] as Row[])
                    : ([['축 1개 부하 분담', `${Math.round(layout.share * 100)}%`]] as Row[])),
                  ...(layout.mode === 'twinShaft'
                    ? ((axis.shaft
                        ? [
                            ['연결축', `${axis.shaft.model} (LN ${axis.shaft.length} mm)`],
                            ['연결축 관성', q(axis.shaft.inertia, 'kg·cm²', 4)],
                          ]
                        : [['연결축 관성', q(layout.shaftInertia, 'kg·cm²', 4)]]) as Row[])
                    : []),
                ] as Row[])
              : []),
          ]}
        />

        <h3>{t('상세 설정')}</h3>
        <SpecTable
          rows={[
            ['구동 효율 (볼스크류 / 벨트)', `${fmt(settings.efficiency.spindle)} / ${fmt(settings.efficiency.belt)}`],
            ['마찰 계수 (볼스크류 / 벨트)', `${fmt(settings.friction.spindle)} / ${fmt(settings.friction.belt)}`],
            ['외부 반력 Fc', q(settings.externalForce, 'N')],
            ['가이드 저항 FG', q(settings.guideResistance, 'N')],
            ['커플링 관성', q(settings.couplingInertia, 'kg·cm²', 4)],
            ['기본 허용 관성비', q(settings.defaultInertiaRatio, times)],
            ['지지 간격', settings.supportSpan > 0 ? q(settings.supportSpan, 'mm') : t('양 끝만 지지')],
            ['일 가동 시간', q(settings.hoursPerDay, 'h')],
            ['전원', settings.supplies.map((s) => supplyLabel[s]).join(' / ')],
            ['브레이크', settings.requireBrake ? t('필요') : t('선택')],
            ['감속기', settings.useGearbox ? t('감속기 사용') : t('감속기 미사용')],
            ...(axis.axis.family === 'ESBF'
              ? ([['ESBF 외부 가이드', settings.externalGuide ? t('사용 (로드 횡하중 검토 생략)') : t('미사용')]] as Row[])
              : []),
          ]}
        />

        <h3>{t('선정 모델')}</h3>
        <table className="report-table">
          <thead>
            <tr>
              <th>{t('구분')}</th>
              <th>{t('메이커')}</th>
              <th>{t('모델명')}</th>
              <th>{t('주문번호')}</th>
              <th>{t('수량')}</th>
              <th>{t('판정')}</th>
            </tr>
          </thead>
          <tbody>
            {selection.map(([part, maker, model, partNumber, count, status]) => (
              <tr key={part}>
                <td>{part}</td>
                <td>{maker}</td>
                <td className="model">{model}</td>
                <td>{partNumber ?? '—'}</td>
                <td>{count ?? '—'}</td>
                <td>{status ? <StatusBadge status={status} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Chapter>

      <Chapter no={2} axis={gantry?.axis} title={t('모션 프로파일')}>
        <ProfileNumbers axis={axis} />
        <figure className="profile-chart report-chart">
          <figcaption>
            {t(profileView === 'cycle' ? '왕복' : moveLabel(profileView === 'back', vertical))}
            {profileView !== 'back' && axis.press ? ` + ${t('압착')}` : ''}
            {settings.dwellTime > 0 ? ` + ${t('휴지')}` : ''} ({t('가로축 시간 s')})
          </figcaption>
          <ProfilePlot axis={axis} drive={drive} settings={settings} view={profileView} />
        </figure>
      </Chapter>

      <Chapter no={3} axis={gantry?.axis} title={t('축 선정 세부사항')}>
        <h3>{axis.order.model}</h3>
        <SpecTable
          rows={[
            ...(axis.order.stroke != null
              ? ([
                  ['주문번호', axis.order.partNumber ?? '—'],
                  [
                    '주문 스트로크',
                    `${q(axis.order.stroke, 'mm')}${axis.order.modular ? ` (${t('모듈러 제품, 모듈 번호로 주문')})` : ''}`,
                  ],
                ] as Row[])
              : []),
            ...(axis.options && a.additionalSlide
              ? ([
                  ['추가 슬라이드', axis.options.slides.length ? axis.options.slides.join(' + ') : t('없음')],
                  ...(axis.options.slides.length ? [['슬라이드 사이 거리', q(axis.options.gap, 'mm')]] : []),
                ] as Row[])
              : []),
            ...(axis.options?.belt ? ([['벨트 재질', axis.options.belt.code ?? t('클로로프렌')]] as Row[]) : []),
            ['제품군', [a.family, a.variant].filter(Boolean).join('-')],
            ['구동 방식', t(driveLabel[a.drive])],
            ['최대 스트로크', q(a.maxStroke, 'mm')],
            ['최대 속도', q(a.maxSpeed, 'm/s')],
            ['최대 가속도', q(a.maxAcceleration, 'm/s²')],
            ['최대 이송력', q(a.maxFeedForce, 'N')],
            ['무부하 구동 토크', q(axis.noLoadTorque, 'Nm')],
            ['최대 구동 토크', q(a.maxDrivingTorque, 'Nm')],
            ['회전당 이송량', q(axis.feed, 'mm/rev')],
            ['반복 정밀도', a.repeatability == null ? '—' : `±${fmt(a.repeatability, 3)} mm`],
            ['이동 질량 (부하 + 슬라이드)', q(axis.movingMass, 'kg')],
            ['축 질량', q(axis.axisMass, 'kg')],
            ['구동축 환산 관성', q(axis.inertia, 'kg·cm²', 4)],
            ['구동 효율', fmt(axis.efficiency)],
            ['인터페이스 코드', a.interfaceCode ?? '—'],
          ]}
        />
        <h3>{t('검토 항목')}</h3>
        <CheckTable checks={axisDetailChecks(axis)} />
        {axis.info.length > 0 && (
          <>
            <h3>{t('참고값')}</h3>
            <SpecTable
              rows={axis.info.map((i): Row => {
                const text = `${q(i.value, i.unit)}${i.note ? ` (${t(i.note, i.noteArgs)})` : ''}`
                return [i.label, i.alert ? <span key={i.label} className="fail-text">{text}</span> : text]
              })}
            />
          </>
        )}
      </Chapter>

      <Chapter no={4} axis={gantry?.axis} title={t('모터 선정 세부사항')}>
        {!drive ? (
          noMotor
        ) : (
          <>
            <h3>
              {drive.motor.maker} {drive.motor.model}
            </h3>
            <SpecTable
              rows={[
                [
                  '시리즈',
                  translateData(lang, [drive.motor.series, drive.motor.description].filter(Boolean).join(' · ')) || '—',
                ],
                ['브레이크', drive.motor.brake ? t('있음') : t('없음')],
                ...(drive.motor.orderCode
                  ? ([
                      ['주문 형식', drive.motor.orderCode],
                      ['주문번호', drive.motor.partNumber ?? '—'],
                    ] as Row[])
                  : []),
                ['정격 출력', q(drive.motor.ratedPower, 'W', 0)],
                ['정격 / 최대 토크', `${fmt(drive.motor.ratedTorque, 3)} / ${fmt(drive.motor.peakTorque, 3)} Nm`],
                ['정격 / 최대 회전수', `${fmt(drive.motor.ratedSpeed, 0)} / ${fmt(drive.motor.maxSpeed, 0)} rpm`],
                ['로터 관성', q(drive.motor.inertia, 'kg·cm²', 4)],
                ['허용 관성비', q(drive.motor.allowableInertiaRatio, times)],
                ['허용 회생 전력', q(drive.motor.regenPower, 'W')],
                ['앰프', drive.motor.amplifier ?? '—'],
                ['인터페이스 코드', drive.motor.interfaceCode ?? '—'],
              ]}
            />
            <h3>
              {g
                ? t('운전 결과 (감속기 {model} {ratio}:1 포함)', { model: g.model, ratio: g.ratio })
                : t('운전 결과 (감속기 미사용)')}
            </h3>
            <SpecTable
              rows={[
                ['최대 토크', q(drive.peakTorque, 'Nm')],
                ['실효 토크', q(drive.rmsTorque, 'Nm')],
                ['최대 회전수', q(drive.maxMotorSpeed, 'rpm', 0)],
                ['관성비', q(drive.inertiaRatio, times)],
                ['회생 전력 (사이클 평균)', q(drive.regenPower, 'W')],
              ]}
            />
            <h3>{t('검토 항목')}</h3>
            <CheckTable checks={drive.checks} />
          </>
        )}
      </Chapter>

      {drive?.controller && (
        <Chapter no={4} axis={gantry?.axis} title={t('드라이브 · 케이블 · 제동저항')}>
          <DrivePackage selection={drive.controller} cableLength={settings.cableLength} hideTitle />
        </Chapter>
      )}

      <Chapter no={5} axis={gantry?.axis} title={t('감속기 세부사항')}>
        {!drive ? (
          noMotor
        ) : (
          <>
            {g ? (
              <>
                <h3>
                  {g.maker} {g.model}
                </h3>
                <SpecTable
                  rows={[
                    ['감속비', `${g.ratio}:1`],
                    ['주문번호', g.partNumber ?? '—'],
                    ['단수', g.stage == null ? '—' : t('{n}단', { n: g.stage })],
                    ['플랜지 크기', q(g.flangeSize, 'mm', 0)],
                    ['정격 출력 토크', q(g.continuousTorque, 'Nm')],
                    ['최대 출력 토크', q(g.maxTorque, 'Nm')],
                    ['최대 입력 회전수', q(g.maxInputSpeed, 'rpm', 0)],
                    ['관성 (입력측)', q(g.inertia, 'kg·cm²', 4)],
                    ['효율', q(g.efficiency, '%', 1)],
                    ['인터페이스 코드 (출력측)', g.interfaceCode ?? '—'],
                  ]}
                />
                <h3>{t('검토 항목')}</h3>
                <CheckTable checks={gearboxChecks(drive)} />
              </>
            ) : (
              <p className="report-note">{t('감속기를 사용하지 않습니다 (축 - 연결키트 - 모터).')}</p>
            )}
          </>
        )}
      </Chapter>

      <Chapter no={6} axis={gantry?.axis} title={t('연결키트 세부사항')}>
        {!kitMatch ? (
          noMotor
        ) : (
          <>
            <SpecTable
              rows={[
                ['축 인터페이스 코드', kitMatch.axisCode ?? '—'],
                [
                  kitMatch.motorSide === 'gearbox' ? '감속기 (출력측) 인터페이스 코드' : '모터 인터페이스 코드',
                  kitMatch.motorCode ?? '—',
                ],
              ]}
            />
            {kit ? (
              <>
                <h3>{kit.product}</h3>
                <SpecTable
                  rows={[
                    ['주문번호', kit.partNumber ?? '—'],
                    ['종류', t(kit.type === 'axial' ? '직렬 키트' : '병렬 키트')],
                    ['견시창', kit.window ? t('있음') : t('없음')],
                    kit.type === 'axial' ? ['커플링', kit.coupling ?? '—'] : ['풀리 품번', kit.pulley ?? '—'],
                    ['전달 토크', kit.transmissibleTorque != null ? q(kit.transmissibleTorque, 'Nm') : '—'],
                    ['관성 모멘트', kit.inertia != null ? q(kit.inertia, 'kg·cm²') : '—'],
                    ['최대 회전수', kit.maxSpeed != null ? q(kit.maxSpeed, 'rpm') : '—'],
                    ...(kit.noLoadTorque != null ? ([['무부하 토크', q(kit.noLoadTorque, 'Nm')]] as Row[]) : []),
                    ...(twinAssembly && !gantry
                      ? ([['축 배치', t(facing ? '슬라이드 마주보기' : '나란히 (슬라이드 위)')]] as Row[])
                      : []),
                    ...(motorPosition && twinMotorPosition
                      ? ([
                          ['모터 위치 (첫 번째 축, 정면도 기준)', motorPosition],
                          ['모터 위치 (두 번째 축, 정면도 기준)', twinMotorPosition],
                        ] as Row[])
                      : motorPosition
                        ? ([['모터 위치 (정면도 기준)', motorPosition]] as Row[])
                        : []),
                    ...(kit.type === 'parallel'
                      ? ([
                          [twinAssembly ? '키트 조립 방향 (첫 번째 축, 모터 위치)' : '키트 조립 방향 (모터 위치)', t(sideLabel[assembly.kitSide])],
                        ] as Row[])
                      : []),
                    [
                      twinAssembly ? '모터 조립 방향 (첫 번째 축, 커넥터)' : '모터 조립 방향 (커넥터)',
                      t(sideLabel[connectorSide(assembly, kit.type === 'parallel')]),
                    ],
                    ...(twinAssembly && kit.type === 'parallel'
                      ? ([['키트 조립 방향 (두 번째 축, 모터 위치)', t(sideLabel[twinAssembly.kitSide])]] as Row[])
                      : []),
                    ...(twinAssembly
                      ? ([
                          ['모터 조립 방향 (두 번째 축, 커넥터)', t(sideLabel[connectorSide(twinAssembly, kit.type === 'parallel')])],
                        ] as Row[])
                      : []),
                  ]}
                />
                <p className="report-note">{t('모터 쪽 축 끝에서 축을 바라볼 때 기준이며, 슬라이드 면이 상입니다.')}</p>
                {[
                  ...new Set([
                    ...assemblyWarnings(assembly, kit.type === 'parallel'),
                    ...(twinAssembly ? assemblyWarnings(twinAssembly, kit.type === 'parallel') : []),
                  ]),
                ].map((w) => (
                  <p key={w} className="report-note warn-text">
                    {t(w)}
                  </p>
                ))}
                {kitEval && <CheckTable checks={kitEval.checks} />}
                {kitEval && kitEval.notes.length > 0 && <KitNotes notes={kitEval.notes} />}
              </>
            ) : (
              <p className="report-note">{t('조건에 맞는 연결키트가 없습니다.')}</p>
            )}
          </>
        )}
      </Chapter>
    </div>
  )
}

/** One gantry axis in the overview: its letter, its place in the selection order and its result */
export interface GantryReportAxis {
  /** 'X축' … (translated) */
  name: string
  /** place in the selection order, 1 = the tool end */
  order: number
  result: GantryAxisResult
}

/** Verdicts of the selected axis, drive and kit together; null before the axis is selected */
function axisVerdict(s: GantryAxisResult['sel']): Status | null {
  const list = [s?.selectedAxis?.status, s?.selectedDrive?.status, s?.selectedKitEval?.status]
  return list.includes('fail') ? 'fail' : list.includes('warn') ? 'warn' : s?.selectedAxis ? 'ok' : null
}

/**
 * First chapter of the gantry report: the arrangement, each axis's conditions and selection, the gantry kits and
 * every part to order; each axis's own chapters (`Report` with `gantry`) follow.
 */
export function GantryOverview({ gantry, axes }: { gantry: GantryInputs; axes: GantryReportAxis[] }) {
  const t = useT()
  const lang = useLang()
  const [today] = useState(() => new Date().toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US'))
  const joints = axes.flatMap(({ result }) => (result.joint ? [result.joint] : []))
  const where = (j: GantryJoint) => t('{carried}축 → {base}축 슬라이드', { carried: j.carried.toUpperCase(), base: j.base.toUpperCase() })
  return (
    <section className="report-chapter">
      <h2>{t('조합축 {config} 개요', { config: gantry.config.toUpperCase() })}</h2>
      <ReportMeta date={today} />

      <h3>{t('사용 조건')}</h3>
      <SpecTable
        rows={[
          ['조합축 구성', gantry.config.toUpperCase()],
          ['하중', q(gantry.payload, 'kg')],
          ['무게 중심 X / Y / Z', `${fmt(gantry.cog.x)} / ${fmt(gantry.cog.y)} / ${fmt(gantry.cog.z)} mm`],
          [
            '선정 순서',
            [...axes]
              .sort((a, b) => a.order - b.order)
              .map((a) => a.name)
              .join(' → '),
          ],
        ]}
      />

      <h3>{t('축별 선정 결과')}</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>{t('축')}</th>
            <th>{t('축 설치 방향')}</th>
            <th>{t('스트로크')}</th>
            <th>{t('속도 / 가속도')}</th>
            <th>{t('하중')}</th>
            <th>{t('직교 축')}</th>
            <th>{t('모터')}</th>
            <th>{t('연결키트')}</th>
            <th>{t('판정')}</th>
          </tr>
        </thead>
        <tbody>
          {axes.map(({ name, result: { req, sel } }) => {
            const status = axisVerdict(sel)
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{req ? t(mountingLabel[req.mounting]) : '—'}</td>
                <td>{req ? q(req.stroke, 'mm', 0) : '—'}</td>
                <td>{req ? `${q(req.velocity, 'm/s')} / ${q(req.acceleration, 'm/s²')}` : '—'}</td>
                <td>{req ? q(req.payload, 'kg', 2) : '—'}</td>
                <td className="model">{sel?.selectedAxis?.order.model ?? '—'}</td>
                <td className="model">{sel?.selectedDrive?.motor.model ?? '—'}</td>
                <td className="model">{sel?.selectedKitEval?.kit.product ?? '—'}</td>
                <td>{status ? <StatusBadge status={status} /> : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {joints.length > 0 && (
        <>
          <h3>{t('조합 키트')}</h3>
          <table className="report-table">
            <thead>
              <tr>
                <th>{t('결합')}</th>
                <th>{t('조합 키트')}</th>
                <th>{t('주문번호')}</th>
                <th>{t('수량')}</th>
                <th>{t('판정')}</th>
              </tr>
            </thead>
            <tbody>
              {joints.map((j) => {
                if (!j.kit)
                  return (
                    <tr key={where(j)}>
                      <td>{where(j)}</td>
                      <td colSpan={3}>{t(j.note, j.noteArgs)}</td>
                      <td>
                        <StatusBadge status={j.status} />
                      </td>
                    </tr>
                  )
                // one row per kit model (a mirrored pair under two X axes), a custom beam with its length and its
                // plate, then what is ordered with them
                const kits = [
                  ...[...new Set(j.kits.map((k) => k.model))].map((model) => {
                    const same = j.kits.filter((k) => k.model === model)
                    return { model, partNumber: same[0].partNumber, n: same.length }
                  }),
                  ...(j.beam ? [{ model: `${j.beam.bracket.model} (L ${fmt(j.beam.length, 0)} mm)`, partNumber: null, n: 1 }] : []),
                  ...(j.beam?.plate ? [{ model: j.beam.plate.model, partNumber: j.beam.plate.partNumber, n: 1 }] : []),
                ]
                const extra = jointAccessories(j, adapters)
                return [
                  ...kits.map((k, i) => (
                    <tr key={`${where(j)}${k.model}`}>
                      <td>{i === 0 ? where(j) : ''}</td>
                      <td className="model">{k.model}</td>
                      <td>{k.partNumber ?? t('주문 제작')}</td>
                      <td>{k.n}</td>
                      <td>{i === 0 ? <StatusBadge status={j.status} /> : ''}</td>
                    </tr>
                  )),
                  ...extra.map((x) => (
                    <tr key={`${where(j)}${x.partNumber}`}>
                      <td />
                      <td className="model">{x.model}</td>
                      <td>{x.partNumber}</td>
                      <td>{x.n ?? '—'}</td>
                      <td />
                    </tr>
                  )),
                ]
              })}
            </tbody>
          </table>
          {joints
            .filter((j) => j.kit && j.status !== 'ok')
            .map((j) => (
              <p key={where(j)} className="report-note warn-text">
                {where(j)}: {t(j.note, j.noteArgs)}
              </p>
            ))}
        </>
      )}

      <h3>{t('선정 모델 (전체)')}</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>{t('축')}</th>
            <th>{t('구분')}</th>
            <th>{t('메이커')}</th>
            <th>{t('모델명')}</th>
            <th>{t('주문번호')}</th>
            <th>{t('수량')}</th>
            <th>{t('판정')}</th>
          </tr>
        </thead>
        <tbody>
          {axes.flatMap(({ name, result: { sel } }) =>
            sel?.selectedAxis
              ? partRows(sel.selectedAxis, sel.selectedDrive, sel.selectedKitEval, t).map(
                  ([part, maker, model, partNumber, count, status], i) => (
                    <tr key={`${name}${part}${model}`}>
                      <td>{i === 0 ? name : ''}</td>
                      <td>{part}</td>
                      <td>{maker}</td>
                      <td className="model">{model}</td>
                      <td>{partNumber ?? '—'}</td>
                      <td>{count ?? '—'}</td>
                      <td>{status ? <StatusBadge status={status} /> : '—'}</td>
                    </tr>
                  ),
                )
              : [],
          )}
        </tbody>
      </table>
      <p className="report-note">
        {t('각 축의 세부 계산은 다음 장부터 {axes} 순서로 이어집니다.', { axes: axes.map((a) => a.name).join(', ') })}
      </p>
    </section>
  )
}
