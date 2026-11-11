import type { AnyWizard } from '@openwizard/core'
import { createMirrorSource } from '@openwizard/core/mirror'
import { type APIContext, authorizeFor, findRun, unexpected } from './api-context'
import { failure, json } from './http-response'
import { isRecord } from './json-schema'
import { runOf } from './run-handle'
import { frameStream } from './stream'

/** `GET <base>/:runId`: the projected run. */
export async function readRun<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  runId: string,
): Promise<Response> {
  try {
    const identity = await authorizeFor(api, request, 'read', runId)
    if (identity instanceof Response) return identity
    const handle = await findRun(api, request, identity, runId)
    if (handle instanceof Response) return handle
    return json(200, { ok: true, data: runOf(handle).project(api.projection) })
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'read', runId })
  }
}

/** `GET <base>/:runId/steps/:step`: one step of the projected run. */
export async function readStep<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  runId: string,
  step: string,
): Promise<Response> {
  if (!api.plan.readSteps.includes(step)) {
    return failure(404, 'NOT_FOUND', `step '${step}' is not readable through this API`)
  }
  try {
    const identity = await authorizeFor(api, request, 'read', runId)
    if (identity instanceof Response) return identity
    const handle = await findRun(api, request, identity, runId)
    if (handle instanceof Response) return handle
    const state = runOf(handle).project(api.projection)
    const steps = isRecord(state) && isRecord(state.steps) ? state.steps : {}
    const data = steps[step]
    return data === undefined
      ? failure(404, 'NOT_FOUND', `the projection does not expose step '${step}'`)
      : json(200, { ok: true, data })
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'read', runId })
  }
}

/** `GET <base>/:runId/stream`: Mirror frames of the projected run as server-sent events. */
export async function streamRun<F extends AnyWizard, P>(
  api: APIContext<F, P>,
  request: Request,
  runId: string,
): Promise<Response> {
  try {
    const identity = await authorizeFor(api, request, 'stream', runId)
    if (identity instanceof Response) return identity
    const handle = await findRun(api, request, identity, runId)
    if (handle instanceof Response) return handle
    const source = createMirrorSource(runOf(handle), api.projection)
    return frameStream(source, request, () => source.dispose())
  } catch (error) {
    return unexpected(api.onError, error, { request, operation: 'stream', runId })
  }
}
