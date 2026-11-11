export const ACK_CODE_KEYS = [
  'unauthorized',
  'forbidden',
  'invalid-command',
  'not-found',
  'sequence-conflict',
  'out-of-range',
  'key-not-owned',
  'door-already-open',
  'rate-limited',
  'server-error',
  'unknown',
  'malformed',
]

export const ACK_REASON_RULES = [
  ['defeated-player', 'invalid-command', 'defeated players can only request a rematch'],
  ['party-not-in-lobby', 'invalid-command', 'party is not in lobby'],
  ['party-not-active', 'invalid-command', 'party is not active'],
  ['attack-cooling-down', 'invalid-command', 'attack is cooling down'],
  ['health-full', 'invalid-command', 'health is already full'],
  ['item-not-consumable', 'invalid-command', 'item cannot be consumed'],
  ['not-awaiting-rematch', 'invalid-command', 'party is not awaiting a rematch'],
  ['command-id-reused', 'invalid-command', 'commandId was already used for another command'],
  ['player-not-connected', 'forbidden', 'player is not connected to this party'],
  ['viewer-party-mismatch', 'forbidden', 'viewer belongs to another party'],
  ['player-not-in-party', 'forbidden', 'player is not in this party'],
  ['player-disconnected', 'forbidden', 'player is disconnected'],
  ['objective-incomplete', 'forbidden', 'the shared objective is incomplete'],
  ['fixture-not-found', 'not-found', 'fixture not found'],
  ['enemy-not-found', 'not-found', 'enemy not found'],
  ['loot-not-found', 'not-found', 'loot not found'],
  ['inventory-slot-empty', 'not-found', 'inventory slot is empty'],
  ['fixture-too-far', 'out-of-range', 'fixture is too far away'],
  ['enemy-too-far', 'out-of-range', 'enemy is too far away'],
  ['loot-too-far', 'out-of-range', 'loot is too far away'],
  ['key-bound-to-other', 'key-not-owned', 'the key is bound to another player'],
  ['required-key-not-owned', 'key-not-owned', 'this player does not own the required key'],
  ['door-open', 'door-already-open', 'door is already open'],
  ['party-state-changed', 'sequence-conflict', 'party state changed'],
  ['command-pending', 'rate-limited', 'command is still pending'],
  ['host-ownership-lost', 'server-error', 'durable party host lost ownership'],
  ['missing-domain-result', 'server-error', 'command completed without a domain result'],
]

export const ACK_REASON_KEYS = [...ACK_REASON_RULES.map(([key]) => key), 'other', 'malformed']

const protocolCodes = new Set(ACK_CODE_KEYS.slice(0, 10))
const lifecycleReasons = new Set(['party-not-active', 'defeated-player'])

export function metricKey(value) {
  return value.replaceAll('-', '_')
}

export function classifyAckFailure(pending, frame) {
  const valid =
    frame?.ok === false &&
    typeof frame.code === 'string' &&
    typeof frame.message === 'string' &&
    frame.message.length > 0 &&
    typeof frame.retryable === 'boolean'
  if (!valid) return { code: 'malformed', reason: 'malformed', disposition: 'fatal' }
  const code = protocolCodes.has(frame.code) ? frame.code : 'unknown'
  const rule = ACK_REASON_RULES.find(([, ruleCode, message]) => {
    return ruleCode === frame.code && message === frame.message
  })
  const reason = rule?.[0] ?? 'other'
  const lifecycle =
    pending.commandType === 'move' &&
    frame.code === 'invalid-command' &&
    frame.retryable === false &&
    lifecycleReasons.has(reason)
  return { code, reason, disposition: lifecycle ? 'lifecycle' : 'fatal' }
}
