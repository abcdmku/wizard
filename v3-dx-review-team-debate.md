# v3 Review Team Debate: Examples, E2E Usage, and DX Alignment

Date: February 26, 2026
Scope reviewed:
- `core-contracts.ts`
- `react-contracts.ts`
- `examples/modes/wizard-mode.example.ts`
- `examples/modes/dag-mode.example.ts`
- `examples/modes/saga-mode.example.ts`
- `examples/modes/hybrid-mode.example.ts`
- `v3-streamlined-api-rfc.md`
- `v3-orchestrator-council-spec.md`

## Review Team (Requested Composition)

1. **Avery (Full-Stack TypeScript, Design-first UX)**
2. **Mina (Full-Stack TypeScript, Design-first Developer Flows)**
3. **Ravi (Data Models Engineer)**
4. **Iris (System Architecture Engineer)**
5. **Noah (Reliability + Security Engineer)**

## Debate Transcript (Condensed)

### Round 1: Does the current API feel canonical and ergonomic?

**Avery (FS UX):**
- The authoring path is clean: `defineSteps` + `defineFlow` + `createOrchestrator`.
- Step builders (`view/action/gate/final`) are readable and map to product intent.
- `wizard/dag/saga/hybrid` modes are explicit and understandable.

**Mina (FS DX):**
- Runtime method set is comprehensive and consistent across examples.
- Bound React contract (`bindOrchestratorReact`) is the right direction.
- Biggest DX risk: graph typing does not currently enforce `next` and `dependsOn` against real step keys.

**Ravi (Data Models):**
- State model is complete and normalized (`steps`, `history`, `saga`, `persistence`).
- Inference maps (`StepInputMap/StepOutputMap/StepErrorMap`) are strong foundations.
- But step-level context typing is not anchored to flow context in current contracts.

**Iris (Architecture):**
- Single engine with explicit mode semantics is the correct architecture choice.
- Contracts support deterministic transition/scheduling/compensation pipelines.
- Missing hard constraints for mode-specific behavior in types and docs.

**Noah (Reliability/Security):**
- Persistence adapter shape is practical and testable.
- Redaction hook exists, but operational security defaults are underspecified.
- No explicit contract for error sanitization, secret handling, or multi-tenant key discipline.

### Round 2: E2E walkthrough quality by example

**Wizard example**
- Strength: clean linear + branch pattern (`accountRoute` gate).
- Gap: example does not exercise validation, `canEnter/canExit`, persistence, or error surfaces.

**DAG example**
- Strength: clear split/join and concurrency entrypoint via `runReady`.
- Gap: single `runReady` call under-demonstrates expected scheduler loop and completion lifecycle.

**Saga example**
- Strength: closest to real production usage (persistence, compensation, retry entrypoints).
- Gap: compensation policy outcomes and partial-compensation failure handling are not shown.

**Hybrid example**
- Strength: practical client/server choreography.
- Gap: implicit boundary between user navigation (`next`) and auto execution (`runReady`) needs stronger documented rules.

### Round 3: "Best DX on market" bar check

Consensus:
- **Direction is strong.**
- **Current contracts/examples are ~75% aligned** with the stated v3 vision.
- **Primary blocker to top-tier DX is type-safety completeness**, not runtime surface area.

## Alignment Verdict

Aligned now:
- One canonical authoring path.
- One broad runtime API covering wizard + dag + saga + hybrid.
- State model supports observability and durability.
- React binding avoids overload-heavy hook APIs.

Not yet aligned enough:
1. **Step graph safety is not guaranteed** (`next`/`dependsOn` can drift from valid keys at type level).
2. **Context typing is not fully propagated into step callbacks** in a flow-bound way.
3. **Mode semantics are not type-constrained** (navigation/scheduling affordances look uniform even when behavior differs).
4. **Security/reliability defaults are not explicit** for persistence in sensitive workloads.
5. **Examples are good smoke tests but not full E2E operating guides** (no retry loop strategy, no resume-after-crash scenario matrix, limited failure-path demos).

## Required Changes To Hit "Best DX" Standard

1. **Flow-bound step typing**
- Make `defineSteps`/`defineFlow` cooperate so `next` and `dependsOn` are constrained to actual step ids.
- Ensure callback args (`context`, `input`, `output`) are inferred from the flow, not weakly inferred per object literal.

2. **Mode contracts and docs**
- Document and type-encode runtime expectations per mode:
  - `wizard`: navigation-first
  - `dag`: scheduler-first
  - `saga`: scheduler + compensation
  - `hybrid`: explicit handoff rules between `next` and `runReady`

3. **Security baseline for persistence**
- Require explicit guidance for:
  - key scoping (`tenant/workflow/entity`)
  - redaction policy defaults
  - error payload sanitization
  - optional encryption-at-rest adapter pattern

4. **True E2E example pack**
- Add one "operational" example per mode with:
  - happy path
  - recoverable failure path
  - non-recoverable path
  - resume from persisted snapshot
  - observable event assertions

## Team Decision

Proceed with v3 direction, but do not call API contracts "final" until:
- graph-key type safety is enforced,
- flow-bound inference is locked,
- persistence security guidance is codified,
- and E2E examples demonstrate production-grade lifecycle behavior.

