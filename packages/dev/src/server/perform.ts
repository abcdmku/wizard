import type { Action, ActionResult } from '../wire'
import { runAt } from './children'
import type { Held } from './runs'

interface Refused {
  readonly ok: false
  readonly message: string
  readonly issues?: ActionResult['issues']
}

const answer = (result: { readonly ok: true } | Refused): ActionResult =>
  result.ok
    ? { ok: true }
    : {
        ok: false,
        message: result.message,
        ...(result.issues === undefined ? {} : { issues: result.issues }),
      }

const known = (found: boolean, what: string): ActionResult =>
  found ? { ok: true } : { ok: false, message: `${what} is no longer waiting.` }

/** Applies one action from the UI to a run and reports what the run answered. */
export async function perform(item: Held, action: Action): Promise<ActionResult> {
  const { run } = item
  switch (action.type) {
    case 'submit': {
      const scope = runAt(run, action.path)
      if (scope === undefined) return { ok: false, message: 'That child run is not live.' }
      if (scope.getState().current !== action.step) {
        const moved = await scope.go(action.step as never)
        if (!moved.ok) return answer(moved)
      }
      const saved = await scope.setInput(action.step as never, action.input as never)
      if (!saved.ok) return answer(saved)
      return answer(await scope.next())
    }
    case 'send':
      return answer(await run.send(action.event as never, action.payload as never))
    case 'resolve':
      return known(item.manual.resolve(action.id, action.value), 'That service call')
    case 'reject':
      return known(item.manual.reject(action.id, action.message), 'That service call')
    case 'skipTimer':
      return known(item.clock.skip(), 'A timer')
    case 'retry':
      return answer(await run.retry(action.step as never))
    case 'skip':
      return answer(await run.skip(action.step as never, 'Skipped from the dev UI'))
    case 'cancel':
      return answer(await run.cancel('Cancelled from the dev UI'))
  }
}
