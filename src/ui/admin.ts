import { useSyncExternalStore } from 'react'

// No backend: the hash only keeps the password out of the source; anyone reading the bundle can still turn it on.
const PASSWORD_SHA256 = 'e395467476866b04e5666f6ae5d4790a191f27f14d3e86e863cc1a0ba8621ed5'
const STORAGE_KEY = 'axispilot-admin'

const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let admin = read()

function set(on: boolean) {
  admin = on
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // private window or blocked storage: on for this page only
  }
  listeners.forEach((l) => l())
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** true when the password matches; admin mode then stays on in this browser */
export async function unlockAdmin(password: string): Promise<boolean> {
  const ok = (await sha256(password)) === PASSWORD_SHA256
  if (ok) set(true)
  return ok
}

export const lockAdmin = () => set(false)

/** Admin mode: the arrangements hidden from other users (2축 동기) are offered. */
export function useAdmin(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => admin,
  )
}
