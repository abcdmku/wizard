import { describe, expect, it } from 'vitest'
import { PlayerInputBuffer } from './playerInputBuffer'
import { keyboardDirection, movementFor } from './usePlayerControls'

const bindingFor = (key: string, code: string) => {
  const binding = keyboardDirection({ key, code })
  if (binding === null) throw new Error(`missing direction binding for ${key}`)
  return binding
}

describe('movementFor', () => {
  it('emits only the most recently pressed cardinal direction', () => {
    expect(movementFor(['up', 'right'])).toBe('east')
    expect(movementFor(['right', 'up'])).toBe('north')
  })

  it('stops when no direction is held', () => {
    expect(movementFor([])).toBeNull()
  })
})

describe('PlayerInputBuffer', () => {
  it('drops movement and discrete actions while disabled', () => {
    const input = new PlayerInputBuffer()
    expect(input.pressDirection('right', 'key:d')).toBe(false)
    expect(input.queueAction({ type: 'attack' })).toBe(false)
    input.setEnabled(true)
    expect(input.nextCommand()).toBeNull()
  })

  it('clears held and queued input when the player becomes disabled', () => {
    const input = new PlayerInputBuffer()
    input.setEnabled(true)
    input.pressDirection('right', 'key:d')
    input.queueAction({ type: 'attack' })
    input.setEnabled(false)
    input.setEnabled(true)
    expect(input.nextCommand()).toBeNull()
  })

  it('keeps discrete actions ahead of held movement while enabled', () => {
    const input = new PlayerInputBuffer()
    input.setEnabled(true)
    input.pressDirection('right', 'key:d')
    input.queueAction({ type: 'attack' })
    expect(input.nextCommand()).toEqual({ type: 'attack' })
    expect(input.nextCommand()).toEqual({ type: 'move', direction: 'east' })
  })

  it('does not let an older key repeat steal direction priority', () => {
    const input = new PlayerInputBuffer()
    const keyboardW = bindingFor('w', 'KeyW')
    const keyboardD = bindingFor('d', 'KeyD')
    input.setEnabled(true)
    input.pressDirection(keyboardW.direction, keyboardW.source)
    input.pressDirection(keyboardD.direction, keyboardD.source)
    expect(input.pressDirection(keyboardW.direction, keyboardW.source, true)).toBe(false)
    expect(input.nextCommand()).toEqual({ type: 'move', direction: 'east' })
  })

  it('retains a direction while another physical alias remains held', () => {
    const input = new PlayerInputBuffer()
    const keyboardW = bindingFor('w', 'KeyW')
    const arrowUp = bindingFor('ArrowUp', 'ArrowUp')
    input.setEnabled(true)
    input.pressDirection(keyboardW.direction, keyboardW.source)
    input.pressDirection(arrowUp.direction, arrowUp.source)
    input.releaseDirection(keyboardW.source)
    expect(input.nextCommand()).toEqual({ type: 'move', direction: 'north' })
  })
})
