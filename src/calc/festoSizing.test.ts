// The app's sizing against Festo's Electric Motion Sizing reports (2026-11-14, folder Ref): the same axis, motor,
// gearbox and kit under the same motion. The app keeps the Excel's friction term (μ·m·g) and drive efficiency on top
// of the data sheet no-load torque, so its torques sit at or above Festo's; `peak` / `rms` hold each case's ratio to
// Festo's value: about 1.3 to 1.5 on the small motors, where μ·m·g weighs most. The EMGA idle torque comes from these
// reports (`Gearbox.idleTorque`, one per size): without friction and efficiency the app gives Festo's torques.
// Known gap: EGC guide utilisation (Festo 96 %, the app 84 % with the spindle axis depth in the lever; the data sheet
// refers the torques to the slide surface, which gives 58 %).
import { describe, expect, it } from 'vitest'
import { axes, brakingResistors, cables, controllers, gearboxes, kits, motors } from '../data'
import { evaluateAxis, PRESS_LOAD_FACTOR, type AxisEvaluation, type AxisSample } from './axisSelection'
import { selectController } from './controllerSelection'
import { evaluateKit } from './kitSelection'
import { dwellPhase, moveProfile, samplePhases, type Phase } from './motionProfile'
import { evaluateDrive } from './motorSelection'
import { defaultPress, defaultSettings, type Requirements, type Settings } from './types'

const find = <T extends { id: string }>(list: T[], id: string) => {
  const item = list.find((x) => x.id === id)
  if (!item) throw new Error(`no ${id}`)
  return item
}

interface Case {
  name: string
  axis: string
  motor: string
  gearbox: string | null
  kit: string
  req: Requirements
  /** s per cycle (Festo pauses after every move) */
  dwell: number
  /** Festo's records where its optimiser picked each move's speed and acceleration: [mm, m/s, m/s², N] */
  moves?: [number, number, number, number][]
  /** the app's torque over Festo's, [from, to] */
  peak: [number, number]
  rms: [number, number]
  tolerance?: { inertia?: number; force?: number }
  /** lowest guide utilisation the app may give where it stays under Festo's */
  guideMin?: number
  festo: { rpm: number; peak: number; rms: number; current: number; force: number; inertiaRatio: number; cycle: number; guideMax?: number; lifeKm?: number }
}

const floor = (stroke: number, payload: number, acceleration: number, jerk: number): Requirements => ({
  stroke,
  velocity: 0.5,
  acceleration,
  jerk,
  payload,
  cog: { x: 0, y: 0, z: 50 },
  mounting: 'floor',
})

const pressing = (force: number, jerk: number): Requirements => ({
  stroke: 400,
  velocity: 0.26,
  acceleration: 3.75,
  jerk,
  payload: 5,
  cog: { x: 0, y: 0, z: 0 },
  mounting: 'vertical',
  press: { ...defaultPress, enabled: true, force, distance: 200, speed: 0.1, holdTime: 0, direction: 'down' },
})

