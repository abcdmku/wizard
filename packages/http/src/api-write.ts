import {
  type AnyWizard,
  type CommandResult,
  type ContextInput,
  type EventType,
  isWizardError,
  parseCommand,
} from '@openwizard/core'
import { parseWireCommand, type WireAck } from '@openwizard/core/mirror'
import { commandAllowed } from './access'
import { type APIContext, authorizeFor, findRun, idempotencyKey, unexpected } from './api-context'
import { failure, json, readJson } from './http-response'
import { idempotent } from './idempotency'
import { isStandardSchema, jsonIssues } from './json-schema'
import { dispatchThrough, hostIds, isUnrecorded, runOf, sendThrough } from './run-handle'
import { commandResponse, sendResponse } from './run-responses'

/** `POST <base>`: check the context input and create a run through `runs.create`. */
export async function createRun<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
): Promise<Response> {
  try {
    const identity = await authorizeFor(api, request, 'create')
    if (identity instanceof Response) return identity
    const body = await readJson(request, api.maxBodyBytes)
    if (body instanceof Response) return body
    const issues = await contextIssues(api.wizard, body.value)
    if (issues !== undefined) return rejected(api, issues)
    const key = idempotencyKey(api, request, identity, 'create')
    return await idempotent(api.idempotency, key?.scoped, body.text, async () => {
      try {
        const handle = await api.runs.create?.({
          request,
          tenantId: identity.tenantId,
          principal: identity.principal,
          // The context boundary accepted this value above (or rejects it in `createRun` below).
          input: body.value as ContextInput<F>,
          ...(key === undefined ? {} : { idempotencyKey: key.raw }),
        })
        if (handle === undefined)
          throw new TypeError('runs.create is required by the create capability')
        return json(201, { ok: true, data: runOf(handle).project(api.projection) })
      } catch (error) {
        // A checker boundary rejects inside `createRun`, as a `WizardError` with issues.
        if (isWizardError(error) && error.code === 'BOUNDARY_REJECTED') {
          return rejected(api, error.issues ?? [])
        }
        throw error
      }
    })
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'create' })
  }
}

/** `POST <base>/:runId/commands`: one run or step command inside the declared access. */
export async function dispatchCommand<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  runId: string,
): Promise<Response> {
  try {
    const identity = await authorizeFor(api, request, 'command', runId)
    if (identity instanceof Response) return identity
    const body = await readJson(request, api.maxBodyBytes)
    if (body instanceof Response) return body
    const parsed = parseCommand(api.wizard, body.value)
    if (!parsed.ok) {
      return failure(400, 'INVALID_COMMAND', 'the body is not a command of this wizard', {
        issues: parsed.issues,
      })
    }
    const command = parsed.value
    if (command.type === 'send') {
      return failure(
        400,
        'INVALID_COMMAND',
        `send events through POST ${api.basePath}/{runId}/events/{event}`,
      )
    }
    if (!commandAllowed(api.plan, command)) {
      return failure(403, 'COMMAND_NOT_ALLOWED', `this API does not expose ${command.type} here`)
    }
    const key = idempotencyKey(api, request, identity, `command\0${runId}`)
    const ids = await hostIds(key?.scoped, command)
    const handle = await findRun(api, request, identity, runId)
    if (handle instanceof Response) return handle
    return await idempotent(api.idempotency, key?.scoped, body.text, async () =>
      commandResponse(await dispatchThrough(handle, command, ids)),
    )
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'command', runId })
  }
}

/**
 * `POST <base>/:runId/events/<event>`: the body is the event payload; the run dedupes on a hash
 * of the `Idempotency-Key` scoped to this route.
 */
export async function sendEvent<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  runId: string,
  event: EventType<F>,
): Promise<Response> {
  try {
    const identity = await authorizeFor(api, request, 'event', runId)
    if (identity instanceof Response) return identity
    const body = await readJson(request, api.maxBodyBytes)
    if (body instanceof Response) return body
    const key = idempotencyKey(api, request, identity, `event\0${runId}\0${event}`)
    const ids = await hostIds(key?.scoped)
    const handle = await findRun(api, request, identity, runId)
    if (handle instanceof Response) return handle
    return await idempotent(api.idempotency, key?.scoped, body.text, async () =>
      sendResponse(await sendThrough(handle, event, body.value, { ids })),
    )
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'event', runId, event })
  }
}

/**
 * `POST <base>/:runId/stream`: a Mirror `WireCommand`, answered with its `WireAck` (the
 * `httpTransport` client speaks it). Access and scopes match the command and event routes;
 * the command id dedupes like an `Idempotency-Key`.
 */
export async function dispatchWire<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  runId: string,
): Promise<Response> {
  try {
    const identity = await authorizeFor(api, request, 'command', runId)
    if (identity instanceof Response) return identity
    const body = await readJson(request, api.maxBodyBytes)
    if (body instanceof Response) return body
    const parsed = parseWireCommand(api.wizard, body.value)
    if (!parsed.ok) {
      return failure(400, 'INVALID_COMMAND', 'the body is not a wire command of this wizard', {
        issues: parsed.issues,
      })
    }
    const wire = parsed.value
    const scoped = `${api.id}\0${identity.tenantId}\0wire\0${runId}\0${wire.commandId}`
    const ids = {
      ...(await hostIds(scoped, wire)),
      ...(wire.expectedSeq === undefined ? {} : { expectedSeq: wire.expectedSeq }),
    }
    const handle = await findRun(api, request, identity, runId)
    if (handle instanceof Response) return handle
    const run = runOf(handle)
    const ack = (result: CommandResult): Response =>
      json(200, {
        commandId: wire.commandId,
        result,
        seq: runOf(handle).getState().seq,
      } satisfies WireAck)
    if (wire.instanceId !== run.id) {
      return ack({
        ok: false,
        code: 'INVALID_COMMAND',
        message: `this route serves run '${run.id}'`,
      })
    }
    if (!commandAllowed(api.plan, wire.command)) {
      return ack({
        ok: false,
        code: 'FORBIDDEN',
        message: `this API does not expose ${wire.command.type} here`,
      })
    }
    return await idempotent(api.idempotency, scoped, body.text, async () => {
      const result = await dispatchThrough(handle, wire.command, ids)
      return isUnrecorded(result) ? result : ack(result)
    })
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'command', runId })
  }
}

function rejected<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  issues: readonly { readonly message: string; readonly path?: readonly unknown[] }[],
): Response {
  return failure(
    422,
    'BOUNDARY_REJECTED',
    `the input does not match the ${api.wizard.name} context`,
    {
      issues,
    },
  )
}

/** Issues of the wizard's context boundary for `input`, when it is a Standard Schema. */
async function contextIssues(wizard: AnyWizard, input: unknown) {
  if (!isStandardSchema(wizard.context)) return undefined
  const result = await wizard.context['~standard'].validate(input)
  return result.issues === undefined ? undefined : jsonIssues(result.issues)
}
