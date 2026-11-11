import { getThen } from './thenable'

/** Assimilate a host barrier once and turn every hostile-thenable failure into a rejected drain. */
export function runBarrier(
  start: () => void | Promise<void>,
  complete: () => void,
  abort: (error: unknown) => void,
): Promise<void> | undefined {
  let gate: void | Promise<void>
  let then: ReturnType<typeof getThen>
  try {
    gate = start()
    then = getThen(gate)
  } catch (error) {
    abort(error)
    return Promise.reject(error)
  }

  if (then === undefined) {
    try {
      complete()
      return undefined
    } catch (error) {
      abort(error)
      return Promise.reject(error)
    }
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      abort(error)
      reject(error)
    }
    const succeed = (): void => {
      if (settled) return
      settled = true
      try {
        complete()
        resolve()
      } catch (error) {
        abort(error)
        reject(error)
      }
    }
    try {
      then.call(gate, succeed, fail)
    } catch (error) {
      fail(error)
    }
  })
}
