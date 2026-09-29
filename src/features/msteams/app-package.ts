import { appIconPng, crc32 } from '@/lib/png'

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
    accentColor: '#2A78D6',
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

function colorIcon(): Buffer {
  return appIconPng(192)
}

function outlineIcon(): Buffer {
  return appIconPng(32, { outline: true })
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
