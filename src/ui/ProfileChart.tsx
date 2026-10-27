import { useMemo, useState, type PointerEvent } from 'react'
import type { AxisEvaluation } from '../calc/axisSelection'
import { tracePhases, type Phase, type TracePoint } from '../calc/motionProfile'
import { motorTorqueFn, type DriveEvaluation } from '../calc/motorSelection'
import type { Settings, VerticalDirection } from '../calc/types'
import { useT } from '../i18n'
import { CollapseTitle, RadioGroup } from './common'
import { fmt, moveLabel } from './format'

const W = 1000
const H = 92
const PAD = { left: 160, right: 12, top: 22, bottom: 6 }
const AXIS_H = 22

type Point = TracePoint & { torque: number }

interface Series {
  key: string
  label: string
  unit: string
  digits: number
  pick: (p: Point) => number
}

/** Range including 0, with a little headroom so the trace never touches the frame. */
function extent(values: number[]): [number, number] {
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  return [min - span * 0.08, max + span * 0.08]
}

/** Roughly `count` round tick values covering [lo, hi]. */
function ticks(lo: number, hi: number, count = 3): number[] {
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v)
  return out
}

function Panel({ trace, series, x, hover }: { trace: Point[]; series: Series; x: (t: number) => number; hover: Point | null }) {
  const [lo, hi] = extent(trace.map(series.pick))
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom)
  const d = trace.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(series.pick(p)).toFixed(1)}`).join('')
  return (
    <g>
      {ticks(lo, hi).map((v) => (
        <g key={v}>
          <line className={v === 0 ? 'chart-zero' : 'chart-grid'} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
          <text className="chart-tick" x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {fmt(v, 2)}
          </text>
        </g>
      ))}
      <text className="chart-title" x={4} y={(PAD.top + H - PAD.bottom) / 2} dy="0.32em">
        {series.label} [{series.unit}]
      </text>
      <path className="chart-line" d={d} />
      {hover && <circle className="chart-dot" cx={x(hover.t)} cy={y(series.pick(hover))} r={4} />}
      {hover && (
        <text className="chart-readout" x={W - PAD.right} y={PAD.top - 8} textAnchor="end">
          {fmt(series.pick(hover), series.digits)} {series.unit}
        </text>
      )}
    </g>
  )
}

interface Props {
  axis: AxisEvaluation
  drive: DriveEvaluation | null
  settings: Settings
  /** direction of the forward move on a vertical axis, null otherwise */
  vertical: VerticalDirection | null
  open: boolean
  onToggle: () => void
  /** Shown view; the PDF report prints the same one */
  view: ProfileView
  onView: (view: ProfileView) => void
}

/** Full cycle, or one move with its dwell. */
export type ProfileView = 'cycle' | 'forward' | 'back'

/** The cycle (or one move) as stacked panels sharing the time axis. */
export function ProfileChart({ axis, drive, settings, vertical, open, onToggle, view, onView }: Props) {
  const t = useT()
  return (
    <figure className="profile-chart">
      <div className="profile-chart-head">
        <CollapseTitle open={open} onToggle={onToggle}>
          {t('모션 프로파일')}
        </CollapseTitle>
        {open && (
          <RadioGroup
            options={['cycle', 'forward', 'back'] as const}
            value={view}
            onChange={onView}
            label={(v) => t(v === 'cycle' ? '왕복' : moveLabel(v === 'back', vertical))}
          />
        )}
      </div>
      {open && <ProfilePlot axis={axis} drive={drive} settings={settings} view={view} />}
    </figure>
  )
}

/** Phases of the view: one move ends with the dwell; the cycle has one, between the forward and the return move. */
function viewPhases(axis: AxisEvaluation, view: ProfileView): Phase[] {
  return view === 'cycle' ? axis.cyclePhases : view === 'back' ? axis.backPhases : axis.forwardPhases
}

type SpanKind = 'dwell' | 'press'

/** Shaded spans [start, end, kind] in s: dwells and the press (press move + hold), adjacent phases merged. */
function shadedSpans(phases: Phase[]): [number, number, SpanKind][] {
  const spans: [number, number, SpanKind][] = []
  let t = 0
  for (const p of phases) {
    const kind: SpanKind | null = p.load ? 'press' : p.dir === 0 ? 'dwell' : null
    const last = spans[spans.length - 1]
    if (kind && last && last[2] === kind && Math.abs(last[1] - t) < 1e-12) last[1] = t + p.duration
    else if (kind) spans.push([t, t + p.duration, kind])
    t += p.duration
  }
  return spans
}

/** Position, velocity, acceleration, jerk and torque over the view; hovering reads out values. */
export function ProfilePlot({
  axis,
  drive,
  settings,
  view,
}: {
  axis: AxisEvaluation
  drive: DriveEvaluation | null
  settings: Settings
  view: ProfileView
}) {
  const t = useT()
  const [hover, setHover] = useState<Point | null>(null)
  const phases = useMemo(() => viewPhases(axis, view), [axis, view])
  const moveTime = phases.reduce((s, p) => s + p.duration, 0)
  const spans = shadedSpans(phases)

  const trace = useMemo(() => {
    const motorTorque = drive ? motorTorqueFn(axis, drive.motor, drive.gearbox, settings) : null
    const raw = tracePhases(phases)
    // Position from the forward move's start: the return move travels back from the stroke end to 0.
    const offset = view === 'back' ? -raw[raw.length - 1].x : 0
    return raw.map((p): Point => {
      const s = { ...axis.driveAt(p.v, p.a, p.dir, p.load), dir: p.dir }
      // Without a motor, show the drive-shaft torque with efficiency applied (as in the axis "구동 토크" check).
      const torque = motorTorque
        ? motorTorque(s)
        : s.torque * s.omega >= 0
          ? s.torque / axis.efficiency
          : s.torque * axis.efficiency
      return { ...p, x: p.x + offset, torque }
    })
  }, [axis, drive, settings, phases, view])

  const series: Series[] = [
    { key: 'x', label: t('위치'), unit: 'mm', digits: 1, pick: (p) => p.x * 1000 },
    { key: 'v', label: t('속도'), unit: 'm/s', digits: 3, pick: (p) => p.v },
    { key: 'a', label: t('가속도'), unit: 'm/s²', digits: 2, pick: (p) => p.a },
    {
      key: 'j',
      label: t('저크'),
      unit: 'm/s³',
      digits: 1,
      pick: (p) => p.j,
    },
    {
      key: 't',
      label: t(drive ? '모터 토크' : '축 구동 토크'),
      unit: 'Nm',
      digits: 3,
      pick: (p) => p.torque,
    },
  ]

  const x = (t: number) => PAD.left + (t / moveTime) * (W - PAD.left - PAD.right)
  const plotH = series.length * H
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const time = ((((e.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right)) * moveTime
    if (time < 0 || time > moveTime) return setHover(null)
    let best = trace[0]
    for (const p of trace) if (Math.abs(p.t - time) < Math.abs(best.t - time)) best = p
    setHover(best)
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${plotH + AXIS_H}`}
      role="img"
      aria-label={t('위치, 속도, 가속도, 저크, 토크 프로파일 (휴지 시간 포함)')}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      {spans.map(([t0, t1, kind]) => (
        <g key={t0}>
          <rect
            className={kind === 'press' ? 'chart-press' : 'chart-dwell'}
            x={x(t0)}
            width={x(t1) - x(t0)}
            y={PAD.top}
            height={plotH - PAD.top - PAD.bottom}
          />
          <text className="chart-tick" x={(x(t0) + x(t1)) / 2} y={PAD.top - 8} textAnchor="middle">
            {t(kind === 'press' ? '압착' : '휴지')}
          </text>
        </g>
      ))}
      {series.map((s, i) => (
        <g key={s.key} transform={`translate(0 ${i * H})`}>
          <Panel trace={trace} series={s} x={x} hover={hover} />
        </g>
      ))}
      {ticks(0, moveTime, 6)
        .filter((time) => time <= moveTime)
        .map((time) => (
          <text key={time} className="chart-tick" x={x(time)} y={plotH + 15} textAnchor="middle">
            {fmt(time, 3)}
          </text>
        ))}
      {hover && (
        <>
          <line className="chart-cursor" x1={x(hover.t)} x2={x(hover.t)} y1={PAD.top} y2={plotH - PAD.bottom} />
          <text className="chart-readout chart-halo" x={x(hover.t)} y={plotH + 15} textAnchor="middle">
            {fmt(hover.t, 3)} s
          </text>
        </>
      )}
    </svg>
  )
}
