/**
 * Machine barrel — the pure engine (`machine` bundles `decide` / `apply` / `plan`), the initial
 * state builder, `explain` and the selectors that callers outside `machine/` read. Consumed by
 * the interpreter, the runtime, replay, the projection and tests.
 *
 * @internal
 */

import { apply } from './apply'
import { decide } from './decide'
import { plan } from './plan'
import type { Machine } from './types'

export const machine: Machine = { decide, apply, plan }

export { type Explanation, explain } from './explain'
export { initialState } from './initial'
export { available, type Progress, phase, progress, ready, readyOrCurrentViews } from './selectors'
export { apply }
