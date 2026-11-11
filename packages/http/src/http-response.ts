import type { HTTPErrorBody } from './http'

/** A JSON response that is never cached. */
export function json(status: number, body: object, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  })
}

/** The one error body every generated route returns. */
export function failure(
  status: number,
  code: string,
  message: string,
  extra: Omit<HTTPErrorBody, 'ok' | 'code' | 'message'> = {},
  headers?: HeadersInit,
): Response {
  const body: HTTPErrorBody = { ok: false, code, message, ...extra }
  return json(status, body, headers)
}

export function methodNotAllowed(allow: readonly string[]): Response {
  return failure(
    405,
    'METHOD_NOT_ALLOWED',
    `this route accepts ${allow.join(', ')}`,
    {},
    {
      allow: allow.join(', '),
    },
  )
}

export function isJsonMediaType(contentType: string | null): boolean {
  if (contentType === null) return false
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true
}

/**
 * Read a JSON-typed UTF-8 body of at most `maxBodyBytes`. Returns the raw text, or the error
 * response to send. Bytes are counted as they arrive, so an oversized upload is never buffered.
 */
export async function readText(request: Request, maxBodyBytes: number): Promise<string | Response> {
  if (!isJsonMediaType(request.headers.get('content-type'))) {
    return failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json')
  }
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBodyBytes) return tooLarge(maxBodyBytes)
  try {
    return (await boundedText(request.body, maxBodyBytes)) ?? tooLarge(maxBodyBytes)
  } catch {
    return failure(400, 'BODY_UNREADABLE', 'the request body could not be read')
  }
}

/** The body as text, or `undefined` (and the upload cancelled) once it passes `maxBodyBytes`. */
async function boundedText(
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
): Promise<string | undefined> {
  if (body === null) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength
      if (size > maxBodyBytes) {
        await reader.cancel().catch(() => {})
        return undefined
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

/** Read and parse a size-limited JSON body. */
export async function readJson(
  request: Request,
  maxBodyBytes: number,
): Promise<{ readonly value: unknown; readonly text: string } | Response> {
  const text = await readText(request, maxBodyBytes)
  if (text instanceof Response) return text
  try {
    return { value: JSON.parse(text) as unknown, text }
  } catch {
    return failure(400, 'INVALID_JSON', 'the request body is not valid JSON')
  }
}

function tooLarge(maxBodyBytes: number): Response {
  return failure(413, 'BODY_TOO_LARGE', `the request body exceeds ${maxBodyBytes} bytes`)
}

export function decodeSegment(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length === 0 ? undefined : decoded
  } catch {
    return undefined
  }
}

export function requirePositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
}

export function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${label} must not be empty`)
  return value
}
