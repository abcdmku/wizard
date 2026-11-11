/** Options for the built-in outbound webhook endpoint check. @public */
export interface WebhookEndpointValidationOptions {
  /** HTTPS is required unless this development-only escape hatch is enabled. */
  readonly allowHTTP?: boolean
}

/**
 * Parse an outbound callback URL and reject obvious SSRF targets.
 *
 * This check blocks credentials, local names, and non-public IP literals. Deployments should add
 * DNS resolution through `endpointPolicy.validate` and pin the resolved address in their fetch
 * implementation when DNS rebinding is in scope.
 * @public
 */
export function validateWebhookEndpoint(
  endpoint: string,
  options: WebhookEndpointValidationOptions = {},
): URL {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new TypeError('webhook endpoint must be an absolute URL')
  }
  if (url.protocol !== 'https:' && !(options.allowHTTP === true && url.protocol === 'http:')) {
    throw new TypeError('webhook endpoint must use HTTPS')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError('webhook endpoint must not contain credentials')
  }
  if (url.hash.length > 0) throw new TypeError('webhook endpoint must not contain a fragment')
  const hostname = stripIPv6Brackets(url.hostname.toLowerCase()).replace(/\.+$/, '')
  if (hostname.length === 0) throw new TypeError('webhook endpoint must contain a hostname')
  if (blockedName(hostname) || blockedIPAddress(hostname)) {
    throw new TypeError('webhook endpoint must use a public network address')
  }
  return url
}

function blockedName(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true
  }
  return !hostname.includes('.') && !hostname.includes(':')
}

function blockedIPAddress(hostname: string): boolean {
  const ipv4 = parseIPv4(hostname)
  if (ipv4 !== undefined) return blockedIPv4(ipv4)
  if (!hostname.includes(':')) return false
  const normalized = hostname.toLowerCase()
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2001:10:') ||
    normalized.startsWith('2001:20:') ||
    normalized.startsWith('2002:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^(?:fe8|fe9|fea|feb)/.test(normalized)
  ) {
    return true
  }
  if (normalized.startsWith('::ffff:')) {
    const mapped = parseIPv4(normalized.slice('::ffff:'.length))
    return mapped === undefined || blockedIPv4(mapped)
  }
  // Only globally routable unicast IPv6 addresses are valid callback literals.
  const first = Number.parseInt(normalized.split(':', 1)[0] ?? '', 16)
  return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff
}

function parseIPv4(hostname: string): readonly [number, number, number, number] | undefined {
  const parts = hostname.split('.')
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => Number(part))
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return undefined
  return values as unknown as readonly [number, number, number, number]
}

function blockedIPv4([a, b, c]: readonly [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function stripIPv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}
