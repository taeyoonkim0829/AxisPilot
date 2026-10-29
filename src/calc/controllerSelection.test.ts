import { describe, expect, it } from 'vitest'
import { axes, brakingResistors, cables, controllers, motors } from '../data'
import { evaluateAxis } from './axisSelection'
import { attachController, selectController } from './controllerSelection'
import { evaluateDrive, motorSupply } from './motorSelection'
import { defaultSettings, type Requirements } from './types'

const data = { controllers, resistors: brakingResistors, cables }
const req: Requirements = { stroke: 500, velocity: 0.5, acceleration: 5, jerk: 0, payload: 10, cog: { x: 0, y: 0, z: 0 }, mounting: 'floor' }
const run = (axisId: string, motorId: string, r: Partial<Requirements> = {}, s: Partial<typeof defaultSettings> = {}) => {
  const settings = { ...defaultSettings, ...s }
  const ev = evaluateAxis(axes.find((a) => a.id === axisId)!, { ...req, ...r }, settings)!
  const drive = evaluateDrive(ev, motors.find((m) => m.id === motorId)!, null, settings)
  return { ev, drive, settings, selection: selectController(ev, drive, settings, data)! }
}

describe('selectController', () => {
  it('picks the smallest drive of the motor voltage class that carries the required current', () => {
    const { selection } = run('ELGD-BS-KF-60-…10P', 'EMMT-AS-60-M-HS')
    expect(selection.controller!.model).toBe('CMMT-AS-C2-11A-P3-MP-S1')
    // Festo's preferred combination is shown when it differs
    expect(selection.preferred!.model).toBe('CMMT-AS-C3-11A-P3-MP-S1')
    expect(selection.status).toBe('ok')
    // LS winding: 230 V single-phase drives
    expect(run('ELGD-BS-KF-60-…10P', 'EMMT-AS-60-S-LS').selection.controller!.voltageClass).toBe('3A')
    expect(run('ELGD-BS-KF-60-…10P', 'EMMT-ST-57-M', { velocity: 0.2 }).selection.controller!.family).toBe('CMMT-ST')
  })

  it('selects the motor cable by length and cross-section', () => {
    const at = (motor: string, cableLength: number) => run('ELGD-BS-KF-60-…10P', motor, {}, { cableLength }).selection.cables
    expect(at('EMMT-AS-60-M-HS', 5)[0]).toMatchObject({ type: 'NEBM-M23G15-EH-5-Q7N-R3LEG14', partNumber: '5251375', order: 'standard' })
    // EMMT-ST-57: 0.5 mm² up to 5 m, 0.75 mm² up to 10 m
    expect(at('EMMT-ST-57-M', 5)[0].type).toBe('NEBM-M17G12-EH-5-Q6N-LE12')
    expect(at('EMMT-ST-57-M', 7.5)[0].type).toBe('NEBM-M17G12-EH-7.5-Q7N-LE12')
    // EMMB-AS: motor, encoder, encoder adapter and, with brake, the brake cable
    expect(at('EMMB-AS-60-04-B', 5).map((c) => c.role)).toEqual(['motor', 'encoder', 'adapter', 'brake'])
    expect(at('EMMB-AS-60-04', 5).map((c) => c.role)).toEqual(['motor', 'encoder', 'adapter'])
  })

  it('completes type and part number for lengths without a standard cable (NEBM documentation)', () => {
    const motorCable = (motor: string, cableLength: number) =>
      run('ELGD-BS-KF-60-…10P', motor, {}, { cableLength }).selection.cables.find((c) => c.role === 'motor')!
    // M23: a variable-length part number per cross-section
    expect(motorCable('EMMT-AS-60-M-HS', 6)).toMatchObject({ type: 'NEBM-M23G15-EH-6-Q7N-R3LEG14', partNumber: '5251373', order: 'variable' })
    expect(motorCable('EMMT-AS-60-L-HS', 12.34)).toMatchObject({ type: 'NEBM-M23G15-EH-12.4-Q9N-R3LEG14', partNumber: '5251380', length: 12.4 })
    // M17 / L10: modular product system NEBM-LX/M17, 0.5 m increments
    expect(motorCable('EMMT-ST-57-M', 6)).toMatchObject({ type: 'NEBM-M17G12-EH-6-Q7N-LE12', partNumber: '8181663', order: 'modular', module: 'NEBM-LX/M17' })
    expect(motorCable('EMMT-ST-57-M', 6.2).type).toBe('NEBM-M17G12-EH-6.5-Q7N-LE12')
    expect(motorCable('EMMB-ST-57-M', 12).type).toBe('NEBM-L10G14-EH-12-Q9N-LE12')
    // Sub-D: variable length 1 ... 25 m
    expect(motorCable('EMMS-ST-57-M', 6)).toMatchObject({ type: 'NEBM-S1G9-E-6-Q5-LE6', partNumber: '1450373' })
    // EMMB-AS cables come in standard lengths only: the next longer one
    const emmb = run('ELGD-BS-KF-60-…10P', 'EMMB-AS-60-04', {}, { cableLength: 6 }).selection.cables
    expect(emmb.find((c) => c.role === 'motor')).toMatchObject({ type: 'NEBM-H6G4-E-7.5-Q13N-LE4', partNumber: '5219199', order: 'rounded' })
    expect(emmb.find((c) => c.role === 'adapter')!.type).toBe('NEFM-REG6-K-0.5-R3G8')
  })

  it('warns beyond the cable selection table', () => {
    const { selection } = run('ELGD-BS-KF-60-…10P', 'EMMT-AS-60-M-HS', {}, { cableLength: 40 })
    expect(selection.cables.some((c) => c.role === 'motor')).toBe(false)
    expect(selection.checks.find((c) => c.label === '모터 케이블 길이')!.status).toBe('warn')
  })

  it('adds an external braking resistor when the integrated one is too small', () => {
    const { selection } = run('EGC-185-...-BS-40P-KF-GK', 'EMMT-AS-190-M-HS', { payload: 200, velocity: 1, acceleration: 5, mounting: 'vertical' })
    expect(selection.resistor.averagePower).toBeGreaterThan(selection.controller!.internalResistor!.nominalPower)
    expect(selection.resistor.required).toBe(true)
    expect(selection.controller!.brakingResistors).toContain(selection.resistor.item!.model)
    // a small horizontal move regenerates nothing: no-load torque and friction take the braking
    expect(run('ELGD-BS-KF-60-…10P', 'EMMT-AS-60-M-HS').selection.resistor.required).toBe(false)
  })

  it('folds the drive package verdict into the motor and skips other makers', () => {
    const { ev, drive, settings } = run('ELGD-BS-KF-60-…10P', 'EMMT-AS-60-M-HS')
    expect(attachController(ev, drive, settings, data).controller!.controller).not.toBeNull()
    const other = evaluateDrive(ev, { ...motors.find((m) => m.maker === 'Mitsubishi')!, controller: null }, null, settings)
    expect(selectController(ev, other, settings, data)).toBeNull()
  })

  it('takes the drive from the maker combination table (Controller.motors) of the motor drive range', () => {
    const { ev, settings } = run('ELGD-BS-KF-60-…10P', 'EMMT-AS-60-M-HS')
    const base = controllers.find((c) => c.family === 'CMMT-AS')!
    const drive = (model: string, motors: string, nominalCurrent: number) => ({
      ...base, id: model, model, partNumber: model, family: 'S210', voltageClass: '3AC', motors, nominalCurrent,
      peakCurrent: 3 * nominalCurrent, internalResistor: null, brakingResistors: [],
    })
    const siemens = [drive('S210-A', '^1FK2X', 1), drive('S210-B', '^1FK2Y', 1), drive('S210-C', '^1FK2Y', 50)]
    const cable = { ...cables[0], id: 'S1', maker: 'Siemens', controller: 'S210', motors: '^1FK2Y', configurable: null,
      range: [0, 50] as [number, number], type: 'MC-{L}', partNumbers: { '5': 'MC-5' } }
    const motor = { ...motors.find((m) => m.id === 'EMMT-AS-60-M-HS')!, maker: 'Siemens' as const, model: '1FK2Y', controller: 'S210-3AC' }
    const sel = selectController(ev, evaluateDrive(ev, motor, null, settings), settings, {
      ...data, controllers: [...controllers, ...siemens], cables: [...cables, cable],
    })!
    // only the drives paired with 1FK2Y, the smaller one if it carries the current
    expect(['S210-B', 'S210-C']).toContain(sel.controller!.model)
    expect(sel.cables).toEqual([expect.objectContaining({ role: 'motor', partNumber: 'MC-5' })])
  })
})

