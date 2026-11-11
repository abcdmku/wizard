import {
  type ClientCommand,
  ClientCommandSchema,
  type ClientMessage,
  ClientMessageSchema,
  MAX_SERVER_FRAME_BYTES,
  type PlayerProjection,
  ServerFrameSchema,
} from '@wizard/dungeon-shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MovementCommandGate } from './movementCommandGate'
import { type DungeonSession, websocketUrl } from './session'
import { decideSnapshot, type SnapshotCursor, snapshotCursor } from './snapshotOrder'

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'rejected'

interface ConnectionView {
  status: SocketStatus
  retryInMs: number | null
  message: string | null
}

const initialConnection: ConnectionView = {
  status: 'connecting',
  retryInMs: null,
  message: null,
}

const messageText = async (data: unknown): Promise<string | null> => {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (data instanceof Blob) return data.text()
  return null
}

const transmit = (socket: WebSocket, message: ClientMessage): boolean => {
  const parsed = ClientMessageSchema.safeParse(message)
  if (!parsed.success || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(parsed.data))
  return true
}

export const useDungeonSocket = (session: DungeonSession | null) => {
  const [projection, setProjection] = useState<PlayerProjection | null>(null)
  const [connection, setConnection] = useState<ConnectionView>(initialConnection)
  const [connectVersion, setConnectVersion] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const projectionRef = useRef<PlayerProjection | null>(null)
  const cursorRef = useRef<SnapshotCursor | null>(null)
  const sessionRef = useRef<DungeonSession | null>(null)
  const attemptRef = useRef(0)
  const movementGateRef = useRef(new MovementCommandGate())
  projectionRef.current = projection

  const retryNow = useCallback(() => {
    attemptRef.current = 0
    movementGateRef.current.clear()
    socketRef.current?.close(4_000, 'retry requested')
    setConnectVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    if (session === null) {
      socketRef.current?.close(1_000, 'session cleared')
      socketRef.current = null
      projectionRef.current = null
      cursorRef.current = null
      sessionRef.current = null
      movementGateRef.current.clear()
      setProjection(null)
      return
    }
    if (sessionRef.current !== session) {
      sessionRef.current = session
      cursorRef.current = null
      projectionRef.current = null
      movementGateRef.current.clear()
      setProjection(null)
    }
    let active = true
    let rejected = false
    let retryTimer: number | null = null
    let countdownTimer: number | null = null
    let welcomeTimer: number | null = null
    const socket = new WebSocket(websocketUrl(session))
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    const reconnecting = projectionRef.current !== null || connectVersion > 0
    setConnection({
      status: reconnecting ? 'reconnecting' : 'connecting',
      retryInMs: null,
      message: reconnecting ? 'Restoring your run...' : 'Authenticating player ticket...',
    })

    const requestSnapshot = () => {
      transmit(socket, { type: 'request-snapshot', partyId: session.join.partyId })
    }

    const scheduleReconnect = () => {
      if (!active || rejected) return
      if (!navigator.onLine) {
        setConnection({
          status: 'offline',
          retryInMs: null,
          message: 'Check your network connection.',
        })
        return
      }
      const attempt = attemptRef.current
      const delay = Math.min(8_000, 500 * 2 ** attempt)
      attemptRef.current = attempt + 1
      const retryAt = Date.now() + delay
      setConnection({ status: 'reconnecting', retryInMs: delay, message: null })
      countdownTimer = window.setInterval(() => {
        setConnection((current) => ({ ...current, retryInMs: Math.max(0, retryAt - Date.now()) }))
      }, 250)
      retryTimer = window.setTimeout(() => setConnectVersion((version) => version + 1), delay)
    }

    const rejectConnection = (message: string) => {
      rejected = true
      setConnection({ status: 'rejected', retryInMs: null, message })
      socket.close(1_000, 'authentication rejected')
    }

    const receive = async (data: unknown) => {
      const text = await messageText(data)
      if (!active || text === null) return
      if (new TextEncoder().encode(text).byteLength > MAX_SERVER_FRAME_BYTES) {
        rejectConnection('Server update exceeded the protocol limit.')
        return
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        requestSnapshot()
        return
      }
      const result = ServerFrameSchema.safeParse(value)
      if (!result.success || result.data.partyId !== session.join.partyId) {
        requestSnapshot()
        return
      }
      const frame = result.data
      switch (frame.type) {
        case 'welcome':
          if (welcomeTimer !== null) window.clearTimeout(welcomeTimer)
          setConnection({
            status: 'connecting',
            retryInMs: null,
            message: 'Synchronizing dungeon...',
          })
          requestSnapshot()
          break
        case 'snapshot':
          {
            const decision = decideSnapshot(
              cursorRef.current,
              frame,
              projectionRef.current !== null,
            )
            if (!decision.restoreConnection) break
            if (decision.replaceProjection) {
              cursorRef.current = snapshotCursor(frame)
              projectionRef.current = frame.projection
              setProjection(frame.projection)
            }
          }
          attemptRef.current = 0
          setConnection({ status: 'connected', retryInMs: null, message: null })
          break
        case 'ack':
          movementGateRef.current.settleFrame(frame)
          if (!frame.ok && frame.code === 'sequence-conflict') requestSnapshot()
          if (!frame.ok) setConnection((current) => ({ ...current, message: frame.message }))
          break
        case 'error':
          movementGateRef.current.settleFrame(frame)
          if (frame.error.code === 'unauthorized' || frame.error.code === 'forbidden') {
            rejectConnection(frame.error.message)
          } else {
            setConnection((current) => ({ ...current, message: frame.error.message }))
            if (frame.error.code === 'sequence-conflict') requestSnapshot()
          }
          break
      }
    }

    socket.onopen = () => {
      welcomeTimer = window.setTimeout(() => socket.close(4_002, 'welcome timeout'), 10_000)
    }
    socket.onmessage = (event: MessageEvent<unknown>) => {
      void receive(event.data)
    }
    socket.onerror = () => socket.close()
    socket.onclose = (event: CloseEvent) => {
      if (socketRef.current === socket) movementGateRef.current.clear()
      if (welcomeTimer !== null) window.clearTimeout(welcomeTimer)
      if (event.code === 4_401 || event.code === 4_403) {
        rejected = true
        setConnection({
          status: 'rejected',
          retryInMs: null,
          message:
            event.code === 4_401
              ? 'Player ticket expired or invalid.'
              : 'This player is not in the party.',
        })
        return
      }
      if (active && !rejected) scheduleReconnect()
    }

    return () => {
      active = false
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (countdownTimer !== null) window.clearInterval(countdownTimer)
      if (welcomeTimer !== null) window.clearTimeout(welcomeTimer)
      movementGateRef.current.clear()
      socket.close(1_000, 'client cleanup')
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [connectVersion, session])

  useEffect(() => {
    const online = () => retryNow()
    const offline = () =>
      setConnection({
        status: 'offline',
        retryInMs: null,
        message: 'Check your network connection.',
      })
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [retryNow])

  const send = useCallback(
    (command: ClientCommand) => {
      if (session === null) return false
      const parsed = ClientCommandSchema.safeParse(command)
      if (!parsed.success) return false
      const message: ClientMessage = {
        type: 'command',
        partyId: session.join.partyId,
        commandId: crypto.randomUUID(),
        command: parsed.data,
      }
      if (!movementGateRef.current.start(message.commandId, parsed.data)) return false
      const socket = socketRef.current
      const sent = socket !== null && transmit(socket, message)
      if (!sent) movementGateRef.current.settle(message.commandId)
      return sent
    },
    [session],
  )

  return { projection, epoch: cursorRef.current?.epoch ?? null, ...connection, retryNow, send }
}
