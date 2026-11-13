import { describe, expect, it } from 'vitest'
import { axes, motors, thirdPartyAxes } from '../data'
import { axisCandidates, axisSpecRows, COMPARE_AXIS_FAMILIES, motorCandidates, motorSpecRows, supplyOf } from './compare'

describe('제품 비교', () => {
  it('reads the Robostar catalog rows (ball screw and belt types, no linear motor RF)', () => {
    expect(thirdPartyAxes.length).toBeGreaterThan(350)
    expect(thirdPartyAxes.some((a) => a.series === 'RF')).toBe(false)
    const rs = thirdPartyAxes.find((a) => a.model === 'RS-120-X20SS')!
    expect(rs).toMatchObject({ strokeMin: 100, strokeMax: 1000, maxSpeed: 1, payload: [25, 25], motorPower: 200, screwDiameter: 15, screwLead: 20 })
    for (const a of thirdPartyAxes) {
      expect(a.strokeMax).toBeGreaterThan(a.strokeMin)
      expect(a.maxSpeed).toBeGreaterThan(0)
      expect(a.drive === 'spindle' ? a.payload && a.screwLead : a.maxPayload).toBeTruthy()
    }
  })

  it('lists the Festo axes closest to a Robostar axis first, the data against it', () => {
    const rs = thirdPartyAxes.find((a) => a.model === 'RS-120-X20SS')!
    const list = axisCandidates(rs, axes, { drive: 'spindle', families: COMPARE_AXIS_FAMILIES, atLeast: true })
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((a) => a.drive === 'spindle' && a.maxStroke >= 1000 && a.maxSpeed >= 1 && a.family !== 'ESBF')).toBe(true)
    expect(list[0].spindlePitch).toBe(20)
    const elgt = axes.find((a) => a.id === 'ELGT-BS-120-…20P')!
    const rows = axisSpecRows(rs, elgt)
    expect(rows.find((r) => r.label === '최대 스트로크')!.ratio).toBeCloseTo(1000 / 1100)
    expect(rows.find((r) => r.label === '볼스크류 리드')!.ratio).toBe(1)
    // a payload in kg is not put on one scale with forces in N
    expect(rows.find((r) => r.label === '하중 정격')!.ratio).toBeNull()
  })

  it('lists Festo motors for another maker’s motor by torque, filtered by supply, power and interface', () => {
    const ref = motors.find((m) => m.model === '1FK2104-4AF0')!
    const all = motorCandidates(ref, motors, { families: ['EMMT-AS', 'EMMB-AS'], supply: null, samePower: true, sameInterface: false })
    expect(all.every((m) => m.maker === 'Festo' && !m.brake)).toBe(true)
    expect(all.map((m) => m.model)).toContain('EMMT-AS-80-S-HS')
    const ac400 = motorCandidates(ref, motors, { families: ['EMMT-AS', 'EMMB-AS'], supply: 'AC 380–480 V', samePower: true, sameInterface: false })
    expect(ac400.every((m) => supplyOf(m) === 'AC 380–480 V')).toBe(true)
    const emmt = motors.find((m) => m.model === 'EMMT-AS-80-S-HS')!
    const rows = motorSpecRows(ref, emmt)
    expect(rows.find((r) => r.label === '최대 토크')!.ratio).toBeCloseTo(3.75 / 2.8)
    expect(rows.find((r) => r.label === '인터페이스')).toMatchObject({ reference: '80PA', other: '80P', ratio: null })
  })
})
