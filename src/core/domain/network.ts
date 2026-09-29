/**
 * Which addresses the server may be asked to fetch.
 *
 * An uptime monitor makes the server request a URL somebody typed. Without a
 * check, that is a way to make it read things only it can reach: the cloud
 * metadata service at 169.254.169.254, a database on localhost, anything on the
 * private network. So a monitor URL must be http(s) to a public host, and the
 * address it resolves to is checked again at fetch time — a public name can be
 * pointed at 127.0.0.1 after it was saved.
 */

export function isPrivateAddress(ip: string): boolean {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, '')

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)
  if (mapped) return isPrivateAddress(mapped[1])

  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    )
  }

  if (address.includes(':')) {
    return (
      address === '::' ||
      address === '::1' ||
      address.startsWith('fe8') ||
      address.startsWith('fe9') ||
      address.startsWith('fea') ||
      address.startsWith('feb') || // link-local fe80::/10
      address.startsWith('fc') ||
      address.startsWith('fd') || // unique local fc00::/7
      address.startsWith('ff') // multicast
    )
  }
  return true // not an address we recognise: refuse rather than guess
}

/** A URL a monitor may be pointed at, or why not. The DNS check happens at fetch time. */
export function checkMonitorUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'Enter a full URL, such as https://example.com/health.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'Only http and https addresses are allowed.' }
  if (url.username || url.password) return { ok: false, reason: 'Do not put credentials in the URL.' }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: 'Only public addresses are allowed.' }
  }
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) {
    if (isPrivateAddress(host)) return { ok: false, reason: 'Only public addresses are allowed.' }
  }
  return { ok: true, url }
}

/** Uptime over a set of checks, as a percentage to one decimal place. */
export function uptimePercent(checks: ReadonlyArray<{ ok: boolean }>): number | null {
  if (checks.length === 0) return null
  return Math.round((checks.filter((check) => check.ok).length / checks.length) * 1000) / 10
}

/** "4 minutes", "2 hours 5 minutes" — how long an outage lasted. */
export function describeDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`
}
