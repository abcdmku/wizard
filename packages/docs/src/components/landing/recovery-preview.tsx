import {
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Database,
  Play,
  RotateCcw,
  ServerCrash,
  ShieldCheck,
  Webhook,
} from 'lucide-react'
import { STEP_NAMES } from './order-wizard'
import { type DemoPhase, type LiveRun, useLiveRun } from './use-live-run'

const PHASES: readonly { readonly id: DemoPhase; readonly tab: string }[] = [
  { id: 'idle', tab: 'Start' },
  { id: 'running', tab: 'Running' },
  { id: 'crashed', tab: 'Crashed' },
  { id: 'waiting', tab: 'Resumed' },
  { id: 'done', tab: 'Done' },
]

const STATUS_CLASS: Record<DemoPhase, string> = {
  idle: 'waiting',
  running: 'active',
  crashed: 'interrupted',
  waiting: 'waiting',
  done: 'complete',
  failed: 'interrupted',
}

const workerName = (epoch: number) => `worker-${String.fromCharCode(97 + epoch)}`

function narrative(live: LiveRun) {
  const worker = workerName(live.epoch)
  switch (live.phase) {
    case 'idle':
      return {
        icon: Play,
        title: 'A real run, in this tab',
        detail:
          'Start creates a run of a four-step order wizard with @openwizard/core. Only the payment provider is fake.',
        note: 'The provider takes a few seconds to answer. That is your window to pull the plug.',
        action: { label: 'Start run', onClick: live.start, icon: ChevronRight },
      }
    case 'running':
      return {
        icon: CreditCard,
        title: `${worker} is charging order-1042`,
        detail: `chargeCard sent the provider idempotency key order:order-1042:charge. Charges so far: ${live.charges}.`,
        note: 'Crash now: the provider has accepted a charge that this process will never hear about.',
        action: { label: 'Crash the process', onClick: live.crash, icon: ServerCrash },
      }
    case 'crashed':
      return {
        icon: ServerCrash,
        title: `${worker} died mid-charge`,
        detail:
          'run.dispose() killed it. The auto-saved snapshot shows chargeCard active with no result.',
        note: 'A non-idempotent task would resume as failed. This one is idempotent, so it may rerun with the same key.',
        action: { label: 'Resume from the snapshot', onClick: live.resume, icon: RotateCcw },
      }
    case 'waiting':
      return {
        icon: Database,
        title: `${worker} resumed from the snapshot`,
        detail: `chargeCard ran again with the same key and got the stored charge back. Charges so far: ${live.charges}. fraudReview now waits for an event.`,
        note: 'The wait and its 30-minute timeout are in the snapshot too. You could crash and resume again here.',
        action: { label: 'Deliver review.approved', onClick: live.approve, icon: Webhook },
      }
    case 'done':
      return {
        icon: Check,
        title: 'review.approved was validated and delivered',
        detail: `fulfillOrder ran and the run finished: ${live.output ?? ''}.`,
        note: 'The events above came from run.log(). The same stream can drive a UI, an audit trail, or replay().',
        action: { label: 'Reset', onClick: live.reset, icon: RotateCcw },
      }
    default:
      return {
        icon: ServerCrash,
        title: 'The run failed',
        detail: 'Inspect run.getState().steps for the error, then reset.',
        note: '',
        action: { label: 'Reset', onClick: live.reset, icon: RotateCcw },
      }
  }
}

function stepDetail(live: LiveRun, name: (typeof STEP_NAMES)[number]): string {
  const step = live.state?.steps[name]
  if (!step || step.status === 'idle') return 'idle'
  if (name === 'chargeCard' && step.status === 'active') {
    return live.phase === 'crashed' ? 'in flight when the process died' : 'calling the provider'
  }
  if (name === 'chargeCard' && step.status === 'done') return `charged once, ${live.charges} total`
  if (name === 'fraudReview' && step.status === 'active') return 'waiting for review.approved'
  if (step.status === 'done') return `done (attempt ${step.attempt})`
  if (step.error) return step.error.message
  return step.status
}

