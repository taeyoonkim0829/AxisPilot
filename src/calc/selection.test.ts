import { describe, expect, it } from 'vitest'
import { axes, gearboxes, kits, motors, shafts } from '../data'
import type { Axis, Gearbox, Motor } from '../data/types'
import { axisOrder, curveAt, evaluateAxis, guideLoads, memberLoads, parallelLayout, selectAxes, G } from './axisSelection'
import { evaluateDrive, gearboxOptionsFor, gearboxStatus, selectMotors } from './motorSelection'
import { moveProfile } from './motionProfile'
import { comboInputs, shaftTooShort } from '../ui/comboInputs'
import { defaultParallel, defaultPress, defaultSettings as appDefaults, verticalForward, type Requirements } from './types'

// every axis and motor filter on (the app's defaults narrow the lists)
const defaultSettings = { ...appDefaults, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'], supplies: ['ac230', 'ac400', 'dc48'], excludedMotorFamilies: [] } satisfies typeof appDefaults

const baseReq: Requirements = {
  stroke: 500,
  velocity: 0.5,
  acceleration: 5,
  jerk: 0,
  payload: 10,
  cog: { x: 0, y: 0, z: 0 },
  mounting: 'floor',
}

const spindle = { ...axes.find((a) => a.id === 'ELGT-BS-120-…10P')! }

describe('guideLoads', () => {
  it('floor mounting follows the Excel load case', () => {
    const l = guideLoads({ ...baseReq, cog: { x: 100, y: 50, z: 200 } }, 10, 5)
    expect(l.Fz).toBeCloseTo(10 * G)
    expect(l.Mx).toBeCloseTo(0.05 * 10 * G)
    expect(l.My).toBeCloseTo(0.1 * 10 * G + 0.2 * 50)
    expect(l.Mz).toBeCloseTo(0.05 * 50)
  })

  it('vertical mounting puts weight + inertia on the moments', () => {
    const l = guideLoads({ ...baseReq, mounting: 'vertical', cog: { x: 0, y: 100, z: 50 } }, 10, 5)
    expect(l.My).toBeCloseTo(0.05 * 10 * (G + 5))
    expect(l.Mz).toBeCloseTo(0.1 * 10 * (G + 5))
    expect(l.Fz).toBe(0)
  })
})

describe('parallel arrangement', () => {
  const twin = (mode: 'twinMotor' | 'twinShaft', y = 0): Requirements => ({
    ...baseReq,
    cog: { x: 0, y, z: 0 },
    parallel: { mode, spacing: 400, guideCount: 1, guideMass: 0, shaftInertia: 2 },
  })

  it('splits the payload between two axes by the lever rule', () => {
    expect(parallelLayout(twin('twinMotor', 0)).share).toBeCloseTo(0.5)
    expect(parallelLayout(twin('twinMotor', -100)).share).toBeCloseTo(0.75)
    const single = evaluateAxis(spindle, baseReq, defaultSettings)!
    const ev = evaluateAxis(spindle, twin('twinMotor', 0), defaultSettings)!
    expect(ev.movingMass).toBeCloseTo(single.movingMass - 5)
    expect(ev.layout.motors).toBe(2)
  })

  it('a connecting shaft puts both axes on one motor', () => {
    const ev = evaluateAxis(spindle, twin('twinShaft', 0), defaultSettings)!
    const axisInertia = spindle.inertiaJ0 + (spindle.inertiaJHPerMeter * (ev.order.stroke ?? 500)) / 1000
    expect(ev.inertia).toBeCloseTo(2 * axisInertia + spindle.inertiaJLPerKg * 10 + 2)
    expect(ev.checks.some((c) => c.label === '구동 토크 (연결축 포함)')).toBe(true)
  })

  it('fits a KSK connecting shaft between two belt axes', () => {
    const belt = axes.find((a) => a.id === 'EGC-80-...-TB-KF-GK')!
    const req = { ...twin('twinShaft', 0), velocity: 1 }
    const ev = evaluateAxis(belt, req, defaultSettings, shafts)!
    // LN = spacing 400 − drive width 82
    expect(ev.shaft?.model).toBe('KSK-80-318')
    expect(ev.shaft?.inertia).toBeCloseTo(1.59 + 0.8 * 0.318)
    const axisInertia = belt.inertiaJ0 + (belt.inertiaJHPerMeter * (ev.order.stroke ?? 500)) / 1000
    expect(ev.inertia).toBeCloseTo(2 * axisInertia + belt.inertiaJLPerKg * 10 + ev.shaft!.inertia)
    const rpm = ev.checks.find((c) => c.label === '연결축 최대 회전수')!
    expect(rpm.value).toBeCloseTo((1000 / belt.feedConstant!) * 60)
    expect(rpm.limit).toBeCloseTo(3333)
    expect(ev.checks.find((c) => c.label === '연결축 전달 토크')!.limit).toBe(8)
    // too close: below the 200 mm minimum length
    const close = evaluateAxis(belt, { ...req, parallel: { ...req.parallel!, spacing: 250 } }, defaultSettings, shafts)!
    expect(close.checks.find((c) => c.label === '연결축 공칭 길이 LN')!.status).toBe('fail')
    // and the drawing leaves the shaft out (its model, at the shortest length, cannot be shortened further)
    expect(shaftTooShort(ev)).toBe(false)
    expect(comboInputs(ev, null, null, req).twin?.shaft?.model).toBe('KSK-80-318')
    expect(shaftTooShort(close)).toBe(true)
    expect(comboInputs(close, null, null, { ...req, parallel: { ...req.parallel!, spacing: 250 } }).twin?.shaft).toBeUndefined()
    // no KSK for a spindle axis: the entered inertia, with a warning
    const other = evaluateAxis(spindle, req, defaultSettings, shafts)!
    expect(other.shaft).toBeNull()
    expect(other.checks.find((c) => c.label === '연결축 (KSK)')!.status).toBe('warn')
  })

  it('puts the axis in the middle or at the edge of two LM guides', () => {
    const guides = (guideAxisEdge: boolean) =>
      parallelLayout({ ...baseReq, parallel: { ...defaultParallel, mode: 'guides', spacing: 200, guideCount: 2, guideAxisEdge } })
    expect(guides(false).isAxis).toEqual([false, true, false])
    const edge = guides(true)
    expect(edge.positions).toEqual([-0.2, 0, 0.2])
    expect(edge.isAxis).toEqual([true, false, false])
    expect(edge.guides).toBe(2)
    // three guides: four members 200 mm apart, the axis left of centre or at the edge
    const three = (guideAxisEdge: boolean) =>
      parallelLayout({ ...baseReq, parallel: { ...defaultParallel, mode: 'guides', spacing: 200, guideCount: 3, guideAxisEdge } })
    expect(three(false).positions.map((p) => +p.toFixed(3))).toEqual([-0.3, -0.1, 0.1, 0.3])
    expect(three(false).isAxis).toEqual([false, true, false, false])
    expect(three(true).isAxis).toEqual([true, false, false, false])
    expect(three(true).guides).toBe(3)
  })

  it('turns the rolling moment into normal forces across the members', () => {
    const layout = parallelLayout({ ...baseReq, parallel: { ...defaultParallel, mode: 'guides', spacing: 200 } })
    // Payload over the guide (y = +100, the guide side): the guide takes the whole weight, the axis nothing
    const loads = memberLoads({ ...baseReq, cog: { x: 0, y: 100, z: 0 } }, 10, 5, layout)
    expect(loads[0].Fz).toBeCloseTo(0)
    expect(loads[1].Fz).toBeCloseTo(10 * G)
    expect(loads[0].Mx).toBe(0)
    // Centred between them: half each; the inertial yaw about the axis is shared
    const centred = memberLoads({ ...baseReq, cog: { x: 0, y: 0, z: 0 } }, 10, 5, layout)
    expect(centred[0].Fz).toBeCloseTo(5 * G)
    expect(centred[0].Mz).toBeCloseTo((0.1 * 50) / 2)
  })

  it('LM guides lower the axis guide load', () => {
    const req = { ...baseReq, cog: { x: 0, y: 100, z: 0 } }
    const single = evaluateAxis(spindle, req, defaultSettings)!
    // Same payload position: 100 mm from the axis, centred between axis and guide (y = 0)
    const guided = evaluateAxis(spindle, { ...req, cog: { x: 0, y: 0, z: 0 }, parallel: { ...defaultParallel, mode: 'guides', spacing: 200 } }, defaultSettings)!
    expect(guided.guideFv).toBeLessThan(single.guideFv)
    expect(guided.info.some((i) => i.label === 'LM 가이드 하중 Fz')).toBe(true)
  })
})

describe('axis order options', () => {
  const elgd = axes.find((a) => a.id === 'ELGD-TB-KF-80')!
  const egc = axes.find((a) => a.id === 'EGC-80-...-TB-KF-GK')!
  const req = { ...baseReq, stroke: 1000, cog: { x: 150, y: 0, z: 50 } }

  it('keeps the standard product without options', () => {
    const e = evaluateAxis(elgd, req, defaultSettings)!
    expect(e.order.model).toBe('ELGD-TB-KF-80-1000-0H-PU2')
    expect(e.order.modular).toBe(false)
    expect(e.noLoadTorque).toBe(1.2)
  })

  it('adds an additional slide and the belt to the type code, lengthening the ordered stroke', () => {
    const plain = evaluateAxis(elgd, req, defaultSettings)!
    const e = evaluateAxis(elgd, req, { ...defaultSettings, additionalSlide: 'right', beltMaterial: { ELGD: 'PU1', EGC: null } })!
    // 142 mm slide + 50 mm gap
    expect(e.order).toEqual({ model: 'ELGD-TB-KF-80-1192-0H-ZR-PU1', partNumber: elgd.moduleNumber, stroke: 1192, modular: true })
    expect(e.noLoadTorque).toBe(1)
    expect(e.movingMass - plain.movingMass).toBeCloseTo(1.11)
    expect(e.checks.find((c) => c.label === '스트로크')!.value).toBe(1192)
    // the payload plate on two slides 192 mm apart takes the pitch moment as a force couple
    expect(e.guideFv).toBeLessThan(plain.guideFv)
  })

  it('takes the entered centre spacing of the slides, at least the minimum', () => {
    const at = (slidePitch: number) => evaluateAxis(elgd, req, { ...defaultSettings, additionalSlide: 'left', slidePitch })!
    // 262 mm centre to centre = half of both slide lengths (142) + 120 mm between them
    expect(at(262).order.model).toBe('ELGD-TB-KF-80-1262-0H-ZL-PU2')
    expect(at(262).options!.gaps).toEqual([120])
    expect(at(262).guideFv).toBeLessThan(at(0).guideFv)
    // below the ELGD minimum (50 mm between the slides) the minimum applies
    expect(at(150).order.stroke).toBe(1192)
    expect(at(150).options!.gaps).toEqual([50])
    expect(at(150).options!.pitches).toEqual([expect.closeTo(0.192)])
  })

  it('takes a distance for each of both EGC slides', () => {
    // 120 mm slides, EGC has no minimum distance: KL 120 (0 between), KR 180 centre to centre (60 between): 1000 + 120 + (120 + 60)
    const e = evaluateAxis(egc, req, { ...defaultSettings, additionalSlide: 'both', slidePitch: 120, slidePitchRight: 180 })!
    expect(e.order.stroke).toBe(1300)
    expect(e.options!.gaps).toEqual([0, 60])
    const even = evaluateAxis(egc, req, { ...defaultSettings, additionalSlide: 'both', slidePitch: 180, slidePitchRight: 180 })!
    expect(even.order.stroke).toBe(1360)
    expect(e.options!.pitches[1] - e.options!.pitches[0]).toBeCloseTo(0.06)
  })

  it('orders both EGC slides; the chloroprene belt has no code, PU2 has no torque data', () => {
    const settings = { ...defaultSettings, additionalSlide: 'both' as const, beltMaterial: { ELGD: 'PU2', EGC: 'PU2' } }
    const e = evaluateAxis(egc, req, settings)!
    // 2 × 120 mm slide (no distance entered; EGC has no minimum)
    expect(e.order.model).toBe('EGC-80-1240-TB-KF-0H-GK-KL-KR-PU2')
    expect(e.inertia - evaluateAxis(egc, req, defaultSettings)!.inertia).toBeCloseTo(2 * 1.2673 + egc.inertiaJHPerMeter * 0.24)
    expect(e.checks.find((c) => c.label === '구동 토크')!.noteArgs).toEqual({ belt: 'PU2' })
    expect(evaluateAxis(egc, req, defaultSettings)!.order.model).toBe('EGC-80-1000-TB-KF-0H-GK')
    // both slides exist on EGC only: ELGD-TB and ELGT-BS leave the list, so do axes without the option
    const listed = selectAxes(axes, req, settings).map((x) => x.axis.id)
    expect(listed).toContain(egc.id)
    expect(listed).not.toContain(elgd.id)
    expect(listed).not.toContain('EGC-HD-125-…-TB-GK')
    expect(listed).not.toContain('ELGT-BS-120-…10P')
    const left = selectAxes(axes, req, { ...settings, additionalSlide: 'left' }).map((x) => x.axis.id)
    expect(left).toEqual(expect.arrayContaining([elgd.id, 'ELGT-BS-120-…10P']))
    expect(left).not.toContain('ELGT-TB-120')
    // both, with no axis offering it listed (ELGT only): shown as 없음, nothing leaves
    const elgtOnly = { ...settings, families: ['ELGT' as const] }
    expect(selectAxes(axes, req, elgtOnly).length).toBe(selectAxes(axes, req, { ...elgtOnly, additionalSlide: 'none' }).length)
  })

  it('orders ELGT-BS with an additional slide (data sheet example ELGT-BS-120-600-10P-ZR)', () => {
    const elgt = axes.find((a) => a.id === 'ELGT-BS-120-…10P')!
    const at = (stroke: number, slidePitch = 0) =>
      evaluateAxis(elgt, { ...req, stroke }, { ...defaultSettings, additionalSlide: 'right', slidePitch })!
    // working stroke 460 + 135 mm slide + 5 mm between: 600, by module number
    expect(at(460).order).toMatchObject({ model: 'ELGT-BS-120-600-10P-ZR', partNumber: elgt.moduleNumber, stroke: 600 })
    expect(at(460).options!.pitches).toEqual([expect.closeTo(0.14)])
    // a longer spacing: the next stroke of the 50 mm list
    expect(at(460, 200).order.stroke).toBe(700)
    // additional slides only above 200 mm stroke
    expect(at(20).order.stroke).toBe(250)

    // under a gantry kit (main slide only) the additional slide shares none of the load
    const settings = { ...defaultSettings, additionalSlide: 'right' as const }
    const plate = evaluateAxis(elgt, req, settings)!
    const kit = evaluateAxis(elgt, { ...req, mainSlide: true }, settings)!
    expect(kit.guideFv).toBeGreaterThan(plate.guideFv)
    expect(kit.order.model).toBe(plate.order.model)
  })
})

describe('torque calculation', () => {
  it('matches the closed-form trapezoid result for a horizontal spindle', () => {
    const settings = { ...defaultSettings, friction: { spindle: 0, belt: 0 } }
    const axis: Axis = { ...spindle, noLoadTorque: 0 }
    const ev = evaluateAxis(axis, baseReq, settings)!
    const motor = { ...motors[0], inertia: 1, peakTorque: 100, ratedTorque: 100 } as Motor
    const drive = evaluateDrive(ev, motor, null, settings)

    const alpha = 5 * ((2 * Math.PI) / (axis.spindlePitch! / 1000))
    const jl = ev.inertia * 1e-4
    const expected = (jl / 0.9 + 1e-4) * alpha // Excel TMa with TL = 0
    expect(drive.peakTorque).toBeCloseTo(expected, 4)
    expect(drive.inertiaRatio).toBeCloseTo(ev.inertia / 1)
    expect(drive.maxMotorSpeed).toBeCloseTo((0.5 * 60000) / axis.spindlePitch!)
  })

  it('warns on constant-velocity torque above rated, fails in conservative mode', () => {
    // Process force keeps the constant segment loaded; a long dwell keeps the RMS torque low.
    const settings = { ...defaultSettings, externalForce: 300, dwellTime: 30 }
    const ev = evaluateAxis(spindle, baseReq, settings)!
    const constantTorque = (300 * spindle.spindlePitch!) / 1000 / (2 * Math.PI) / 0.9
    const motor = { ...motors[0], ratedTorque: constantTorque * 0.8, peakTorque: 100 } as Motor
    const constantCheck = (conservative: boolean) =>
      evaluateDrive(ev, motor, null, { ...settings, conservative }).checks.find((c) => c.label === '등속 구간 토크')!

    expect(constantCheck(false).status).toBe('warn')
    expect(constantCheck(false).value).toBeGreaterThan(constantTorque)
    expect(constantCheck(true).status).toBe('fail')
    expect(evaluateDrive(ev, motor, null, settings).checks.find((c) => c.label === '실효 토크')!.status).toBe('ok')

    const strong = { ...motor, ratedTorque: constantTorque * 2 } as Motor
    expect(evaluateDrive(ev, strong, null, { ...settings, conservative: true }).checks.find((c) => c.label === '등속 구간 토크')!.status).toBe('ok')
  })

  it('fails when the motor speed exceeds the gearbox max input speed', () => {
    const ev = evaluateAxis(spindle, baseReq, defaultSettings)!
    const motor = { ...motors[0], maxSpeed: 1e5, ratedSpeed: 1e5 } as Motor
    const base = gearboxes.find((g) => g.family === 'EMGA')!
    const speedCheck = (maxInputSpeed: number) => {
      const gearbox: Gearbox = { ...base, maxInputSpeed }
      const drive = evaluateDrive(ev, motor, gearbox, defaultSettings)
      return drive.checks.find((c) => c.label === '감속기 최대 입력 회전수')!
    }
    const speed = evaluateDrive(ev, motor, base, defaultSettings).maxMotorSpeed
    expect(speedCheck(speed * 1.1).status).toBe('ok')
    expect(speedCheck(speed * 0.9).status).toBe('fail')
    // the gearbox's own verdict (report): only its checks count; none without a gearbox
    expect(gearboxStatus(evaluateDrive(ev, motor, { ...base, maxInputSpeed: speed * 0.9 }, defaultSettings))).toBe('fail')
    expect(gearboxStatus(evaluateDrive(ev, motor, { ...base, maxInputSpeed: speed * 1.1, maxTorque: 1e6 }, defaultSettings))).toBe('ok')
    expect(gearboxStatus(evaluateDrive(ev, motor, null, defaultSettings))).toBeNull()
  })

  it('vertical axis needs holding torque during dwell', () => {
    const settings = { ...defaultSettings, dwellTime: 0.5 }
    const ev = evaluateAxis(spindle, { ...baseReq, mounting: 'vertical' }, settings)!
    const dwell = ev.samples.filter((s) => s.dir === 0)
    const holding = (ev.movingMass * G * ev.feed) / (2000 * Math.PI)
    expect(dwell[0].torque).toBeCloseTo(holding)
  })
})

describe('selection on real data', () => {
  it('finds passing axes and motors for a typical horizontal case', () => {
    const results = selectAxes(axes, baseReq, defaultSettings)
    const ok = results.filter((r) => r.status !== 'fail')
    expect(ok.length).toBeGreaterThan(0)
    expect(results.findIndex((r) => r.status === 'fail')).toBeGreaterThanOrEqual(ok.length)

    const drives = selectMotors(ok[0], motors, { ...defaultSettings, makers: ['Festo', 'Siemens', 'Mitsubishi'] })
    expect(drives[0].status).not.toBe('fail')
    expect(new Set(drives.filter((d) => d.status !== 'fail').map((d) => d.motor.maker)).size).toBe(3)
  })

  it('rejects axes when the stroke is too long', () => {
    const results = selectAxes(axes, { ...baseReq, stroke: 20000 }, defaultSettings)
    expect(results.every((r) => r.status === 'fail')).toBe(true)
  })

  it('brake filter keeps only brake motors', () => {
    const [first] = selectAxes(axes, { ...baseReq, mounting: 'vertical' }, defaultSettings)
    const drives = selectMotors(first, motors, { ...defaultSettings, requireBrake: true })
    expect(drives.every((d) => d.motor.brake)).toBe(true)
  })

  it('leaves out discontinued Mitsubishi HF motors and Apex PA gearboxes', () => {
    expect(motors.some((m) => m.family.startsWith('HF-'))).toBe(false)
    expect(gearboxes.some((g) => g.family === 'PA')).toBe(false)
    expect(gearboxes.some((g) => g.family === 'AE')).toBe(true)
  })

  it('loads ESBF ball screw axes with kits for their interface codes', () => {
    const esbf = axes.filter((a) => a.family === 'ESBF')
    expect(esbf.length).toBe(17)
    expect(new Set(esbf.map((a) => a.interfaceCode))).toEqual(new Set(['D32', 'D40', 'D50', 'D60', 'D80', 'D100']))
    for (const a of esbf) expect(kits.some((k) => k.axisCode === a.interfaceCode), a.id).toBe(true)
    expect(esbf.every((a) => a.baseMass < 20)).toBe(true)
    expect(esbf.every((a) => (a.screwDynamicLoadRating ?? 0) > 0)).toBe(true)
    expect(selectAxes(esbf, baseReq, { ...defaultSettings, externalGuide: true }).some((r) => r.status !== 'fail')).toBe(true)
    // The piston rod grows with the stroke: moving mass mb = mb0 + mb10 · stroke / 10.
    const esbf63 = esbf.find((a) => a.id === 'ESBF-BS-63-…-10P')!
    expect(evaluateAxis(esbf63, baseReq, defaultSettings)!.movingMass).toBeCloseTo(10 + 1.831 + 0.052 * 50)
  })

  it('limits ESBF by rod buckling and rod lateral force from the data sheet curves', () => {
    const esbf63 = axes.find((a) => a.id === 'ESBF-BS-63-…-10P')!
    const checkOf = (stroke: number, mounting: Requirements['mounting'] = 'floor') =>
      evaluateAxis(esbf63, { ...baseReq, stroke, mounting }, defaultSettings)!.checks
    const buckling = (stroke: number) => checkOf(stroke).find((c) => c.label === '압축력 (좌굴)')!
    expect(buckling(500).limit).toBe(7000)
    expect(buckling(1200).limit).toBeGreaterThan(1500)
    expect(buckling(1200).limit).toBeLessThan(1800)

    // 10 kg on the rod is far beyond the lateral force at 500 mm; an external guide takes it over.
    const lateral = checkOf(500).find((c) => c.label === '로드 횡하중 Fq')!
    expect(lateral.value).toBeCloseTo((10 + 1.831 + 0.052 * 50) * G)
    expect(lateral.status).toBe('fail')
    const guided = evaluateAxis(esbf63, baseReq, { ...defaultSettings, externalGuide: true })!
    expect(guided.checks.find((c) => c.label === '로드 횡하중 Fq')!.status).toBe('ok')
    expect(guided.status).not.toBe('fail')
    expect(checkOf(500).some((c) => c.label === '가이드 하중 비교값 fv')).toBe(false)
    expect(checkOf(500, 'vertical').find((c) => c.label === '로드 횡하중 Fq')!.status).toBe('ok')
  })

  it('press mode: approach, press move and hold carry the press force, the return does not', () => {
    const settings = { ...defaultSettings, friction: { spindle: 0, belt: 0 }, dwellTime: 0.2 }
    const axis: Axis = { ...spindle, noLoadTorque: 0 }
    const press = { ...defaultPress, enabled: true, force: 800, distance: 20, speed: 0.02, holdTime: 2 }
    const ev = evaluateAxis(axis, { ...baseReq, press }, settings)!

    expect(ev.press!.profile.moveTime).toBeGreaterThan(20 / 1000 / 0.02)
    const approach = moveProfile(0.48, 0.5, 5, 0, 1).moveTime
    const back = moveProfile(0.5, 0.5, 5, 0, -1).moveTime
    expect(ev.cycleTime).toBeCloseTo(approach + ev.press!.profile.moveTime + 2 + back + 0.2)

    const hold = ev.samples.filter((s) => s.v === 0 && s.a === 0 && s.load > 0)
    expect(hold.reduce((t, s) => t + s.dt, 0)).toBeCloseTo(2)
    expect(hold[0].force).toBeCloseTo(800)
    expect(Math.max(...ev.samples.filter((s) => s.move === 1).map((s) => Math.abs(s.force)))).toBeLessThan(800)

    const motor = { ...motors[0], ratedTorque: 0.5, peakTorque: 100 } as Motor
    const checks = evaluateDrive(ev, motor, null, settings).checks
    const pressTorque = (800 * axis.spindlePitch!) / 1000 / (2 * Math.PI) / 0.9
    expect(checks.find((c) => c.label === '가압 구간 토크')!.value).toBeCloseTo(pressTorque)
    // Travel moves only: the press force stays out of the constant-velocity torque
    expect(checks.find((c) => c.label === '등속 구간 토크')!.value).toBeLessThan(pressTorque / 2)
    expect(evaluateDrive(evaluateAxis(axis, baseReq, settings)!, motor, null, settings).checks.some((c) => c.label === '가압 구간 토크')).toBe(false)
    // Without a hold the press move alone is checked
    const noHold = evaluateAxis(axis, { ...baseReq, press: { ...press, holdTime: 0 } }, settings)!
    expect(evaluateDrive(noHold, motor, null, settings).checks.find((c) => c.label === '가압 구간 토크')!.value).toBeCloseTo(pressTorque)
  })

  it('vertical pressing: the weight adds to the press force bottom-up and helps top-down', () => {
    const settings = { ...defaultSettings, friction: { spindle: 0, belt: 0 } }
    const axis: Axis = { ...spindle, noLoadTorque: 0 }
    const run = (direction: 'up' | 'down') => {
      const req: Requirements = { ...baseReq, mounting: 'vertical', press: { ...defaultPress, enabled: true, force: 1000, direction } }
      const ev = evaluateAxis(axis, req, settings)!
      return { ev, hold: ev.samples.find((s) => s.v === 0 && s.a === 0 && s.load > 0)!.force, forward: verticalForward(req) }
    }
    const up = run('up')
    const down = run('down')
    expect([up.forward, down.forward]).toEqual(['up', 'down'])
    expect(up.hold).toBeCloseTo(1000 + up.ev.movingMass * G)
    expect(down.hold).toBeCloseTo(1000 - down.ev.movingMass * G)
    // Top-down, the return lifts the load: the return constant segment pushes the weight up (force + = forward = down).
    const returnConstant = down.ev.samples.find((s) => s.move === 1 && s.a === 0 && s.v !== 0)!
    expect(returnConstant.force).toBeCloseTo(-down.ev.movingMass * G)
    expect(verticalForward({ ...baseReq, mounting: 'vertical' })).toBe('up')
    expect(verticalForward({ ...baseReq, press: { ...defaultPress, enabled: true } })).toBe(null)
  })

  it('press force counts against ESBF buckling', () => {
    const esbf63 = axes.find((a) => a.id === 'ESBF-BS-63-…-10P')!
    const press = { ...defaultPress, enabled: true, force: 5000, distance: 10, speed: 0.01, holdTime: 1 }
    const buckling = (stroke: number) =>
      evaluateAxis(esbf63, { ...baseReq, stroke, press }, defaultSettings)!.checks.find((c) => c.label === '압축력 (좌굴)')!
    expect(buckling(400).status).toBe('ok')
    expect(buckling(1000).status).toBe('fail')
    expect(esbf63.screwDynamicLoadRating).toBeGreaterThan(0)
  })

  it('ESBF screw life ends after 10 million round trips and is flagged under 5000 km', () => {
    const esbf32 = axes.find((a) => a.id === 'ESBF-BS-32-…-5P')!
    const life = (stroke: number, payload: number) =>
      evaluateAxis(esbf32, { ...baseReq, stroke, payload, mounting: 'vertical' }, defaultSettings)!.info.find(
        (i) => i.label === '볼스크류 예상 수명',
      )!
    // 50 mm stroke, light load: 10 million round trips = 1000 km, well below the load-based life.
    const short = life(50, 0.1)
    expect(short.value).toBeCloseTo(1000)
    expect(short.note).toBe('약 {years}년 · 왕복 {cycles}회 한계')
    expect(short.alert).toBe(true)
    const long = life(800, 0.1)
    expect(long.value).toBeGreaterThan(5000)
    expect(long.alert).toBe(false)
  })

  it('orders ESBF at the entered stroke: standard part number when it is a standard stroke, else modular', () => {
    const esbf63 = axes.find((a) => a.id === 'ESBF-BS-63-…-10P')!
    expect(axisOrder(esbf63, 250)).toEqual({ model: 'ESBF-BS-63-250-10P', partNumber: '574090', stroke: 250, modular: true })
    expect(axisOrder(esbf63, 300)).toEqual({ model: 'ESBF-BS-63-300-10P', partNumber: '574098', stroke: 300, modular: false })
    expect(axisOrder(esbf63, 100).partNumber).toBe('574096')
    expect(axisOrder(esbf63, 512.3)).toEqual({ model: 'ESBF-BS-63-513-10P', partNumber: '574090', stroke: 513, modular: true })
    // Without order data the axis keeps its data model name
    const bare: Axis = { ...axes.find((a) => a.id === 'ELGT-TB-120')!, typeCode: null, strokePartNumbers: null, moduleNumber: null }
    expect(axisOrder(bare, 250)).toEqual({ model: bare.model, partNumber: null, stroke: null, modular: false })
    // Mass follows the ordered stroke: 250.4 mm is built as 251 mm.
    const ev = evaluateAxis(esbf63, { ...baseReq, stroke: 250.4 }, defaultSettings)!
    expect(ev.axisMass).toBeCloseTo(3.165 + 0.087 * 25.1)
  })

  it('orders ELGT, ELGD and EGC at the stroke the modular product system takes: standard part number when it is a standard stroke', () => {
    const order = (id: string, stroke: number) => axisOrder(axes.find((a) => a.id === id)!, stroke)
    expect(order('ELGT-BS-120-…10P', 280)).toEqual({ model: 'ELGT-BS-120-300-10P', partNumber: '8124451', stroke: 300, modular: false })
    // standard strokes start at 300, the modular system's fixed ones at 100
    expect(order('ELGT-BS-120-…10P', 100)).toEqual({ model: 'ELGT-BS-120-100-10P', partNumber: '8121225', stroke: 100, modular: true })
    expect(order('ELGT-BS-160-…20P', 230).model).toBe('ELGT-BS-160-250-20P')
    // ELGT modular strokes come in fixed steps
    expect(order('ELGT-BS-120-…10P', 1050)).toEqual({ model: 'ELGT-BS-120-1100-10P', partNumber: '8121225', stroke: 1100, modular: true })
    // ELGD and EGC take any whole mm in their variable range
    expect(order('ELGD-BS-KF-60-…10P', 120)).toEqual({ model: 'ELGD-BS-KF-60-120-0H-10P', partNumber: '8176874', stroke: 120, modular: true })
    expect(order('ELGD-BS-KF-60-…10P', 200).partNumber).toBe('8192261')
    // Long slide: no standard strokes, any whole mm
    expect(order('ELGD-BS-KF-80-…10P-L', 512.3)).toEqual({ model: 'ELGD-BS-KF-80-513-0H-10P-L', partNumber: '8176875', stroke: 513, modular: true })
    expect(order('ELGD-TB-KF-WD-100-…-L', 2100).model).toBe('ELGD-TB-KF-WD-100-2100-0H-L-PU2')
    expect(order('EGC-80-...-TB-KF-GK', 300).model).toBe('EGC-80-300-TB-KF-0H-GK')
    expect(order('ELGD-TB-KF-WD-100-…-L', 450).model).toBe('ELGD-TB-KF-WD-100-450-0H-L-PU2')
    // Standard stroke only: the next standard stroke above, modular when none is long enough
    const std = (id: string, stroke: number) => axisOrder(axes.find((a) => a.id === id)!, stroke, null, true)
    expect(std('ELGD-BS-KF-60-…10P', 120)).toMatchObject({ partNumber: '8192261', stroke: 200, modular: false })
    expect(std('ELGD-BS-KF-80-…10P-L', 512.3).modular).toBe(true)
    // Above the variable range only the fixed strokes are left: EGC-70-BS takes 50…980 or 1000
    expect(order('EGC-70-...-BS-10P-KF-GK', 990)).toEqual({ model: 'EGC-70-1000-BS-10P-KF-0H-ML-GK', partNumber: '556807', stroke: 1000, modular: true })
    expect(order('EGC-HD-160-…-BS-20P-GK', 30).model).toBe('EGC-HD-160-50-BS-20P-0H-GK')
    // ELGT-TB (customer solution): a part number per stroke, 50 mm steps up to 1000, then 100 mm
    expect(order('ELGT-TB-160', 1020)).toEqual({ model: 'ELGT-TB-160-1100-CS', partNumber: '8194369', stroke: 1100, modular: false })
  })

  it('reads the ball screw max speed from the speed-stroke curve at the built stroke', () => {
    const speed = (id: string, stroke: number) =>
      evaluateAxis(axes.find((a) => a.id === id)!, { ...baseReq, stroke, velocity: 0.3 }, defaultSettings)!.checks.find((c) => c.label === '속도')!
    expect(speed('ELGT-BS-90-…10P', 500).limit).toBe(0.5)
    expect(speed('ELGT-BS-90-…10P', 500).note).toBeUndefined()
    // ELGT-BS-90-10P: about 0.27 m/s at 1000 mm (data sheet curve)
    const long = speed('ELGT-BS-90-…10P', 1000)
    expect(long.limit).toBeCloseTo(0.267, 2)
    expect(long.status).toBe('fail')
    expect(long.noteArgs).toEqual({ stroke: 1000, max: 0.5 })
    // A long slide shortens the working stroke the curve allows: ELGD-60 by 42 mm
    const std = speed('ELGD-BS-KF-60-…5P', 600).limit!
    expect(speed('ELGD-BS-KF-60-…5P-L', 600).limit).toBeLessThan(std)
    expect(speed('ELGD-BS-KF-60-…5P-L', 558).limit).toBeCloseTo(std, 3)
    // ESBF orders 250 mm as 250 mm: the curve is read there
    expect(speed('ESBF-BS-32-…-5P', 250).limit).toBe(0.55)
  })

  it('limits the ELGD-BS feed force by screw buckling above a stroke', () => {
    const fx = (id: string, stroke: number) =>
      evaluateAxis(axes.find((a) => a.id === id)!, { ...baseReq, stroke, velocity: 0.1 }, defaultSettings)!.checks.find((c) => c.label === '이송력 Fx')!
    expect(fx('ELGD-BS-KF-60-…5P', 400).limit).toBe(1550)
    expect(fx('ELGD-BS-KF-60-…5P', 400).note).toBeUndefined()
    // ELGD-60: about 340 N left at 1000 mm (data sheet p.16)
    expect(fx('ELGD-BS-KF-60-…5P', 1000).limit).toBeCloseTo(338, -1)
    expect(fx('ELGD-BS-KF-60-…5P', 1000).noteArgs).toEqual({ stroke: 1000, max: 1550 })
    // The long slide buckles earlier
    expect(fx('ELGD-BS-KF-60-…5P-L', 600).limit!).toBeLessThan(fx('ELGD-BS-KF-60-…5P', 600).limit!)
  })

  it('releases ELGT-TB for horizontal mounting only', () => {
    const mount = (mounting: Requirements['mounting']) =>
      evaluateAxis(axes.find((a) => a.id === 'ELGT-TB-120')!, { ...baseReq, mounting }, defaultSettings)!.checks.find((c) => c.label === '설치 방향')
    expect(mount('floor')).toBeUndefined()
    expect(mount('wall')?.status).toBe('warn')
    expect(mount('vertical')?.status).toBe('fail')
  })

  it('curveAt interpolates and clamps', () => {
    const curve: [number, number][] = [[0, 10], [100, 10], [200, 4]]
    expect(curveAt(curve, 50)).toBe(10)
    expect(curveAt(curve, 150)).toBe(7)
    expect(curveAt(curve, 500)).toBe(4)
  })

  it('offers Apex gearboxes to HG-KR/HG-SR (same interface as HF-KP/HF-SP)', () => {
    const fits = (model: string) => gearboxOptionsFor(motors.find((m) => m.model === model)!).map((g) => g.id)
    expect(fits('HG-KR13')).toContain('AB042-3')
    expect(fits('HG-SR102').length).toBeGreaterThan(0)
    expect(fits('HG-SR102B')).toEqual(fits('HG-SR102'))
    // "SR102" does not name the 400 V HG-SR1024
    expect(fits('HG-SR1024')).toEqual([])
    // The gearbox input side must take the motor's mounting interface.
    for (const m of motors.filter((x) => x.maker === 'Mitsubishi'))
      for (const g of gearboxOptionsFor(m)) if (g.driveCode) expect(g.driveCode, `${m.model} ${g.id}`).toBe(m.interfaceCode)
  })

  it('checks direct drive only, or each motor with its best gearbox, lowest ratio among equals', () => {
    const [first] = selectAxes(axes, baseReq, defaultSettings)
    const direct = selectMotors(first, motors, defaultSettings)
    expect(direct.every((d) => d.gearbox === null)).toBe(true)

    const rank = { ok: 0, warn: 1, fail: 2 }
    const geared = selectMotors(first, motors, { ...defaultSettings, useGearbox: true })
    expect(geared.length).toBeGreaterThan(0)
    expect(geared.every((d) => d.gearbox !== null)).toBe(true)
    for (const d of geared) {
      for (const g of gearboxOptionsFor(d.motor)) {
        const s = rank[evaluateDrive(first, d.motor, g, defaultSettings).status]
        if (g.ratio < d.gearbox!.ratio) expect(s).toBeGreaterThan(rank[d.status])
        else expect(s).toBeGreaterThanOrEqual(rank[d.status])
      }
    }
  })

  it('prefers a higher ratio that fits over a lower one that only warns (e.g. no kit)', () => {
    const [first] = selectAxes(axes, baseReq, defaultSettings)
    const settings = { ...defaultSettings, useGearbox: true }
    const motor = motors.find((m) => gearboxOptionsFor(m).length >= 2)!
    const lowest = gearboxOptionsFor(motor)[0]
    // The lowest ratio has no kit (warn), every other ratio fits
    const [picked] = selectMotors(first, [motor], { ...settings, makers: [motor.maker], requireBrake: false }, (d) =>
      ({ ...d, status: d.gearbox?.id === lowest.id ? 'warn' : 'ok' }),
    )
    expect(picked.status).toBe('ok')
    expect(picked.gearbox!.id).not.toBe(lowest.id)
  })
})
