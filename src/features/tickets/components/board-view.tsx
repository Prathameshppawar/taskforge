'use client'

import * as React from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

import { KanbanBoard, type BoardColumn } from './kanban-board'
import { CreateTicketDialog, type TicketFormConfig } from './create-ticket-dialog'

/**
 * Client shell for the board: owns the create-dialog state so a column's "+"
 * button can open it pre-set to that column's status.
 */
export function BoardView({
  columns,
  config,
  canEdit,
}: {
  columns: BoardColumn[]
  config: TicketFormConfig
  canEdit: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [statusId, setStatusId] = React.useState<string | undefined>(undefined)

  /*
   * The command palette cannot open a dialog that lives on another page, so it
   * navigates here with ?new=1 instead. Consume the flag and strip it, so a
   * refresh or a back-navigation does not reopen the dialog.
   */
  React.useEffect(() => {
    if (searchParams.get('new') !== '1') return

    setStatusId(undefined)
    setDialogOpen(true)

    const next = new URLSearchParams(searchParams.toString())
    next.delete('new')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [searchParams, pathname, router])

  return (
    <>
      <KanbanBoard
        columns={columns}
        canEdit={canEdit}
        onCreateTicket={(id) => {
          setStatusId(id)
          setDialogOpen(true)
        }}
      />

      <CreateTicketDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        config={config}
        defaultStatusId={statusId}
      />
    </>
  )
}
