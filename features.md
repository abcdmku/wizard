# PRP: Update `@wizard/core` with Statuses + Expanded Helpers

## Goals

1. Adopt the progress-oriented **step statuses**:

```ts
type StepStatus =
  | 'unavailable'  // blocked by guards/prereqs; cannot enter now
  | 'optional'     // step is not required for completion (meta)
  | 'current'      // active step
  | 'completed'    // finished successfully
  | 'required'     // must be completed for overall completion (meta)
  | 'skipped'      // intentionally bypassed
  | 'error'        // failed but retryable/fixable
  | 'terminated'   // permanently failed/unrecoverable (terminal)
  | 'loading';     // async work in progress for the step
```

2. Add **first-class, memoized helpers & selectors** over the store for: identity/ordering, availability, progress, reachability, navigation affordances, “what’s next?”, and diagnostics.

3. Keep core tiny, SSR-safe, and TanStack-style (headless, typed, minimal deps). No new heavy deps.

---

## Non-breaking Config Extensions

Augment `WizardConfig` with optional hints only (no hard deps):

```ts
export type WizardConfig<C, S extends string, D extends Record<S, unknown>, E = never> = {
  // existing fields...
  order?: readonly S[];                               // explicit linear order
  weights?: Partial<Record<S, number>>;               // progress weighting
  prerequisites?: Partial<Record<S, readonly S[]>>;   // simple DAG prereqs
  isStepComplete?: (a: { step: S; data: Partial<D>; ctx: Readonly<C> }) => boolean;

  // status/meta hints (do not set state; used by helpers):
  isOptional?: (step: S, ctx: Readonly<C>) => boolean; // if omitted, default false
  isRequired?: (step: S, ctx: Readonly<C>) => boolean; // default true unless optional

  // lifecycle/error hooks (optional):
  onStatusChange?: (a: { step: S; prev?: StepStatus; next: StepStatus }) => void;
};
```

---

## Core Types (recap)

```ts
export type WizardState<C, S extends string, D extends Record<S, unknown>> = {
  step: S;
  context: C;                   // shared, typed context
  data: Partial<D>;             // per-step payloads
  errors: Partial<Record<S, unknown>>;   // last validation/runtime error per step
  history: Array<{ step: S; context: C; data: Partial<D> }>;
  // optional per-step runtime marks (tiny map; no heavy lib):
  runtime?: Partial<Record<S, {
    status?: StepStatus;        // last explicit status override (rare)
    attempts?: number;          // retries count
    startedAt?: number;         // ms epoch
    finishedAt?: number;        // ms epoch
  }>>;
};
```

---

## New Helper & Selector Surface

Expose via `wizard.helpers` and standalone pure selectors.

```ts
export interface WizardHelpers<C, S extends string, D extends Record<S, unknown>> {
  // Identity & ordering
  allSteps(): readonly S[];                 // declared union in stable order
  orderedSteps(): readonly S[];             // config.order || topo || declaration
  stepCount(): number;
  stepIndex(step: S): number;               // -1 if absent
  currentIndex(): number;

  // Classification & status
  stepStatus(step: S): StepStatus;          // derived (see semantics below)
  isOptional(step: S): boolean;             // from config.isOptional/required
  isRequired(step: S): boolean;

  // Availability
  availableSteps(): readonly S[];           // currently enterable (sync best-effort)
  unavailableSteps(): readonly S[];         // currently not enterable
  refreshAvailability(): Promise<void>;     // re-eval async guards (debounced)

  // Completion & progress
  completedSteps(): readonly S[];
  remainingSteps(): readonly S[];           // from current forward (ordered)
  firstIncompleteStep(): S | null;
  lastCompletedStep(): S | null;
  remainingRequiredCount(): number;
  isComplete(): boolean;                    // all required steps completed
  progress(): { ratio: number; percent: number; label: string }; // weighted if provided

  // Navigation affordances
  canGoNext(): boolean;
  canGoBack(): boolean;
  canGoTo(step: S): boolean;                // cheap sync check
  findNextAvailable(from?: S): S | null;    // respects guards/prereqs
  findPrevAvailable(from?: S): S | null;
  jumpToNextRequired(): S | null;

  // Reachability & graph introspection
  isReachable(step: S): boolean;            // DAG/prereq prune
  prerequisitesFor(step: S): readonly S[];  // resolved prereqs (flattened)
  successorsOf(step: S): readonly S[];      // static “could go to” (graph)

  // Diagnostics
  stepAttempts(step: S): number;
  stepDuration(step: S): number | null;     // finishedAt-startedAt if present
  percentCompletePerStep(): Record<S, number>; // 0/100 by default; plug for partial steps later

  // Snapshots
  snapshot(): WizardState<C, S, D>;
}
```