describe('Siemens drive packages (data)', () => {
  it('pairs 1FK2 with S210 by supply and 1FL6 with V90, with cables', () => {
    const at = (motor: string) => run('ELGD-BS-KF-60-…10P', motor, { velocity: 0.2, acceleration: 2, payload: 2 }).selection
    const k400 = at('1FK2104-4AF0')
    expect(k400.controller).toMatchObject({ family: 'S210', voltageClass: '3AC' })
    expect(k400.cables.some((c) => c.role === 'motor' && c.partNumber)).toBe(true)
    expect(at('1FK2104-4AF0 (230V)').controller).toMatchObject({ family: 'S210', voltageClass: '1AC' })
    const fl6 = at('1FL6024-2AF21-1LG1')
    expect(fl6.controller).toMatchObject({ family: 'V90', voltageClass: '200V' })
    expect(fl6.cables.map((c) => c.role)).toContain('encoder')
    // no motor cable limit in the V90 manual: no cable length check
    expect(fl6.checks.find((c) => c.label === '모터 케이블 길이')).toBeUndefined()
  })

  it('adds the Koch resistor listed for the S210 converter and supply, else checks the V90 limits', () => {
    const heavy = { payload: 200, velocity: 1, acceleration: 5, mounting: 'vertical' as const }
    const at = (motor: string) => run('EGC-185-...-BS-40P-KF-GK', motor, heavy).selection
    for (const [motor, voltage] of [['1FK2208-4AC1', 400], ['1FK2208-4AC1 (230V)', 230]] as const) {
      const s = at(motor)
      expect(s.resistor.required).toBe(true)
      expect(s.resistor.item!.maker).toBe('Michael Koch')
      expect(s.resistor.item!.voltage).toBe(voltage)
      expect(s.controller!.brakingResistors).toContain(s.resistor.item!.id)
      expect(s.checks.map((c) => c.label)).toEqual(expect.arrayContaining(['외부 제동저항 피크 전력', '외부 제동저항 펄스 에너지']))
    }
    const v90 = at('1FL6090-1AC61-2LH1')
    expect(v90.resistor.required).toBe(true)
    expect(v90.resistor.item).toBeNull()
    expect(v90.checks.find((c) => c.label === '외부 제동저항 정격 전력')!.limit).toBe(v90.controller!.externalMaxPower)
    expect(v90.notes.some((n) => n.text.startsWith('저항 {min} Ω'))).toBe(true)
  })
})

