/**
 * Standard Webhooks signing and verification over Web Crypto (HMAC-SHA256), so every entry runs
 * on Node, Deno, Bun and Workers without a CommonJS dependency.
 */

/** The three Standard Webhooks headers. @public */
export interface WebhookSignatureHeaders {
  readonly 'webhook-id': string
  readonly 'webhook-timestamp': string
  readonly 'webhook-signature': string
}

/** Input of `signWebhook`. @public */
export interface SignWebhookInput {
  /** `whsec_<base64>` secret. Pass several during a rotation: the header carries one signature per secret. */
  readonly secret: string | readonly string[]
  /** Stable message id, reused by every retry of the same message. */
  readonly id: string
  /** The exact body bytes that will be sent. */
  readonly body: string
  /** Attempt time. Defaults to now. */
  readonly timestamp?: Date
}

/**
 * Sign a message as a Standard Webhooks sender: returns the headers to send with `body`.
 * @public
 */
export async function signWebhook(input: SignWebhookInput): Promise<WebhookSignatureHeaders> {
  const seconds = Math.floor((input.timestamp ?? new Date()).getTime() / 1000)
  const secrets = typeof input.secret === 'string' ? [input.secret] : input.secret
  if (secrets.length === 0) throw new TypeError('signWebhook requires at least one secret')
  const content = `${input.id}.${seconds}.${input.body}`
  const signatures = await Promise.all(
    secrets.map(async (secret) => `v1,${await hmac(secret, content)}`),
  )
  return {
    'webhook-id': input.id,
    'webhook-timestamp': String(seconds),
    'webhook-signature': signatures.join(' '),
  }
}

type VerifiedSignature =
  | { readonly ok: true; readonly id: string; readonly timestamp: Date }
  | { readonly ok: false }

/** Check the headers of `request` against any of `secrets`, within `toleranceSeconds` of `now`. */
export async function verifySignature(
  headers: Headers,
  body: string,
  secrets: readonly string[],
  toleranceSeconds: number,
  now: number,
): Promise<VerifiedSignature> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signature = headers.get('webhook-signature')
  if (id === null || timestamp === null || signature === null || !/^\d+$/.test(timestamp)) {
    return { ok: false }
  }
  const seconds = Number(timestamp)
  if (Math.abs(now / 1000 - seconds) > toleranceSeconds) return { ok: false }
  const presented = signature
    .split(' ')
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3))
  const content = `${id}.${seconds}.${body}`
  for (const secret of secrets) {
    const expected = await hmac(secret, content)
    if (presented.some((candidate) => constantTimeEqual(candidate, expected))) {
      return { ok: true, id, timestamp: new Date(seconds * 1000) }
    }
  }
  return { ok: false }
}

/** Throws a `TypeError` unless `secret` is a usable `whsec_` / base64 secret. */
export function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    throw new TypeError('webhook secret must be base64, optionally prefixed with whsec_')
  }
  if (binary.length === 0) throw new TypeError('webhook secret must not be empty')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function hmac(secret: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(content)),
  )
  let binary = ''
  for (const byte of signature) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
