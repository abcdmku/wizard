import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type AckFrame,
  type ErrorFrame,
  type ProtocolError,
  SeedPlayerSchema,
  type SnapshotFrame,
  type WelcomeFrame,
} from '@wizard/dungeon-shared'
import { z } from 'zod'
import type { CommandFailureCode, Viewer } from './domain.js'
import type { PartyRuntime, RuntimeAck } from './runtime.js'

const StandardSeedSchema = z
  .object({
    partyId: z.string().trim().min(1).max(64),
    seed: z.number().int().nonnegative(),
    players: z.array(SeedPlayerSchema).min(2).max(4),
  })
  .strict()

const DevAccountSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    email: z.email(),
    password: z.string(),
    role: z.enum(['player', 'warden']),
  })
  .strict()

const DevSeedSchema = z
  .object({
    accounts: z.array(DevAccountSchema).min(2),
    fixtures: z.array(z.string()).default([]),
  })
  .strict()

export const SeedRequestSchema = z.union([StandardSeedSchema, DevSeedSchema])
export const ResetRequestSchema = z
  .object({
    partyId: z.string().trim().min(1).max(64),
    seed: z.number().int().nonnegative().optional(),
  })
  .strict()

export type NormalizedSeed = z.infer<typeof StandardSeedSchema>

export class RequestBodyError extends Error {
  readonly status: 400 | 413

  constructor(status: 400 | 413, message: string) {
    super(message)
    this.name = 'RequestBodyError'
    this.status = status
  }
}

export const normalizeSeed = (input: z.infer<typeof SeedRequestSchema>): NormalizedSeed => {
  if ('partyId' in input) return input
  return {
    partyId: 'starter-room',
    seed: 4_242,
    players: input.accounts
      .filter((account) => account.role === 'player')
      .slice(0, 4)
      .map((account) => ({ id: account.id, name: account.email.split('@')[0] ?? account.id })),
  }
}

export const readJson = async (request: IncomingMessage, maxBytes = 65_536): Promise<unknown> => {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new RequestBodyError(413, 'request body is too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new RequestBodyError(400, 'request body must be valid JSON')
  }
}

export const writeJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  corsOrigin: string,
): void => {
  response.writeHead(status, {
    'access-control-allow-origin': corsOrigin,
    'access-control-allow-headers': 'content-type,x-seed-key,x-dungeon-seed-key',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

const headerValue = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export const hasSeedKey = (request: IncomingMessage, expected: string): boolean => {
  const supplied = headerValue(request, 'x-seed-key') ?? headerValue(request, 'x-dungeon-seed-key')
  if (supplied === undefined) return false
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

type ProtocolErrorCode = ProtocolError['code']

export const protocolCode = (code: CommandFailureCode): ProtocolErrorCode => {
  switch (code) {
    case 'INVALID_COMMAND':
      return 'invalid-command'
    case 'FORBIDDEN':
      return 'forbidden'
    case 'NOT_FOUND':
      return 'not-found'
    case 'OUT_OF_RANGE':
      return 'out-of-range'
    case 'STALE':
      return 'sequence-conflict'
    case 'BUSY':
      return 'rate-limited'
    case 'KEY_NOT_OWNED':
      return 'key-not-owned'
    case 'DOOR_ALREADY_OPEN':
      return 'door-already-open'
    case 'INTERNAL':
      return 'server-error'
  }
}

export const ackFrame = (runtime: PartyRuntime, commandId: string, ack: RuntimeAck): AckFrame => {
  const base = {
    type: 'ack' as const,
    protocolVersion: 1 as const,
    partyId: runtime.partyId,
    commandId,
    sequence: ack.sequence,
    tick: ack.tick,
  }
  return ack.result.ok
    ? { ...base, ok: true, replayed: ack.replayed }
    : {
        ...base,
        ok: false,
        code: protocolCode(ack.result.code),
        message: ack.result.message,
        retryable: ack.result.code === 'BUSY' || ack.result.code === 'STALE',
      }
}

export const snapshotFrame = (
  runtime: PartyRuntime,
  projection: SnapshotFrame['projection'],
  sequence: number,
  epoch: number,
  now: () => Date,
): SnapshotFrame => ({
  type: 'snapshot',
  protocolVersion: 1,
  partyId: runtime.partyId,
  instanceId: runtime.host.run.id,
  epoch,
  sequence,
  tick: projection.tick,
  sentAt: now().toISOString(),
  projection,
})

export const welcomeFrame = (runtime: PartyRuntime, viewer: Viewer): WelcomeFrame => ({
  type: 'welcome',
  protocolVersion: 1,
  partyId: runtime.partyId,
  playerId: viewer.playerId,
  instanceId: runtime.host.run.id,
  epoch: runtime.host.run.epoch,
  sequence: runtime.sequence(),
  tick: runtime.state().tick,
})

export const errorFrame = (
  runtime: PartyRuntime,
  commandId: string | null,
  code: ProtocolErrorCode,
  message: string,
): ErrorFrame => ({
  type: 'error',
  protocolVersion: 1,
  partyId: runtime.partyId,
  commandId,
  sequence: runtime.sequence(),
  tick: runtime.state().tick,
  error: { code, message, retryable: code === 'rate-limited' || code === 'sequence-conflict' },
})