describe('Mitsubishi drive packages (data)', () => {
  it('pairs HK with MR-J5 and HG with MR-J4 from the combination tables, with cables', () => {
    const at = (motor: string, cableLength = 5) =>
      run('ELGD-BS-KF-60-…10P', motor, { velocity: 0.2, acceleration: 2, payload: 2 }, { cableLength }).selection
    const hk = at('HK-KT43W (200V)')
    expect(hk.controller).toMatchObject({ model: 'MR-J5-40A', family: 'MR-J5', voltageClass: '200V' })
    // dual cable (power + encoder) up to 10 m; beyond it the junction cable and a user-made extension
    expect(hk.cables).toEqual([expect.objectContaining({ role: 'motor', partNumber: 'MR-AEP2CBL5M-A1-H' })])
    const hkLong = at('HK-KT43WB (200V)', 15).cables
    expect(hkLong.find((c) => c.role === 'motor')).toMatchObject({ partNumber: 'MR-AEPB2J20CBL03M-A1-L', order: 'variable' })
    expect(hkLong.find((c) => c.role === 'encoder')).toMatchObject({ partNumber: 'MR-AENSCBL20M-H', order: 'rounded' })
    expect(at('HK-KT13W (400V)').controller).toMatchObject({ model: 'MR-J5-60A4', voltageClass: '400V' })
    const hg = at('HG-KR43B')
    expect(hg.controller).toMatchObject({ model: 'MR-J4-40A', family: 'MR-J4' })
    expect(hg.cables.map((c) => c.role)).toEqual(['motor', 'encoder', 'brake'])
    // HG-SR: power by connector set and user-made cable
    expect(at('HG-SR52').cables.find((c) => c.role === 'motor')).toMatchObject({ partNumber: 'MR-PWCNS4', type: 'MR-PWCNS4 + power cable 5 m (user-made)' })
    // no peak current or pulse rating in the Mitsubishi manuals: not checked
    expect(hg.checks.find((c) => c.label === '드라이브 최대 전류')!.limit).toBeNull()
    expect(hg.checks.find((c) => c.label === '제동 에너지 (내장)')).toBeUndefined()
  })

  it('adds an MR-RB regenerative option rated by permissible power only', () => {
    const { selection } = run('EGC-185-...-BS-40P-KF-GK', 'HK-ST502W (200V)', { payload: 200, velocity: 1, acceleration: 5, mounting: 'vertical' })
    expect(selection.resistor.required).toBe(true)
    expect(selection.resistor.item!.family).toBe('MR-RB')
    expect(selection.controller!.brakingResistors).toContain(selection.resistor.item!.model)
    expect(selection.checks.find((c) => c.label === '외부 제동저항 정격 전력')!.limit).toBe(selection.resistor.item!.ratedPower)
    expect(selection.checks.find((c) => c.label === '외부 제동저항 펄스 에너지')).toBeUndefined()
  })

  it('takes the cooling-fan rating (MR-RB5R, 5K-4) when the plain one is too small', () => {
    const { ev, drive, settings, selection } = run('EGC-185-...-BS-40P-KF-GK', 'HK-ST502W (200V)', { payload: 200, velocity: 1, acceleration: 5, mounting: 'vertical' })
    const p = selection.resistor.averagePower
    const fan = { ...brakingResistors.find((r) => r.model === 'MR-RB5R')!, id: 'FAN', model: 'FAN', ratedPower: 0.8 * p, fanPower: 1.2 * p }
    const amp = { ...selection.controller!, brakingResistors: ['FAN'], externalMaxPower: 2 * p }
    const sel = selectController(ev, drive, settings, { ...data, controllers: [amp], resistors: [fan] })!
    expect(sel.resistor.item!.model).toBe('FAN')
    expect(sel.checks.find((c) => c.label === '외부 제동저항 정격 전력')).toMatchObject({ limit: 1.2 * p, status: 'ok' })
    expect(sel.notes.some((n) => n.text.includes('[Pr. PA02]'))).toBe(true)
  })
})

