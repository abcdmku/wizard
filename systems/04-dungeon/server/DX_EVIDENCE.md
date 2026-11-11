# Server runtime evidence

Measured on 2026-08-24 after the final Biome pass. Counts are physical source lines, including
imports, types, comments, and blank lines.

## Glue size

| Area | Source | Lines |
| --- | --- | ---: |
| Party registry adapter | `src/registry.ts` | 277 |
| WebSocket/HTTP lifecycle | `src/transport.ts` | 189 |
| Per-player WebSocket session | `src/socket-session.ts` | 286 |
| Combined WebSocket transport | both transport files | 475 |
| Durable runtime | `src/runtime.ts` | 300 |
| Durable runtime ingress | `makeRuntime`, `src/runtime.ts:94-238` | 145 |
| Authenticated player-command admission | `PartyRuntime.command`, `src/runtime.ts:174-201` | 28 |
| Durable command receipt adapter | `src/command-receipts.ts` | 288 |
| Receipt execution path | `executeCommandReceipt`, `src/command-receipts.ts:173-257` | 85 |
| Resume receipt repair | `repairLastCommandReceipt`, `src/command-receipts.ts:259-288` | 30 |
| Fast internal tick path | `PartyRuntime.tick`, `src/runtime.ts:202-220` | 19 |
| Scoped projection and shared conversion cache | `src/projection.ts` | 233 |
| Durable viewer-scoped source | `src/player-source.ts` | 65 |
| Dungeon workflow | `src/flow.ts` | 165 |
| Browser session transport | `../web/src/network/session.ts` | 89 |

Handwritten glue blocks longer than 20 lines:

- `createPartyRegistry`: lines 78-277 (200 lines). Generic cache, single-flight, generation tokens,
  identity-guarded eviction, and disposal are delegated to `createHostRegistry`; boot discovery,
  BUSY retry, phased ticks, and bounded tick admission remain local.
- HTTP upgrade/auth/open path: `src/transport.ts` lines 78-138 (61 lines).
- HTTP/WebSocket lifecycle object: `src/transport.ts` lines 140-187 (48 lines).
- Command message handler: `src/socket-session.ts` lines 62-114 (53 lines).
- Player socket binding and cleanup: `src/socket-session.ts` lines 116-286 (171 lines), including
  early-message buffering and close-safe presence cleanup.
- Durable runtime ingress: `src/runtime.ts` lines 94-238 (145 lines), including the 28-line
  authenticated command path, execution-time FIFO admission gate, unavailable-socket notification,
  durable idle barrier, and 19-line internal tick path.
- Durable receipt execution: `src/command-receipts.ts` lines 173-257 (85 lines), including sole
  command dedupe, sequence-neutral preflight denial, exact replay, and fail-closed completion.
- Receipt completion: `src/command-receipts.ts` lines 141-163 (23 lines).
- Resume receipt repair: `src/command-receipts.ts` lines 259-288 (30 lines).
- Durable player source: `src/player-source.ts` lines 30-65 (36 lines).

The player-bound-key drill is confined to `src/server.ts` for authenticated ownership and shared
door mutation, and `src/projection.ts` for private inventory/public door projection.

## Full-frame measurement

A deterministic four-player, seed-4242 exploration snapshot was projected separately for every
viewer and validated with `ServerFrameSchema` before measurement. Each serialized fixture snapshot
was 2,867 bytes. The canonical five-minute load run observed a 3,012-byte maximum, leaving 21,988
bytes of headroom under the 25,000-byte protocol limit. The server stays on full snapshots and does
not emit patches.

The exact fixture and all four byte counts are reproduced by
`systems/04-dungeon/tests/unit/protocol.test.ts`.

## Persistence measurement

The August measurement used tagged pure reducers for `world.tick` and `player.command`.
That version persisted the world, phase, and singleton `lastCommandReceipt` in one fenced
snapshot CAS. A steady tick used one CAS with zero dedupe claims or completions; an accepted
external command used one claim, one snapshot CAS, and one receipt completion.
The current callback API uses synchronous `waitFor` handlers with `update()` and `{ done }`,
followed by routing in the step config. Focused source tests on 2026-10-12 measure two snapshot CAS
commits per steady tick and three per phase-changing tick. An ordinary accepted command uses one
claim, two snapshot CAS commits, and one completion; a phase-changing command uses three snapshot
CAS commits. Delivery commits before the handler runs. Its synchronous updates and completion
commit together, and dynamic routing adds a follow-up commit. The August load figures below have
not been rerun for this handler model. A preflight denial still claims and completes its receipt
without changing the Wizard sequence.

The snapshot holds one `lastCommandReceipt` only for crash repair. Completed receipts live in the
durable dedupe store and return exact results after restart or later state changes. If the snapshot
commits but receipt completion is ambiguous, the runtime closes mutation admission and bound
WebSockets with 1012. The next owner repairs the receipt before accepting commands. In the 129-failure
fixture this changed the snapshot from 13,825 bytes to 2,851 bytes, a 79.4% reduction.

`PartyRuntime` admits command, tick, presence, reset, and disposal operations through one FIFO gate.
Each tick awaits `Run.whenIdle()` and verifies that the durable host version matches the
final run snapshot. Phase changes settle behind the same barrier. A following macrotask observes no
later commit or version change.

Every socket owns one immutable viewer scope. `PlayerSource` starts from the runtime's last durably
visible world, sequence, and epoch, then publishes only post-barrier projections. Direct snapshot
requests and the explicit snapshot after an ACK use the same durable view. Late same-player binds and
reconnects therefore cannot expose a candidate state if the CAS or lease fails.

## Verification

- Server unit gate: 17 files and 61 tests passed with zero type errors.
- Aggregate unit gate: 34 files and 128 tests passed with zero type errors.
- Integration gate: 2 files and 4 tests passed.
- Browser gate: the sequential 2-player and 4-player journeys passed.
- `pnpm --dir systems/04-dungeon typecheck`: passed across shared, server, web, and test contracts.
- Every server TypeScript file is at most 300 physical lines; server Biome, local DX metrics, and the
  repository-wide DX audit pass.
- The canonical [load evidence](../load/evidence/manifest.json) is green for the 250 ms smoke, 100 ms
  client smoke, and five-minute profiles. Each passed 26 of 26 thresholds. The official five-minute
  result measured 171 ms command-to-frame p95, 9.6804 Hz minimum world tick rate, and a 3,012-byte
  maximum frame, with zero protocol errors, fatal ACK rejections, unresolved commands, or oversized
  frames.
