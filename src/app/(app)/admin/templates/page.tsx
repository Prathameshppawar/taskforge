import type { Metadata } from 'next'
import Link from 'next/link'
import { LayoutTemplate, Plus } from 'lucide-react'

import { prisma } from '@/infrastructure/db/prisma'
import { requirePermissionPage } from '@/features/auth/guards'
import { PageHeader, EmptyState } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { colorClasses } from '@/core/domain/defaults'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Templates' }

export default async function AdminTemplatesPage() {
  await requirePermissionPage('template:manage')

  const templates = await prisma.projectTemplate.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      isActive: true,
      isDefault: true,
      _count: {
        select: { statuses: true, priorities: true, types: true, labels: true, tickets: true, projects: true },
      },
    },
  })

  return (
    <div>
      <PageHeader
        title="Project templates"
        description="Templates define what a new project inherits: its workflow, labels and starting ticket breakdown."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/projects/new">
              <Plus className="size-4" />
              Use a template
            </Link>
          </Button>
        }
      />

      <div className="p-4 sm:p-6">
        {templates.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates"
            description="Run `npm run db:seed` to install the built-in templates."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <article key={template.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn('mt-0.5 size-3 shrink-0 rounded-sm', colorClasses(template.color).dot)}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-sm font-semibold">{template.name}</h3>
                      {template.isDefault && <Badge variant="secondary">Default</Badge>}
                      {!template.isActive && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    {template.description && (
                      <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    )}
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <Row label="Statuses" value={template._count.statuses} />
                  <Row label="Priorities" value={template._count.priorities} />
                  <Row label="Ticket types" value={template._count.types} />
                  <Row label="Labels" value={template._count.labels} />
                  <Row label="Starter tickets" value={template._count.tickets} />
                  <Row label="Projects using it" value={template._count.projects} />
                </dl>
              </article>
            ))}
          </div>
        )}

        <p className="mt-6 max-w-2xl text-xs text-muted-foreground">
          Templates are seeded from <code className="rounded bg-muted px-1">prisma/seed-templates.ts</code>.
          Edit that file and re-run <code className="rounded bg-muted px-1">npm run db:seed</code> to
          change what new projects inherit — existing projects keep the configuration they were
          created with, and can be edited from each project&apos;s Settings tab.
        </p>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
