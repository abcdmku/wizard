export function waitUntil(timestamp: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const handle = setTimeout(finish, Math.max(0, timestamp - Date.now()))
    const onAbort = () => {
      clearTimeout(handle)
      reject(abortError())
    }
    function finish() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): Error {
  const error = new Error('operation aborted')
  error.name = 'AbortError'
  return error
}
