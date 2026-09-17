'use client'

import * as React from 'react'

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
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [statusId, setStatusId] = React.useState<string | undefined>(undefined)

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
