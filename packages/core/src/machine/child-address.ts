/** Stable internal addresses for mapped children. @internal */

export interface EachChildAddress {
  readonly step: string
  readonly index: number
  readonly key: string
}

export function eachChildAddress(
  step: string,
  index: number,
  key: string,
  steps?: Readonly<Record<string, unknown>>,
): string {
  let address = `@each/${encodeURIComponent(step)}/${index}/${encodeURIComponent(key)}`
  while (steps !== undefined && Object.hasOwn(steps, address)) address = `@${address}`
  return address
}

export function parseEachChildAddress(address: string): EachChildAddress | undefined {
  const [prefix, step, rawIndex, key, ...extra] = address.split('/')
  if (
    prefix === undefined ||
    step === undefined ||
    rawIndex === undefined ||
    key === undefined ||
    extra.length !== 0 ||
    !/^@+each$/.test(prefix) ||
    !/^(0|[1-9]\d*)$/.test(rawIndex)
  )
    return undefined
  const index = Number(rawIndex)
  if (!Number.isSafeInteger(index)) return undefined
  try {
    return { step: decodeURIComponent(step), index, key: decodeURIComponent(key) }
  } catch {
    return undefined
  }
}
