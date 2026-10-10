/**
 * The pure halves of the graph: the model (`buildGraphModel`), the layout pre-pass (back edges,
 * isolated nodes), the handle picker and the ELK layout — with the real bundled elkjs, and with a
 * stub engine to see exactly what ELK is asked to lay out.
 */
import { inspect } from '@openwizard/core'
import type { ElkNode } from 'elkjs/lib/elk-api'
import { describe, expect, it } from 'vitest'
import { findBackEdges, findIsolated } from '../src/layout/cycles'
import { type LayoutEngine, layoutGraph } from '../src/layout/elk'
import { pickHandles } from '../src/layout/handles'
import { buildGraphModel, entryKey } from '../src/layout/model'
import { pipeline } from './fixture'

const graph = inspect(pipeline)
const model = buildGraphModel(graph)
const node = (key: string) => model.nodes.find((n) => n.key === key)
const edge = (key: string) => model.edges.find((e) => e.key === key)

describe('buildGraphModel', () => {
  it('turns the flow step with a child flow into a group whose child steps and entry marker it contains', () => {
    expect(node('pack')?.kind).toBe('group')
    expect(node('pack/count')).toMatchObject({ kind: 'step', parent: 'pack', path: ['pack'] })
    expect(node('pack/packed')?.parent).toBe('pack')
    expect(node(entryKey(['pack']))).toMatchObject({ kind: 'entry', parent: 'pack' })
    expect(node(entryKey([]))).toMatchObject({ kind: 'entry' })
    expect(node(entryKey([]))?.parent).toBeUndefined()
    // Parents come before their children (React Flow needs that order).
    const keys = model.nodes.map((n) => n.key)
    expect(keys.indexOf('pack')).toBeLessThan(keys.indexOf('pack/count'))
  })

  it('draws every edge kind with the right label, plus a `?` port for a dynamic next', () => {
    expect(edge(`start:${entryKey([])}->form`)?.kind).toBe('start')
    expect(edge('next:ingest->normalize')?.kind).toBe('next')
    expect(edge('dependsOn:normalize->gate')).toMatchObject({
      kind: 'dependsOn',
      label: 'dependsOn',
    })
    expect(edge('timeout:awaitPayment->rejected')).toMatchObject({
      kind: 'timeout',
      label: 'timeout 15m',
    })
    expect(node('gate#dyn')?.kind).toBe('dynamic')
    expect(edge('dynamic:gate')).toMatchObject({
      source: 'gate',
      target: 'gate#dyn',
      kind: 'dynamic',
    })
    // Child edges live in the group's scope.
    expect(edge('next:pack/count->pack/packed')?.parent).toBe('pack')
    expect(edge(`start:${entryKey(['pack'])}->pack/count`)?.parent).toBe('pack')
  })

  it('indexes the flow warnings by step key', () => {
    for (const w of graph.warnings) {
      if (w.step !== undefined) expect(model.warnings[w.step]).toContain(w.code)
    }
  })
})

