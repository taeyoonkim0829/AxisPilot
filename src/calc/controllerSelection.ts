// Drive package of a motor with drive data (Festo CMMT-AS / CMMT-ST, Siemens S210 / V90, Mitsubishi MR-J5 / MR-J4):
// servo drive, cables and braking resistor.
import type { BrakingResistor, Cable, Controller } from '../data/types'
import type { AxisEvaluation } from './axisSelection'
import { motorTorqueFn, type DriveEvaluation } from './motorSelection'
import { check, worstStatus, type Check, type Settings, type Status } from './types'

export interface CableChoice {
  role: Cable['role']
  /** type with the length filled in, or the configurable type */
  type: string
  partNumber: string | null
  /** m */
  length: number
  crossSection: number | null
  /** how the length is ordered: a standard length, a variable-length part number, the modular product system, or
   * rounded up to the next standard length */
  order: 'standard' | 'variable' | 'modular' | 'rounded'
  /** module name for `modular` (e.g. NEBM-LX/M17) */
  module?: string
}

export interface ResistorChoice {
  /** an external braking resistor is needed */
  required: boolean
  item: BrakingResistor | null
  /** W, average regenerative power over the cycle */
  averagePower: number
  /** W, peak regenerative power */
  peakPower: number
  /** Ws, largest energy of one braking event */
  eventEnergy: number
}

export interface ControllerSelection {
  controller: Controller | null
  /** the maker's preferred drive for the motor (Festo), when it differs from the selected one */
  preferred: Controller | null
  /** A, required at the motor */
  rmsCurrent: number
  peakCurrent: number
  cables: CableChoice[]
  resistor: ResistorChoice
  checks: Check[]
  /** Korean source text with `{name}` placeholders */
  notes: { text: string; args?: Record<string, string | number> }[]
  status: Status
}

export interface DrivePackageData {
  controllers: Controller[]
  resistors: BrakingResistor[]
  cables: Cable[]
}

/** Drives without an integrated braking resistor (CMMT-ST): below this energy per braking event the supply takes it */
const ST_REGEN_LIMIT = 1

/** Drive range a drive belongs to, as a motor's `controller` names it (CMMT-AS-3A, CMMT-ST, S210-1AC, V90-400V …) */
export const driveRange = (c: Controller) => (c.voltageClass === 'ST' ? c.family : `${c.family}-${c.voltageClass}`)

const lengthKey = (l: number) => String(Math.round(l * 10) / 10)

/**
 * Drive, cables and braking resistor for a motor with a drive range (`Motor.controller`); null for the others. The
 * drive is the smallest of the range (and of the maker's combination table, `Controller.motors`) that covers the
 * motor current.
 */
