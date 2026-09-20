import { requireUser } from "@/features/auth/guards";
import { isAiEnabled } from "@/lib/env";
import { getSidebarProjects } from "@/features/projects/queries";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { MobileNav } from "@/components/shared/mobile-nav";
import { UserMenu } from "@/components/shared/user-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  AppShellClient,
  ShellActions,
} from "@/components/shared/app-shell-client";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import {
  getNotificationPreferences,
  getUnreadCount,
} from "@/features/notifications/queries";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireUser();
  const [projects, unread, preferences] = await Promise.all([
    getSidebarProjects(actor),
    getUnreadCount(actor),
    getNotificationPreferences(actor),
  ]);
  const aiEnabled = isAiEnabled();

  return (
    <AppShellClient permissions={actor.permissions} aiEnabled={aiEnabled}>
      <div className="flex h-dvh overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r lg:block">
          <AppSidebar projects={projects} permissions={actor.permissions} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
            <MobileNav projects={projects} permissions={actor.permissions} />

            <div className="flex-1" />

            <ShellActions aiEnabled={aiEnabled} />
            <NotificationBell
              initialUnread={unread}
              soundEnabled={preferences.sound}
            />
            <ThemeToggle />
            <UserMenu
              name={actor.name}
              username={actor.username}
              roleName={actor.roleName}
              avatarColor={actor.avatarColor}
            />
          </header>

          {/*
            `relative` is load-bearing. Tailwind's `sr-only` is `position:
            absolute`, so a screen-reader label with no positioned ancestor
            resolves against the <body> and escapes every `overflow:hidden`
            above it — inflating the document and scrolling the whole page
            instead of just this pane. Positioning the scroll container makes
            it the containing block, so strays are clipped here.
          */}
          <main className="relative min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </AppShellClient>
  );
}