describe('layout pre-pass', () => {
  it('flags only the edges that close a cycle (DFS), never a forward DAG edge of a diamond', () => {
    const nodes = ['#entry', 'a', 'b', 'c', 'd'].map((key) => ({
      key,
      kind: key === '#entry' ? ('entry' as const) : ('step' as const),
      path: [],
      width: 1,
      height: 1,
    }))
    const edges = [
      { key: 's', source: '#entry', target: 'a', kind: 'start' as const, path: [] },
      { key: 'ab', source: 'a', target: 'b', kind: 'next' as const, path: [] },
      { key: 'ac', source: 'a', target: 'c', kind: 'next' as const, path: [] },
      { key: 'bd', source: 'b', target: 'd', kind: 'next' as const, path: [] },
      { key: 'dc', source: 'd', target: 'c', kind: 'next' as const, path: [] }, // long way round the diamond: forward
      { key: 'ca', source: 'c', target: 'a', kind: 'next' as const, path: [] }, // closes the cycle
      { key: 'dd', source: 'd', target: 'd', kind: 'next' as const, path: [] }, // self-loop
    ]
    expect([...findBackEdges(nodes, edges)].sort()).toEqual(['ca', 'dd'])
    expect([...findIsolated(nodes, edges)]).toEqual([])
  })

  it('finds the fixture step no edge touches (the orphan final), and nothing else', () => {
    expect([...findIsolated(model.nodes, model.edges)]).toEqual(['orphan'])
  })

  it('picks the sides: forward right→left, steep bottom→top, backwards same side (U-turn)', () => {
    const at = (x: number, y: number) => ({ x, y, width: 200, height: 72 })
    expect(pickHandles(at(0, 0), at(350, 0))).toEqual({ sourceHandle: 'r', targetHandle: 'l' })
    expect(pickHandles(at(0, 0), at(20, 300))).toEqual({ sourceHandle: 'b', targetHandle: 't' })
    expect(pickHandles(at(0, 300), at(20, 0))).toEqual({ sourceHandle: 't', targetHandle: 'b' })
    expect(pickHandles(at(700, 0), at(0, 0))).toEqual({ sourceHandle: 'b', targetHandle: 'b' })
    expect(pickHandles(at(700, 300), at(0, 0))).toEqual({ sourceHandle: 't', targetHandle: 't' })
  })
})

describe('layoutGraph', () => {
  it('asks ELK for a DAG of compound nodes: back edges dropped, groups nested, isolated nodes left out', async () => {
    let asked: ElkNode | undefined
    const stub: LayoutEngine = {
      layout: async (g) => {
        asked = g
        return g
      },
    }
    const cyclic = {
      ...model,
      edges: [
        ...model.edges,
        {
          key: 'next:normalize->form',
          source: 'normalize',
          target: 'form',
          kind: 'next' as const,
          path: [],
        },
      ],
    }
    const result = await layoutGraph(cyclic, stub)
    expect(result.backEdges.has('next:normalize->form')).toBe(true)
    const ids = new Set(asked?.edges?.map((e) => e.id))
    expect(ids.has('next:normalize->form')).toBe(false)
    expect(ids.has('next:ingest->normalize')).toBe(true)
    const group = asked?.children?.find((c) => c.id === 'pack')
    expect(group?.children?.map((c) => c.id).sort()).toEqual(
      [entryKey(['pack']), 'pack/count', 'pack/packed'].sort(),
    )
    expect(group?.edges?.length).toBe(2)
    expect(asked?.children?.some((c) => c.id === 'orphan')).toBe(false)
    expect(result.isolated.has('orphan')).toBe(true)
    // Parked anyway, right of everything ELK placed.
    expect(result.placements.orphan).toBeDefined()
  })

  it('with the bundled elkjs: layers run left → right along next edges, children sit inside their group', async () => {
    const result = await layoutGraph(model)
    const p = result.placements
    expect(p.form?.x).toBeLessThan(p.ingest?.x ?? 0)
    expect(p.ingest?.x).toBeLessThan(p.normalize?.x ?? 0)
    expect(p.normalize?.x).toBeLessThan(p.gate?.x ?? 0)
    // Group sized around its children; children positioned relative to the group with the header room.
    const group = p.pack
    const count = p['pack/count']
    const packed = p['pack/packed']
    expect(group?.width).toBeGreaterThan(400)
    expect(count?.x).toBeGreaterThanOrEqual(0)
    expect(count?.y).toBeGreaterThanOrEqual(24)
    expect(packed?.x).toBeGreaterThan(count?.x ?? 0)
    expect((packed?.x ?? 0) + (packed?.width ?? 0)).toBeLessThanOrEqual(group?.width ?? 0)
    // The orphan is parked to the right of the whole layout.
    const rightmost = Math.max(
      ...model.nodes
        .filter((n) => n.parent === undefined && n.key !== 'orphan')
        .map((n) => (p[n.key]?.x ?? 0) + (p[n.key]?.width ?? 0)),
    )
    expect(p.orphan?.x).toBeGreaterThan(rightmost)
  })
})
