import boundaries from '../../assets/diagrams/boundaries.svg?raw'
import deployment from '../../assets/diagrams/deployment.svg?raw'
import durability from '../../assets/diagrams/durability.svg?raw'
import runtime from '../../assets/diagrams/runtime.svg?raw'
import system from '../../assets/diagrams/system.svg?raw'

const diagrams = {
  boundaries,
  deployment,
  durability,
  runtime,
  system,
} as const

export type DiagramName = keyof typeof diagrams

export function Diagram({ name }: { readonly name: DiagramName }) {
  // These strings are compile-time imports from the repository's SVG files, never user input.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Inline markup inherits the active docs theme.
  return <figure className="docs-diagram" dangerouslySetInnerHTML={{ __html: diagrams[name] }} />
}
