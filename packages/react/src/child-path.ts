/** Child selection stays explicit internally, so numeric step ids are never treated as indices. */
export interface ChildSegment {
  readonly step: string
  readonly index?: number
}
export type ChildPath = readonly ChildSegment[]

export function appendChild(path: ChildPath, step: string, index?: number): ChildPath {
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) {
    throw new RangeError('useChild index must be a non-negative safe integer')
  }
  return [...path, index === undefined ? { step } : { step, index }]
}

export function wirePath(path: ChildPath): readonly string[] {
  return path.flatMap(({ step, index }) => (index === undefined ? [step] : [step, String(index)]))
}
