import type { ProposalStatus } from '@prisma/client'

import { Badge } from '@/components/ui/badge'

const LABEL: Record<ProposalStatus, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
}

/** The status of a change proposal, as a badge. */
export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  if (status === 'PENDING') {
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
        {LABEL[status]}
      </Badge>
    )
  }
  if (status === 'APPROVED') {
    return (
      <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400">
        {LABEL[status]}
      </Badge>
    )
  }
  return <Badge variant="secondary">{LABEL[status]}</Badge>
}
