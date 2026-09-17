import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="size-6 text-muted-foreground" />
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This ticket or project does not exist, or it may have been deleted.
        </p>

        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/projects">Browse projects</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
