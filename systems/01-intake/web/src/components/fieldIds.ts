export function joinIds(...ids: Array<string | undefined>): string | undefined {
  const joined = ids.filter((id): id is string => Boolean(id)).join(' ')
  return joined.length > 0 ? joined : undefined
}
