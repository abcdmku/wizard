/** Deliver every callback even when a subscriber or its error handler throws. */
export function notifyListeners<T>(
  listeners: Iterable<(value: T) => void>,
  value: T,
  onListenerError: (error: unknown) => void,
): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(value)
    } catch (error) {
      try {
        onListenerError(error)
      } catch (reportingError) {
        rethrowListenerError(reportingError)
      }
    }
  }
}

/** Default listener error handling matches a local run. */
export function rethrowListenerError(error: unknown): void {
  queueMicrotask(() => {
    throw error
  })
}