export function selectController(
  axisEval: AxisEvaluation,
  drive: DriveEvaluation,
  settings: Settings,
  data: DrivePackageData,
): ControllerSelection | null {
  const { motor, gearbox } = drive
  if (!motor.controller) return null
  const candidates = data.controllers
    .filter((c) => driveRange(c) === motor.controller && (!c.motors || new RegExp(c.motors).test(motor.model)))
    .toSorted((a, b) => a.nominalCurrent - b.nominalCurrent)
  const family = candidates[0]?.family ?? motor.controller

  // Motor current from the torque: an open-loop stepper always runs at its nominal current
  const kt = motor.torqueConstant ?? (motor.nominalCurrent ? motor.ratedTorque / motor.nominalCurrent : null)
  const motorTorque = motorTorqueFn(axisEval, motor, gearbox, settings)
  const ratio = gearbox?.ratio ?? 1
  const currents = axisEval.samples.map((s) =>
    motor.openLoop ? (motor.nominalCurrent ?? 0) : kt ? Math.abs(motorTorque(s)) / kt : 0,
  )
  const rmsCurrent = motor.openLoop ? (motor.nominalCurrent ?? 0) : kt ? drive.rmsTorque / kt : 0
  const peakCurrent = Math.max(0, ...currents)
  // Longest stretch above the drive's nominal current (peak current is allowed for peakDuration). The cycle repeats,
  // so a stretch at its end runs on into the next cycle's start: two cycles are scanned.
  const overTime = (c: Controller) => {
    const cycle = axisEval.samples.reduce((t, s) => t + s.dt, 0)
    let longest = 0
    let run = 0
    for (const pass of [0, 1])
      axisEval.samples.forEach((s, i) => {
        run = currents[i] > c.nominalCurrent ? run + s.dt : 0
        if (pass === 1 || run > 0) longest = Math.max(longest, Math.min(run, cycle))
      })
    return longest
  }
  const fits = (c: Controller) =>
    motor.openLoop
      ? c.nominalCurrent >= (motor.nominalCurrent ?? 0)
      : c.nominalCurrent >= rmsCurrent &&
        (c.peakCurrent == null || c.peakCurrent >= peakCurrent) &&
        (c.peakDuration == null || overTime(c) <= c.peakDuration)
  const controller = candidates.find(fits) ?? candidates.at(-1) ?? null
  const preferredItem = data.controllers.find((c) => c.model === motor.preferredController) ?? null
  const preferred = preferredItem && preferredItem.id !== controller?.id ? preferredItem : null

  const checks: Check[] = []
  const notes: ControllerSelection['notes'] = []
  if (controller) {
    if (motor.openLoop) {
      const c = check('드라이브 정격 전류', motor.nominalCurrent ?? 0, controller.nominalCurrent, 'A')
      checks.push(
        c.status === 'fail'
          ? { ...c, status: 'warn', note: '모터 정격 전류를 낼 수 없어 토크가 선도보다 줄어듭니다' }
          : { ...c, note: '오픈루프: 모터 정격 전류로 구동' },
      )
    } else {
      checks.push(
        check('드라이브 정격 전류', rmsCurrent, controller.nominalCurrent, 'A'),
        check('드라이브 최대 전류', peakCurrent, controller.peakCurrent, 'A'),
        check('최대 전류 지속 시간', overTime(controller), controller.peakDuration, 's'),
      )
    }
    if (!kt && !motor.openLoop) notes.push({ text: '모터 토크 상수가 없어 전류를 계산하지 못했습니다' })
  } else {
    notes.push({ text: '이 모터에 맞는 드라이브 데이터가 없습니다' })
  }

  // Cables for the set length
  const length = settings.cableLength
  const cableChoices: CableChoice[] = []
  const pick = (role: Cable['role']) =>
    data.cables.find(
      (c) =>
        c.role === role &&
        c.controller === family &&
        new RegExp(c.motors).test(motor.model) &&
        (!c.brakeOnly || motor.brake) &&
        length > c.range[0] &&
        length <= c.range[1],
    )
  const roles: Cable['role'][] = ['motor', 'encoder', 'adapter', 'brake']
  for (const role of roles) {
    const cable = pick(role)
    if (!cable) continue
    const l = cable.fixedLength ?? length
    const base = { role, crossSection: cable.crossSection }
    const standard = cable.partNumbers[lengthKey(l)]
    const conf = cable.configurable
    if (standard) {
      cableChoices.push({ ...base, type: cable.type.replace('{L}', lengthKey(l)), partNumber: standard, length: l, order: 'standard' })
    } else if (conf && l <= conf.max) {
      // the length goes into the type, rounded up to the configurable increment
      const ordered = Math.max(conf.min, Math.ceil(l / conf.step - 1e-9) * conf.step)
      cableChoices.push({
        ...base,
        type: conf.type.replace('{L}', lengthKey(ordered)),
        partNumber: conf.partNumber,
        length: ordered,
        order: conf.kind,
        module: conf.module,
      })
    } else {
      // standard lengths only: the next longer one
      const next = Object.keys(cable.partNumbers)
        .map(Number)
        .sort((a, b) => a - b)
        .find((s) => s >= l)
      if (next == null) {
        notes.push({ text: '{type}: 주문할 수 있는 길이를 넘습니다', args: { type: cable.type.replace('-{L}', '') } })
        continue
      }
      cableChoices.push({
        ...base,
        type: cable.type.replace('{L}', lengthKey(next)),
        partNumber: cable.partNumbers[lengthKey(next)],
        length: next,
        order: 'rounded',
      })
    }
  }
  const hasMotorCable = cableChoices.some((c) => c.role === 'motor')
  if (!hasMotorCable) {
    checks.push({
      ...check('모터 케이블 길이', length, null, 'm'),
      status: 'warn',
      note: '케이블 선정표 범위를 넘습니다 — 사전 기술 검토 필요',
    })
  } else if (controller?.maxCableLength != null && length > controller.maxCableLength) {
    checks.push({
      ...check('모터 케이블 길이', length, controller.maxCableLength, 'm'),
      status: 'warn',
      note: '외부 메인 필터 없이 허용되는 길이를 넘습니다',
    })
  } else if (length > 25) {
    notes.push({ text: '케이블 길이 25 m 초과는 사전 기술 검토를 권장합니다' })
  }
  if (cableChoices.some((c) => c.order === 'modular')) {
    notes.push({ text: '모듈러 케이블은 모듈 번호와 형식(길이 포함)으로 주문합니다' })
  }
  if (cableChoices.some((c) => c.order === 'rounded')) notes.push({ text: '표준 길이만 있는 케이블은 다음 표준 길이로 올렸습니다' })
  if (motor.brake) notes.push({ text: '브레이크 모터는 24 V DC 이상의 로직 전원이 필요합니다' })

  // Regeneration: negative mechanical power at the motor shaft, losses neglected (conservative)
  let energy = 0
  let eventEnergy = 0
  let event = 0
  let peakRegen = 0
  for (const s of axisEval.samples) {
    const power = motorTorque(s) * s.omega * ratio
    if (power < 0) {
      event += -power * s.dt
      energy += -power * s.dt
      peakRegen = Math.max(peakRegen, -power)
    } else {
      eventEnergy = Math.max(eventEnergy, event)
      event = 0
    }
  }
  eventEnergy = Math.max(eventEnergy, event)
  const averagePower = energy / axisEval.cycleTime
  const resistor: ResistorChoice = { required: false, item: null, averagePower, peakPower: peakRegen, eventEnergy }
  if (controller) {
    const internal = controller.internalResistor
    const needed = internal
      ? averagePower > internal.nominalPower ||
        (internal.pulseEnergy != null && eventEnergy > internal.pulseEnergy) ||
        (internal.pulsePower != null && peakRegen > internal.pulsePower)
      : eventEnergy > ST_REGEN_LIMIT
    if (internal) {
      // pulse values are not documented for every drive (Mitsubishi: continuous regenerative power only)
      const own = [
        check('제동저항 정격 전력 (내장)', averagePower, internal.nominalPower, 'W'),
        ...(internal.pulseEnergy != null ? [check('제동 에너지 (내장)', eventEnergy, internal.pulseEnergy, 'Ws')] : []),
      ]
      // the internal resistor only informs here: an external one takes over when it is exceeded
      for (const c of own) if (c.status === 'fail') Object.assign(c, { status: 'ok', note: '외부 제동저항으로 보완' })
      checks.push(...own)
    }
    if (needed) {
      const options = controller.brakingResistors
        .map((m) => data.resistors.find((r) => r.model === m))
        .filter((r): r is BrakingResistor => !!r)
      const rating = (r: BrakingResistor) =>
        (controller.resistorVoltage ?? 0) >= 700
          ? { power: r.nominalPower780, energy: r.pulseEnergy780 }
          : { power: r.nominalPower380, energy: r.pulseEnergy380 }
      const item =
        options.find((r) => (rating(r).power ?? 0) >= averagePower && (rating(r).energy ?? 0) >= eventEnergy) ??
        options.at(-1) ??
        null
      resistor.required = true
      resistor.item = item
      if (item) {
        checks.push(
          check('외부 제동저항 정격 전력', averagePower, Math.min(rating(item).power ?? 0, controller.externalMaxPower ?? Infinity), 'W'),
          check('외부 제동저항 펄스 에너지', eventEnergy, rating(item).energy, 'Ws'),
        )
      } else {
        checks.push({ ...check('외부 제동저항', averagePower, null, 'W'), status: 'warn', note: '맞는 제동저항 데이터가 없습니다' })
      }
      if (!internal)
        notes.push(
          family === 'CMMT-ST'
            ? { text: 'CMMT-ST는 내장 제동저항이 없습니다. 회생 에너지가 있어 외부 제동저항을 권장합니다' }
            : { text: '{model}은 내장 제동저항이 없습니다. 회생 에너지가 있어 외부 제동저항을 권장합니다', args: { model: controller.model } },
        )
    }
  }
  notes.push({ text: '회생 계산은 모터·드라이브 손실과 DC 링크 흡수를 빼지 않은 보수적인 값입니다' })

  return {
    controller,
    preferred,
    rmsCurrent,
    peakCurrent,
    cables: cableChoices,
    resistor,
    checks,
    notes,
    status: worstStatus(checks),
  }
}

/** Folds the drive package verdict into the drive option (used as a selectMotors hook, after attachKit). */
export function attachController(
  axisEval: AxisEvaluation,
  drive: DriveEvaluation,
  settings: Settings,
  data: DrivePackageData,
): DriveEvaluation {
  const selection = selectController(axisEval, drive, settings, data)
  if (!selection) return drive
  return { ...drive, controller: selection, status: worstStatus([{ status: drive.status }, { status: selection.status }]) }
}

