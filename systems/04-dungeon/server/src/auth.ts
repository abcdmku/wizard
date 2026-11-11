import { createHmac, timingSafeEqual } from 'node:crypto'
import { type Viewer, ViewerSchema } from '@wizard/dungeon-shared'
import { z } from 'zod'

const TokenHeaderSchema = z.object({ alg: z.literal('HS256'), typ: z.literal('JWT') }).strict()

const TokenClaimsSchema = z
  .object({
    sub: z.string().trim().min(1).max(64),
    partyId: z.string().trim().min(1).max(64).optional(),
    dungeonId: z.string().trim().min(1).max(64).optional(),
    sid: z.string().trim().min(1).max(64).optional(),
    iat: z.number().int().nonnegative().optional(),
    exp: z.number().int().positive(),
  })
  .strict()
  .superRefine((claims, context) => {
    if (claims.partyId === undefined && claims.dungeonId === undefined) {
      context.addIssue({ code: 'custom', message: 'partyId or dungeonId is required' })
    }
    if (
      claims.partyId !== undefined &&
      claims.dungeonId !== undefined &&
      claims.partyId !== claims.dungeonId
    ) {
      context.addIssue({ code: 'custom', message: 'partyId and dungeonId must match' })
    }
  })

export interface AuthenticatedViewer {
  readonly partyId: string
  readonly viewer: Viewer
}

export interface TokenInput {
  readonly partyId: string
  readonly playerId: string
  readonly sessionId?: string
  readonly expiresAtSeconds?: number
}

export type TokenVerification =
  | { readonly ok: true; readonly value: AuthenticatedViewer }
  | { readonly ok: false; readonly message: string }

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const signature = (secret: string, unsigned: string): Buffer =>
  createHmac('sha256', secret).update(unsigned).digest()

const parseJson = (encoded: string): unknown => {
  const text = Buffer.from(encoded, 'base64url').toString('utf8')
  return JSON.parse(text)
}

export const signPlayerToken = (secret: string, input: TokenInput): string => {
  const issuedAtSeconds = Math.floor(Date.now() / 1_000)
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({
    sub: input.playerId,
    partyId: input.partyId,
    sid: input.sessionId ?? `session:${input.playerId}`,
    iat: issuedAtSeconds,
    exp: input.expiresAtSeconds ?? issuedAtSeconds + 3_600,
  })
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${signature(secret, unsigned).toString('base64url')}`
}

export const verifyPlayerToken = (
  secret: string,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): TokenVerification => {
  const parts = token.split('.')
  const headerPart = parts[0]
  const payloadPart = parts[1]
  const signaturePart = parts[2]
  if (
    parts.length !== 3 ||
    headerPart === undefined ||
    payloadPart === undefined ||
    signaturePart === undefined
  ) {
    return { ok: false, message: 'invalid token shape' }
  }
  const unsigned = `${headerPart}.${payloadPart}`
  const expected = signature(secret, unsigned)
  let actual: Buffer
  try {
    actual = Buffer.from(signaturePart, 'base64url')
  } catch {
    return { ok: false, message: 'invalid token signature' }
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, message: 'invalid token signature' }
  }
  try {
    const header = TokenHeaderSchema.safeParse(parseJson(headerPart))
    const claims = TokenClaimsSchema.safeParse(parseJson(payloadPart))
    if (!header.success || !claims.success) return { ok: false, message: 'invalid token claims' }
    if (claims.data.exp <= nowSeconds) return { ok: false, message: 'token expired' }
    const partyId = claims.data.partyId ?? claims.data.dungeonId
    if (partyId === undefined) return { ok: false, message: 'missing party id' }
    const viewer = ViewerSchema.parse({
      tenantId: partyId,
      partyId,
      playerId: claims.data.sub,
      sessionId: claims.data.sid ?? `session:${claims.data.sub}`,
    })
    return { ok: true, value: { partyId, viewer } }
  } catch {
    return { ok: false, message: 'invalid token encoding' }
  }
}
