'use client'

import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** The browser's own print dialog, which also saves as PDF. */
export function PrintButton() {
  return (
    <Button size="sm" variant="outline" className="h-7" onClick={() => window.print()}>
      <Printer className="size-3.5" /> Print or save as PDF
    </Button>
  )
}
