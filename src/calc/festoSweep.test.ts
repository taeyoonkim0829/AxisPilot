// The app against Festo's Electric Motion Sizing for every axis family it offers, floor and vertical (festo/sweep.json:
// the same move, Festo's recommended axis, motor and kit per family and technology, read from festo.com). Festo's own
// model has no μ·m·g and no efficiency on top of the no-load torque, so the app's torques sit at or above Festo's
// (1.1 to 2.7 ×; ELGD-BS-KF-WD-100-10P under it, below). Festo adds the EMMB-AS motors' own friction
// (`Motor.frictionPerRpm`); without it the app fell under Festo's torque on the cases with an EMMB motor.
import { describe, expect, it } from 'vitest'
import { axes, brakingResistors, cables, controllers, kits, motors } from '../data'
import { evaluateAxis } from './axisSelection'
import { selectController } from './controllerSelection'
import sweep from './festo/sweep.json'
import { evaluateKit } from './kitSelection'
import { evaluateDrive } from './motorSelection'
import { defaultSettings, type Mounting, type Requirements, type Settings } from './types'

const norm = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase()

function partsOf(c: (typeof sweep.cases)[number]) {
  const settings: Settings = {
    ...defaultSettings,
    families: ['ELGT', 'ELGD', 'EGC', 'ESBF'],
    drives: ['spindle', 'belt'],
    dwellTime: 0.4,
    spindleSupport: /-SU-/.test(c.axis),
  }
  const req: Requirements = { stroke: 500, velocity: 0.5, acceleration: 2, jerk: c.jerk, payload: 10, cog: { x: 0, y: 0, z: c.cogZ }, mounting: c.mounting as Mounting }
  const family = c.axis.split('-')[0]
  const found = axes.filter((a) => a.family === family).map((a) => evaluateAxis(a, req, settings)).find((ev) => ev && norm(ev.order.model) === norm(c.axis))
  // EMMB-AS-60-02-S30M(B), EMMT-AS-80-S-LS-RM(B), EMMT-AS-150-M-HS-R2M(B): the app's id, -B with a brake
  const motorId = c.motor.replace(/-(S30|R2?)MB?$/, '') + (/MB$/.test(c.motor) ? '-B' : '')
  const motor = motors.find((m) => m.id === motorId)
  const kit = found && motor ? kits.find((k) => [c.kit, c.kit.replace(/-G\d$/, '')].some((n) => k.id.startsWith(n + '|')) && k.axisCode === found.axis.interfaceCode && k.motorCode === motor.interfaceCode) : undefined
  return { settings, ev: found, motor, kit }
}

describe('Festo Electric Motion Sizing: every axis family, floor and vertical', () => {
  for (const c of sweep.cases) {
    const key = `${c.axis}|${c.mounting}`
    it(key, () => {
      const { settings, ev, motor, kit } = partsOf(c)
      expect(ev, `axis ${c.axis}`).toBeTruthy()
      expect(motor, `motor ${c.motor}`).toBeTruthy()
      expect(kit, `kit ${c.kit}`).toBeTruthy()
      const drive = evaluateDrive(ev!, motor!, null, settings)
      const k = evaluateKit(ev!, drive, kit!, settings)
      const v = (label: string) => k.checks.find((x) => x.label === label)!.value
      const within = (app: number, festo: number, tol: number, what: string) => expect(Math.abs(app / festo - 1), `${what}: app ${app}, Festo ${festo}`).toBeLessThan(tol)
      // the same motion
      within(ev!.cycleTime, c.cycle, 0.005, 'cycle time')
      within(drive.maxMotorSpeed, c.rpm, 0.005, 'motor speed')
      // Festo's 질량 관성 비율 is (JL + JM) / JM
      within(v('관성비 (키트 포함)') + 1, c.inertiaRatio, 0.1, 'inertia ratio')
      const ctl = selectController(ev!, drive, settings, { controllers, resistors: brakingResistors, cables })!
      within(ctl.peakCurrent / drive.peakTorque, c.current / c.peak, 0.03, 'current per torque')
      // at or above Festo's torque, but ELGD-BS-KF-WD-100-10P: the data sheet's no-load torque 0.077 Nm is under the
      // about 0.2 Nm Festo's tool takes, so the app falls to 0.6 to 0.9 × Festo's (data sheet kept, the user's decision)
      const min = /^ELGD-BS-KF-WD-100-.*-10P/.test(c.axis) ? 0.55 : 1
      expect(v('최대 토크 (키트 포함)') / c.peak, 'peak torque').toBeGreaterThanOrEqual(min)
      expect(v('실효 토크 (키트 포함)') / c.rms, 'rms torque').toBeGreaterThanOrEqual(min)
      // the guide: ELGT / ELGD at or above Festo's; EGC (drive axis depth as lever) at least 80 % of it
      if (c.guideMax != null && ev!.axis.family !== 'ESBF') {
        const min = ev!.axis.family === 'EGC' ? 0.8 * c.guideMax : c.guideMax - 0.005
        expect(ev!.guideFv, 'guide').toBeGreaterThanOrEqual(min)
      }
    })
  }
})
