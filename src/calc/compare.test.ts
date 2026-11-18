import { describe, expect, it } from 'vitest'
import { axes, motors, thirdPartyAxes } from '../data'
import { G, guideComparisonValue, guideLoads } from './axisSelection'
import { axisCandidates, axisSpecRows, COMPARE_AXIS_FAMILIES, estimatedThrust, festoOverhang, festoVariant, motorCandidates, fullModel, fullModels, motorSpecRows, robostarModel, robostarModels, offeredOptions, supplyOf } from './compare'
import type { Requirements } from './types'

describe('제품 비교', () => {
  it('builds the 1FK2 article number and the Festo order variant for the same options', () => {
    const sie = motors.find((m) => m.id === '1FK2104-4AF0 (230V)')!
    expect(fullModel(sie, { shaft: 'key', seal: false, encoder: 'multi' })).toBe('1FK2104-4AF00-1MA0')
    expect(fullModel(sie, { shaft: 'plain', seal: true, encoder: 'single' })).toBe('1FK2104-4AF01-0SA0')
    const opt = { shaft: 'key', seal: true, encoder: 'single' } as const
    const model = (id: string) => fullModel(motors.find((m) => m.id === id)!, opt)
    // Mitsubishi: brake B, oil seal J, keyed shaft K; HG-KR053 has no oil seal and no keyed shaft, HG-JR its oil seal as standard
    expect(model('HG-KR43B')).toBe('HG-KR43BJK')
    expect(model('HG-KR053')).toBe('HG-KR053')
    expect(model('HG-JR153')).toBe('HG-JR153K')
    expect(model('HK-KT13WB (200V)')).toBe('HK-KT13WBJK')
    // LS: encoder, shaft K / N, option 1 seal / 2 brake / 3 both, 8 for 48 V; no oil seal on FAL
    expect(model('APM-EB04A brake')).toBe('APM-EB04AM3K3')
    expect(fullModel(motors.find((m) => m.id === 'APM-EB04A')!, { shaft: 'plain', seal: false, encoder: 'multi' })).toBe('APM-EB04AM3N')
    expect(model('APM-FG110D')).toBe('APM-FG110DM3K1')
    expect(model('APMC-FBL04A')).toBe('APMC-FBL04AMK1')
    expect(model(motors.find((m) => m.model === 'APMC-FAL01A (48V) (brake)')!.id)).toBe('APMC-FAL01AM8K28')
    expect(offeredOptions(motors.find((m) => m.id === 'HG-KR053')!, opt)).toEqual({ shaft: 'plain', seal: false, encoder: 'multi' })
    // the search finds a model by any of its full names, which give back their options
    expect(fullModels(sie).find((f) => f.model === '1FK2104-4AF01-0MA0')?.options).toEqual({ shaft: 'plain', seal: true, encoder: 'multi' })
    expect(fullModels(motors.find((m) => m.id === 'HG-KR053')!).map((f) => f.model)).toEqual(['HG-KR053'])
  })

  it('builds the Robostar order code: stroke in 10 mm, encoder, motor W with B for brake, PR / PL', () => {
    const ax = (id: string) => thirdPartyAxes.find((a) => a.id === id)!
    expect(robostarModel(ax('RS-120-X20SS'), { stroke: 550, encoder: 'A', hand: 'R' })).toBe('RS-120-X20SS-055-A-200')
    expect(robostarModel(ax('RC-070-Z05PR (L)'), { stroke: 100, encoder: 'I', hand: 'L' })).toBe('RC-070-Z05PL-010-I-10B')
    expect(robostarModel(ax('RK-080'), { stroke: 500, encoder: 'A', hand: 'R' })).toBeNull()
    expect(robostarModels(ax('RS-120-X20SS')).find((f) => f.model === 'RS-120-X20SS-100-I-200')?.options).toEqual({ stroke: 1000, encoder: 'I', hand: 'R' })
    const emmb = motors.find((m) => m.id === 'EMMB-AS-40-01')!
    expect(festoVariant(emmb, { shaft: 'key', seal: false, encoder: 'multi' }).variant).toMatchObject({ orderCode: 'EMMB-AS-40-01-K-S30M', partNumber: '8097169' })
    // EMMB-AS has no shaft seal: the nearest variant, the seal named as not offered
    expect(festoVariant(emmb, { shaft: 'plain', seal: true, encoder: 'single' })).toMatchObject({ variant: { orderCode: 'EMMB-AS-40-01-S30S' }, differs: ['seal'] })
    const emmt = motors.find((m) => m.id === 'EMMT-AS-60-S-LS-B')!
    expect(festoVariant(emmt, { shaft: 'key', seal: true, encoder: 'multi' }).variant).toMatchObject({ orderCode: 'EMMT-AS-60-SKR-LS-RMB', partNumber: null })
  })

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
    expect(rows.find((r) => r.label === '최대 스트로크')!.ratio).toBeCloseTo(1100 / 1000)
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
    expect(rows.find((r) => r.label === '최대 토크')!.ratio).toBeCloseTo(2.8 / 3.75)
    expect(rows.find((r) => r.label === '인터페이스')).toMatchObject({ reference: '80PA', other: '80P', ratio: null })
  })
})

describe('제품 비교: Robostar load ratings', () => {
  it('estimates the feed force and puts the catalog overhangs against the Festo axis at fv = 1', () => {
    const rs = thirdPartyAxes.find((a) => a.model === 'RS-120-X10SS')!
    expect(rs.overhang).toEqual([
      { mounting: 'floor', payload: 30, lateral: 246, normal: 978 },
      { mounting: 'floor', payload: 50, lateral: 162, normal: 594 },
    ])
    // 200 W at 3000 rpm, lead 10 mm, η 0.9
    expect(estimatedThrust(200, 10)).toBeCloseTo(360, 0)
    const egc = axes.find((a) => a.id === 'EGC-120-...-BS-10P-KF-GK')!
    const rows = axisSpecRows(rs, egc).filter((r) => r.label.startsWith('허용 오버행'))
    expect(rows).toHaveLength(4)
    // further out the guide comparison value passes 1; a heavier payload sits closer
    const lateral = festoOverhang(egc, 'floor', 30, 'lateral')!
    const f = (y: number) => guideComparisonValue(guideLoads({ mounting: 'floor', cog: { x: 0, y, z: 0 } } as Requirements, 30 + egc.slideMass, 0.3 * G, egc.guideCentre ?? 0), egc).fv
    expect(f(lateral)).toBeLessThan(1)
    expect(f(lateral + 2)).toBeGreaterThan(1)
    expect(festoOverhang(egc, 'floor', 50, 'lateral')!).toBeLessThan(lateral)
    // along gravity on a wall only the inertial force loads the guide: beyond the search
    expect(festoOverhang(egc, 'wall', 2, 'lateral')).toBe(5000)
  })
})
