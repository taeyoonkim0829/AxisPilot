import { describe, expect, it } from 'vitest'
import { axes, gearboxes, kits, motors } from '../data'
import { evaluateAxis } from './axisSelection'
import { attachKit, evaluateKit, findKits, orderKits } from './kitSelection'
import { evaluateDrive, selectMotors } from './motorSelection'
import { defaultSettings as appDefaults, type Requirements } from './types'

// every axis and motor filter on (the app's defaults narrow the lists)
const defaultSettings = { ...appDefaults, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'], supplies: ['ac230', 'ac400', 'dc48'], excludedMotorFamilies: [] } satisfies typeof appDefaults

const axis = (id: string) => axes.find((a) => a.id === id)!
const motor = (id: string) => motors.find((m) => m.id === id)!

describe('findKits', () => {
  it('reproduces the Excel kit selection tool for ELGD-BS-KF-60 + HG-KR43', () => {
    const m = findKits(axis('ELGD-BS-KF-60-…10P'), motor('HG-KR43'), null, kits)
    expect(m.axisCode).toBe('T42-60')
    expect(m.motorCode).toBe('60PA')
    const names = (type: string, window: boolean) =>
      m.kits.filter((k) => k.type === type && k.window === window).map((k) => k.product)
    expect(names('axial', false)).toEqual(['EAMM-A-T42-60P'])
    expect(names('axial', true)).toEqual(['GD060A060M1A-1000'])
    expect(names('parallel', false)).toEqual(['EAMM-U-65-T42-60P-87'])
    expect(names('parallel', true)).toEqual(['GD060U060M1A-1000'])
  })

  it('matches the gearbox output code instead of the motor when a gearbox is used', () => {
    const gearbox = gearboxes.find((g) => g.interfaceCode === '60G0')!
    const m = findKits(axis('ELGD-BS-KF-60-…10P'), motor('HG-KR43'), gearbox, kits)
    expect(m.motorSide).toBe('gearbox')
    expect(m.motorCode).toBe('60G0')
    expect(m.kits.every((k) => k.motorCode === '60G0')).toBe(true)
  })

  it('finds nothing when a code is missing', () => {
    const noCode = motors.find((m) => m.interfaceCode === null)!
    const m = findKits(axis('ELGD-BS-KF-60-…10P'), noCode, null, kits)
    expect(m.motorCode).toBeNull()
    expect(m.kits).toEqual([])
  })

  it('lists axial before parallel, then plain before inspection window', () => {
    const m = findKits(axis('ELGD-BS-KF-60-…10P'), motor('HG-KR43'), null, kits)
    expect(orderKits(m.kits).map((k) => k.product)).toEqual([
      'EAMM-A-T42-60P',
      'GD060A060M1A-1000',
      'EAMM-U-65-T42-60P-87',
      'GD060U060M1A-1000',
    ])
  })
})

describe('evaluateKit', () => {
  const req: Requirements = { stroke: 500, velocity: 0.5, acceleration: 5, jerk: 0, payload: 10, cog: { x: 0, y: 0, z: 0 }, mounting: 'floor' }
  const evaluate = (product: string, velocity = 0.5) => {
    const ev = evaluateAxis(axis('ELGD-BS-KF-60-…10P'), { ...req, velocity }, defaultSettings)!
    const drive = evaluateDrive(ev, motor('HG-KR43'), null, defaultSettings)
    const kit = findKits(ev.axis, drive.motor, null, kits).kits.find((k) => k.product === product)!
    return { ev, drive, result: evaluateKit(ev, drive, kit, defaultSettings) }
  }
  const checkOf = (r: ReturnType<typeof evaluateKit>, label: string) => r.checks.find((c) => c.label === label)!

  it('checks the transferable torque and speed from the data sheet', () => {
    const { ev, result } = evaluate('EAMM-A-T42-60P')
    const torque = checkOf(result, '키트 전달 토크')
    expect(torque.limit).toBe(10)
    // the axis input torque plus the kit's own inertia
    expect(torque.value).toBeGreaterThanOrEqual(Math.max(...ev.samples.map((s) => Math.abs(s.torque))))
    expect(checkOf(result, '키트 최대 회전수').value).toBeCloseTo(3000)
    expect(result.status).not.toBe('fail')
  })

  it('fails above the kit speed and warns when the motor can exceed the kit torque', () => {
    const fast = evaluate('EAMM-U-65-T42-60P-87', 0.6).result
    expect(checkOf(fast, '키트 최대 회전수').status).toBe('fail') // 3600 rpm > 3000 rpm
    const { drive, result } = evaluate('EAMM-U-65-T42-60P-87')
    expect(drive.motor.peakTorque).toBeGreaterThan(3)
    expect(checkOf(result, '모터 최대 토크 (키트 기준)').status).toBe('warn')
    // advice only: the kit itself still passes
    expect(result.status).toBe('ok')
    expect(result.notes.map((n) => n.text)).toContain(
      '벨트 장력이 모터와 축의 베어링에 반경 하중을 줍니다. 하중이 크면 카운터 베어링 EAMG(클램핑 슬리브 EAMH-…-P 포함)를 검토하세요.',
    )
  })

  it('checks the lower ELGD feed force with a parallel kit', () => {
    const run = (id: string, type: 'axial' | 'parallel') => {
      const ev = evaluateAxis(axis(id), { ...req, velocity: 0.1, acceleration: 30, payload: 30 }, defaultSettings)!
      const drive = evaluateDrive(ev, motor('HG-KR43'), null, defaultSettings)
      const kit = findKits(ev.axis, drive.motor, null, kits).kits.find((k) => k.type === type && !k.window)!
      return evaluateKit(ev, drive, kit, defaultSettings).checks.find((c) => c.label === '이송력 Fx (병렬 키트)')
    }
    // ELGD-80-20P: 2650 N with an axial kit, 873 N with a parallel kit (data sheet p.6)
    expect(run('ELGD-BS-KF-80-…20P', 'parallel')).toMatchObject({ limit: 873, status: 'fail' })
    expect(run('ELGD-BS-KF-80-…20P', 'axial')).toBeUndefined()
    // ELGD-60 takes the same force either way
    expect(run('ELGD-BS-KF-60-…10P', 'parallel')).toBeUndefined()
  })

  it('flags kits without data sheet values instead of guessing', () => {
    const { result } = evaluate('GD060A060M1A-1000')
    expect(checkOf(result, '키트 전달 토크')).toMatchObject({ status: 'ok', limit: null, note: '키트 데이터 없음 — 확인 필요' })
    expect(result.notes[0].text).toMatch(/데이터시트에 없는 키트/)
  })
})

describe('attachKit', () => {
  const req: Requirements = { stroke: 500, velocity: 0.5, acceleration: 5, jerk: 0, payload: 10, cog: { x: 0, y: 0, z: 0 }, mounting: 'floor' }
  const ev = evaluateAxis(axis('ELGD-BS-KF-60-…10P'), req, defaultSettings)!
  const settings = { ...defaultSettings, makers: ['Festo', 'Siemens', 'Mitsubishi'] as const satisfies typeof defaultSettings.makers, requireBrake: false }

  it('recommends the first kit that does not fail and folds its verdict into the motor', () => {
    const drive = attachKit(ev, evaluateDrive(ev, motor('HG-KR43'), null, settings), kits, settings)
    expect(drive.kits!.map((k) => k.kit.product)[0]).toBe('EAMM-A-T42-60P')
    expect(drive.kit!.kit.product).toBe('EAMM-A-T42-60P')
    expect(drive.driveStatus).toBeDefined()
  })

  it('warns when no kit fits and sorts motors by the combined verdict', () => {
    const noCode = motors.find((m) => m.interfaceCode === null && m.maker === 'Festo')!
    const results = selectMotors(ev, [motor('HG-KR43'), noCode], settings, (d) => attachKit(ev, d, kits, settings))
    const bare = results.find((r) => r.motor.id === noCode.id)!
    expect(bare.kit).toBeNull()
    expect(bare.status).not.toBe('ok')
    if (bare.driveStatus === 'ok') expect(bare.status).toBe('warn')
  })
})
