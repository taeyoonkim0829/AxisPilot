import type { Side } from '../cad/combo'
import type { AxisEvaluation } from '../calc/axisSelection'
import type { CableChoice } from '../calc/controllerSelection'
import type { Status, Supply, VerticalDirection } from '../calc/types'

/** Axis checks for the detail tables: the stroke is the user's own input, shown only when it exceeds the axis. */
export const axisDetailChecks = (axis: AxisEvaluation) =>
  axis.checks.filter((c) => c.label !== '스트로크' || c.status !== 'ok')

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const d = abs >= 1000 ? 0 : abs >= 100 ? Math.min(digits, 1) : digits
  return value.toLocaleString('ko-KR', { maximumFractionDigits: d })
}

/** Force in kgf (standard gravity 9.80665 N/kgf), e.g. "≈ 102 kgf". */
export function kgf(newton: number): string {
  return `≈ ${fmt(newton / 9.80665, 1)} kgf`
}

export function pct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${Math.round(ratio * 100)}%`
}

export const statusLabel: Record<Status, string> = { ok: '적합', warn: '주의', fail: '부적합' }

/** Assembly side seen from the motor end of the axis (step 5, report) */
export const sideLabel: Record<Side, string> = { up: '상', down: '하', left: '좌', right: '우' }

export const mountingLabel = { floor: '바닥', wall: '벽면', vertical: '수직' } as const

export const parallelModeLabel = {
  single: '단일 축',
  twinMotor: '2축 · 모터 동기',
  twinShaft: '2축 · 기구 동기',
  guides: '축 + LM 가이드',
} as const

export const driveLabel ={ belt: '벨트', spindle: '볼스크류' } as const

export const pressDirectionLabel = { down: '위→아래', up: '아래→위' } as const

/** Name of one move: forward/return, or up/down on a vertical axis (`verticalForward`: direction of the forward move). */
export const moveLabel = (back: boolean, vertical: VerticalDirection | null) => {
  if (!vertical) return back ? '복귀' : '전진'
  return (vertical === 'up') !== back ? '상승' : '하강'
}

/** Motor power supply (`Settings.supplies`, `motorSupply`) */
export const supplyLabel: Record<Supply, string> = { ac230: 'AC 200–240 V', ac400: 'AC 380–480 V', dc48: 'DC 24/48 V' }

export const cableRoleLabel: Record<CableChoice['role'], string> = {
  motor: '모터 케이블',
  encoder: '엔코더 케이블',
  adapter: '엔코더 어댑터',
  brake: '브레이크 케이블',
}
