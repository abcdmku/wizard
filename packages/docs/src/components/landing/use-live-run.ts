/**
 * Owns the demo's run lifecycle in the browser: start a run, "crash" it by disposing mid-task,
 * resume from the auto-saved snapshot, deliver the review event, reset. Every action is a real
 * `@openwizard/core` call; the UI only renders what the run reports.
 */
import { createMemoryStore, type Run, type RunEvent, type Snapshot } from '@openwizard/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPayments, type OrderWizard, orderWizard } from './order-wizard'

export type DemoPhase = 'idle' | 'running' | 'crashed' | 'waiting' | 'done' | 'failed'

export interface LiveRun {
  readonly phase: DemoPhase
  readonly state: Snapshot<OrderWizard>['state'] | null
  readonly epoch: number
  readonly events: readonly RunEvent<OrderWizard>[]
  readonly charges: number
  readonly output: string | null
  readonly start: () => void
  readonly crash: () => void
  readonly resume: () => void
  readonly approve: () => void
  readonly reset: () => void
}

const KEY = 'orders/order-1042'
/** Event families hidden from the demo log so the meaningful transitions stand out. */
const NOISE = ['transition.', 'step.arrived', 'step.idempotencyKeyRequested', 'persist.']
const CONTEXT = { orderId: 'order-1042', amount: 129.5 }

function phaseOf(state: Snapshot<OrderWizard>['state'] | null, crashed: boolean): DemoPhase {
  if (!state) return 'idle'
  if (crashed) return 'crashed'
  switch (state.status) {
    case 'idle':
      return 'idle'
    case 'running':
    case 'compensating':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'done':
      return 'done'
    default:
      return 'failed'
  }
}

export function useLiveRun(): LiveRun {
  const store = useRef(createMemoryStore())
  const [charges, setCharges] = useState(0)
  const payments = useRef(createPayments(setCharges))
  const runRef = useRef<Run<OrderWizard> | null>(null)
  const [state, setState] = useState<Snapshot<OrderWizard>['state'] | null>(null)
  const [events, setEvents] = useState<readonly RunEvent<OrderWizard>[]>([])
  const [epoch, setEpoch] = useState(0)
  const [crashed, setCrashed] = useState(false)
  const [output, setOutput] = useState<string | null>(null)

  const adopt = useCallback((run: Run<OrderWizard>) => {
    runRef.current = run
    setEpoch(run.epoch)
    setCrashed(false)
    setState(run.getState())
    run.subscribe(setState)
    run.observe((event) => {
      if (NOISE.some((prefix) => event.type.startsWith(prefix))) return
      setEvents((log) => [...log.slice(-7), event])
    })
    run.subscribeResult((result) => {
      setOutput(result.status === 'done' ? String(result.output) : null)
    })
  }, [])

  const options = useCallback(
    () => ({ deps: { payments: payments.current }, store: store.current, key: KEY }),
    [],
  )

  const start = useCallback(() => {
    if (runRef.current) return
    const run = orderWizard.create(CONTEXT, { instanceId: 'order-1042', ...options() })
    adopt(run)
    void run.start()
  }, [adopt, options])

  const crash = useCallback(() => {
    const run = runRef.current
    if (!run) return
    // The provider already accepted the in-flight charge; this process just never hears back.
    run.dispose()
    runRef.current = null
    setCrashed(true)
  }, [])

  const resume = useCallback(async () => {
    const saved = await store.current.get(KEY)
    if (!saved || runRef.current) return
    adopt(orderWizard.resume(saved, options()))
  }, [adopt, options])

  const approve = useCallback(() => {
    void runRef.current?.send('review.approved', { by: 'reviewer@example.com' })
  }, [])

  const reset = useCallback(() => {
    runRef.current?.dispose()
    runRef.current = null
    store.current.clear()
    payments.current.reset()
    setState(null)
    setEvents([])
    setEpoch(0)
    setCrashed(false)
    setCharges(0)
    setOutput(null)
  }, [])

  useEffect(() => () => runRef.current?.dispose(), [])

  return {
    phase: phaseOf(state, crashed),
    state,
    epoch,
    events,
    charges,
    output,
    start,
    crash,
    resume: () => void resume(),
    approve,
    reset,
  }
}
