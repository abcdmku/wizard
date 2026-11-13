/**
 * Moving the view for a focused step, and the zoom of one wheel notch with Ctrl.
 */
import { expect, it } from 'vitest'
import { overflow } from '../src/graph/Keyboard'
import { wheelFactor } from '../src/graph/WheelZoom'

it('leaves a step that shows whole where it is, and moves the view only by what is cut', () => {
  // A fitted graph leaves 20px; the bottom step of it is in view.
  expect(overflow(380, 432, 452, 16)).toBe(0)
  expect(overflow(-30, 22, 452, 16)).toBe(46)
  expect(overflow(420, 472, 452, 16)).toBe(-36)
})

it('zooms by 1.2 for one wheel notch and a little for a pinch', () => {
  expect(wheelFactor(-100, 0)).toBeCloseTo(1.2)
  expect(wheelFactor(100, 0)).toBeCloseTo(1 / 1.2)
  expect(wheelFactor(-3, 1)).toBeCloseTo(1.2)
  const pinch = wheelFactor(-4, 0)
  expect(pinch).toBeGreaterThan(1)
  expect(pinch).toBeLessThan(1.05)
})
