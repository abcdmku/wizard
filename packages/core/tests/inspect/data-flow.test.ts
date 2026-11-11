import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary } from '../../src/authoring/boundary'
import { inspect, toMermaid } from '../../src/inspect'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('inspect data patterns', () => {
  it('describes named pull edges, their skip rules and only the final consumer as a sink', () => {
    const wizard = defineWizard(
      { name: 'quotes', context: boundary.trusted<{}>() },
      ({ step, steps }) => {
        const amount = step({ run: () => 10 })
        const remote = step({ run: () => 'remote' })
        const cached = step({ run: () => true })
        return steps(
          {
            amount,
            remote,
            cached,
            join: step({
              needs: { amount, winner: { any: [remote, cached] }, extra: { optional: cached } },
              run: ({ needs }) => needs.amount,
            }),
          },
          { start: ['amount', 'remote', 'cached'] },
        )
      },
    )
    const graph = inspect(wizard)
    expect(graph.nodes.map((node) => [node.id, node.completes])).toEqual([
      ['amount', undefined],
      ['remote', undefined],
      ['cached', undefined],
      ['join', true],
    ])
    expect(graph.nodes.find((node) => node.id === 'join')?.needs).toEqual({
      amount: { kind: 'all', steps: ['amount'] },
      winner: { kind: 'any', steps: ['remote', 'cached'] },
      extra: { kind: 'optional', steps: ['cached'] },
    })
    expect(graph.edges.filter((edge) => edge.kind === 'needs')).toEqual([
      { from: 'amount', to: 'join', kind: 'needs', alias: 'amount', mode: 'all', path: [] },
      { from: 'remote', to: 'join', kind: 'needs', alias: 'winner', mode: 'any', path: [] },
      { from: 'cached', to: 'join', kind: 'needs', alias: 'winner', mode: 'any', path: [] },
      { from: 'cached', to: 'join', kind: 'needs', alias: 'extra', mode: 'optional', path: [] },
    ])
    expect(graph.warnings).toEqual([])
    const mermaid = toMermaid(graph)
    expect(mermaid).toContain('amount -->|"needs: amount"| join')
    expect(mermaid).toContain('remote -->|"needs: winner (any)"| join')
    expect(mermaid).toContain('cached -->|"needs: winner (any) · needs: extra (optional)"| join')
  })

  it('keeps fallback and wait-timeout sources as happy-path sinks and draws alternate edges', () => {
    const wizard = defineWizard(
      {
        name: 'recovery',
        context: boundary.trusted<{}>(),
        events: { received: boundary.trusted<string>() },
      },
      ({ step, steps }) =>
        steps(
          {
            trip: step({ run: () => 42, fallback: 'recover' }),
            wait: step({
              waitFor: { received: ({ payload }) => ({ done: payload }) },
              timeout: { after: '1m', next: 'recover' },
            }),
            recover: step({ run: () => 'recovered' }),
          },
          { start: ['trip', 'wait'] },
        ),
    )
    const graph = inspect(wizard)
    expect(graph.nodes.map((node) => [node.id, node.completes])).toEqual([
      ['trip', true],
      ['wait', true],
      ['recover', true],
    ])
    expect(graph.nodes[0]?.fallback).toBe('recover')
    expect(graph.edges.filter((edge) => edge.kind !== 'start')).toEqual([
      { from: 'trip', to: 'recover', kind: 'fallback', path: [] },
      { from: 'wait', to: 'recover', kind: 'timeout', path: [] },
    ])
    expect(graph.warnings.map((warning) => warning.code)).toEqual(['MULTIPLE_SINKS'])
    expect(toMermaid(graph)).toContain('trip -.->|"fallback"| recover')
    expect(toMermaid(graph)).toContain('wait -.->|"timeout 1m"| recover')
  })

  it('exposes map concurrency, item output schemas and static or dynamic sleeps without running hooks', () => {
    let calls = 0
    const wizard = defineWizard(
      { name: 'batch', context: z.object({ ids: z.array(z.string()) }) },
      ({ step, steps }) =>
        steps({
          batch: step({
            each: ({ context }) => {
              calls += 1
              return context.ids
            },
            key: (item) => item,
            concurrency: 3,
            run: ({ item }) => item.length,
            output: z.number(),
            next: 'pause',
          }),
          pause: step({ sleep: '1s', next: 'dynamic' }),
          dynamic: step({
            sleep: () => {
              calls += 1
              return '2s'
            },
          }),
        }),
    )
    const graph = inspect(wizard)
    expect(calls).toBe(0)
    expect(graph.nodes.map((node) => [node.id, node.each, node.sleep])).toEqual([
      ['batch', { concurrency: 3, keyed: true }, undefined],
      ['pause', undefined, 1000],
      ['dynamic', undefined, 'dynamic'],
    ])
    expect(graph.nodes[0]?.output).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'array',
      items: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
    })
    expect(graph.nodes[0]?.hooks).toEqual(['run', 'each', 'key'])
    expect(graph.nodes[2]?.hooks).toEqual(['sleep'])
    const mermaid = toMermaid(graph)
    expect(mermaid).toContain('batch[["batch<br/>each · concurrency 3"]]')
    expect(mermaid).toContain('pause[["pause<br/>sleep 1s"]]')
    expect(mermaid).toContain('dynamic[["dynamic<br/>sleep (dynamic)"]]')
  })

  it('warns when required needs pull both exclusive branch outputs', () => {
    const wizard = defineWizard(
      { name: 'choice', context: boundary.trusted<{}>() },
      ({ step, steps }) => {
        const left = step({ run: () => 1 })
        const right = step({ run: () => 'right' })
        return steps({
          choose: step({ targets: [left, right], next: () => left }),
          left,
          right,
          join: step({ needs: { left, right }, run: ({ needs }) => `${needs.left}${needs.right}` }),
        })
      },
    )
    expect(inspect(wizard).warnings).toEqual([
      {
        code: 'EXCLUSIVE_JOIN',
        message:
          "step 'join' needs all of 'left', 'right', which are alternative branches of 'choose' (only one runs); use needs: { result: { any: [...] } } or join after the branches merge",
        step: 'join',
        path: [],
      },
    ])
  })

  it('serializes an unbounded map without converting its concurrency into null', () => {
    const wizard = defineWizard(
      { name: 'unbounded', context: boundary.trusted<{}>() },
      ({ step, steps }) =>
        steps({ batch: step({ each: () => [1, 2], run: ({ item }) => item * 2 }) }),
    )
    const graph = inspect(wizard)
    expect(graph.nodes[0]?.each).toEqual({})
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph)
    expect(toMermaid(graph)).toContain('batch[["batch<br/>each"]]')
  })

  it('fingerprints need modes and map or sleep structure, while ignoring concurrency and delay tuning', () => {
    const graphFor = (mode: 'required' | 'optional', concurrency: number, sleep: '1s' | '2s') =>
      inspect(
        defineWizard({ name: 'structure', context: boundary.trusted<{}>() }, ({ step, steps }) => {
          const producer = step({ each: () => [1], run: ({ item }) => item, concurrency })
          return steps({
            producer,
            consumer: step({
              needs: mode === 'required' ? { producer } : { producer: { optional: producer } },
              sleep,
            }),
          })
        }),
      )
    expect(graphFor('required', 1, '1s').fingerprint).toBe(
      graphFor('required', 5, '2s').fingerprint,
    )
    expect(graphFor('required', 1, '1s').fingerprint).not.toBe(
      graphFor('optional', 1, '1s').fingerprint,
    )
  })
})
