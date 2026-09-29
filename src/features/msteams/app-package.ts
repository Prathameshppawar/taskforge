import { deflateSync } from 'node:zlib'

/**
 * The Teams app package — manifest.json and its two icons, zipped — built on
 * request with this bot's app id, so installing TaskForge in Teams is
 * "download, then upload", with no manifest to hand-write. Written without a
 * zip or image library: the zip is stored (uncompressed) entries, and the
 * icons are drawn pixel by pixel into PNGs.
 */

export function teamsManifest(input: { appId: string; host: string; appName: string }) {
  return {
    $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.19/MicrosoftTeams.schema.json',
    manifestVersion: '1.19',
    version: '1.0.0',
    id: input.appId,
    developer: {
      name: input.appName,
      websiteUrl: `https://${input.host}`,
      privacyUrl: `https://${input.host}`,
      termsOfUseUrl: `https://${input.host}`,
    },
    name: { short: input.appName.slice(0, 30), full: `${input.appName} tickets` },
    description: {
      short: 'Turn a conversation into a well-formed ticket.',
      full: `Describe what you need in a chat or a project channel. ${input.appName} asks what is missing, keeps a draft everyone can shape, and files it as a ticket when you press Create — with your own permissions. Linked channels hear about new tickets.`,
    },
    icons: { color: 'color.png', outline: 'outline.png' },
    accentColor: '#2563EB',
    bots: [
      {
        botId: input.appId,
        scopes: ['personal', 'team', 'groupChat'],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ['personal', 'team', 'groupChat'],
            commands: [
              { title: 'help', description: 'What I can do' },
              { title: 'use', description: 'use CODE — file into a project from this chat' },
              { title: 'link', description: 'link CODE — tie this channel to a project' },
              { title: 'create', description: 'File the draft as a ticket' },
              { title: 'discard', description: 'Throw the draft away' },
            ],
          },
        ],
      },
    ],
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [input.host],
  }
}

export function appPackage(input: { appId: string; host: string; appName: string }): Buffer {
  return zip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(teamsManifest(input), null, 2)) },
    { name: 'color.png', data: colorIcon() },
    { name: 'outline.png', data: outlineIcon() },
  ])
}

// --- icons -------------------------------------------------------------------------

/** 192×192: a blue tile with a white check, the product's mark. */
function colorIcon(): Buffer {
  const size = 192
  return png(size, size, (x, y) => {
    const inTick = onTick(x / size, y / size, 0.07)
    return inTick ? [255, 255, 255, 255] : [37, 99, 235, 255]
  })
}

/** 32×32: the same check, white on transparent, as Teams requires. */
function outlineIcon(): Buffer {
  const size = 32
  return png(size, size, (x, y) => (onTick((x + 0.5) / size, (y + 0.5) / size, 0.09) ? [255, 255, 255, 255] : [0, 0, 0, 0]))
}

/** Whether a point (in unit coordinates) is on a check mark's two strokes. */
function onTick(u: number, v: number, width: number): boolean {
  const near = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(u - (ax + t * dx), v - (ay + t * dy)) <= width
  }
  return near(0.26, 0.52, 0.43, 0.69) || near(0.43, 0.69, 0.75, 0.33)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
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

// --- zip ---------------------------------------------------------------------------

export function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(0, 10) // time, date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, file.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + file.data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
