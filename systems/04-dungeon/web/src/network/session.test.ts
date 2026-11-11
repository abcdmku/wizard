import { describe, expect, it } from 'vitest'
import { resolveWebsocketUrl } from './session'

describe('resolveWebsocketUrl', () => {
  it('keeps /ws on a custom page origin and port', () => {
    expect(resolveWebsocketUrl('http://localhost:4490/play', 'signed ticket', '/ws')).toBe(
      'ws://localhost:4490/ws?token=signed+ticket',
    )
  })

  it('uses secure WebSockets for an HTTPS page origin', () => {
    expect(resolveWebsocketUrl('https://dungeon.example.test:8443/', 'ticket', '/ws')).toBe(
      'wss://dungeon.example.test:8443/ws?token=ticket',
    )
  })

  it('falls back to the same-origin proxy when no build override exists', () => {
    expect(resolveWebsocketUrl('http://127.0.0.1:4555/', 'ticket')).toBe(
      'ws://127.0.0.1:4555/ws?token=ticket',
    )
  })
})
