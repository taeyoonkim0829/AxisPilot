// Motor–axis mounting kit lookup by mechanical interface code, and the kit checks.
import type { Axis, Gearbox, Kit, Motor } from '../data/types'
import type { AxisEvaluation } from './axisSelection'
import { motorTorqueFn, type DriveEvaluation } from './motorSelection'
import { check, worstStatus, type Check, type Settings, type Status } from './types'

export type KitType = Kit['type']

export interface KitMatch {
  axisCode: string | null
  /** The motor's interface code, or the gearbox's (output side) when a gearbox sits in between */
  motorCode: string | null
  motorSide: 'motor' | 'gearbox'
  /** Standard kits (axial and parallel, with and without inspection window) in file order */
  kits: Kit[]
  /** SA (custom-made) kits whose name codes match; reference only */
  special: Kit[]
}


export function findKits(axis: Axis, motor: Motor, gearbox: Gearbox | null, all: Kit[], kitType: Settings['kitType'] = 'all'): KitMatch {
  const axisCode = axis.interfaceCode
  const motorCode = gearbox ? gearbox.interfaceCode : motor.interfaceCode
  const matches =
    axisCode && motorCode
      ? all.filter((k) => k.axisCode === axisCode && k.motorCode === motorCode && (kitType === 'all' || k.type === kitType))
      : []
  return {
    axisCode,
    motorCode,
    motorSide: gearbox ? 'gearbox' : 'motor',
    kits: matches.filter((k) => !k.special),
    special: matches.filter((k) => k.special),
  }
}

/** Something to look at beyond the checks; Korean source text with `{name}` placeholders */
export interface KitNote {
  text: string
  args?: Record<string, string | number>
}

/** Advisory check: shown as 주의 in the details, not part of the kit's verdict */
export const MOTOR_MAX_LABEL = '모터 최대 토크 (키트 기준)'

export interface KitEvaluation {
  kit: Kit
  status: Status
  checks: Check[]
  notes: KitNote[]
}

/**
 * Kit checks for the selected axis and drive. The kit sits at the axis drive shaft (after the gearbox), so it
 * carries the axis input torque plus its own inertia and no-load torque, at the axis shaft speed.
 */
