/**
 * `useHotkey('ctrl+shift+d', handler)` — a document-level shortcut (`ctrl` matches ⌘ on macOS
 * too); `false` disables it.
 */

import { useEffect } from 'react'

interface Chord {
  readonly key: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
}

export function parseChord(hotkey: string): Chord {
  const parts = hotkey
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
  const key = parts[parts.length - 1] ?? ''
  return {
    key,
    ctrl: parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  }
}

export function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  return (
    event.key.toLowerCase() === chord.key &&
    (event.ctrlKey || event.metaKey) === chord.ctrl &&
    event.shiftKey === chord.shift &&
    event.altKey === chord.alt
  )
}

export function useHotkey(hotkey: string | false, handler: () => void): void {
  useEffect(() => {
    if (hotkey === false || typeof document === 'undefined') return
    const chord = parseChord(hotkey)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matchesChord(event, chord)) return
      event.preventDefault()
      handler()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hotkey, handler])
}
