import { bracketCount, type AxisEvaluation } from '../calc/axisSelection'
import type { KitEvaluation } from '../calc/kitSelection'
import { gearboxStatus, type DriveEvaluation } from '../calc/motorSelection'
import { worstStatus, type Status } from '../calc/types'
import { cableRoleLabel } from './format'

/** Part, maker, model, order number, quantity and verdict of everything to order for one axis */
export type SelectionRow = [part: string, maker: string, model: string, partNumber: string | null, count: number | null, status: Status | null]

/** The 선정 모델 rows of one axis: axis, motor and its drive package, gearbox, kit, LM guides, connecting shaft */
export function partRows(
  axis: AxisEvaluation,
  drive: DriveEvaluation | null,
  kitEval: KitEvaluation | null,
  t: (text: string, args?: Record<string, string | number>) => string,
): SelectionRow[] {
  const g = drive?.gearbox ?? null
  const kit = kitEval?.kit ?? null
  const layout = axis.layout
  // Quantities: two axes in a twin arrangement; one drive train per motor
  const nAxes = layout.axes
  const nDrive = drive ? layout.motors : null
  return [
    [t('직교 축'), 'Festo', axis.order.model, axis.order.partNumber, nAxes, axis.status],
    [
      t('모터'),
      drive?.motor.maker ?? '—',
      drive ? (drive.motor.orderCode ?? drive.motor.model) : t('선택 안 됨'),
      drive?.motor.partNumber ?? null,
      nDrive,
      drive?.status ?? null,
    ],
    // Festo drive package: drive, cables, external braking resistor
    ...(drive?.controller?.controller
      ? ([[t('서보 드라이브'), 'Festo', drive.controller.controller.model, drive.controller.controller.partNumber, nDrive, drive.controller.status]] as SelectionRow[])
      : []),
    ...(drive?.controller?.cables ?? []).map(
      (c): SelectionRow => [t(cableRoleLabel[c.role]), 'Festo', c.type, c.partNumber, nDrive, null],
    ),
    ...(drive?.controller?.resistor.item && drive.controller.resistor.required
      ? ([[t('제동저항'), 'Festo', drive.controller.resistor.item.model, drive.controller.resistor.item.partNumber, nDrive, null]] as SelectionRow[])
      : []),
    [
      t('감속기'),
      g?.maker ?? '—',
      drive ? (g ? `${g.model} (${g.ratio}:1)` : t('감속기 미사용')) : '—',
      g?.partNumber ?? null,
      g ? nDrive : null,
      drive ? gearboxStatus(drive) : null,
    ],
    [
      t('연결키트'),
      kit ? 'Festo' : '—',
      kit?.product ?? (drive ? t('해당 키트 없음') : '—'),
      kit?.partNumber ?? null,
      kit ? nDrive : null,
      kitEval?.status ?? null,
    ],
    ...(axis.guide
      ? ([
          [
            t(axis.guide.guide.kind === 'axis' ? '가이드 축' : '가이드 유닛'),
            'Festo',
            axis.guide.model,
            axis.guide.partNumber,
            axis.guide.count,
            worstStatus(axis.checks.filter((c) => c.label.startsWith('가이드 축') || c.label.startsWith('가이드 유닛'))),
          ],
        ] as SelectionRow[])
      : layout.guides
        ? ([[t('LM 가이드'), '—', t('별도 선정 (참고값: 3장)'), null, layout.guides, null]] as SelectionRow[])
        : []),
    ...(axis.shaft ? ([[t('연결축'), 'Festo', axis.shaft.model, axis.shaft.shaft.partNumber, 1, null]] as SelectionRow[]) : []),
    // one lug per axis, a bracket per switch (HWS-EGC: per axis end); the proximity switches by model (limit switches, home switch)
    ...(axis.sensing
      ? ([
          ...(axis.sensing.lug ? [[t('센서 러그'), 'Festo', axis.sensing.lug.model, axis.sensing.lug.partNumber, nAxes, null]] : []),
          ...(axis.sensing.bracket
            ? [[t('센서 브라켓'), 'Festo', axis.sensing.bracket.model, axis.sensing.bracket.partNumber, nAxes * bracketCount(axis.sensing), null]]
            : []),
          ...[...new Set(axis.sensing.switches.map((s) => s.part))].map((part): SelectionRow => {
            const roles = axis.sensing!.switches.filter((s) => s.part === part)
            const names = [...new Set(roles.map((s) => t(s.role === 'home' ? 'Home 센서' : 'Limit 센서')))].join(' · ')
            return [`${t('근접 센서')} (${names})`, part.maker, part.model, part.partNumber, nAxes * roles.length, null]
          }),
        ] as SelectionRow[])
      : []),
  ]
}
