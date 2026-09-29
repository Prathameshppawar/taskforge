import { redirect } from 'next/navigation'

import { prisma } from '@/infrastructure/db/prisma'
import { landingView } from '@/features/projects/views'

/**
 * Opening a project lands on the view it has chosen in its settings, Insights
 * unless changed. Access is checked by the project layout around this page
 * and again by the view itself, so this only picks the destination.
 */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const settings = await prisma.projectSettings.findUnique({
    where: { projectId },
    select: { defaultView: true },
  })
  redirect(`/projects/${projectId}/${landingView(settings?.defaultView)}`)
}
