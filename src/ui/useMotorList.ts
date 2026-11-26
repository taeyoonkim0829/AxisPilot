import { useEffect, useMemo, useState } from 'react'
import type { DriveEvaluation } from '../calc/motorSelection'
import type { Requirements, Settings } from '../calc/types'
import { motorList } from '../selection'

export interface MotorListRequest {
  id: number
  req: Requirements
  settings: Settings
  axisId: string
}
export type MotorListReply = { id: number; rows: DriveEvaluation[] } | { id: number; error: string }

let worker: Worker | null = null
let nextId = 0
const listeners = new Map<number, (reply: MotorListReply) => void>()
// one request in the worker at a time; of those waiting only the newest is sent (typing makes many)
let busy = false
let waiting: MotorListRequest | null = null

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./motorList.worker.ts', import.meta.url), { type: 'module' })
  w.addEventListener('message', (e: MessageEvent<MotorListReply>) => {
    listeners.get(e.data.id)?.(e.data)
    listeners.delete(e.data.id)
    busy = false
    sendNext()
  })
  // a crashed worker fails its requests; the next one starts a new worker
  w.addEventListener('error', (e) => {
    e.preventDefault()
    for (const [id, listener] of listeners) listener({ id, error: e.message || 'Motor list worker failed' })
    listeners.clear()
    w.terminate()
    if (worker === w) worker = null
    busy = false
    sendNext()
  })
  worker = w
  return w
}

function sendNext() {
  if (busy || !waiting) return
  busy = true
  getWorker().postMessage(waiting)
  waiting = null
}

function request(req: MotorListRequest, listener: (reply: MotorListReply) => void) {
  // a request still waiting is superseded: it is never sent
  if (waiting) listeners.delete(waiting.id)
  listeners.set(req.id, listener)
  waiting = req
  sendNext()
}

/**
 * The motor step's list for the selected axis, built in a worker so the page stays responsive while every motor (and
 * gearbox) is checked. While a new list is on its way the last one stays (`pending`). Without `Worker` (tests) it is
 * built on the spot.
 */
export function useMotorList(req: Requirements, settings: Settings, axisId: string | null): { rows: DriveEvaluation[]; pending: boolean } {
  const inline = typeof Worker === 'undefined'
  const direct = useMemo(() => (inline && axisId ? motorList(req, settings, axisId) : []), [inline, req, settings, axisId])
  const [shown, setShown] = useState<{ for: unknown[]; rows: DriveEvaluation[] }>({ for: [], rows: [] })
  useEffect(() => {
    if (inline || !axisId) return
    let live = true
    request({ id: nextId++, req, settings, axisId }, (reply) => {
      if (!live) return
      if ('error' in reply) console.error(reply.error)
      setShown({ for: [req, settings, axisId], rows: 'error' in reply ? [] : reply.rows })
    })
    return () => {
      // a newer request supersedes this one: its reply is dropped
      live = false
    }
  }, [inline, req, settings, axisId])
  if (inline) return { rows: direct, pending: false }
  if (!axisId) return { rows: [], pending: false }
  const current = shown.for[0] === req && shown.for[1] === settings && shown.for[2] === axisId
  return { rows: shown.rows, pending: !current }
}
