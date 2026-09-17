import { requireUser } from '@/features/auth/guards'
import { getSidebarProjects } from '@/features/projects/queries'
import { AppSidebar } from '@/components/shared/app-sidebar'
import { MobileNav } from '@/components/shared/mobile-nav'
import { UserMenu } from '@/components/shared/user-menu'
import { ThemeToggle } from '@/components/shared/theme-toggle'

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireUser()
  const projects = await getSidebarProjects(actor)

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r lg:block">
        <AppSidebar role={actor.role} projects={projects} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <MobileNav role={actor.role} projects={projects} />

          <div className="flex-1" />

          <ThemeToggle />
          <UserMenu
            name={actor.name}
            username={actor.username}
            role={actor.role}
            avatarColor={actor.avatarColor}
          />
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
