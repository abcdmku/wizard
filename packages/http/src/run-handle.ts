import type {
  AnyWizard,
  Command,
  CommandResult,
  EventType,
  Run,
  SendResult,
} from '@openwizard/core'

/** A refusal of a durable host's own gate (lease, version, dedupe), not of the run. @public */
export interface DurableHostFailure {
  readonly ok: false
  readonly code: string
  readonly message: string
}

/**
 * A multi-owner host such as `@openwizard/durable`'s `DurableRunHost`. When `runs` or a
 * receiver's `resolve` returns one, HTTP commands and events go through its lease, version and
 * dedupe checks: a SHA-256 of the scoped `Idempotency-Key` (or receiver `webhook-id`) becomes the
 * command or event id.
 * @public
 */
export interface DurableRunHandle<F extends AnyWizard> {
  readonly run: Run<F>
  dispatch(
    command: Command<F>,
    options: {
      readonly commandId: string
      readonly digest?: string
      readonly expectedVersion?: { readonly epoch: number; readonly seq: number }
    },
  ): Promise<{ readonly ok: true; readonly result: CommandResult } | DurableHostFailure>
  send(
    event: EventType<F>,
    payload: unknown,
    options: { readonly eventId: string; readonly correlationId?: string },
  ): Promise<SendResult | DurableHostFailure>
}

/** What a data layer or resolver may return: a live run, or a durable host that owns one. @public */
export type RunHandle<F extends AnyWizard> = Run<F> | DurableRunHandle<F>

/**
 * A refusal the run never recorded: a durable host's gate (lease lost, id reused, id still
 * pending), a disposed run, or an event sent before the run started. `idempotent` answers it
 * without storing it, so a retry with the same key reaches the run again.
 */
export interface Unrecorded {
  readonly ok: false
  readonly unrecorded: true
  readonly status: 409 | 422 | 503
  readonly code: string
  readonly message: string
}

export function runOf<F extends AnyWizard>(handle: RunHandle<F>): Run<F> {
  return isDurable(handle) ? handle.run : handle
}

/**
 * The ids a durable host dedupes on: a SHA-256 of the scoped idempotency `key` (so ids from
 * different APIs, tenants, runs and routes never meet) and, for commands, of the command itself.
 * Hash them before resolving the run so resolving a live owner happens as close to dispatch as
 * possible. The durable host must also accept a handle held across other I/O awaits.
 */
interface HostIds {
  readonly id: string | undefined
  readonly digest?: string
  readonly expectedSeq?: number
}

export async function hostIds(key: string | undefined, command?: unknown): Promise<HostIds> {
  const id = key === undefined ? undefined : await sha256(key)
  return command === undefined ? { id } : { id, digest: await sha256(JSON.stringify(command)) }
}

/** Dispatch through the host when there is one, deduped on `ids` (from `hostIds(key, command)`). */
export async function dispatchThrough<F extends AnyWizard>(
  handle: RunHandle<F>,
  command: Command<F>,
  ids: HostIds,
): Promise<CommandResult | Unrecorded> {
  const run = runOf(handle)
  const options =
    ids.expectedSeq === undefined
      ? undefined
      : { expectedVersion: { epoch: run.epoch, seq: ids.expectedSeq } }
  if (!isDurable(handle)) return unlessDisposed(await run.dispatch(command, options))
  const result = await handle.dispatch(command, {
    commandId: ids.id ?? crypto.randomUUID(),
    ...(ids.digest === undefined ? {} : { digest: ids.digest }),
    ...(ids.expectedSeq === undefined
      ? {}
      : { expectedVersion: { epoch: run.epoch, seq: ids.expectedSeq } }),
  })
  if (!result.ok && result.code === 'CAS_CONFLICT' && ids.expectedSeq !== undefined) {
    return {
      ok: false,
      code: 'STALE',
      message: `the run is at seq ${run.getState().seq}, not ${ids.expectedSeq}`,
    }
  }
  return result.ok ? unlessDisposed(result.result) : hostFailure(result.code)
}

/** Send through the host when there is one; the run dedupes on `ids.id` (from `hostIds(key)`). */
export async function sendThrough<F extends AnyWizard>(
  handle: RunHandle<F>,
  event: EventType<F>,
  payload: unknown,
  delivery: { readonly ids: HostIds; readonly correlationId?: string | undefined },
): Promise<SendResult | Unrecorded> {
  const eventId = delivery.ids.id
  const correlation =
    delivery.correlationId === undefined ? {} : { correlationId: delivery.correlationId }
  const result = isDurable(handle)
    ? await handle.send(event, payload, { eventId: eventId ?? crypto.randomUUID(), ...correlation })
    : await handle.send(event, payload, {
        ...(eventId === undefined ? {} : { eventId }),
        ...correlation,
      })
  if (!isRunResult(result)) return hostFailure(result.code)
  if (result.ok || result.code !== 'RUN_NOT_STARTED') return unlessDisposed(result)
  // Refused at the run's status gate, before it recorded the id: a retry after `start()` delivers.
  return { ok: false, unrecorded: true, status: 409, code: result.code, message: result.message }
}

export function isUnrecorded(value: object): value is Unrecorded {
  return 'unrecorded' in value && value.unrecorded === true
}

function isDurable<F extends AnyWizard>(handle: RunHandle<F>): handle is DurableRunHandle<F> {
  return 'run' in handle && typeof handle.run === 'object'
}

/** A run's `SendResult` failure always names its `reason`; a host refusal never does. */
function isRunResult(result: SendResult | DurableHostFailure): result is SendResult {
  return result.ok || 'reason' in result
}

/** A disposed run (shutdown or eviction racing the request) is unavailable, like a lost lease. */
function unlessDisposed<R extends CommandResult | SendResult>(result: R): R | Unrecorded {
  if (result.ok || result.code !== 'DISPOSED') return result
  return {
    ok: false,
    unrecorded: true,
    status: 503,
    code: 'RUN_UNAVAILABLE',
    message: 'the run was disposed before it took the request; retry shortly',
  }
}

function hostFailure(code: string): Unrecorded {
  if (code === 'DEDUPLICATE_CONFLICT') {
    return {
      ok: false,
      unrecorded: true,
      status: 422,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'this idempotency key was already used for a different request',
    }
  }
  if (code === 'COMMAND_INTERRUPTED') {
    return {
      ok: false,
      unrecorded: true,
      status: 409,
      code: 'IDEMPOTENCY_INTERRUPTED',
      message:
        'the worker stopped while applying this request, so it may have been applied; read the run and retry with a new key',
    }
  }
  if (code === 'COMMAND_PENDING') {
    return {
      ok: false,
      unrecorded: true,
      status: 409,
      code: 'IDEMPOTENCY_PENDING',
      message: 'a request with this idempotency key is still running; retry shortly',
    }
  }
  return {
    ok: false,
    unrecorded: true,
    status: 503,
    code: 'RUN_UNAVAILABLE',
    message: `the run's durable host refused the request (${code}); retry shortly`,
  }
}

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
