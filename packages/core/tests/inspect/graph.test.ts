import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { inspect } from '../../src/inspect/graph'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('inspect', () => {
  const child = defineWizard(
    { name: 'child', version: 2, context: z.object({ n: z.number() }), output: () => undefined },
    ({ step, steps }) =>
      steps({
        work: step({ run: async () => 1, next: 'end', label: 'Work' }),
        end: step({ next: null }),
        lost: step({ next: null }),
      }),
  )
  const wizard = defineWizard(
    {
      name: 'root',
      context: boundary.trusted<{ a: string }>(),
      events: { ping: boundary.trusted<{ n: number }>(), pong: boundary.trusted() },
      output: () => undefined,
    },
    ({ step, view, flow, steps }) =>
      steps(
        {
          form: view({
            label: 'Form',
            input: z.object({ x: z.string() }),
            enter: () => {},
            exit: () => {},
            next: ['reserve', 'wait'],
          }),
          reserve: step({ run: async () => 1, timeout: '5s', compensate: () => {}, next: 'route' }),
          wait: step({
            waitFor: { ping: () => {}, pong: () => {} },
            timeout: { after: '1m', next: 'expired' },
            next: 'route',
          }),
          route: step({ next: () => 'sub', targets: ['sub'] }),
          sub: flow(child, {
            context: () => ({ n: 1 }),
            dependsOn: ['reserve'],
            next: 'done',
          }),
          done: step({ run: () => 1 }),
          expired: step({ next: null }),
        },
        { start: 'form' },
      ),
  )

  it('describes every step: kind, label, hooks, schemas, waits, compensation, child flow (recursing with path)', () => {
    const graph = inspect(wizard)
    expect(graph.name).toBe('root')
    expect(graph.version).toBe(1)
    expect(graph.nodes).toEqual([
      {
        id: 'form',
        kind: 'view',
        label: 'Form',
        path: [],
        hooks: ['enter', 'exit'],
        start: true,
        input: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { x: { type: 'string' } },
          required: ['x'],
        },
        output: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { x: { type: 'string' } },
          required: ['x'],
          additionalProperties: false,
        },
      },
      {
        id: 'reserve',
        kind: 'step',
        path: [],
        hooks: ['run', 'compensate'],
        timeout: 5000,
        compensable: true,
      },
      {
        id: 'wait',
        kind: 'step',
        path: [],
        hooks: ['waitFor:ping', 'waitFor:pong'],
        timeout: 60_000,
        waitsFor: ['ping', 'pong'],
      },
      { id: 'route', kind: 'step', path: [], hooks: ['next'], dynamicNext: true, targets: ['sub'] },
      {
        id: 'sub',
        kind: 'flow',
        path: [],
        hooks: ['context'], // authoring name (compiled: childContext)
        dependsOn: { all: ['reserve'] },
        child: { name: 'child', version: 2 },
      },
      { id: 'done', kind: 'step', path: [], hooks: ['run'], completes: true },
      { id: 'expired', kind: 'step', path: [], hooks: [], completes: true },
      { id: 'work', kind: 'step', label: 'Work', path: ['sub'], hooks: ['run'], start: true },
      { id: 'end', kind: 'step', path: ['sub'], hooks: [], completes: true },
      { id: 'lost', kind: 'step', path: ['sub'], hooks: [], completes: true },
    ])
  })

  it('lists start/next/timeout/dependsOn edges per flow path', () => {
    const graph = inspect(wizard)
    expect(graph.edges).toEqual([
      { from: null, to: 'form', kind: 'start', path: [] },
      { from: 'form', to: 'reserve', kind: 'next', path: [] },
      { from: 'form', to: 'wait', kind: 'next', path: [] },
      { from: 'reserve', to: 'route', kind: 'next', path: [] },
      { from: 'wait', to: 'route', kind: 'next', path: [] },
      { from: 'wait', to: 'expired', kind: 'timeout', path: [] },
      { from: 'route', to: 'sub', kind: 'route', path: [] },
      { from: 'sub', to: 'done', kind: 'next', path: [] },
      { from: 'reserve', to: 'sub', kind: 'dependsOn', path: [] },
      { from: null, to: 'work', kind: 'start', path: ['sub'] },
      { from: 'work', to: 'end', kind: 'next', path: ['sub'] },
    ])
  })

  it('carries the compile warnings (with paths) and is stable across calls', () => {
    const graph = inspect(wizard)
    expect(graph.warnings).toEqual([
      {
        code: 'UNREACHABLE',
        message: "step 'lost' is not reachable from start",
        step: 'lost',
        path: ['sub'],
      },
    ])
    expect(inspect(wizard).nodes).toEqual(graph.nodes)
  })
})
