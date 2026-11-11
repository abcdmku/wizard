/**
 * `toMarkdown(graph)` — render a manifest (from `inspect(flow)`) as one Markdown page: the
 * diagram, a table of every step, the facts of each step, the context and event schemas and the
 * analysis warnings. Pure text, so the page can be committed and compared.
 *
 * @packageDocumentation
 */

import { describeSchema, fieldTable } from './markdown-schema'
import { toMermaid } from './mermaid'
import { duration } from './mermaid-syntax'
import type { FlowGraph, FlowGraphEdge, FlowGraphNode, GraphNeed } from './types'

/**
 * Render a manifest as a Markdown page for people and coding agents: a title with the version
 * and fingerprint, the `toMermaid` diagram, then per flow (root first, each child flow under its
 * step) a table of when every step starts, what it does and where it leads, followed by one
 * section per step with its needs, guard, retry, timeout, undo hook, hooks and JSON Schemas.
 * Ends with the context fields, the declared events with the steps that wait for or handle
 * them, and the warnings. Only manifest facts are printed: a hook is named, never executed or
 * described. Deterministic for a given manifest.
 * @public
 */
export function toMarkdown(graph: FlowGraph): string {
  const lines: string[] = [`# ${graph.name}`, '']
  if (graph.description !== undefined) lines.push(graph.description, '')
  lines.push(
    `Wizard \`${graph.name}\`, version ${graph.version}, fingerprint \`${graph.fingerprint}\`.`,
    '',
    '## Diagram',
    '',
    '```mermaid',
    toMermaid(graph),
    '```',
    '',
  )
  for (const path of flowPaths(graph)) lines.push(...flowSection(graph, path))
  if (graph.schemas.context !== undefined) {
    lines.push('## Context', '', ...fieldTable(graph.schemas.context), '')
  }
  lines.push(...eventsSection(graph), ...warningsSection(graph))
  return `${lines.join('\n').trimEnd()}\n`
}

/** The root flow, then every child flow in node order. */
function flowPaths(graph: FlowGraph): (readonly string[])[] {
  const paths: (readonly string[])[] = [[]]
  for (const node of graph.nodes) if (node.child !== undefined) paths.push([...node.path, node.id])
  return paths.filter((path) => graph.nodes.some((node) => samePath(node.path, path)))
}

function flowSection(graph: FlowGraph, path: readonly string[]): string[] {
  const nodes = graph.nodes.filter((node) => samePath(node.path, path))
  const edges = graph.edges.filter((edge) => samePath(edge.path, path))
  const owner = graph.nodes.find((node) => samePath([...node.path, node.id], path))
  const title =
    owner?.child === undefined
      ? '## Steps'
      : `## Steps of ${code(owner.child.name)}, the child wizard of step ${code(stepName(owner))}`
  const rows = nodes.map((node) => [
    code(node.id),
    node.kind,
    startsWhen(node, edges).join('; '),
    does(node),
    leadsTo(node, edges).join('; '),
  ])
  return [
    title,
    '',
    ...table(['Step', 'Kind', 'Starts when', 'Does', 'Then'], rows),
    '',
    ...nodes.flatMap((node) => stepSection(node, edges)),
  ]
}

function stepSection(node: FlowGraphNode, edges: readonly FlowGraphEdge[]): string[] {
  const facts: string[] = [
    `Starts when: ${startsWhen(node, edges).join('; ')}.`,
    `Then: ${leadsTo(node, edges).join('; ')}.`,
  ]
  for (const [alias, need] of Object.entries(node.needs ?? {})) {
    facts.push(`${code(`needs.${alias}`)} is ${needText(need)}.`)
  }
  if (node.hooks.includes('when')) facts.push('Skipped when its `when` guard returns false.')
  if (node.retry !== undefined) facts.push(`Retry: ${retryText(node.retry)}.`)
  if (node.timeout !== undefined && node.waitsFor === undefined) {
    facts.push(`Each run times out after ${duration(node.timeout)}.`)
  }
  if (node.compensable === true) {
    facts.push('Has a `compensate` hook that undoes it when the run compensates.')
  }
  if (node.hooks.length > 0) facts.push(`Hooks: ${node.hooks.map(code).join(', ')}.`)

  const lines = [`### ${stepName(node)}`, '']
  if (node.label !== undefined) lines.push(`${node.label}.`, '')
  if (node.description !== undefined) lines.push(node.description, '')
  lines.push(...facts.map((fact) => `- ${fact}`), '')
  const input = node.input === undefined ? [] : fieldTable(node.input)
  if (input.length > 0) lines.push('Input:', '', ...input, '')
  const output = node.output === undefined ? [] : fieldTable(node.output)
  // A view's output side usually prints the same table as its input side.
  if (output.length > 0 && output.join() !== input.join()) {
    lines.push('Output:', '', ...output, '')
  }
  return lines
}

