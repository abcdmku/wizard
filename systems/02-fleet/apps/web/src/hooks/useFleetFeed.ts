import { useCallback, useEffect, useState } from 'react'
import { FleetApiError, getDashboard, streamDashboards } from '../lib/api'
import type { Dashboard } from '../model'

export type ConnectionPhase = 'loading' | 'connecting' | 'live' | 'reconnecting' | 'failed'

interface FeedState {
  dashboard: Dashboard | undefined
  error: string | undefined
  phase: ConnectionPhase
  retryCount: number
}

interface FleetFeed extends FeedState {
  applyDashboard: (dashboard: Dashboard) => void
  retry: () => void
}

const initialState: FeedState = {
  dashboard: undefined,
  error: undefined,
  phase: 'loading',
  retryCount: 0,
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Fleet updates stopped unexpectedly.'
}

function isAborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useFleetFeed(token: string, onUnauthorized: () => void): FleetFeed {
  const [state, setState] = useState<FeedState>(initialState)
  const [generation, setGeneration] = useState(0)

  const applyDashboard = useCallback((dashboard: Dashboard) => {
    setState((current) => ({ ...current, dashboard, error: undefined }))
  }, [])

  const retry = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function run(): Promise<void> {
      let current: Dashboard | undefined
      let attempts = 0
      setState((current) =>
        generation > 0 && current.dashboard
          ? {
              ...current,
              error: undefined,
              phase: 'connecting',
              retryCount: 0,
            }
          : initialState,
      )

      while (active) {
        try {
          if (!current) {
            current = await getDashboard(token, controller.signal)
            if (!active) return
            setState({
              dashboard: current,
              error: undefined,
              phase: 'connecting',
              retryCount: 0,
            })
          }

          for await (const dashboard of streamDashboards(token, controller.signal)) {
            if (!active) return
            current = dashboard
            attempts = 0
            setState({
              dashboard,
              error: undefined,
              phase: 'live',
              retryCount: 0,
            })
          }
          if (active) throw new Error('The live stream closed.')
        } catch (error) {
          if (!active || isAborted(error)) return
          if (error instanceof FleetApiError && error.status === 401) {
            onUnauthorized()
            return
          }

          attempts += 1
          const delay = Math.min(1_000 * 2 ** (attempts - 1), 15_000)
          setState((value) => ({
            ...value,
            error: messageFor(error),
            phase: current ? 'reconnecting' : attempts >= 4 ? 'failed' : 'loading',
            retryCount: attempts,
          }))
          await pause(delay, controller.signal)
        }
      }
    }

    void run()
    return () => {
      active = false
      controller.abort()
    }
  }, [generation, onUnauthorized, token])

  return { ...state, applyDashboard, retry }
}
