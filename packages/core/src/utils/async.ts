export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingPromise: Promise<Awaited<ReturnType<T>>> | null = null;

  return (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    if (pendingPromise) {
      return pendingPromise;
    }

    const promise = new Promise<Awaited<ReturnType<T>>>((resolve, reject) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...args);
          pendingPromise = null;
          resolve(result);
        } catch (error) {
          pendingPromise = null;
          reject(error);
        }
      }, delay);
    });

    pendingPromise = promise;
    return promise;
  };
}