function remaining(live: LiveRun): string {
  if (live.phase === 'done') return 'cleared'
  const deadline = live.state?.steps.fraudReview.deadline
  if (!deadline) return 'none'
  return `${Math.max(0, Math.round((deadline - Date.now()) / 60_000))}m remaining`
}

function visualState(live: LiveRun, name: (typeof STEP_NAMES)[number]): string {
  const status = live.state?.steps[name].status ?? 'idle'
  if (status === 'done') return 'done'
  if (status !== 'active') return 'blocked'
  if (live.phase === 'crashed') return 'interrupted'
  return name === 'fraudReview' ? 'waiting' : 'running'
}

function ownerLabel(live: LiveRun): string {
  switch (live.phase) {
    case 'idle':
      return 'none'
    case 'crashed':
      return 'lease expired'
    case 'done':
      return 'released'
    default:
      return workerName(live.epoch)
  }
}

export function RecoveryPreview() {
  const live = useLiveRun()
  const story = narrative(live)
  const EventIcon = story.icon
  const ActionIcon = story.action.icon

  return (
    <section className="recovery-demo" aria-label="Live workflow recovery demo">
      <div className="recovery-demo-bar">
        <div>
          <span className="recovery-demo-mark">OW</span>
          <span>order-1042</span>
        </div>
        <span className={`recovery-demo-status recovery-demo-status-${STATUS_CLASS[live.phase]}`}>
          <span aria-hidden="true" />
          {live.phase === 'crashed' ? 'interrupted' : (live.state?.status ?? 'not started')}
        </span>
      </div>

      <div className="recovery-demo-tabs">
        {PHASES.map((item, index) => (
          <button
            key={item.id}
            type="button"
            disabled
            aria-current={live.phase === item.id ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            {item.tab}
          </button>
        ))}
      </div>

      <div className="recovery-demo-body" aria-live="polite">
        <div className="recovery-demo-event">
          <div>
            <EventIcon aria-hidden="true" />
          </div>
          <span>
            <strong>{story.title}</strong>
            <small>{story.detail}</small>
          </span>
        </div>

        <div className="recovery-demo-steps">
          {STEP_NAMES.map((name, index) => {
            const status = live.state?.steps[name].status ?? 'idle'
            return (
              <div className="recovery-demo-step" key={name}>
                <span
                  className={`recovery-demo-step-state recovery-demo-step-state-${visualState(live, name)}`}
                >
                  {status === 'done' ? <Check aria-hidden="true" /> : index + 1}
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{stepDetail(live, name)}</small>
                </span>
                <code className="recovery-demo-step-label">{status}</code>
              </div>
            )
          })}
        </div>

        <div className="recovery-demo-facts">
          <div>
            <Database aria-hidden="true" />
            <span>
              snapshot
              <strong>{live.state ? `epoch ${live.epoch}, seq ${live.state.seq}` : 'none'}</strong>
            </span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>
              owner<strong>{ownerLabel(live)}</strong>
            </span>
          </div>
          <div>
            <CreditCard aria-hidden="true" />
            <span>
              charges<strong>{live.charges}</strong>
            </span>
          </div>
          <div>
            <Clock3 aria-hidden="true" />
            <span>
              timeout<strong>{remaining(live)}</strong>
            </span>
          </div>
        </div>

        {live.events.length > 0 && (
          <ol className="recovery-demo-log" aria-label="Run events">
            {live.events.map((event) => (
              <li key={`${event.seq}:${event.type}:${'step' in event ? String(event.step) : ''}`}>
                <span>{event.seq}</span>
                <code>{event.type}</code>
                {'step' in event && typeof event.step === 'string' && <small>{event.step}</small>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="recovery-demo-action">
        <p>{story.note}</p>
        <button type="button" onClick={story.action.onClick}>
          {story.action.label}
          <ActionIcon aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
