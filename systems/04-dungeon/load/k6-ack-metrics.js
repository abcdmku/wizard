import { Counter } from 'k6/metrics'
import { ACK_CODE_KEYS, ACK_REASON_KEYS, classifyAckFailure, metricKey } from './ack-policy.js'

const total = new Counter('ack_rejections_total')
const lifecycle = new Counter('ack_rejections_lifecycle')
const fatal = new Counter('ack_rejections_fatal')
const codeCounters = Object.fromEntries(
  ACK_CODE_KEYS.map((code) => [code, new Counter(`ack_rejection_code_${metricKey(code)}`)]),
)
const reasonCounters = Object.fromEntries(
  ACK_REASON_KEYS.map((reason) => [
    reason,
    new Counter(`ack_rejection_reason_${metricKey(reason)}`),
  ]),
)

export function recordAckRejection(pending, frame) {
  const classified = classifyAckFailure(pending, frame)
  const tags = {
    code: classified.code,
    reason: classified.reason,
    command: pending.commandType,
    disposition: classified.disposition,
  }
  total.add(1, tags)
  codeCounters[classified.code].add(1)
  reasonCounters[classified.reason].add(1)
  if (classified.disposition === 'lifecycle') lifecycle.add(1)
  else fatal.add(1)
  return classified
}