### Pure Selectors (tree-shakable)

```ts
export const selectors = {
  allSteps:  <C,S,D>(cfg: WizardConfig<C,S,D>) => readonly S[],
  ordered:   <C,S,D>(cfg: WizardConfig<C,S,D>) => readonly S[],
  // and small pure helpers used by the instance helpers…
};
```

---

## Status Semantics (how `stepStatus` is derived)

Given `state`, `config`, guard caches, and minimal runtime marks:

1. **current**: `state.step === s`.
2. **loading**: step is current (or being entered) and has a pending `load`/async action.
3. **terminated**: runtime.status === 'terminated' (terminal failure recorded).
4. **error**: runtime.status === 'error' (retryable issue recorded).
5. **completed**: `isStepComplete?.(...) === true` OR `state.data[s] != null`.
6. **skipped**: step appears in ordered path but was explicitly jumped over and recorded as skipped.
7. **unavailable**: prereqs unmet OR `canEnter(ctx)` last-known false OR static graph says unreachable.
8. **required / optional**: **meta classification**, not mutually exclusive with others; exposed via `isRequired/isOptional`.

   * For UI convenience, helpers may return `'required'` when neither current/completed/skipped/error/terminated/loading/unavailable, and `isRequired(step)` is true; likewise `'optional'` for optional steps.

> Note: To avoid ambiguity, `stepStatus` returns a **primary status** (one of 9). Requirement is accessible via `isRequired/isOptional` helpers, and also included in `stepMeta(step)` if you add it.

Optional convenience:

```ts
stepMeta(step: S): {
  status: StepStatus;
  required: boolean;
  optional: boolean;
  index: number;
  isBeforeCurrent: boolean;
  isAfterCurrent: boolean;
}
```

---

## Ordering Strategy

* Use `config.order` if provided.
* Else try **topological order** from static `next` graph if acyclic.
* Else fall back to declaration order (stable).

Deterministic given equal config.

---

## Minimal Runtime Marks (no heavy deps)

* When entering a step: set `startedAt` and increment `attempts`.
* On successful completion: set `finishedAt`, clear transient error.
* On retryable failure: set `runtime.status='error'`.
* On terminal failure: set `runtime.status='terminated'`.
* On skip: record `skipped` in a tiny `skips` set/map (or `runtime.status='skipped'`).

> Keep this **optional**: core still works if runtime marks are absent.

---

## API Touchpoints (additions only)

* `createWizard(...)` returns `wizard.helpers`.
* Add tiny methods for marks (optional; callable by React adapter or user code):

```ts
markError(step: S, err: unknown): void;       // sets retryable error
markTerminated(step: S, err?: unknown): void; // sets terminal failure
markLoading(step: S): void; markIdle(step: S): void;
markSkipped(step: S): void;
```

* Maintain `onStatusChange` hook if status transitions inferred.

---

## Performance

* Implement helpers as memoized selectors over `(config, store.state)`.
* Cache last known `canEnter` for async guards; `refreshAvailability()` re-checks with debounce (e.g., 50ms).
* Expose a `useWizardState(selector)` in React package to avoid over-rendering (unchanged).

---

## Tests (add)