function startsWhen(node: FlowGraphNode, edges: readonly FlowGraphEdge[]): string[] {
  const into = (kind: FlowGraphEdge['kind']): string[] =>
    edges.flatMap((edge) =>
      edge.to === node.id && edge.kind === kind && edge.from !== null ? [code(edge.from)] : [],
    )
  const parts: string[] = []
  if (node.start === true) parts.push('its wizard starts')
  if (into('next').length > 0) parts.push(`${list(into('next'), 'or')} finishes`)
  // A need activates its consumer, so the producers below are both gate and trigger.
  if (into('route').length > 0) parts.push(`${list(into('route'), 'or')} routes here`)
  if (into('timeout').length > 0) parts.push(`${list(into('timeout'), 'or')} times out`)
  if (into('fallback').length > 0) parts.push(`${list(into('fallback'), 'or')} fails for good`)
  for (const need of Object.values(node.needs ?? {})) {
    const steps = need.steps.map(code)
    parts.push(
      need.kind === 'any'
        ? `the first of ${list(steps, 'or')} finishes`
        : `${list(steps, 'and')} ${verb(need.kind === 'optional' ? 'settle' : 'finish', steps.length)}`,
    )
  }
  if (node.dependsOn !== undefined) {
    const gate =
      'any' in node.dependsOn
        ? `one of ${list(node.dependsOn.any.map(code), 'or')}`
        : list(node.dependsOn.all.map(code), 'and')
    parts.push(`held until ${gate} is done`)
  }
  return parts.length > 0 ? parts : ['never, nothing activates it']
}

function does(node: FlowGraphNode): string {
  const each = node.each === undefined ? '' : ' for each item'
  if (node.kind === 'view') return 'Collects input from a person'
  if (node.child !== undefined) {
    return `Runs child wizard ${code(node.child.name)} version ${node.child.version}${each}`
  }
  if (node.waitsFor !== undefined) return `Waits for ${list(node.waitsFor.map(code), 'or')}`
  if (node.sleep !== undefined) {
    return node.sleep === 'dynamic'
      ? 'Sleeps for a time computed by its `sleep` hook'
      : `Sleeps ${duration(node.sleep)}`
  }
  if (node.hooks.includes('run')) return `Runs work${each}`
  return 'Routes'
}

function leadsTo(node: FlowGraphNode, edges: readonly FlowGraphEdge[]): string[] {
  const out = (kind: FlowGraphEdge['kind']): string[] =>
    edges.flatMap((edge) => (edge.from === node.id && edge.kind === kind ? [code(edge.to)] : []))
  const parts: string[] = []
  if (out('next').length > 0) parts.push(list(out('next'), 'and'))
  if (out('route').length > 0) {
    parts.push(`${list(out('route'), 'or')}, chosen by its \`next\` function`)
  } else if (node.dynamicNext === true) {
    parts.push('steps chosen by its `next` function')
  }
  if (out('needs').length > 0) parts.push(`feeds ${list([...new Set(out('needs'))], 'and')}`)
  for (const target of out('timeout')) {
    const after = node.timeout === undefined ? '' : ` after ${duration(node.timeout)}`
    parts.push(`${target}${after} without an event`)
  }
  for (const target of out('fallback')) parts.push(`${target} if it fails for good`)
  if (node.completes === true) parts.push('ends its branch, and its output can be the result')
  return parts.length > 0 ? parts : ['ends its branch']
}

function needText(need: GraphNeed): string {
  const steps = need.steps.map(code)
  if (need.kind === 'any') return `the output of whichever of ${list(steps, 'or')} finishes first`
  if (need.kind === 'optional') return `the output of ${list(steps, 'and')}, or \`undefined\``
  return `the output of ${list(steps, 'and')}`
}

function retryText(retry: NonNullable<FlowGraphNode['retry']>): string {
  const count = `up to ${retry.retries} ${retry.retries === 1 ? 'retry' : 'retries'} after the first run`
  const backoff =
    retry.backoff === undefined
      ? 'with no delay'
      : retry.backoff === 'exponential'
        ? `with exponential backoff from ${duration(retry.baseMs ?? 200)}`
        : `${duration(retry.backoff)} apart`
  return `${count}, ${backoff}${retry.when === true ? ', only for errors its `when` accepts' : ''}`
}

function eventsSection(graph: FlowGraph): string[] {
  const names = Object.keys(graph.schemas.events)
  if (names.length === 0) return []
  const users = (event: string, hook: 'waitFor' | 'on'): string =>
    graph.nodes
      .filter((node) => node.hooks.includes(`${hook}:${event}`))
      .map((node) => code(stepName(node)))
      .join(', ')
  const rows = names.map((event) => [
    code(event),
    code(describeSchema(graph.schemas.events[event])),
    users(event, 'waitFor'),
    users(event, 'on'),
  ])
  return ['## Events', '', ...table(['Event', 'Payload', 'Completes', 'Also handled by'], rows), '']
}

function warningsSection(graph: FlowGraph): string[] {
  if (graph.warnings.length === 0) return []
  const rows = graph.warnings.map((warning) => [
    code(warning.code),
    warning.step === undefined ? '' : code([...warning.path, warning.step].join(' / ')),
    warning.message,
  ])
  return ['## Warnings', '', ...table(['Code', 'Step', 'Message'], rows), '']
}

/** A step id, prefixed with its child path (`fulfil / pick`), unique within the page. */
function stepName(node: FlowGraphNode): string {
  return [...node.path, node.id].join(' / ')
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index])
}

/** `finishes` for one subject, `finish` for several. */
function verb(base: 'finish' | 'settle', count: number): string {
  return count === 1 ? `${base}${base === 'finish' ? 'es' : 's'}` : base
}

function code(text: string): string {
  return `\`${text}\``
}

function list(items: readonly string[], word: 'and' | 'or'): string {
  if (items.length <= 2) return items.join(` ${word} `)
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const row = (cells: readonly string[]): string =>
    `| ${cells.map((cell) => cell.replaceAll('|', '\\|').replaceAll(/\s*\n\s*/g, ' ')).join(' | ')} |`
  return [row(head), row(head.map(() => '---')), ...rows.map(row)]
}
