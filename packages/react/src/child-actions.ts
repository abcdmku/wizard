/**
 * The scoped command sugar of a child (`MirrorChild` shape): every command travels through the
 * source's `dispatch` as `{ type: 'child', path, command }`. Memoised per (source, path).
 *
 * A `Mirror` carries the same sugar (`mirror.child(step)`), a `Run` does not (its `child(step)`
 * is the live child run, absent until the flow step starts), so both sources go through this one.
 *
 * @internal
 */

import type { RawActions } from './adapter'
import { appendChild, wirePath } from './child-path'

export interface RawChildActions extends RawActions {
  readonly path: readonly string[]
  start(): Promise<unknown>
  send(
    event: string,
    payload: unknown,
    options?: { readonly correlationId?: string; readonly eventId?: string },
  ): Promise<unknown>
  startStep(step: string): Promise<unknown>
  retry(step: string, options?: { readonly patch?: unknown }): Promise<unknown>
  cancel(reason?: string): Promise<unknown>
  startReady(): Promise<unknown>
  compensate(options?: { readonly from?: string; readonly reason?: string }): Promise<unknown>
  reset(): Promise<unknown>
  skip(step: string, reason?: string): Promise<unknown>
  invalidate(step: string, options?: { readonly cascade?: boolean }): Promise<unknown>
  child(step: string, index?: number): RawChildActions
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
      send({
        type: 'send',
        event,
        payload,
        ...(options?.correlationId === undefined ? {} : { correlationId: options.correlationId }),
        ...(options?.eventId === undefined ? {} : { eventId: options.eventId }),
      }),
    startStep: (step) => send({ type: 'startStep', step }),
    retry: (step, options) =>
      send({
        type: 'retry',
        step,
        ...(options?.patch === undefined ? {} : { patch: options.patch }),
      }),
    cancel: (reason) =>
      send(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
    startReady: () => send({ type: 'startReady' }),
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
    child: (step, index) =>
      childActions(root, [...path, ...wirePath(appendChild([], step, index))]),
  }
  cache.set(key, actions)
  return actions
}
