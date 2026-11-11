import {
  ClientMessageSchema,
  type ServerFrame,
  type SnapshotFrame,
  type Viewer,
} from '@wizard/dungeon-shared'
import WebSocket from 'ws'
import { encodeServerFrame, isEncodedServerFrameWithinLimit } from './frame-encoding.js'
import { createPlayerSource } from './player-source.js'
import { projectState } from './projection.js'
import type { PartyRuntime } from './runtime.js'
import { ackFrame, errorFrame, snapshotFrame, welcomeFrame } from './transport-helpers.js'

export const MAX_CLIENT_MESSAGE_BYTES = 16_384
export const RUNTIME_UNAVAILABLE_CLOSE_CODE = 1012
const MAX_EARLY_MESSAGE_COUNT = 32

export interface SocketSessionOptions {
  readonly socket: WebSocket
  readonly runtime: PartyRuntime
  readonly viewer: Viewer
  readonly now: () => Date
  readonly alive: Map<WebSocket, boolean>
  readonly connectionCounts: Map<string, number>
  readonly isStopping: () => boolean
  readonly onError?: (error: unknown) => void
  readonly onFrame?: (measurement: { readonly bytes: number; readonly frame: ServerFrame }) => void
}

const report = (options: SocketSessionOptions, error: unknown): void => {
  try {
    options.onError?.(error)
  } catch {
    // Error reporting cannot own a socket.
  }
}

const send = (options: SocketSessionOptions, frame: ServerFrame): boolean => {
  if (options.socket.readyState !== WebSocket.OPEN) return false
  const encoded = encodeServerFrame(frame)
  try {
    options.onFrame?.({ bytes: encoded.bytes, frame })
  } catch {
    // Measurements cannot block a frame.
  }
  if (!isEncodedServerFrameWithinLimit(encoded)) {
    options.socket.close(1009, 'authoritative frame exceeds 25000 bytes')
    return false
  }
  options.socket.send(encoded.payload)
  return true
}

const currentSnapshot = (options: SocketSessionOptions): SnapshotFrame => {
  const { runtime, viewer } = options
  const sequence = runtime.sequence()
  const epoch = runtime.host.version.epoch
  const projection = projectState(runtime.state(), viewer, sequence, epoch)
  return snapshotFrame(runtime, projection, sequence, epoch, options.now)
}

const handleMessage = async (
  options: SocketSessionOptions,
  raw: WebSocket.RawData,
  beforeCommand: () => void,
  afterCommand: () => void,
  sendCurrentSnapshot: () => void,
): Promise<void> => {
  const { runtime, viewer } = options
  const messageBytes = Array.isArray(raw)
    ? raw.reduce((total, part) => total + part.byteLength, 0)
    : raw.byteLength
  if (messageBytes > MAX_CLIENT_MESSAGE_BYTES) {
    send(options, errorFrame(runtime, null, 'invalid-command', 'message is too large'))
    options.socket.close(1009, 'client message exceeds 16384 bytes')
    return
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw.toString())
  } catch {
    send(options, errorFrame(runtime, null, 'invalid-command', 'message must be JSON'))
    return
  }
  const parsed = ClientMessageSchema.safeParse(decoded)
  if (!parsed.success) {
    send(options, errorFrame(runtime, null, 'invalid-command', 'invalid client message'))
    return
  }
  if (parsed.data.partyId !== viewer.partyId) {
    send(options, errorFrame(runtime, null, 'forbidden', 'message party does not match token'))
    return
  }
  if (parsed.data.type === 'request-snapshot') {
    sendCurrentSnapshot()
    return
  }
  beforeCommand()
  try {
    const ack = await runtime.command(viewer, {
      commandId: parsed.data.commandId,
      command: parsed.data.command,
      ...(parsed.data.expectedSequence === undefined
        ? {}
        : { expectedSequence: parsed.data.expectedSequence }),
    })
    send(options, ackFrame(runtime, parsed.data.commandId, ack))
  } catch (error: unknown) {
    report(options, error)
    send(options, errorFrame(runtime, parsed.data.commandId, 'server-error', 'command failed'))
  } finally {
    afterCommand()
  }
}

