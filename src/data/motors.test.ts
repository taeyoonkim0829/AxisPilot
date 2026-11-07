import { expect, it } from 'vitest'
import { motors } from './index'

// The gantry loads take the motor mass from the data: there is no input to stand in for a missing one.
it('every motor offered has a mass', () => {
  expect(motors.filter((m) => !(m.mass != null && m.mass > 0)).map((m) => m.model)).toEqual([])
})
