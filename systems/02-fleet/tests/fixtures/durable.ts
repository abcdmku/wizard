import type { DurableVersion } from '@openwizard/fleet-shared'
import { compose } from './compose'

export async function durableVersion(
  tenantId: string,
  deliveryId: string,
): Promise<DurableVersion> {
  const runKey = `${encodeURIComponent(tenantId)}:${encodeURIComponent(deliveryId)}`
  if (!/^[A-Za-z0-9_.:%-]+$/.test(runKey)) throw new Error('Unexpected durable run key')
  const escapedKey = runKey.replaceAll("'", "''")
  const output = await compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'fleet',
    '-d',
    'fleet',
    '-At',
    '-c',
    `SELECT snapshot_epoch::text || ':' || snapshot_seq::text FROM fleet_wizard_runs WHERE run_key = '${escapedKey}'`,
  )
  const [epochText, seqText] = output.trim().split(':')
  const epoch = Number(epochText)
  const seq = Number(seqText)
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !Number.isSafeInteger(seq) || seq < 0) {
    throw new Error(`No valid durable version found for ${runKey}`)
  }
  return { epoch, seq }
}

export async function durableCommandResult(
  tenantId: string,
  deliveryId: string,
  commandId: string,
): Promise<string> {
  const runKey = `${encodeURIComponent(tenantId)}:${encodeURIComponent(deliveryId)}`
  if (!/^[A-Za-z0-9_.:%-]+$/.test(runKey) || !/^[A-Za-z0-9_.:%-]+$/.test(commandId)) {
    throw new Error('Unexpected durable dedupe identifier')
  }
  const output = await compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'fleet',
    '-d',
    'fleet',
    '-At',
    '-c',
    `SELECT result FROM fleet_wizard_dedupe WHERE run_key = '${runKey}' AND dedupe_id = '${commandId}' AND status = 'completed'`,
  )
  const result = output.trim()
  if (result.length === 0) throw new Error(`No completed durable command found for ${commandId}`)
  return result
}
