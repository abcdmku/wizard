import { Gauge } from 'k6/metrics'
import { requireActiveParties, seedParties } from './k6-support.js'

const healthBeforeSeed = new Gauge('health_active_parties_before_seed')
const healthAfterSeed = new Gauge('health_active_parties_after_seed')

export function setupParties(baseUrl, seedKey, profile) {
  healthBeforeSeed.add(requireActiveParties(baseUrl, 0, 'before seed'))
  const parties = seedParties(baseUrl, seedKey, profile.parties, profile.playersPerParty)
  healthAfterSeed.add(requireActiveParties(baseUrl, profile.parties, 'after seed'))
  return parties
}
