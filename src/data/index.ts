import type { Axis, AxisAdapter, BrakingResistor, Cable, ConnectingShaft, Controller, Gearbox, Kit, Motor } from './types'

// Product data is maintained directly in these JSON files (see data/README.md):
// one file per maker and product family, data/<kind>/<maker>/<family>.json
// kind = axes | motors | gearboxes | kits | drives | brakingResistors | cables | shafts | adapters.
// Files excluded with `!` stay in data/ but are not offered in the app (discontinued: Mitsubishi HF-KP/HF-SP,
// Apex PA).
type DataFile = { items: unknown[] }
const axisFiles = import.meta.glob<DataFile>('../../data/axes/*/*.json', { eager: true, import: 'default' })
const motorFiles = import.meta.glob<DataFile>(['../../data/motors/*/*.json', '!../../data/motors/Mitsubishi/HF-*.json'], {
  eager: true,
  import: 'default',
})
const gearboxFiles = import.meta.glob<DataFile>(['../../data/gearboxes/*/*.json', '!../../data/gearboxes/Apex/PA.json'], {
  eager: true,
  import: 'default',
})
const kitFiles = import.meta.glob<DataFile>('../../data/kits/*/*.json', { eager: true, import: 'default' })
const controllerFiles = import.meta.glob<DataFile>('../../data/drives/*/*.json', { eager: true, import: 'default' })
const resistorFiles = import.meta.glob<DataFile>('../../data/brakingResistors/*/*.json', { eager: true, import: 'default' })
const cableFiles = import.meta.glob<DataFile>('../../data/cables/*/*.json', { eager: true, import: 'default' })
const shaftFiles = import.meta.glob<DataFile>('../../data/shafts/*/*.json', { eager: true, import: 'default' })
const adapterFiles = import.meta.glob<DataFile>('../../data/adapters/*/*.json', { eager: true, import: 'default' })

const items = <T,>(files: Record<string, DataFile>) => Object.values(files).flatMap((f) => f.items as T[])

export const axes = items<Axis>(axisFiles)
export const motors = items<Motor>(motorFiles)
export const gearboxes = items<Gearbox>(gearboxFiles)
export const kits = items<Kit>(kitFiles)
export const controllers = items<Controller>(controllerFiles)
export const brakingResistors = items<BrakingResistor>(resistorFiles)
export const cables = items<Cable>(cableFiles)
export const shafts = items<ConnectingShaft>(shaftFiles)
export const adapters = items<AxisAdapter>(adapterFiles)

/** Families of each maker present in the data, sorted by name. */
/** Festo series in the order the motor step lists them; others (and the other makers) alphabetically after */
const familyOrder = ['EMMT-AS', 'EMMT-ST', 'EMMT-EC', 'EMMB-AS', 'EMMB-ST', 'EMMS-ST', 'EMMH-AS']
const familyRank = (f: string) => (familyOrder.includes(f) ? familyOrder.indexOf(f) : familyOrder.length)

export const motorFamilies = Object.fromEntries(
  (['Festo', 'Siemens', 'Mitsubishi'] as const).map((maker) => [
    maker,
    [...new Set(motors.filter((m) => m.maker === maker).map((m) => m.family))].sort(
      (a, b) => familyRank(a) - familyRank(b) || a.localeCompare(b),
    ),
  ]),
) as Record<Motor['maker'], string[]>

/**
 * Gearboxes whose compatibility list names this motor (Apex lists Mitsubishi frame codes like "KP053"). The code must
 * not run on into another digit: "SR52" is HG-SR52(B), not the 400 V HG-SR524.
 */
export function gearboxesFor(motor: Motor, all: Gearbox[] = gearboxes): Gearbox[] {
  const names = (code: string) => {
    for (let i = motor.model.indexOf(code); i >= 0; i = motor.model.indexOf(code, i + 1))
      if (!/\d/.test(motor.model[i + code.length] ?? '')) return true
    return false
  }
  return all.filter((g) => g.compatibleMotors?.some(names))
}
