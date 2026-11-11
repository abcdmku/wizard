# DX audit: player-bound key drill

The drill measures the change a developer makes when the player-bound key rule
changes. The useful unit is not the number of abstractions. It is the number of
files a developer must understand and the time before a type error points at
the right boundary.

Record one run with:

| Field | What to measure |
| --- | --- |
| wizardLoc | Measured LOC in workflow/room transition glue (`server/src/flow.ts`) |
| workaroundHelpers | Helpers added only to work around missing types |
| casts | Type assertions added by the drill |
| explicitGenerics | Explicit generic arguments added by the drill |
| typecheckMs | Wall-clock time for `pnpm typecheck` |
| filesTouched | Unique, existing system-relative handwritten paths, at most six |
| instanceRegistryLoc | Lines in the instance registry touched by the drill |
| wsTransportLoc | Lines in WebSocket transport touched by the drill |
| durableCommandGlueLoc | Lines in durable command glue touched by the drill |
| frameBytes | Serialized full-frame byte count at the measured fixture |
| frameLimitExceeded | Whether `frameBytes > 25,000` |
| latencyTrigger | Whether the p95 transport budget was exceeded |

The machine-readable minimum lives in `dx-metrics.json`. Keep its required
fields numeric and keep `filesTouched` to one through six unique paths. Put
larger notes here so the validator does not need to parse prose.

The current physical source counts are 277 LOC for the party registry adapter
(`server/src/registry.ts`), 189 LOC for the HTTP/WebSocket lifecycle
(`server/src/transport.ts`), 286 LOC for the per-player socket session
(`server/src/socket-session.ts`), 300 LOC for the durable runtime
(`server/src/runtime.ts`), and 89 LOC for the browser session transport
(`web/src/network/session.ts`). The two server WebSocket files total 475 lines.
The workflow definition is 165 lines. The local durable receipt adapter is 288
lines, the scoped projection and conversion cache is 233 lines, and the durable
player source is 65 lines. These counts include imports, types, comments, and
blank lines.

The main measured function spans are `createPartyRegistry` lines 78-277,
`createDungeonServer` lines 52-189, `handleMessage` lines 62-114,
`bindPlayerSocket` lines 116-286, and `makeRuntime` lines 94-238. Within the
runtime, authenticated command admission is lines 174-201 and the internal tick
path is lines 202-220. `executeCommandReceipt` is lines 173-257, receipt repair
is lines 259-288, and `createPlayerSource` is lines 30-65. The registry delegates
keyed cache, single-flight opening, generation invalidation, identity-checked
eviction, and disposal to `createHostRegistry`. Boot discovery, BUSY retry,
phase-staggered 10 Hz pulses, and the two-outstanding-tick limit remain local.

## Measurement commands

```sh
pnpm typecheck
pnpm test
```

Use the server's frame-size test or a captured fixture for `frameBytes`. Record
the byte count before and after the change. The wire contract reserves a patch
frame with `baseSequence`, but the server does not emit patches while both
triggers remain false. If a future frame crosses 25,000 bytes or the five-minute
p95 reaches 250 ms, evaluate patch emission without removing the full snapshot
at subscribe and reconnect.

The target is no more than six touched handwritten files, no workaround helper,
no new cast, and no new explicit generic argument for a normal ownership-rule
change. A measured violation is a design signal. It is not a reason to loosen
the check.

## Recorded fixture

`dungeon wire boundaries > reproduces the four-player seed-4242 full-frame byte
baseline` constructs exploration tick 2 at sequence 100 and epoch 1, projects
the canonical state for all four viewers, validates each frame with
`ServerFrameSchema`, and asserts exactly 2,867 UTF-8 bytes per viewer. That is
11.5% of the exact 25,000-byte trigger, leaving 22,133 bytes of headroom. Patch
frames therefore remain disabled.

The checked-in [load evidence](../load/evidence/manifest.json) records green
20-party runs for the 250 ms smoke cadence, 100 ms client smoke cadence, and the
five-minute 100 ms cadence. Each profile passed all 26 thresholds. The official
five-minute run measured a 171 ms command-to-frame p95, a minimum 9.6804 Hz
world tick rate, and a 3,012-byte largest frame. It recorded zero protocol
errors, fatal ACK rejections, unresolved commands, and oversized frames.
