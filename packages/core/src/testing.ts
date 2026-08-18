/**
 * @openwizard/core/testing — test-only helpers, kept out of the main barrel so an application
 * bundle never carries them: the virtual-time `createTestScheduler()` (pass it as `scheduler`
 * to drive retries, wait timeouts and inbox TTLs deterministically) and the in-process
 * `createLocalTransport()` loopback between a `MirrorSource` and a `Mirror`.
 *
 * @packageDocumentation
 */

export { createTestScheduler, type TestScheduler } from './interpreter/test-scheduler'
export { createLocalTransport, type LocalTransportOptions } from './mirror/local-transport'
