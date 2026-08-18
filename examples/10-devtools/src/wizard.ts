/**
 * The wizard this page drives: example 07's pipeline with fake services that take real time.
 * `context` is exported too — handing it to `<Devtools context>` lets the timeline replay the run
 * from seq 0 even when the panel mounts late.
 */
import { createWizard, type Wizard } from '@openwizard/core'
import { type Deps, makeDeps, pipeline } from './pipeline'

export { pipeline }
export const context = { source: 'crm-export' }

export function createPipelineWizard(deps: Deps = makeDeps()): Wizard<typeof pipeline> {
  return createWizard(pipeline, { context, deps, logSize: 1_000 })
}
