import type { ClientCommand } from '@wizard/dungeon-shared'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { type ControlDirection, PlayerInputBuffer } from './playerInputBuffer'

export { type ControlDirection, movementFor } from './playerInputBuffer'

const directionKey = (key: string): ControlDirection | null => {
  switch (key.toLowerCase()) {
    case 'w':
    case 'arrowup':
      return 'up'
    case 's':
    case 'arrowdown':
      return 'down'
    case 'a':
    case 'arrowleft':
      return 'left'
    case 'd':
    case 'arrowright':
      return 'right'
    default:
      return null
  }
}

const directionSource = (event: Pick<KeyboardEvent, 'code' | 'key'>): string =>
  event.code.length > 0 ? `code:${event.code}` : `key:${event.key.toLowerCase()}`

export const keyboardDirection = (
  event: Pick<KeyboardEvent, 'code' | 'key'>,
): { direction: ControlDirection; source: string } | null => {
  const direction = directionKey(event.key)
  return direction === null ? null : { direction, source: directionSource(event) }
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement

export const usePlayerControls = (
  enabled: boolean,
  interactionTargetId: string | null,
  pickupId: string | null,
  send: (command: ClientCommand) => boolean,
) => {
  const input = useRef(new PlayerInputBuffer())
  const interactionRef = useRef(interactionTargetId)
  const pickupRef = useRef(pickupId)
  input.current.setEnabled(enabled)
  interactionRef.current = interactionTargetId
  pickupRef.current = pickupId

  const queueAction = useCallback((command: ClientCommand) => {
    input.current.queueAction(command)
  }, [])

  const startDirection = useCallback((direction: ControlDirection) => {
    input.current.pressDirection(direction, `touch:${direction}`)
  }, [])

  const stopDirection = useCallback((direction: ControlDirection) => {
    input.current.releaseDirection(`touch:${direction}`)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      const command = input.current.nextCommand()
      if (command !== null) send(command)
    }, 100)
    return () => {
      window.clearInterval(timer)
    }
  }, [enabled, send])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const binding = keyboardDirection(event)
      if (binding !== null) {
        event.preventDefault()
        input.current.pressDirection(binding.direction, binding.source, event.repeat)
        return
      }
      if (event.repeat) return
      if (event.code === 'Space') {
        event.preventDefault()
        queueAction({ type: 'attack' })
      } else if (event.key.toLowerCase() === 'e') {
        const targetId = interactionRef.current
        if (targetId !== null) queueAction({ type: 'interact', targetId })
      } else if (event.key.toLowerCase() === 'f') {
        const lootId = pickupRef.current
        if (lootId !== null) queueAction({ type: 'pickup', lootId })
      } else if (/^[1-4]$/.test(event.key)) {
        queueAction({ type: 'item-use', slot: Number(event.key) - 1 })
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const binding = keyboardDirection(event)
      if (binding !== null) input.current.releaseDirection(binding.source)
    }
    const onBlur = () => {
      input.current.clearDirections()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled, queueAction])

  return useMemo(
    () => ({ enabled, queueAction, startDirection, stopDirection }),
    [enabled, queueAction, startDirection, stopDirection],
  )
}

export type PlayerControls = ReturnType<typeof usePlayerControls>
