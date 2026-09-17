import type { Metadata } from 'next'
import Link from 'next/link'
import { FolderKanban, Plus } from 'lucide-react'

import { requireUser } from '@/features/auth/guards'
import { listProjects } from '@/features/projects/queries'
import { ProjectCard } from '@/features/projects/components/project-card'
import { PageHeader, EmptyState } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { roleHas } from '@/core/domain/rbac'

export const metadata: Metadata = { title: 'Projects' }

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>
}) {
  const actor = await requireUser()
  const { q, archived } = await searchParams

  const projects = await listProjects(actor, {
    search: q,
    includeArchived: archived === '1',
  })

  const canCreate = roleHas(actor.role, 'project:create')
  const active = projects.filter((p) => !p.isArchived)
  const archivedProjects = projects.filter((p) => p.isArchived)

  return (
    <div>
      <PageHeader
        title="Projects"
        description={`${active.length} active${
          archivedProjects.length ? ` · ${archivedProjects.length} archived` : ''
        }`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={archived === '1' ? '/projects' : '/projects?archived=1'}>
                {archived === '1' ? 'Hide archived' : 'Show archived'}
              </Link>
            </Button>
            {canCreate && (
              <Button asChild size="sm">
                <Link href="/projects/new">
                  <Plus className="size-4" />
                  New project
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="p-4 sm:p-6">
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description={
              canCreate
                ? 'Create your first project from a template to get a full workflow, labels and a starting ticket breakdown.'
                : 'You are not a member of any project yet. Ask an administrator to add you.'
            }
            action={
              canCreate && (
                <Button asChild>
                  <Link href="/projects/new">
                    <Plus className="size-4" />
                    New project
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
