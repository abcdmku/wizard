import { type ServerFrame, ServerFrameSchema } from '@wizard/dungeon-shared'
import WebSocket, { type RawData } from 'ws'

interface Waiter {
  readonly matches: (frame: ServerFrame) => boolean
  readonly resolve: (frame: ServerFrame) => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export class WsPeer {
  readonly socket: WebSocket
  readonly frames: ServerFrame[] = []
  private readonly waiters: Waiter[] = []
  private failure: Error | undefined

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (raw) => this.receive(raw))
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value))
  }

  sendRaw(value: string): void {
    this.socket.send(value)
  }

  next(matches: (frame: ServerFrame) => boolean, timeoutMs = 5_000): Promise<ServerFrame> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const index = this.frames.findIndex(matches)
    if (index >= 0) {
      const frame = this.frames.splice(index, 1)[0]
      if (frame !== undefined) return Promise.resolve(frame)
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.resolve === resolve)
        if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1)
        reject(new Error(`timed out waiting for frame after ${timeoutMs}ms`))
      }, timeoutMs)
      this.waiters.push({ matches, resolve, reject, timeout })
    })
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()))
    this.socket.close()
    await closed
  }

  private receive(raw: RawData): void {
    let value: unknown
    try {
      value = JSON.parse(raw.toString())
    } catch {
      this.fail(new Error('server sent malformed JSON'))
      return
    }
    const parsed = ServerFrameSchema.safeParse(value)
    if (!parsed.success) {
      this.fail(new Error(`server frame failed schema validation: ${parsed.error.message}`))
      return
    }
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.matches(parsed.data))
    if (waiterIndex < 0) {
      this.frames.push(parsed.data)
      return
    }
    const waiter = this.waiters.splice(waiterIndex, 1)[0]
    if (waiter === undefined) return
    clearTimeout(waiter.timeout)
    waiter.resolve(parsed.data)
  }

  private fail(error: Error): void {
    this.failure = error
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeout)
      waiter.reject(error)
    }
  }
}

export function connectWs(url: string): Promise<WsPeer> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const peer = new WsPeer(socket)
    socket.once('open', () => resolve(peer))
    socket.once('error', (error) => reject(error))
  })
}

export function waitForWsClose(
  socket: WebSocket,
  timeoutMs = 5_000,
): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`timed out waiting for close after ${timeoutMs}ms`)),
      timeoutMs,
    )
    socket.once('close', (code, reason) => {
      clearTimeout(timeout)
      resolve({ code, reason: reason.toString() })
    })
  })
}
