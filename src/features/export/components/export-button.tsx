'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Exports the view currently on screen.
 *
 * It forwards the page's own query string, so the file holds exactly the
 * filtered, sorted rows being looked at. Exporting "all tickets" is nearly
 * useless; exporting *this* is the entire point — and it costs almost nothing
 * to build, because the filters already live in the URL.
 */
export function ExportButton({
  projectId,
  projectName,
  total,
}: {
  projectId?: string
  projectName?: string
  total: number
}) {
  const searchParams = useSearchParams()

  const href = React.useCallback(
    (format: 'csv' | 'xlsx') => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('format', format)
      if (projectId) params.set('project', projectId)
      if (projectName) params.set('name', projectName)
      return `/api/export/tickets?${params.toString()}`
    },
    [searchParams, projectId, projectName],
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Download className="size-3.5" />
          <span className="text-xs">Export</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <a href={href('xlsx')} download>
            <FileSpreadsheet className="size-4" />
            <span>
              Excel
              <span className="block text-[11px] text-muted-foreground">
                Real dates and numbers
              </span>
            </span>
          </a>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <a href={href('csv')} download>
            <FileText className="size-4" />
            <span>
              CSV
              <span className="block text-[11px] text-muted-foreground">Opens anywhere</span>
            </span>
          </a>
        </DropdownMenuItem>

        <div className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? 'ticket' : 'tickets'} in this view
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
