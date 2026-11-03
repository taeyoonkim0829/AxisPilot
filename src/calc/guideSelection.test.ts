import { describe, expect, it } from 'vitest'
import { axes, guides } from '../data'
import { evaluateAxis, G } from './axisSelection'
import { cylinderGuideFor, eagfLoads, guideAxisFor, guideFv } from './guideSelection'
import { defaultParallel, defaultSettings as appDefaults, type Requirements } from './types'

const settings = { ...appDefaults, families: ['ELGT', 'ELGD', 'EGC', 'ESBF'], drives: ['spindle', 'belt'] } satisfies typeof appDefaults
const req: Requirements = { stroke: 200, velocity: 0.3, acceleration: 2, jerk: 0, payload: 5, cog: { x: 15, y: 0, z: 0 }, mounting: 'floor' }
const esbf = axes.find((a) => a.id === 'ESBF-BS-32-…-5P')!

describe('EAGF guide unit', () => {
  it('reproduces Festo calculation example (EAGF-V2-KF-32-200, 5 kg at 15 mm, a = 2 m/s²)', () => {
    const fit = cylinderGuideFor(esbf, 200, guides)!
    expect(fit.model).toBe('EAGF-V2-KF-32-200')
    expect(fit.partNumber).toBe('2782818')
    expect(fit.movingMass).toBeCloseTo(1.084)
    const m = 5 + fit.movingMass
    const loads = eagfLoads(fit, 5, req.cog, 200, { travel: m * 2, lateral: m * 2, normal: m * G })
    // Lb_total = (15·5 − 112·1.084) / 6.084 = −7.6 mm; My = 60 N × (83 + 200 − 7.6) mm
    expect(loads.Fz).toBeCloseTo(59.7, 1)
    expect(loads.My).toBeCloseTo(59.7 * 0.2754, 1)
    expect(loads.Mz).toBeCloseTo(12.17 * 0.2754, 1)
    expect(guideFv(loads, fit.guide)).toBeCloseTo(0.68, 2)
    // a stroke without a standard part number takes the module number
    expect(cylinderGuideFor(esbf, 250, guides)!.partNumber).toBe('3038083')
  })

  it('checks the EAGF instead of the rod lateral force when the external guide is on', () => {
    const ev = evaluateAxis(esbf, req, { ...settings, externalGuide: true }, [], guides)!
    expect(ev.guide?.guide.family).toBe('EAGF')
    expect(ev.checks.find((c) => c.label === '가이드 유닛 하중 비교값 fv')!.status).toBe('ok')
    expect(ev.checks.find((c) => c.label === '로드 횡하중 Fq')!.limit).toBeNull()
    // its moving mass moves with the rod, its displacement force adds to the resistance
    const plain = evaluateAxis(esbf, req, { ...settings, externalGuide: false }, [], guides)!
    expect(plain.guide).toBeNull()
    expect(ev.movingMass - plain.movingMass).toBeCloseTo(ev.guide!.movingMass)
    // beyond its 500 mm stroke the EAGF fails
    const long = evaluateAxis(esbf, { ...req, stroke: 600 }, { ...settings, externalGuide: true }, [], guides)!
    expect(long.checks.find((c) => c.label === '가이드 유닛 스트로크')!.status).toBe('fail')
  })
})

describe('guide axes beside the drive axis', () => {
  const parallel = { ...defaultParallel, mode: 'guides' as const, spacing: 300, guideCount: 2, guideAxis: true }

  it('takes EGC-FA beside EGC and ELFD beside ELGD, by slide', () => {
    const egc = axes.find((a) => a.id === 'EGC-80-...-TB-KF-GK')!
    expect(guideAxisFor(egc, 500, 2, guides)!.model).toBe('EGC-80-500-FA-0H-GK')
    const gv = guideAxisFor(axes.find((a) => a.id === 'EGC-80-...-TB-KF-GV')!, 500, 1, guides)!
    expect(gv.otherSlide).toBe(true)
    const long = guideAxisFor(axes.find((a) => a.id === 'ELGD-TB-KF-80-…-L')!, 500, 1, guides)!
    expect(long.model).toBe('ELFD-KF-80-500-0H-L')
    expect(long.otherSlide).toBe(false)
    expect(guideAxisFor(axes.find((a) => a.family === 'ELGT')!, 500, 1, guides)).toBeNull()
  })

  it('adds the guide slides to the moved mass and checks the most loaded guide axis', () => {
    const elgd = axes.find((a) => a.id === 'ELGD-TB-KF-80')!
    const r = { ...req, stroke: 500, payload: 20, cog: { x: 0, y: 0, z: 0 }, parallel }
    const ev = evaluateAxis(elgd, r, settings, [], guides)!
    expect(ev.guide?.model).toBe('ELFD-KF-80-500-0H')
    expect(ev.guide?.count).toBe(2)
    expect(ev.layout.guideMass).toBeCloseTo(2 * 0.911)
    expect(ev.checks.find((c) => c.label === '가이드 축 하중 비교값 fv')!.status).toBe('ok')
    const lm = evaluateAxis(elgd, { ...r, parallel: { ...parallel, guideAxis: false } }, settings, [], guides)!
    expect(lm.guide).toBeNull()
    expect(lm.movingMass).toBeLessThan(ev.movingMass)
  })
})
