import { prisma } from '@/infrastructure/db/prisma'
import { getInboundSetting, isInboundConfigured, mailboxAddress } from './service'

export async function getInboundOverview() {
  const [setting, recent] = await Promise.all([
    getInboundSetting(),
    prisma.inboundEmail.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        fromAddress: true,
        subject: true,
        outcome: true,
        reason: true,
        createdAt: true,
        ticket: { select: { key: true } },
      },
    }),
  ])
  return { configured: isInboundConfigured(), mailbox: mailboxAddress(), setting, recent }
}

export type InboundOverview = Awaited<ReturnType<typeof getInboundOverview>>
