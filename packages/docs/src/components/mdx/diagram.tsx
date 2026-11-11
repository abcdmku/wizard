import boundaries from '../../assets/diagrams/boundaries.svg?raw'
import compensation from '../../assets/diagrams/compensation.svg?raw'
import deployment from '../../assets/diagrams/deployment.svg?raw'
import durability from '../../assets/diagrams/durability.svg?raw'
import graph from '../../assets/diagrams/graph.svg?raw'
import order from '../../assets/diagrams/order.svg?raw'
import parallel from '../../assets/diagrams/parallel.svg?raw'
import projection from '../../assets/diagrams/projection.svg?raw'
import recovery from '../../assets/diagrams/recovery.svg?raw'
import runtime from '../../assets/diagrams/runtime.svg?raw'
import runtimeModel from '../../assets/diagrams/runtime-model.svg?raw'
import simpleFlow from '../../assets/diagrams/simple-flow.svg?raw'
import system from '../../assets/diagrams/system.svg?raw'

const diagrams = {
  boundaries,
  compensation,
  deployment,
  durability,
  graph,
  order,
  parallel,
  projection,
  recovery,
  runtimeModel,
  runtime,
  simpleFlow,
  system,
} as const

export type DiagramName = keyof typeof diagrams

export function Diagram({ name }: { readonly name: DiagramName }) {
  // These strings are compile-time imports from the repository's SVG files, never user input.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Inline markup inherits the active docs theme.
  return <figure className="docs-diagram" dangerouslySetInnerHTML={{ __html: diagrams[name] }} />
}
