'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  CircleCheck,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { copilotAction } from '../actions'
import { CopilotResultCard } from './copilot-result-card'

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolRuns?: Array<{ name: string; result: { ok: boolean; summary: string; data?: unknown } }>
  error?: boolean
}

const SUGGESTIONS = [
  { icon: Sparkles, label: 'Break down a feature', prompt: 'Create tasks for the authentication module: Login API, Login UI, Password Reset API, Password Reset UI' },
  { icon: Search, label: 'Show blocked tickets', prompt: 'show blocked tickets' },
  { icon: Search, label: 'My critical tickets', prompt: 'show my critical tickets' },
  { icon: Bot, label: 'Project health', prompt: 'How is this project performing?' },
]

/**
 * Right-side Copilot drawer.
 *
 * Conversation state is local to the panel — it is a task assistant, not a
 * durable chat log, so nothing is persisted and closing the drawer keeps the
 * thread only for the current page session.
 */
export function CopilotPanel({
  open,
  onOpenChange,
  projectId,
  projectName,
  enabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectName?: string
  enabled: boolean
}) {
  const router = useRouter()
  const [messages, setMessages] = React.useState<CopilotMessage[]>([])
  const [input, setInput] = React.useState('')
  const [isPending, startTransition] = React.useTransition()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  // Keep the newest message in view as the conversation grows.
  React.useEffect(() => {
    const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages, isPending])

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isPending) return

    const userMessage: CopilotMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }

    const history = messages
      .filter((message) => !message.error)
      .map((message) => ({ role: message.role, content: message.content }))

    setMessages((current) => [...current, userMessage])
    setInput('')

    startTransition(async () => {
      const result = await copilotAction({ message: trimmed, projectId, history })

      if (!result.success) {
        setMessages((current) => [
          ...current,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            content: result.error,
            error: true,
          },
        ])
        return
      }

      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.data.reply,
          toolRuns: result.data.toolRuns,
        },
      ])

      // Anything the Copilot changed should appear in the view behind the panel.
      if (result.data.toolRuns.some((run) => run.result.ok)) router.refresh()
    })
  }

  return (
    <>
      {/* Scrim */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-2xl',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-label="AI Copilot"
        aria-hidden={!open}
      >
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Copilot</h2>
            {projectName && (
              <p className="truncate text-[11px] text-muted-foreground">{projectName}</p>
            )}
          </div>

          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setMessages([])}
              aria-label="Clear conversation"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onOpenChange(false)}
            aria-label="Close Copilot"
          >
            <X className="size-4" />
          </Button>
        </header>

        {!enabled ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted">
              <Bot className="size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Copilot is not configured</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Set <code className="rounded bg-muted px-1">AI_PROVIDER</code> to{' '}
                <code className="rounded bg-muted px-1">groq</code> or{' '}
                <code className="rounded bg-muted px-1">ollama</code> in your environment, add
                the matching credentials, and restart.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                See <code className="rounded bg-muted px-1">.env.example</code> for details.
              </p>
            </div>
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-0 flex-1" ref={scrollRef}>
              <div className="space-y-4 p-4">
                {messages.length === 0 && (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="text-sm">
                        Ask me to create tickets, break a feature into tasks, find work, move
                        things along, or summarise how a project is going.
                      </p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        I act as you — I can only do what your role allows, and everything I do
                        is recorded in the activity log.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      {SUGGESTIONS.map((suggestion) => {
                        const Icon = suggestion.icon
                        return (
                          <button
                            key={suggestion.label}
                            type="button"
                            onClick={() => send(suggestion.prompt)}
                            className="flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-accent"
                          >
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{suggestion.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}

                {isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Working…
                  </div>
                )}
              </div>
            </ScrollArea>

            <Separator />

            <div className="shrink-0 p-3">
              <div className="relative">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Create a ticket, find work, or ask how things are going…"
                  rows={2}
                  disabled={isPending}
                  className="resize-none pr-11"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      send(input)
                    }
                  }}
                />
                <Button
                  size="icon"
                  className="absolute right-2 bottom-2 size-7"
                  onClick={() => send(input)}
                  disabled={isPending || !input.trim()}
                  aria-label="Send"
                >
                  {isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ArrowUp className="size-3.5" />
                  )}
                </Button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Enter to send · Shift+Enter for a new line
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function MessageBubble({ message }: { message: CopilotMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* What the Copilot actually did, before what it says about it. */}
      {message.toolRuns && message.toolRuns.length > 0 && (
        <div className="space-y-1.5">
          {message.toolRuns.map((run, index) => (
            <CopilotResultCard key={index} name={run.name} result={run.result} />
          ))}
        </div>
      )}

      <div
        className={cn(
          'flex gap-2',
          message.error && 'rounded-lg border border-destructive/30 bg-destructive/5 p-2.5',
        )}
      >
        {message.error ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        )}
        <p
          className={cn(
            'min-w-0 text-sm leading-relaxed whitespace-pre-wrap',
            message.error && 'text-destructive',
          )}
        >
          {message.content}
        </p>
      </div>
    </div>
  )
}
