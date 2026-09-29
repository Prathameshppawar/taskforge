'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Github } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { disconnectGithubAction } from '../user-actions'

/** Settings → GitHub: this person's own GitHub connection. */
export function GithubAccount({ connection, appReady }: { connection: { login: string } | null; appReady: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Github className="size-5" />
        </span>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{connection ? `Connected as ${connection.login}` : 'Not connected'}</p>
          <p className="text-muted-foreground">
            Connecting lets TaskForge create repositories for you — under your account or an organisation you belong to —
            which the workspace&rsquo;s GitHub App cannot do on its own. It acts as you, and only within what the app is
            allowed.
          </p>
        </div>
      </div>
      {!appReady ? (
        <p className="text-xs text-muted-foreground">The workspace&rsquo;s GitHub App has not been set up yet (Workspace → Integrations).</p>
      ) : connection ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await disconnectGithubAction()
              if (!result.success) toast.error(result.error)
              router.refresh()
            })
          }
        >
          Disconnect
        </Button>
      ) : (
        <Button size="sm" asChild>
          <a href="/api/github/user/authorize">
            <Github className="size-4" /> Connect GitHub
          </a>
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        GitHub requires the app to hold <strong>Administration: Read and write</strong> to create repositories, and to list
        this site&rsquo;s <code>/api/github/user/callback</code> as a callback URL — both in the app&rsquo;s settings on GitHub.
      </p>
    </section>
  )
}