export const bindPlayerSocket = async (options: SocketSessionOptions): Promise<void> => {
  const { socket, runtime, viewer } = options
  const connectionKey = `${viewer.partyId}:${viewer.playerId}`
  const priorCount = options.connectionCounts.get(connectionKey) ?? 0
  options.connectionCounts.set(connectionKey, priorCount + 1)
  let connectionReleased = false
  let wasLastConnection = false
  let presenceReady = false
  let disconnectStarted = false
  let closed = false
  let runtimeUnavailable = false
  let initialized = false
  let unsubscribeUnavailable = (): void => undefined
  let source: ReturnType<typeof createPlayerSource> | undefined
  let suppressFrames = false
  let lastSnapshot: { readonly epoch: number; readonly tick: number } | undefined
  let commandWatermark: { readonly epoch: number; readonly tick: number } | undefined
  const earlyMessages: WebSocket.RawData[] = []
  let gate = Promise.resolve()

  const releaseConnection = (): void => {
    if (connectionReleased) return
    connectionReleased = true
    const remaining = Math.max(0, (options.connectionCounts.get(connectionKey) ?? 1) - 1)
    if (remaining === 0) options.connectionCounts.delete(connectionKey)
    else options.connectionCounts.set(connectionKey, remaining)
    wasLastConnection = remaining === 0
  }

  const disconnectReleased = async (): Promise<void> => {
    if (
      disconnectStarted ||
      !presenceReady ||
      !connectionReleased ||
      !wasLastConnection ||
      runtimeUnavailable ||
      options.isStopping()
    ) {
      return
    }
    disconnectStarted = true
    await runtime.disconnect(viewer.playerId)
  }

  const deliverSnapshot = (frame: SnapshotFrame): void => {
    if (send(options, frame)) lastSnapshot = { epoch: frame.epoch, tick: frame.tick }
  }

  const deliverCurrentSnapshot = (): void => {
    deliverSnapshot(currentSnapshot(options))
  }

  const beforeCommand = (): void => {
    suppressFrames = true
    commandWatermark = lastSnapshot ?? {
      epoch: runtime.host.version.epoch,
      tick: runtime.state().tick,
    }
  }

  const afterCommand = (): void => {
    suppressFrames = false
    if (!closed) deliverCurrentSnapshot()
    commandWatermark = undefined
  }

  const queueMessage = (raw: WebSocket.RawData): void => {
    gate = gate
      .then(() =>
        closed || runtimeUnavailable
          ? undefined
          : handleMessage(options, raw, beforeCommand, afterCommand, deliverCurrentSnapshot),
      )
      .catch((error: unknown) => {
        report(options, error)
        send(options, errorFrame(runtime, null, 'server-error', 'command failed'))
      })
  }

  const onMessage = (raw: WebSocket.RawData): void => {
    if (closed || runtimeUnavailable) return
    if (initialized) {
      queueMessage(raw)
      return
    }
    if (earlyMessages.length >= MAX_EARLY_MESSAGE_COUNT) {
      socket.close(1008, 'session initialization backlog exceeded')
      return
    }
    earlyMessages.push(raw)
  }
  const onPong = (): void => {
    options.alive.set(socket, true)
  }
  const onClose = (): void => {
    if (closed) return
    closed = true
    initialized = false
    earlyMessages.length = 0
    socket.off('message', onMessage)
    socket.off('pong', onPong)
    unsubscribeUnavailable()
    options.alive.delete(socket)
    source?.dispose()
    releaseConnection()
    void disconnectReleased().catch((error) => report(options, error))
  }

  socket.on('message', onMessage)
  socket.on('close', onClose)
  socket.on('pong', onPong)
  unsubscribeUnavailable = runtime.onUnavailable(() => {
    runtimeUnavailable = true
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(RUNTIME_UNAVAILABLE_CLOSE_CODE, 'party runtime restarting')
    }
  })
  try {
    if (priorCount === 0) await runtime.connect(viewer.playerId)
    presenceReady = true
  } catch (error) {
    closed = true
    earlyMessages.length = 0
    socket.off('message', onMessage)
    socket.off('close', onClose)
    socket.off('pong', onPong)
    unsubscribeUnavailable()
    releaseConnection()
    throw error
  }
  if (closed || socket.readyState !== WebSocket.OPEN) {
    releaseConnection()
    await disconnectReleased()
    return
  }
  options.alive.set(socket, true)
  send(options, welcomeFrame(runtime, viewer))
  const durableVersion = runtime.host.version
  const playerSource = createPlayerSource(runtime.host.run, viewer, {
    world: runtime.state(),
    sequence: durableVersion.seq,
    epoch: durableVersion.epoch,
  })
  source = playerSource
  if (closed) {
    playerSource.dispose()
    return
  }
  playerSource.subscribe((frame) => {
    const snapshot = snapshotFrame(runtime, frame.state, frame.seq, frame.epoch, options.now)
    if (!suppressFrames) {
      deliverSnapshot(snapshot)
      return
    }
    const watermark = commandWatermark
    if (
      watermark === undefined ||
      watermark.epoch !== frame.epoch ||
      frame.state.tick < watermark.tick
    ) {
      commandWatermark = { epoch: frame.epoch, tick: frame.state.tick }
      return
    }
    if (frame.state.tick > watermark.tick) {
      deliverSnapshot(snapshot)
      commandWatermark = { epoch: frame.epoch, tick: frame.state.tick }
    }
  })
  initialized = true
  for (const raw of earlyMessages.splice(0)) queueMessage(raw)
}
