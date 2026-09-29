import { deflateSync } from 'node:zlib'

/**
 * PNGs drawn in code, for icons that need no image library: the Teams app
 * package and the installable web app share one mark.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y)
      const offset = y * (width * 4 + 1) + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * The mark, as in the favicon (src/app/icon.tsx): three board columns of
 * falling height on the brand blue. Coordinates are the favicon's 32-unit grid,
 * so the two can never drift apart in shape. Returns the column's opacity, or
 * 0 outside every column.
 */
function onMark(u: number, v: number): number {
  const x = u * 32
  const y = v * 32
  const columns = [
    { left: 7.5, height: 16, alpha: 1 },
    { left: 13.5, height: 11, alpha: 0.85 },
    { left: 19.5, height: 14, alpha: 0.7 },
  ]
  for (const column of columns) {
    if (x < column.left || x > column.left + 5 || y < 8 || y > 8 + column.height) continue
    // Rounded ends, radius 1.5.
    const cx = Math.min(Math.max(x, column.left + 1.5), column.left + 3.5)
    const cy = Math.min(Math.max(y, 9.5), 8 + column.height - 1.5)
    if (Math.hypot(x - cx, y - cy) <= 1.5) return column.alpha
  }
  return 0
}

const BRAND: [number, number, number] = [42, 120, 214]

/**
 * The mark as a PNG: white columns on brand blue (or, for an outline icon,
 * white on transparent). `padding` shrinks it into a maskable icon's safe
 * zone; `rounded` gives the tile the favicon's corners.
 */
export function appIconPng(size: number, options: { outline?: boolean; padding?: number; rounded?: boolean } = {}): Buffer {
  const padding = options.padding ?? 0
  const scale = 1 - padding * 2
  const radius = options.rounded ? size * (7 / 32) : 0
  return png(size, size, (x, y) => {
    const u = ((x + 0.5) / size - padding) / scale
    const v = ((y + 0.5) / size - padding) / scale
    const alpha = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? onMark(u, v) : 0
    if (options.outline) return alpha ? [255, 255, 255, 255] : [0, 0, 0, 0]
    if (radius) {
      const cx = Math.min(Math.max(x + 0.5, radius), size - radius)
      const cy = Math.min(Math.max(y + 0.5, radius), size - radius)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) return [0, 0, 0, 0]
    }
    const mix = (channel: number) => Math.round(channel + (255 - channel) * alpha)
    return [mix(BRAND[0]), mix(BRAND[1]), mix(BRAND[2]), 255]
  })
}
