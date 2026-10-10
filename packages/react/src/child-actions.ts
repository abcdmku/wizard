/**
 * The scoped command sugar of a child (`MirrorChild` shape): every command travels through the
 * source's `dispatch` as `{ type: 'child', path, command }`. Memoised per (source, path).
 *
 * @internal
 */

import type { RawActions } from './adapter'

export interface RawChildActions extends RawActions {
  readonly path: readonly string[]
  child(step: string): RawChildActions
}

const childActionCaches = new WeakMap<RawActions, Map<string, RawChildActions>>()

export function childActions(root: RawActions, path: readonly string[]): RawChildActions {
  let cache = childActionCaches.get(root)
  if (cache === undefined) {
    cache = new Map()
    childActionCaches.set(root, cache)
  }
  const key = JSON.stringify(path)
  const existing = cache.get(key)
  if (existing !== undefined) return existing
  const send = (command: unknown): Promise<unknown> =>
    root.dispatch({ type: 'child', path, command })
  const actions: RawChildActions = {
    path,
    start: () => send({ type: 'start' }),
    next: () => send({ type: 'next' }),
    back: () => send({ type: 'back' }),
    go: (step) => send({ type: 'go', step }),
    setInput: (step, patch) => send({ type: 'setInput', step, patch }),
    resetInput: (step) => send({ type: 'resetInput', step }),
    send: (event, payload, options) =>
      send(
        options?.correlationId === undefined
          ? { type: 'send', event, payload }
          : { type: 'send', event, payload, correlationId: options.correlationId },
      ),
    run: (step) => send({ type: 'run', step }),
    retry: (step) => send({ type: 'retry', step }),
    cancel: (reason) =>
      send(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
    runReady: () => send({ type: 'runReady' }),
    compensate: (options) =>
      send({
        type: 'compensate',
        ...(options?.from === undefined ? {} : { from: options.from }),
        ...(options?.reason === undefined ? {} : { reason: options.reason }),
      }),
    reset: () => send({ type: 'reset' }),
    skip: (step, reason) =>
      send(reason === undefined ? { type: 'skip', step } : { type: 'skip', step, reason }),
    invalidate: (step, options) =>
      send(
        options?.cascade === undefined
          ? { type: 'invalidate', step }
          : { type: 'invalidate', step, cascade: options.cascade },
      ),
    dispatch: send,
    child: (step) => childActions(root, [...path, step]),
  }
  cache.set(key, actions)
  return actions
}
