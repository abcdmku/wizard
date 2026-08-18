import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { defineFlow } from '../../src/authoring/define-flow'
import { WizardError } from '../../src/errors'
import { inspect } from '../../src/inspect/graph'

describe('inspect', () => {
  const c = defineFlow({ name: 'child', version: 2, context: z.object({ n: z.number() }) })
  const child = c.steps({
    work: c.task(async () => 1, { next: 'end', label: 'Work' }),
    end: c.final(),
    lost: c.final(),
  })
  const s = defineFlow({
    name: 'root',
    context: boundary.trusted<{ a: string }>(),
    events: { ping: boundary.trusted<{ n: number }>(), pong: boundary.trusted() },
  })
  const flow = s.steps(
    {
      form: s.view({
        label: 'Form',
        input: z.object({ x: z.string() }),
        enter: () => {},
        exit: () => {},
        next: ['reserve', 'wait'],
      }),
      reserve: s.task(async () => 1, { timeout: '5s', compensate: () => {}, next: 'route' }),
      wait: s.wait({
        on: { ping: () => {}, pong: () => {} },
        timeout: { after: '1m', next: 'expired' },
        next: 'route',
      }),
      route: s.decision({ next: () => 'sub' }),
      sub: s.flow(child, { context: () => ({ n: 1 }), dependsOn: ['reserve'], next: 'done' }),
      done: s.final({ output: () => 1 }),
      expired: s.final(),
    },
    { start: 'form' },
  )

  it('lists nodes with kind/label/path/hooks/dependsOn/timeout/dynamicNext/start (recursing into children)', () => {
    const graph = inspect(flow)
    expect(graph.name).toBe('root')
    expect(graph.version).toBe(1)
    expect(graph.nodes.map((n) => [n.path.join('/'), n.id, n.kind])).toEqual([
      ['', 'form', 'view'],
      ['', 'reserve', 'task'],
      ['', 'wait', 'wait'],
      ['', 'route', 'decision'],
      ['', 'sub', 'flow'],
      ['', 'done', 'final'],
      ['', 'expired', 'final'],
      ['sub', 'work', 'task'],
      ['sub', 'end', 'final'],
      ['sub', 'lost', 'final'],
    ])
    const byId = Object.fromEntries(
      graph.nodes.filter((n) => n.path.length === 0).map((n) => [n.id, n]),
    )
    expect(byId.form).toEqual({
      id: 'form',
      kind: 'view',
      label: 'Form',
      path: [],
      hooks: ['enter', 'exit'],
      start: true,
    })
    expect(byId.reserve).toEqual({
      id: 'reserve',
      kind: 'task',
      path: [],
      hooks: ['run', 'compensate'],
      timeout: 5000,
    })
    expect(byId.wait).toEqual({
      id: 'wait',
      kind: 'wait',
      path: [],
      hooks: ['on:ping', 'on:pong'],
      timeout: 60_000,
    })
    expect(byId.route).toEqual({
      id: 'route',
      kind: 'decision',
      path: [],
      hooks: ['next'],
      dynamicNext: true,
    })
    expect(byId.sub).toEqual({
      id: 'sub',
      kind: 'flow',
      path: [],
      hooks: ['context'], // authoring name (compiled: childContext)
      dependsOn: { all: ['reserve'] },
    })
    expect(byId.done).toEqual({ id: 'done', kind: 'final', path: [], hooks: ['output'] })
    const work = graph.nodes.find((n) => n.id === 'work')
    expect(work).toEqual({
      id: 'work',
      kind: 'task',
      label: 'Work',
      path: ['sub'],
      hooks: ['run'],
      start: true,
    })
  })

  it('lists start/next/timeout/dependsOn edges per flow path', () => {
    const graph = inspect(flow)
    expect(graph.edges).toEqual([
      { from: null, to: 'form', kind: 'start', path: [] },
      { from: 'form', to: 'reserve', kind: 'next', path: [] },
      { from: 'form', to: 'wait', kind: 'next', path: [] },
      { from: 'reserve', to: 'route', kind: 'next', path: [] },
      { from: 'wait', to: 'route', kind: 'next', path: [] },
      { from: 'wait', to: 'expired', kind: 'timeout', path: [] },
      { from: 'sub', to: 'done', kind: 'next', path: [] },
      { from: 'reserve', to: 'sub', kind: 'dependsOn', path: [] },
      { from: null, to: 'work', kind: 'start', path: ['sub'] },
      { from: 'work', to: 'end', kind: 'next', path: ['sub'] },
    ])
  })

  it('carries the compile warnings (with paths) and is stable across calls', () => {
    const graph = inspect(flow)
    expect(graph.warnings).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'lost' is not reachable from start",
        step: 'lost',
        path: ['sub'],
      },
    ])
    expect(inspect(flow).nodes).toEqual(graph.nodes)
  })

  it('throws DEFINITION_INVALID for a broken flow', () => {
    const broken = {
      '~types': undefined,
      name: 'broken',
      context: boundary.trusted(),
      steps: { a: { kind: 'view', next: 'zzz', '~types': undefined } },
    }
    expect(() => inspect(broken as never)).toThrow(WizardError)
  })
})
