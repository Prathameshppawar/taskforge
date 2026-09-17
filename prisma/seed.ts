/* eslint-disable no-console */
import { PrismaClient, type RoleKey } from '@prisma/client'
import bcrypt from 'bcryptjs'

import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  DEFAULT_TICKET_TYPES,
} from '../src/core/domain/defaults'
import { TEMPLATE_SEEDS, type TemplateTicketSeed } from './seed-templates'

const prisma = new PrismaClient()

/**
 * Idempotent seed.
 *
 * Safe to run repeatedly: roles and templates are upserted, and the admin
 * account is only created if it does not already exist (an existing admin's
 * password is never overwritten). Demo data is opt-in via SEED_DEMO=true.
 */

const ROLES: Array<{ key: RoleKey; name: string; description: string }> = [
  {
    key: 'ADMIN',
    name: 'Admin',
    description:
      'Full platform control: user management, templates, every project and all configuration.',
  },
  {
    key: 'PROJECT_MANAGER',
    name: 'Project Manager',
    description:
      'Creates and runs projects, manages members, labels and workflow configuration.',
  },
  {
    key: 'USER',
    name: 'User',
    description:
      'Works on tickets in the projects they belong to, and comments on them.',
  },
]

async function seedRoles() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description },
      create: { key: role.key, name: role.name, description: role.description, isSystem: true },
    })
  }
  console.log(`  ✓ ${ROLES.length} roles`)
}

async function seedAdmin(): Promise<string> {
  const username = (process.env.ADMIN_USERNAME ?? 'admin').toLowerCase()
  const email = (process.env.ADMIN_EMAIL ?? 'admin@taskforge.local').toLowerCase()
  const name = process.env.ADMIN_NAME ?? 'Platform Admin'
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe!2024'
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12)

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } })

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) {
    console.log(`  ✓ admin "${username}" already exists — password left untouched`)
    return existing.id
  }

  const user = await prisma.user.create({
    data: {
      username,
      email,
      name,
      passwordHash: await bcrypt.hash(password, rounds),
      roleId: adminRole.id,
      avatarColor: 'indigo',
      jobTitle: 'Administrator',
      // Force a change on first sign-in unless an explicit password was supplied.
      mustChangePassword: !process.env.ADMIN_PASSWORD,
    },
  })

  console.log(`  ✓ admin created — username "${username}"`)
  return user.id
}

async function seedTemplates(adminId: string) {
  for (const seed of TEMPLATE_SEEDS) {
    // Replace any previous definition so edits to the seed file take effect.
    await prisma.projectTemplate.deleteMany({ where: { name: seed.name } })

    const template = await prisma.projectTemplate.create({
      data: {
        name: seed.name,
        description: seed.description,
        icon: seed.icon,
        color: seed.color,
        isDefault: seed.isDefault ?? false,
        createdById: adminId,
        statuses: {
          create: DEFAULT_STATUSES.map((s) => ({
            name: s.name,
            category: s.category,
            color: s.color,
            position: s.position,
            isInitial: s.isInitial ?? false,
          })),
        },
        priorities: {
          create: DEFAULT_PRIORITIES.map((p) => ({
            name: p.name,
            color: p.color,
            level: p.level,
            isDefault: p.isDefault ?? false,
          })),
        },
        types: {
          create: DEFAULT_TICKET_TYPES.map((t) => ({
            name: t.name,
            color: t.color,
            icon: t.icon,
            position: t.position,
            isDefault: t.isDefault ?? false,
          })),
        },
        labels: {
          create: seed.labels.map((l) => ({
            name: l.name,
            color: l.color,
            description: l.description ?? null,
          })),
        },
      },
    })

    await createTemplateTickets(template.id, seed.tickets, null)
  }

  console.log(`  ✓ ${TEMPLATE_SEEDS.length} project templates`)
}

async function createTemplateTickets(
  templateId: string,
  tickets: TemplateTicketSeed[],
  parentId: string | null,
) {
  let position = 0

  for (const ticket of tickets) {
    const created = await prisma.templateTicket.create({
      data: {
        templateId,
        parentId,
        title: ticket.title,
        description: ticket.description ?? null,
        typeName: ticket.typeName ?? null,
        priorityName: ticket.priorityName ?? null,
        position: position++,
        labelNames: ticket.labels?.length
          ? { create: ticket.labels.map((labelName) => ({ labelName })) }
          : undefined,
      },
    })

    if (ticket.children?.length) {
      await createTemplateTickets(templateId, ticket.children, created.id)
    }
  }
}

async function main() {
  console.log('\n🌱 Seeding TaskForge\n')

  console.log('Roles')
  await seedRoles()

  console.log('\nAdministrator')
  const adminId = await seedAdmin()

  console.log('\nProject templates')
  await seedTemplates(adminId)

  if (process.env.SEED_DEMO === 'true') {
    console.log('\nDemo workspace')
    const { seedDemo } = await import('./seed-demo')
    await seedDemo(prisma, adminId)
  }

  console.log('\n✅ Seed complete.\n')
  console.log('   Sign in with the ADMIN_USERNAME / ADMIN_PASSWORD from your .env')
  console.log('   Set SEED_DEMO=true to also create a demo project with tickets.\n')
}

main()
  .catch((error) => {
    console.error('\n❌ Seed failed:\n', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
