import { describe, expect, it } from 'vitest'
import { defaultComboOptions } from './cad/combo'
import { defaultGantry, initialGantrySettings } from './calc/gantry'
import { defaultPress, defaultSettings } from './calc/types'
import { noPicks } from './selection'
import { decodeShare, encodeShare, MAX_SHARED_BYTES, type Shared } from './share'

const single: Shared = {
  mode: 'single',
  req: { stroke: 800, velocity: 1.2, acceleration: 8, jerk: 0, payload: 25, cog: { x: 10, y: -20, z: 60 }, mounting: 'wall', press: defaultPress },
  settings: { ...defaultSettings, conservative: true },
  picks: { ...noPicks, axisId: 'EGC-80-...-TB-KF-GK', kitId: 'kit-1' },
  profileView: 'forward',
  assembly: { ...defaultComboOptions, kitSide: 'left', twinMotorConnector: 'up' },
}

describe('shared link', () => {
  it('packs a calculation into an address-safe value and back', async () => {
    const value = await encodeShare(single)
    expect(value).toMatch(/^1[A-Za-z0-9_-]+$/)
    expect(await decodeShare(value)).toEqual(single)
  })

  it('refuses a link that unpacks to more than the limit', async () => {
    // 4 MB of one repeated character packs into a few kB: a crafted link must not fill the tab's memory
    const big = { ...single, req: { ...single.req, note: 'x'.repeat(4 * MAX_SHARED_BYTES) } } as unknown as Shared
    const value = await encodeShare(big)
    expect(value.length).toBeLessThan(20000)
    expect(await decodeShare(value)).toBeNull()
  })

  it('fills fields missing from an older link with the defaults', async () => {
    const { settings: _settings, assembly: _assembly, ...old } = single
    const decoded = await decodeShare(await encodeShare({ ...old, settings: {}, assembly: {} } as unknown as Shared))
    expect(decoded).toEqual({ ...single, settings: defaultSettings, assembly: defaultComboOptions })
  })

  it('keeps the gantry screen with its tab', async () => {
    const gantry: Shared = {
      mode: 'gantry',
      gantry: { ...defaultGantry, config: 'xy' },
      gantrySettings: initialGantrySettings,
      picks: { x: noPicks, y: { ...noPicks, motorId: 'm' }, z: noPicks },
      views: { x: 'cycle', y: 'back', z: 'cycle' },
      assemblies: { x: defaultComboOptions, y: defaultComboOptions, z: defaultComboOptions },
      tab: 'y',
    }
    expect(await decodeShare(await encodeShare(gantry))).toEqual(gantry)
  })

  it('ignores a damaged value', async () => {
    expect(await decodeShare('1not-a-deflate-stream')).toBeNull()
    expect(await decodeShare('9abc')).toBeNull()
  })
})