export function evaluateKit(axisEval: AxisEvaluation, drive: DriveEvaluation, kit: Kit, settings: Settings): KitEvaluation {
  const { motor, gearbox } = drive
  const ratio = gearbox?.ratio ?? 1
  const eta = axisEval.efficiency
  const kitInertia = (kit.inertia ?? 0) * 1e-4 // kg·m²
  const noLoad = kit.noLoadTorque ?? 0
  const motorTorque = motorTorqueFn(axisEval, motor, gearbox, settings)

  let kitPeak = 0
  let motorPeak = 0
  let sumSquares = 0
  for (const s of axisEval.samples) {
    const input = s.torque * s.omega >= 0 ? s.torque / eta : s.torque * eta
    const sgn = s.omega !== 0 ? Math.sign(s.omega) : s.dir
    const own = kitInertia * s.alpha + sgn * noLoad
    kitPeak = Math.max(kitPeak, Math.abs(input + own))
    // Motor side: the kit's inertia and no-load torque load the motor through the gearbox, not the screw.
    const t = motorTorque(s) + own / ratio / (gearbox?.efficiency ? gearbox.efficiency / 100 : 1)
    motorPeak = Math.max(motorPeak, Math.abs(t))
    sumSquares += t * t * s.dt
  }
  const motorRms = Math.sqrt(sumSquares / axisEval.cycleTime)
  const kitSpeed = drive.maxMotorSpeed / ratio
  // The kit replaces the coupling inertia setting when it sits on the motor shaft (no gearbox).
  const extraInertia = (kit.inertia ?? 0) / ratio ** 2 - (gearbox ? 0 : settings.couplingInertia)
  const inertiaRatio = drive.inertiaRatio + (kit.inertia != null ? extraInertia / motor.inertia : 0)
  // Motor (and gearbox) peak torque that can reach the kit, e.g. in a crash or a stop at the current limit
  const motorMax = motor.peakTorque * ratio * (gearbox?.efficiency ? gearbox.efficiency / 100 : 1)

  const noData = '키트 데이터 없음 — 확인 필요'
  const checks: Check[] = [
    check('키트 전달 토크', kitPeak, kit.transmissibleTorque, 'Nm', kit.transmissibleTorque == null ? noData : undefined),
    check('키트 최대 회전수', kitSpeed, kit.maxSpeed, 'rpm', kit.maxSpeed == null ? noData : undefined),
  ]
  // ELGD-BS takes less feed force with a parallel kit (data sheet); the axis step checked the axial value.
  const parallelFx = kit.type === 'parallel' ? axisEval.axis.maxFeedForceParallel : null
  const fx = axisEval.checks.find((c) => c.label === '이송력 Fx')
  if (parallelFx != null && fx && (fx.limit == null || parallelFx < fx.limit)) {
    checks.push(check('이송력 Fx (병렬 키트)', fx.value, parallelFx, 'N'))
  }
  if (kit.inertia != null) {
    checks.push(
      check('최대 토크 (키트 포함)', motorPeak, motor.peakTorque, 'Nm'),
      check('실효 토크 (키트 포함)', motorRms, motor.ratedTorque, 'Nm'),
      check('관성비 (키트 포함)', inertiaRatio, motor.allowableInertiaRatio ?? settings.defaultInertiaRatio, '배'),
    )
  }
  // advice only, listed last
  if (kit.transmissibleTorque != null && motorMax > kit.transmissibleTorque) {
    checks.push({
      ...check(MOTOR_MAX_LABEL, motorMax, kit.transmissibleTorque, 'Nm'),
      status: 'warn',
      note: '드라이브 토크(전류) 제한을 키트 전달 토크 이하로 설정하세요',
    })
  }

  const notes: KitNote[] = []
  if (kit.transmissibleTorque == null) {
    notes.push({ text: 'EAMM-A/EAMM-U 데이터시트에 없는 키트입니다. 전달 토크, 최대 회전수, 관성을 제작사 자료로 확인하세요.' })
  }
  if (kit.dataSource) notes.push({ text: '키트 데이터는 현행 모델 {source}의 값입니다.', args: { source: kit.dataSource } })
  if (/-S1(-|$)/.test(kit.product)) {
    notes.push({ text: 'IP65 실링(-S1)은 모터와 플랜지 사이의 방열을 줄입니다. 모터 디레이팅을 확인하세요.' })
  }
  if (kit.type === 'parallel') {
    notes.push({
      text: '벨트 장력이 모터와 축의 베어링에 반경 하중을 줍니다. 하중이 크면 카운터 베어링 EAMG(클램핑 슬리브 EAMH-…-P 포함)를 검토하세요.',
    })
    if (/^EAMM-U-(110|145)-/.test(kit.product)) notes.push({ text: '벨트 장력 조정에는 클램핑 부품 EADT를 사용하세요.' })
  }
  if (motor.maker !== 'Festo') {
    notes.push({ text: '타사 모터: 키트 매뉴얼의 타사 모터 인터페이스 표에서 축 지름·축 길이·플랜지가 맞는지 확인하세요.' })
  }
  // The motor's torque reserve above the kit is advice (set a torque limit): it shows in the details only.
  return { kit, status: worstStatus(checks.filter((c) => c.label !== MOTOR_MAX_LABEL)), checks, notes }
}

/**
 * Every kit matching the drive, checked, with the recommended one: the first in list order that does not fail,
 * preferring kits with data sheet values.
 * The drive's status then includes the kit: the recommended kit's verdict, or `warn` when no kit matches.
 */
export function attachKit(axisEval: AxisEvaluation, drive: DriveEvaluation, all: Kit[], settings: Settings): DriveEvaluation {
  const match = findKits(axisEval.axis, drive.motor, drive.gearbox, all, settings.kitType)
  const evaluated = orderKits(match.kits).map((k) => evaluateKit(axisEval, drive, k, settings))
  // Prefer a kit the data sheet values could verify over one without data
  const passing = evaluated.filter((e) => e.status !== 'fail')
  const kit = passing.find((e) => e.kit.transmissibleTorque != null) ?? passing[0] ?? evaluated[0] ?? null
  const kitStatus: Status = kit ? kit.status : 'warn'
  return { ...drive, kits: evaluated, kit, driveStatus: drive.status, status: worstStatus([{ status: drive.status }, { status: kitStatus }]) }
}

/** All kits in one list: axial before parallel, then without inspection window before with one. */
export function orderKits(kits: Kit[]): Kit[] {
  const rank = (k: Kit) => (k.type === 'axial' ? 0 : 2) + (k.window ? 1 : 0)
  return kits.toSorted((a, b) => rank(a) - rank(b))
}