* **Type tests**: literal `S` union preserved through helpers; impossible steps rejected.
* **Order**: explicit, topo, fallback determinism.
* **Availability**: prereqs + guards (sync/async) + refresh.
* **Status lattice**: transitions among loading → error/terminated → retry → completed.
* **Progress**: linear, weighted; monotonic within a path.
* **Finders**: `firstIncompleteStep`, `findNextAvailable`, `jumpToNextRequired`.

---

## Docs (core README snippet)

Add a **“Helpers & Status”** section with short examples:

```ts
const { helpers } = wizard;

// Progress bar
const { percent, label } = helpers.progress();

// Sidebar list
for (const s of helpers.orderedSteps()) {
  const status = helpers.stepStatus(s);
  const required = helpers.isRequired(s);
  // render badge/colors
}

// Next button
if (helpers.canGoNext()) wizard.next();

// Jump to next required
const nextReq = helpers.jumpToNextRequired();
if (nextReq) wizard.goTo(nextReq);

// Retry after error
if (helpers.stepStatus('payment') === 'error') {
  wizard.goTo('payment'); // re-enter
}
```

Also document the meaning of:

* **unavailable** vs **loading** vs **error** vs **terminated**
* **optional/required** as meta, not mutually exclusive primary statuses.

---

## Implementation Sketch (condensed)

