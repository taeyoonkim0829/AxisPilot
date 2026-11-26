import { motorList } from '../selection'
import type { MotorListReply, MotorListRequest } from './useMotorList'

// Motor list worker: the motor step's list (`motorList`) off the page, one request at a time
self.addEventListener('message', (e: MessageEvent<MotorListRequest>) => {
  const { id, req, settings, axisId } = e.data
  let reply: MotorListReply
  try {
    reply = { id, rows: motorList(req, settings, axisId) }
  } catch (err) {
    reply = { id, error: String(err instanceof Error ? err.message : err) }
  }
  self.postMessage(reply)
})
