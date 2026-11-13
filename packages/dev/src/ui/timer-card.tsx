import type { Manifest } from '@openwizard/core/inspect'
import type { ReactElement, ReactNode } from 'react'
import type { NextTimer, RunDetail } from '../wire'
import { stepLabel } from './format'
import { advanceCode, Card, Deadline } from './need'
import { nodeOf } from './step-facts'

/** `attempt 2 of 3`, or nothing when the step has no retry policy. */
export const attemptText = (attempt?: number, attempts?: number): string | undefined =>
  attempt === undefined || attempts === undefined ? undefined : `attempt ${attempt} of ${attempts}`

interface Told {
  readonly title: ReactNode
  readonly note: string
  readonly verb: string
  readonly effect: string
  /** The duration the step declares, when the manifest has it. */
  readonly full?: number
}

/** What a person reads about a timer, from what the server knows it is for. */
function tell(timer: NextTimer | undefined, manifest: Manifest | undefined): Told {
  const name = timer?.step === undefined ? undefined : stepLabel(timer.path, timer.step)
  const node =
    timer?.step === undefined ? undefined : nodeOf(manifest, [...timer.path, timer.step].join('/'))
  const step = <code>{name}</code>
  switch (name === undefined ? 'unknown' : timer?.purpose) {
    case 'retry':
      return {
        title: <>Retry delay: {step}</>,
        note: `${name} failed and waits before it tries again.`,
        verb: `${name} tries again`,
        effect: 'the next attempt starts now',
        ...(typeof node?.retry?.backoff === 'number' ? { full: node.retry.backoff } : {}),
      }
    case 'timeout':
      return {
        title: <>Timeout of {step}</>,
        note: `${name} is working. If it has not finished by then, the attempt fails.`,
        verb: 'Times out',
        effect: 'the running attempt times out now',
        ...(node?.timeout === undefined ? {} : { full: node.timeout }),
      }
    case 'undoTimeout':
      return {
        title: <>Timeout of the undo hook of {step}</>,
        note: `The run undoes ${name}. If the undo hook has not finished by then, it fails.`,
        verb: 'Times out',
        effect: 'the undo hook times out now',
      }
    case 'waitTimeout':
      return {
        title: <>Timeout of {step}</>,
        note: `${name} waits for an event. If none comes by then, the wait times out.`,
        verb: 'Times out',
        effect: 'the wait times out now',
        ...(node?.timeout === undefined ? {} : { full: node.timeout }),
      }
    case 'sleep':
      return {
        title: <>Sleep of {step}</>,
        note: 'The step sleeps until a set time, then the run goes on by itself.',
        verb: 'Wakes',
        effect: 'the step wakes now',
        ...(typeof node?.sleep === 'number' ? { full: node.sleep } : {}),
      }
    case 'compensationGrace':
      return {
        title: <>Undo grace period of {step}</>,
        note: 'The run waits for work in flight to settle before it undoes it.',
        verb: 'Ends',
        effect: 'undoing starts now',
      }
    case 'inboxTtl':
      return {
        title: <>Buffered event for {step}</>,
        note: 'An event arrived before its step waited for it. It is kept until then.',
        verb: 'Expires',
        effect: 'the event is dropped now',
      }
    default:
      return {
        title: 'Next timer',
        note: 'The dev server cannot tell which step set this timer.',
        verb: 'Fires',
        effect: 'it fires now',
      }
  }
}

/**
 * The run's next timer when no form, event or sleep card shows it: a retry delay, the run
 * timeout of a working step, or another timer the engine keeps, named by `run.timer`.
 */
export function TimerCard(props: {
  readonly run: RunDetail
  readonly at: number
  readonly manifest: Manifest | undefined
}): ReactElement {
  const { run, at } = props
  const timer = run.timer?.at === at ? run.timer : undefined
  const told = tell(timer, props.manifest)
  const attempt = attemptText(timer?.attempt, timer?.attempts)
  return (
    <Card
      kind="timer"
      title={told.title}
      meta={attempt}
      note={told.note}
      code={advanceCode(at - run.now, told.full)}
    >
      <Deadline run={run.id} left={at - run.now} next verb={told.verb} effect={told.effect} />
    </Card>
  )
}
