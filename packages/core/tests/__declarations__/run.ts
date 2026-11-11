import { boundOrder, store } from './wizard'

/** A live run handed to another module. */
export function openOrder(orderId: string) {
  return boundOrder.create({ orderId }, { store })
}

/** The outcome of a whole run. */
export function runOrder(orderId: string) {
  return boundOrder.run({ orderId })
}

/** What a server handler returns about a run. Every value keeps its inferred type. */
export async function describeOrder(orderId: string) {
  const run = openOrder(orderId)
  try {
    await run.start()
    const navigation = await run.next()
    const state = run.getState()
    return {
      state,
      snapshot: run.getSnapshot(),
      rejected: navigation.ok ? undefined : navigation,
      issues: await run.validate('confirm'),
      progress: run.progress(),
      shipTo: state.steps.shipTo.child,
      waitingFor: run.waitingFor(),
      explanation: run.explain('summary'),
      log: run.log(),
      result: run.result(),
    }
  } finally {
    run.dispose()
  }
}