const cases: Case[] = [
  {
    name: 'ELGD-TB-KF-WD-100, 10 kg, EMMB-AS-40-01 + EMGA i=8',
    axis: 'ELGD-TB-KF-WD-100-…-L',
    motor: 'EMMB-AS-40-01',
    gearbox: 'EMGA-40-P-G8-EAS-40',
    kit: 'EAMM-A-L38-40G-G2|L38|40G',
    req: floor(500, 10, 2, 415),
    dwell: 0.4,
    // Festo's moving mass is 1.08 kg, the data sheet's 1.36 kg
    peak: [1.45, 1.55],
    rms: [1.5, 1.6],
    tolerance: { inertia: 0.03, force: 0.03 },
    festo: { rpm: 2856.93, peak: 0.16, rms: 0.11, current: 0.59, force: 22.16, inertiaRatio: 6.65, cycle: 2.91, guideMax: 0.04 },
  },
  {
    name: 'EGC-80-BS-20P, 100 kg, EMMT-AS-80-L-LS',
    axis: 'EGC-80-...-BS-20P-KF-GK',
    motor: 'EMMT-AS-80-L-LS',
    gearbox: null,
    kit: 'EAMM-A-S48-80P|S48|80P',
    req: floor(1000, 100, 5, 129),
    dwell: 0.4,
    peak: [1.25, 1.4],
    rms: [1.4, 1.6],
    guideMin: 0.8,
    festo: { rpm: 1500, peak: 2.27, rms: 0.65, current: 4.28, force: 503.68, inertiaRatio: 8.44, cycle: 4.68, guideMax: 0.96, lifeKm: 10000 },
  },
  {
    name: 'ELGT-BS-120-20P, 100 kg, EMMT-AS-80-L-LS',
    axis: 'ELGT-BS-120-…20P',
    motor: 'EMMT-AS-80-L-LS',
    gearbox: null,
    kit: 'EAMM-A-T46-80P|T46-120|80P',
    req: floor(1000, 100, 5, 157),
    dwell: 0.4,
    peak: [1.12, 1.25],
    rms: [1.12, 1.25],
    festo: { rpm: 1500, peak: 2.19, rms: 0.62, current: 4.14, force: 510.1, inertiaRatio: 8.27, cycle: 4.66, guideMax: 0.27, lifeKm: 10000 },
  },
  {
    name: 'ELGT-BS-90-20P, 10 kg, EMMB-AS-60-02',
    axis: 'ELGT-BS-90-…20P',
    motor: 'EMMB-AS-60-02',
    gearbox: null,
    kit: 'EAMM-A-T46-60P|T46-90|60P',
    req: floor(500, 10, 2, 300),
    dwell: 0.4,
    peak: [0.97, 1.06],
    rms: [0.95, 1.06],
    tolerance: { force: 0.01 },
    festo: { rpm: 1500, peak: 0.35, rms: 0.24, current: 0.74, force: 23.28, inertiaRatio: 7.54, cycle: 2.91, guideMax: 0.05, lifeKm: 10000 },
  },
  {
    name: 'EGC-50-TB, 10 kg, EMMB-AS-40-01 + EMGA i=5',
    axis: 'EGC-50-...-TB-KF-GK',
    motor: 'EMMB-AS-40-01',
    gearbox: 'EMGA-40-P-G5-EAS-40',
    kit: 'EAMM-A-L27-40G|L27|40G',
    req: floor(500, 10, 2, 92),
    dwell: 0.4,
    peak: [1.3, 1.4],
    rms: [1.22, 1.32],
    guideMin: 0.3,
    festo: { rpm: 2586.48, peak: 0.14, rms: 0.1, current: 0.54, force: 20.26, inertiaRatio: 7.22, cycle: 2.94, guideMax: 0.32 },
  },
  {
    name: 'EGC-120-TB, 10 kg, EMMB-AS-60-04 + EMGA-60 i=5',
    axis: 'EGC-120-…-TB-KF-GK',
    motor: 'EMMB-AS-60-04',
    gearbox: 'EMGA-60-P-G5-EAS-60',
    kit: 'EAMM-A-L62-60H|L62|60H',
    req: floor(500, 10, 2, 1000),
    dwell: 0.4,
    peak: [1.28, 1.36],
    rms: [1.3, 1.38],
    festo: { rpm: 1199.96, peak: 0.53, rms: 0.38, current: 0.94, force: 24.42, inertiaRatio: 6.53, cycle: 2.9, guideMax: 0.02 },
  },
  {
    name: 'EGC-185-TB, 10 kg, EMMB-AS-80-07 + EMGA-80 i=8',
    axis: 'EGC-185-...-TB-KF-GK',
    motor: 'EMMB-AS-80-07',
    gearbox: 'EMGA-80-P-G8-EAS-80',
    kit: 'EAMM-A-L95-80G-G2|L95|80G',
    req: floor(500, 10, 2, 575),
    dwell: 0.4,
    peak: [1.27, 1.35],
    rms: [1.28, 1.36],
    festo: { rpm: 1034.46, peak: 1.02, rms: 0.72, current: 1.54, force: 33.09, inertiaRatio: 6.76, cycle: 2.91, guideMax: 0.01 },
  },
  {
    name: 'EGC-185-BS-40P, 10 kg, EMMT-AS-150-M-HV + EMGA-120 i=3',
    axis: 'EGC-185-...-BS-40P-KF-GK',
    motor: 'EMMT-AS-150-M-HV',
    gearbox: 'EMGA-120-P-G3-SAS-140',
    kit: 'EAMM-A-S95-120G|S95|120G',
    req: floor(500, 10, 2, 300),
    dwell: 0.4,
    peak: [1.0, 1.1],
    rms: [1.0, 1.1],
    festo: { rpm: 2250, peak: 5.68, rms: 2.84, current: 4.3, force: 37.22, inertiaRatio: 1.14, cycle: 2.91, guideMax: 0.02 },
  },
  {
    name: 'pressing 10 kN: ESBF-BS-100-400-40P, EMMT-AS-100-L-HS-B + EMGA i=8',
    axis: 'ESBF-BS-100-…-40P',
    motor: 'EMMT-AS-100-L-HS-B',
    gearbox: 'EMGA-120-P-G8-SAS-100',
    kit: 'EAMM-A-D100-120G|D100|120G',
    req: pressing(10000, 492),
    dwell: 1,
    moves: [
      [200, 0.25641, 3.75162, 0],
      [200, 0.1, 7.01427, 10000],
      [-400, 0.26111, 2.7252, 0],
    ],
    peak: [1.0, 1.1],
    rms: [1.03, 1.12],
    festo: { rpm: 3133.32, peak: 17.13, rms: 5.27, current: 11.12, force: 9946.7, inertiaRatio: 1.22, cycle: 5.52, lifeKm: 4526 },
  },
  {
    name: 'pressing 5 kN: ESBF-BS-63-400-10P, EMMT-AS-80-L-HS-B + EMGA i=3',
    axis: 'ESBF-BS-63-…-10P',
    motor: 'EMMT-AS-80-L-HS-B',
    gearbox: 'EMGA-80-P-G3-EAS-80',
    kit: 'EAMM-A-D60-80G-G2|D60|80G',
    req: pressing(5000, 300),
    dwell: 1,
    moves: [
      [200, 0.23703, 8.43255, 0],
      [200, 0.1, 5.47723, 5000],
      [-400, 0.31363, 3.45521, 0],
    ],
    peak: [1.03, 1.12],
    rms: [1.05, 1.14],
    festo: { rpm: 5645.43, peak: 6.08, rms: 2.0, current: 7.42, force: 4961.39, inertiaRatio: 1.51, cycle: 5.31, lifeKm: 1808 },
  },
]

