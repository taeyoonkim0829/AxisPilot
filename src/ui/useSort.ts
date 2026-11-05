import { useState } from 'react'
import type { Status } from '../calc/types'

export type SortValue = number | string | null
export type SortState = { key: string; dir: 'asc' | 'desc' } | null

/** Names compare their numbers by value, so sizes sort 60, 80, 120, 160 (not 120, 160, 60, 80) */
const collator = new Intl.Collator(undefined, { numeric: true })

export const statusRank: Record<Status, number> = { ok: 0, warn: 1, fail: 2 }

/**
 * Column sorting for a table. Clicking a column cycles ascending → descending → original order.
 * Missing values (null) always go last; ties keep the original order.
 */
export function useSort<T>(rows: T[], keys: Record<string, (row: T) => SortValue>) {
  const [sort, setSort] = useState<SortState>(null)
  const pick = sort && keys[sort.key]
  const sorted =
    sort && pick
      ? rows
          .map((row, i) => ({ row, i, v: pick(row) }))
          .sort((a, b) => {
            if (a.v == null || b.v == null) return a.v == null ? (b.v == null ? a.i - b.i : 1) : -1
            const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v))
            return (sort.dir === 'asc' ? c : -c) || a.i - b.i
          })
          .map((x) => x.row)
      : rows
  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))
  return { sorted, sort, toggle }
}
