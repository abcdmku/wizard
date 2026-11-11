/** A scoped Mirror source authorizes typed commands without putting scope on the wire. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createMirrorSource } from '../../src/mirror/source'
import type { Frame, WireCommand } from '../../src/mirror/wire'
import { createMemoryStore } from '../../src/persistence/memory-store'
import { defineProjection } from '../../src/projection/define-projection'
import { createRun } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

interface Viewer {
  readonly tenantId: string
  readonly role: 'reader' | 'operator'
  readonly token: string
}
interface RuntimeViewer extends Viewer {
  self?: RuntimeViewer
}
const flow = defineWizard(
  {
    name: 'source-authorization',
    context: boundary.trusted<{
      readonly tenantId: string
      readonly secret: string
    }>(),
  },
  ({ step, view, steps }) =>
    steps(
      {
        form: view({ next: 'done' }),
        done: step({ next: null }),
      },
      { start: 'form' },
    ),
)
const projection = defineProjection(flow, {
  scope: boundary.trusted<Viewer>(),
  select: ({ state, scope }) => ({
    status: state.status,
    current: state.current,
    tenantMatch: state.context.tenantId === scope.tenantId,
  }),
})
const operator = (token = 'scope-secret-token'): Viewer => ({
  tenantId: 'tenant-a',
  role: 'operator',
  token,
})
const command = (commandId: string): WireCommand => ({
  commandId,
  instanceId: 'authorized-run',
  command: { type: 'start' },
})
const makeRun = () =>
  createRun(flow, {
    context: { tenantId: 'tenant-a', secret: 'state-secret' },
    instanceId: 'authorized-run',
  })
describe('createMirrorSource authorization', () => {
  it('parses and captures its scope once for every projected frame and authorization call', async () => {
    let parses = 0
    const counted = defineProjection(flow, {
      scope: boundary.parse<Viewer>((value) => {
        parses += 1
        return value as Viewer
      }),
      select: ({ state, scope }) => ({
        current: state.current,
        tenantMatch: state.context.tenantId === scope.tenantId,
      }),
    })
    const run = makeRun()
    const source = createMirrorSource(run, counted, {
      scope: operator(),
      authorize: ({ scope }) => scope.role === 'operator',
    })
    source.subscribe(() => {})
    await source.dispatch(command('start'))
    expect(parses).toBe(1)
    source.dispose()
    run.dispose()
  })
  it('passes full state, a decoded command, and parsed scope to authorize', async () => {
    const run = makeRun()
    const scope = operator()
    let authorized: unknown
    const source = createMirrorSource(run, projection, {
      scope,
      authorize: (input) => {
        authorized = input
        return input.scope.role === 'operator' && input.command.type === 'start'
      },
    })
    let frame: Frame<unknown> | undefined
    source.subscribe((next) => {
      frame = next
    })
    const ack = await source.dispatch(command('allowed'))
    expect(ack.result).toMatchObject({ ok: true })
    expect(authorized).toMatchObject({
      state: { context: { tenantId: 'tenant-a', secret: 'state-secret' } },
      command: { type: 'start' },
      scope,
    })
    expect(frame).toMatchObject({ state: { tenantMatch: true } })
    expect(JSON.stringify(frame)).not.toContain(scope.token)
    expect(JSON.stringify(command('wire'))).not.toContain(scope.token)
    source.dispose()
    run.dispose()
  })
  it('keeps a non-serializable scope out of frames, acks, logs, snapshots, and persistence', async () => {
    const store = createMemoryStore()
    const run = createRun(flow, {
      context: { tenantId: 'tenant-a', secret: 'state-secret' },
      instanceId: 'authorized-run',
      store,
      autoSave: 'off',
    })
    const scope: RuntimeViewer = operator('persisted-scope-secret')
    scope.self = scope
    const source = createMirrorSource(run, projection, {
      scope,
      authorize: ({ scope: parsed }) => parsed.role === 'operator',
    })
    const frames: Frame<unknown>[] = []
    source.subscribe((frame) => frames.push(frame))
    const ack = await source.dispatch(command('persist'))
    await run.save()
    const stored = await store.get('authorized-run')
    for (const value of [frames, ack, run.getSnapshot(), run.log(), stored]) {
      expect(JSON.stringify(value)).not.toContain(scope.token)
    }
    source.dispose()
    run.dispose()
  })
  it('rejects a wire scope before calling authorization', async () => {
    const run = makeRun()
    let calls = 0
    const source = createMirrorSource(run, projection, {
      scope: operator(),
      authorize: () => {
        calls += 1
        return true
      },
    })
    const ack = await source.dispatch({
      ...command('wire-scope'),
      scope: { token: 'client' },
    } as never)
    expect(ack.result).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(calls).toBe(0)
    source.dispose()
    run.dispose()
  })
  it('fails closed on false, throw, and rejection, then releases the dispatch gate', async () => {
    const run = makeRun()
    const scope = operator('never-leak-this-token')
    let attempt = 0
    const source = createMirrorSource(run, projection, {
      scope,
      authorize: () => {
        attempt += 1
        if (attempt === 1) return false
        if (attempt === 2) throw new Error('private authorization detail')
        if (attempt === 3) return Promise.reject(new Error('private rejection detail'))
        return true
      },
    })
    const acks = await Promise.all([
      source.dispatch(command('false')),
      source.dispatch(command('throw')),
      source.dispatch(command('reject')),
      source.dispatch(command('allowed')),
    ])
    for (const denied of acks.slice(0, 3)) {
      expect(denied?.result).toEqual({
        ok: false,
        code: 'FORBIDDEN',
        message: 'command is not authorized',
      })
      expect(JSON.stringify(denied)).not.toContain(scope.token)
      expect(JSON.stringify(denied)).not.toContain('private')
    }
    expect(acks[3]?.result).toMatchObject({ ok: true })
    expect(attempt).toBe(4)
    expect(run.getState().current).toBe('form')
    expect(JSON.stringify(run.getSnapshot())).not.toContain(scope.token)
    expect(JSON.stringify(run.log())).not.toContain(scope.token)
    source.dispose()
    run.dispose()
  })
  it('rejects source construction when a scoped projection has no scope option', () => {
    const run = makeRun()
    const createRaw = createMirrorSource as unknown as (...args: readonly unknown[]) => unknown
    expect(() => createRaw(run, projection)).toThrow(/scope/i)
    run.dispose()
  })
})
