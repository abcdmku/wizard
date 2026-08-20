import {
  type Command,
  createMirrorSource,
  defineProjection,
  type FlowRun,
  parseCommand,
} from '@openwizard/core'
import { orderFlow } from './order-flow'

export const publicOrder = defineProjection(orderFlow, {
  expose: {
    context: ['orderId'],
    steps: { prepare: { output: true } },
    output: true,
    progress: true,
  },
})

export function connectOrder(run: FlowRun<typeof orderFlow>) {
  return createMirrorSource(run, publicOrder)
}

export async function dispatchOrder(
  run: FlowRun<typeof orderFlow>,
  body: unknown,
  authorize: (command: Command<typeof orderFlow>) => boolean,
) {
  const parsed = parseCommand(orderFlow, body)
  if (!parsed.ok || !authorize(parsed.value)) return { ok: false as const }
  return run.dispatch(parsed.value)
}