const allOn: Settings = { ...defaultSettings, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'] }

/** Festo's own records as phases: each move with its speed and acceleration, the cycle's pause at the end */
function recordSamples(ev: AxisEvaluation, c: Case): { samples: AxisSample[]; cycle: number } {
  const phases: Phase[] = []
  const moveOf: number[] = []
  c.moves!.forEach(([mm, v, a, load], i) => {
    for (const p of moveProfile(Math.abs(mm) / 1000, v, a, c.req.jerk, mm > 0 ? 1 : -1).phases) {
      phases.push(load ? { ...p, load } : p)
      moveOf.push(i)
    }
  })
  phases.push(dwellPhase(c.dwell))
  moveOf.push(-1)
  const samples = samplePhases(phases, (i) => moveOf[i]).map((s) => ({ ...s, ...ev.driveAt(s.v, s.a, s.dir, s.load) }))
  return { samples, cycle: phases.reduce((t, p) => t + p.duration, 0) }
}

function run(c: Case) {
  const settings = { ...allOn, dwellTime: c.dwell }
  const axis = find(axes, c.axis)
  const motor = find(motors, c.motor)
  const gearbox = c.gearbox ? find(gearboxes, c.gearbox) : null
  const kit = find(kits, c.kit)
  let ev = evaluateAxis(axis, c.req, settings)!
  if (c.moves) {
    const { samples, cycle } = recordSamples(ev, c)
    ev = { ...ev, samples, cycleTime: cycle, peakVelocity: Math.max(...c.moves.map((m) => m[1])) }
  }
  const drive = evaluateDrive(ev, motor, gearbox, settings)
  const kitEval = evaluateKit(ev, drive, kit, settings)
  const value = (label: string) => kitEval.checks.find((k) => k.label === label)!.value
  const moving = ev.samples.filter((s) => s.dir !== 0)
  return {
    ev,
    drive,
    cycle: ev.cycleTime,
    rpm: drive.maxMotorSpeed,
    peak: value('최대 토크 (키트 포함)'),
    rms: value('실효 토크 (키트 포함)'),
    inertiaRatio: value('관성비 (키트 포함)'),
    force: Math.max(...moving.map((s) => Math.abs(s.force))),
    controller: selectController(ev, drive, settings, { controllers, resistors: brakingResistors, cables }),
  }
}

describe('Festo Electric Motion Sizing reports', () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = run(c)
      const f = c.festo
      const within = (app: number, festo: number, tolerance: number, what: string) =>
        expect(Math.abs(app / festo - 1), `${what}: app ${app}, Festo ${festo}`).toBeLessThan(tolerance)
      const between = (app: number, festo: number, [lo, hi]: [number, number], what: string) => {
        expect(app / festo, `${what}: app ${app}, Festo ${festo}`).toBeGreaterThanOrEqual(lo)
        expect(app / festo, `${what}: app ${app}, Festo ${festo}`).toBeLessThanOrEqual(hi)
      }
      // the same motion: jerk-limited profile, cycle and motor speed
      within(r.cycle, f.cycle, 0.003, 'cycle time')
      within(r.rpm, f.rpm, 0.001, 'motor speed')
      // Festo's 질량 관성 비율 is (JL + JM) / JM
      within(r.inertiaRatio + 1, f.inertiaRatio, c.tolerance?.inertia ?? 0.01, 'inertia ratio')
      // Festo's 필요 가용 힘 has no friction term: the app's is μ·m·g above it
      const friction = allOn.friction[r.ev.axis.drive] * r.ev.movingMass * 9.81
      within(r.force - friction, f.force, c.tolerance?.force ?? 0.005, 'feed force')
      between(r.peak, f.peak, c.peak, 'peak torque')
      between(r.rms, f.rms, c.rms, 'rms torque')
      // motor current per torque
      within(r.controller!.peakCurrent / r.drive.peakTorque, f.current / f.peak, 0.04, 'current per torque')
      // the guide: at or above Festo's where the data sheet gives the guide centre
      // EGC stays under Festo with the drive axis depth as lever (`guideMin`): 84 % for 96 %, 30.7 % for 32 %
      const guideMin = c.guideMin ?? (f.guideMax ?? 0) - 0.005
      if (f.guideMax != null && r.ev.axis.guideCentre != null) expect(r.ev.guideFv).toBeGreaterThanOrEqual(guideMin)
      // ball screw life: Festo's is the data sheet's (fw = 1), the app's has the press-in coefficient
      const life = r.ev.info.find((i) => i.label === '볼스크류 예상 수명')?.value
      if (c.moves && life != null) within(life * PRESS_LOAD_FACTOR ** 3, f.lifeKm!, 0.015, 'screw life')
    })
  }
})
