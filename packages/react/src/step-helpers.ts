/**
 * What `useStep(id)` spreads over a step record: the live `phase` (Run sources) and, for a
 * view, the helpers bound to that view — `next` / `back` only act while it is the current view
 * (else a `NOT_ACTIVE` result, nothing sent), `go`, `setInput`, `resetInput` and `issuesFor`.
 *
 * @internal
 */

import type { Issue } from '@openwizard/core'
import type { RawActions } from './adapter'

interface ViewHelpers {
  readonly next: () => Promise<unknown>
  readonly back: () => Promise<unknown>
  readonly go: () => Promise<unknown>
  readonly setInput: (patch: unknown) => Promise<unknown>
  readonly resetInput: () => Promise<unknown>
}

/**
 * Helpers bound to view `step`; `currentOf` reads the cursor of the view's flow at call time and
 * `label` names the hook in the rejection message (`useStep('payment')`).
 */
export function viewHelpers(
  actions: RawActions,
  currentOf: () => string | null,
  label: string,
  step: string,
): ViewHelpers {
  const fromHere =
    (name: 'next' | 'back', move: () => Promise<unknown>) => (): Promise<unknown> => {
      const current = currentOf()
      if (current === step) return move()
      return Promise.resolve({
        ok: false,
        reason: 'not-active',
        code: 'NOT_ACTIVE',
        message: `${label}.${name}(): '${step}' is not the current view (current: ${current === null ? 'none' : `'${current}'`}); nothing was sent`,
        step,
      })
    }
  return {
    next: fromHere('next', actions.next),
    back: fromHere('back', actions.back),
    go: () => actions.go(step),
    setInput: (patch) => actions.setInput(step, patch),
    resetInput: () => actions.resetInput(step),
  }
}

/** The record with its phase (when the source reports one separately) and the view helpers. */
export function stepResult(
  record: object,
  phase: string | undefined,
  helpers: ViewHelpers | undefined,
): object {
  const withPhase = phase === undefined ? record : { ...record, phase }
  if (helpers === undefined) return withPhase
  const issues = (record as { readonly issues?: readonly Issue[] }).issues
  return {
    ...withPhase,
    ...helpers,
    issuesFor: (field?: string) => issuesAt(issues, field),
  }
}

/** Issues whose path starts at `field`; without `field`, the issues that have no path. */
function issuesAt(
  issues: readonly Issue[] | undefined,
  field: string | undefined,
): readonly Issue[] {
  return (issues ?? []).filter((issue) => {
    const head = fieldOf(issue)
    return field === undefined ? head === undefined : head !== undefined && String(head) === field
  })
}

/** First path segment of a Standard Schema issue (`['name']` or `[{ key: 'name' }]`). */
function fieldOf(issue: Issue): PropertyKey | undefined {
  const head = issue.path?.[0]
  return typeof head === 'object' && head !== null ? head.key : head
}
