'use client'

import * as React from 'react'
import { Menu } from 'lucide-react'
import type { Permission } from '@/core/domain/rbac'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AppSidebar, type SidebarProject } from './app-sidebar'

export function MobileNav({
  permissions,
  projects,
}: {
  permissions: Permission[]
  projects: SidebarProject[]
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 lg:hidden" aria-label="Open navigation">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <AppSidebar permissions={permissions} projects={projects} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
