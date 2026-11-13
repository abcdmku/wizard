import type { ReactElement } from 'react'
import type { WizardInfo } from '../wire'
import { span } from './format'

type Node = WizardInfo['manifest']['nodes'][number]

/** What a step does, in one word, read from its declaration. */
function roleOf(node: Node): string {
  if (node.kind === 'view') return 'form'
  if (node.kind === 'child') return 'child wizard'
  if (node.waitsFor !== undefined) return 'waits'
  if (node.sleep !== undefined) return 'sleeps'
  if (node.dynamicNext === true && !node.hooks.includes('run')) return 'routes'
  return 'runs'
}

/** The needs and options of a step, each as a short phrase. */
function tagsOf(node: Node): readonly string[] {
  const tags: string[] = []
  for (const [alias, need] of Object.entries(node.needs ?? {})) {
    const steps = need.steps.join(' or ')
    const named = alias === steps ? steps : `${alias} from ${steps}`
    if (need.kind === 'any') tags.push(`needs one of ${need.steps.join(', ')}`)
    else if (need.kind === 'optional') tags.push(`needs ${named} if it ran`)
    else tags.push(`needs ${named}`)
  }
  if (node.child !== undefined) tags.push(`runs ${node.child.name}`)
  if (node.each !== undefined) tags.push('once per item')
  for (const event of node.waitsFor ?? []) tags.push(`waits for ${event}`)
  if (node.sleep !== undefined)
    tags.push(node.sleep === 'dynamic' ? 'sleeps, set at start' : `sleeps ${span(node.sleep)}`)
  if (node.timeout !== undefined) tags.push(`times out after ${span(node.timeout)}`)
  if (node.targets !== undefined) tags.push(`goes to ${node.targets.join(' or ')}`)
  if (node.retry !== undefined && node.retry.retries > 0)
    tags.push(
      `retries ${node.retry.retries}${node.retry.backoff === 'exponential' ? ', backing off' : ''}`,
    )
  if (node.fallback !== undefined) tags.push(`falls back to ${node.fallback}`)
  if (node.compensable === true) tags.push('has an undo')
  return tags
}

/** Every step of a wizard: its name, what it does, its description, its needs and its options. */
export function Steps({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  return (
    <ol className="wz-steps">
      {wizard.manifest.nodes.map((node) => {
        const tags = tagsOf(node)
        return (
          <li key={[...node.path, node.id].join('/')}>
            <div className="wz-step-head">
              <code className="wz-step-name">
                {node.path.length > 0 && <span className="quiet">{node.path.join(' / ')} / </span>}
                {node.id}
              </code>
              <span className="wz-role">{roleOf(node)}</span>
              {node.start === true && <span className="wz-role wz-first">starts first</span>}
            </div>
            {node.description !== undefined && <p>{node.description}</p>}
            {tags.length > 0 && (
              <ul className="wz-tags" aria-label="Needs and options">
                {tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