```ts
function createHelpers<C,S extends string,D extends Record<S,unknown>>(
  cfg: WizardConfig<C,S,D>,
  store: Store<WizardState<C,S,D>>,
) : WizardHelpers<C,S,D> {
  const guardCache = new Map<S, boolean>();
  const all = computeAllSteps(cfg);
  const ordered = computeOrderedSteps(cfg);

  const get = () => store.state;

  const isRequired = (s: S) => cfg.isRequired
    ? !!cfg.isRequired(s, get().context)
    : !(cfg.isOptional?.(s, get().context) ?? false);

  const isOptional = (s: S) => cfg.isOptional?.(s, get().context) ?? !isRequired(s);

  const completed = () => ordered.filter(s =>
    cfg.isStepComplete?.({ step: s, data: get().data, ctx: get().context })
      ?? (get().data[s] != null));

  const prereqsMet = (s: S) => (cfg.prerequisites?.[s] ?? []).every(p =>
    cfg.isStepComplete?.({ step: p, data: get().data, ctx: get().context })
      ?? (get().data[p] != null));

  const canEnterSync = (s: S) => {
    if (!prereqsMet(s)) return false;
    const ce = cfg.steps[s]?.canEnter;
    if (!ce) return true;
    try {
      const res = ce({ ctx: get().context });
      if (typeof res === 'boolean') return res;
    } catch {}
    return guardCache.get(s) ?? false;
  };

  const available = () => ordered.filter(canEnterSync);

  const status = (s: S): StepStatus => {
    const st = get();
    if (st.step === s) return 'current';

    const rt = st.runtime?.[s];
    if (rt?.status === 'terminated') return 'terminated';
    if (rt?.status === 'error') return 'error';
    if (rt?.status === 'loading') return 'loading';
    if ((cfg.isStepComplete?.({ step: s, data: st.data, ctx: st.context }) ?? (st.data[s] != null))) return 'completed';
    // if recorded as skipped, prefer that label:
    if (rt?.status === 'skipped') return 'skipped';
    if (!prereqsMet(s) || !canEnterSync(s)) return 'unavailable';
    // neither completed nor current nor unavailable -> it's upcoming.
    // We surface requirement via helper meta; pick a neutral default:
    return isOptional(s) ? 'optional' : 'required';
  };

  const progress = () => {
    const total = ordered.length || 1;
    const done = completed().length;
    const ratio = cfg.weights
      ? weightedRatio(ordered, completed(), cfg.weights)
      : done / total;
    return { ratio, percent: Math.round(ratio * 100), label: `${done} / ${total}` };
  };

  const firstIncomplete = () => {
    for (const s of ordered) {
      const st = status(s);
      if (st !== 'completed' && st !== 'terminated' && st !== 'skipped') return s;
    }
    return null;
  };

  const findNextAvailable = (from?: S) => {
    const idx = from ? ordered.indexOf(from) : ordered.indexOf(get().step);
    for (let i = Math.max(0, idx + 1); i < ordered.length; i++) {
      const s = ordered[i];
      if (canEnterSync(s)) return s;
    }
    return null;
  };

  const jumpToNextRequired = () => {
    const idx = ordered.indexOf(get().step);
    for (let i = Math.max(0, idx + 1); i < ordered.length; i++) {
      const s = ordered[i];
      if (isRequired(s) && canEnterSync(s)) return s;
    }
    return null;
  };

  const refreshAvailability = debounce(async () => {
    const ctx = get().context;
    for (const s of ordered) {
      const ce = cfg.steps[s]?.canEnter;
      guardCache.set(s, ce ? !!(await ce({ ctx })) : true);
    }
    store.setState((st) => ({ ...st })); // tick
  }, 50);

  return {
    allSteps: () => all,
    orderedSteps: () => ordered,
    stepCount: () => ordered.length,
    stepIndex: (s) => ordered.indexOf(s),
    currentIndex: () => ordered.indexOf(get().step),
    stepStatus: status,
    isOptional, isRequired,
    availableSteps: () => available(),
    unavailableSteps: () => ordered.filter((s) => !canEnterSync(s)),
    refreshAvailability,
    completedSteps: () => completed(),
    remainingSteps: () => ordered.slice(ordered.indexOf(get().step) + 1),
    firstIncompleteStep: firstIncomplete,
    lastCompletedStep: () => {
      for (let i = ordered.indexOf(get().step); i >= 0; i--) {
        const s = ordered[i];
        if (status(s) === 'completed') return s;
      }
      return null;
    },
    remainingRequiredCount: () => ordered.filter(isRequired).filter((s) => status(s) !== 'completed').length,
    isComplete: () => ordered.filter(isRequired).every((s) => status(s) === 'completed'),
    progress,
    canGoNext: () => !!findNextAvailable(),
    canGoBack: () => get().history.length > 0,
    canGoTo: (s) => ['current','completed','optional','required'].includes(status(s)) && canEnterSync(s),
    findNextAvailable,
    findPrevAvailable: (from?: S) => {
      const idx = from ? ordered.indexOf(from) : ordered.indexOf(get().step);
      for (let i = idx - 1; i >= 0; i--) {
        const s = ordered[i];
        if (canEnterSync(s)) return s;
      }
      return null;
    },
    jumpToNextRequired,
    isReachable: (s) => prereqsMet(s), // simple prune; can extend with static graph analysis
    prerequisitesFor: (s) => (cfg.prerequisites?.[s] ?? []),
    successorsOf: (s) => /* gather from next graph */ [],
    stepAttempts: (s) => get().runtime?.[s]?.attempts ?? 0,
    stepDuration: (s) => {
      const rt = get().runtime?.[s];
      return rt?.startedAt && rt?.finishedAt ? rt.finishedAt - rt.startedAt : null;
    },
    percentCompletePerStep: () => Object.fromEntries(all.map((s) => [s, status(s) === 'completed' ? 100 : 0])) as Record<S, number>,
    snapshot: () => structuredClone(get()),
  };
}
```

---

## Acceptance Criteria

* `stepStatus` returns one of the **9 final statuses**; semantics match above.
* `isRequired/isOptional` provided separately (meta) and used by helpers.
* Helpers are **memoized**, SSR-safe, and add minimal size.
* Type tests preserve literal `S` unions in returns.
* Unit tests cover ordering, availability, progress, and status transitions (including `error` → retry → `completed`; `terminated` is terminal).
* Docs updated (core README “Helpers & Status”) with concise examples.

---

## Commands (Claude)

1. Implement helpers and status vocabulary in `@wizard/core`.
2. Add tiny runtime marks + public `markError/markTerminated/markLoading/markIdle/markSkipped` methods.
3. Write tests (unit + type) for new helpers.
4. Update README with examples (progress bar, sidebar, retry flow).
5. Build & size-check.

> If a choice is ambiguous, favor **small**, **deterministic**, and **type-clear** solutions.