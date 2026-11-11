export function activePartiesFromHealth(body) {
  const activeParties = body?.activeParties
  return Number.isInteger(activeParties) && activeParties >= 0 ? activeParties : null
}