describe('motorSupply', () => {
  const m = motors[0]
  it('reads the voltage, else the drive range', () => {
    expect(motorSupply({ ...m, voltage: 200, controller: null })).toBe('ac230')
    expect(motorSupply({ ...m, voltage: 400, controller: null })).toBe('ac400')
    expect(motorSupply({ ...m, voltage: 48, controller: null })).toBe('dc48')
    expect(motorSupply({ ...m, voltage: null, controller: 'CMMT-AS-3A' })).toBe('ac230')
    expect(motorSupply({ ...m, voltage: null, controller: 'CMMT-AS-11A' })).toBe('ac400')
    expect(motorSupply({ ...m, voltage: null, controller: 'CMMT-ST' })).toBe('dc48')
    expect(motorSupply({ ...m, voltage: null, controller: 'V90-200V' })).toBe('ac230')
    expect(motorSupply({ ...m, voltage: null, controller: null })).toBeNull()
  })
})

describe('stepper torque-speed curve', () => {
  it('fails when the required torque exceeds the 48 V curve at speed', () => {
    const curve = (velocity: number) =>
      run('ELGD-BS-KF-60-…10P', 'EMMT-ST-57-M', { velocity }).drive.checks.find((c) => c.label === '토크-회전수 선도')!
    expect(curve(0.2).status).toBe('ok')
    expect(curve(0.5).status).toBe('fail')
    // open loop: the curve is divided by a safety factor
    const open = run('ELGD-BS-KF-60-…10P', 'EMMS-ST-57-M', { velocity: 0.1 }).drive.checks.find((c) => c.label === '토크-회전수 선도')!
    expect(open.limit).toBeCloseTo(1.4 / 1.5, 2)
  })
})
