import { Clock, MirrorSource, Scheduler, Transport } from "@openwizard/core";
//#region src/interpreter/test-scheduler.d.ts
/**
 * Virtual-time scheduler + clock for tests (what `createTestScheduler()` returns): `advance(ms)`
 * fires due timers in order, `flush()` fires everything, `pending()` counts armed timers.
 * @public
 */
interface TestScheduler extends Scheduler, Clock {
  /** Move virtual time forward, firing due timers in `at` order (then insertion order). */
  advance(ms: number): void;
  /** Fire every pending timer regardless of its due time (virtual time jumps to each). */
  flush(): void;
  /** Number of armed timers. */
  pending(): number;
}
/**
 * Deterministic scheduler + clock for tests: `createWizard(flow, { scheduler })` (it doubles as
 * the clock), then `advance(ms)` / `flush()` to fire retries, wait timeouts and inbox TTLs
 * without real waiting. Timers fire synchronously inside `advance`, so state is committed when
 * it returns (async hooks still need their promises to settle).
 * @public
 */
declare function createTestScheduler(options?: {
  readonly now?: number;
}): TestScheduler;
//#endregion
//#region src/mirror/local-transport.d.ts
/**
 * `createLocalTransport` options: `delayMs` delays every frame and every command/ack hop
 * (default 0 = synchronous frames, acks resolve on the wizard's own microtasks); `scheduler`
 * drives those delays (a test scheduler makes them deterministic); `serialize` JSON-round-trips
 * frames, commands and acks (default `false`).
 * @public
 */
interface LocalTransportOptions {
  readonly delayMs?: number;
  readonly scheduler?: Scheduler;
  readonly serialize?: boolean;
}
/**
 * Loopback transport over a `MirrorSource` (same process, no wire). With the defaults, frames
 * reach the Mirror synchronously on every commit and `send` resolves with the source's ack.
 * @public
 */
declare function createLocalTransport<S>(source: MirrorSource<S>, options?: LocalTransportOptions): Transport<S>;
//#endregion
export { type LocalTransportOptions, type TestScheduler, createLocalTransport, createTestScheduler };
//# sourceMappingURL=testing.d.ts.map