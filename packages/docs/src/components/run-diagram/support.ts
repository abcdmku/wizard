/** A promise a scenario settles by hand, so a diagram can show a step while its service call is open. */
export function deferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // A rejection is always expected by the step that awaits it.
  promise.catch(() => {})
  return { promise, resolve, reject }
}
