'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  History,
  Check,
  Loader2,
  Mic,
  Search,
  ShieldQuestion,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { copilotAction } from '../actions'
import { useSpeechInput } from '../hooks/use-speech-input'
import { CopilotResultCard } from './copilot-result-card'
import { MarkdownText } from './markdown-text'

export interface CopilotProposal {
  tool: string
  arguments: Record<string, unknown>
  label: string
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolRuns?: Array<{ name: string; result: { ok: boolean; summary: string; data?: unknown } }>
  /** Writes the Copilot wants to make, pending approval. */
  proposals?: CopilotProposal[]
  /** Set once the user has approved or declined, so the prompt does not linger. */
  resolved?: 'approved' | 'declined'
  error?: boolean
}

const SUGGESTIONS = [
  { icon: Sparkles, label: 'Break down a feature', prompt: 'Create tasks for the authentication module: Login API, Login UI, Password Reset API, Password Reset UI' },
  { icon: Search, label: 'Show blocked tickets', prompt: 'show blocked tickets' },
  { icon: Search, label: 'My critical tickets', prompt: 'show my critical tickets' },
  { icon: Bot, label: 'Project health', prompt: 'How is this project performing?' },
]

const STORAGE_KEY = 'taskforge.copilot.threads'
const MAX_THREADS = 15
const MAX_MESSAGES_PER_THREAD = 40

/** What the user currently has on screen, passed to the model as context. */
export interface CopilotScreen {
  /** Route segment: board, table, calendar, ticket, dashboard, … */
  view: string
  /** Set when a ticket detail page is open. */
  ticketKey?: string
  /** Human summary of active filters, e.g. "status=Blocked, overdue only". */
  filters?: string
}

export interface CopilotThread {
  id: string
  /** Derived from the first user message, so the history list is scannable. */
  title: string
  messages: CopilotMessage[]
  updatedAt: number
}

/**
 * Thread storage.
 *
 * Threads are kept per project in localStorage: it costs nothing, needs no
 * schema change, and a Copilot thread is personal working context rather than
 * shared project data. The trade-off is that it does not follow the user to
 * another browser or device.
 *
 * Every access is guarded — localStorage throws in private windows and returns
 * nothing when site data has been cleared.
 */
function storeKey(projectId?: string) {
  return `${STORAGE_KEY}.${projectId ?? 'global'}`
}

function loadThreads(projectId?: string): CopilotThread[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storeKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as CopilotThread[])
      .filter((t) => t && typeof t.id === 'string' && Array.isArray(t.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function saveThreads(projectId: string | undefined, threads: CopilotThread[]) {
  if (typeof window === 'undefined') return
  try {
    // Drop empty threads, cap the count, and trim each — tool payloads are
    // large and the quota is around 5MB.
    const trimmed = threads
      .filter((t) => t.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_THREADS)
      .map((t) => ({ ...t, messages: t.messages.slice(-MAX_MESSAGES_PER_THREAD) }))

    window.localStorage.setItem(storeKey(projectId), JSON.stringify(trimmed))
  } catch {
    // Quota exceeded or storage blocked — the panel still works in memory.
  }
}

function newThread(): CopilotThread {
  return {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'New chat',
    messages: [],
    updatedAt: Date.now(),
  }
}

function titleFor(messages: CopilotMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return 'New chat'
  const text = first.content.trim().replace(/\s+/g, ' ')
  return text.length > 38 ? `${text.slice(0, 38)}…` : text
}

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function CopilotPanel({
  open,
  onOpenChange,
  projectId,
  projectName,
  screen,
  enabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectName?: string
  screen?: CopilotScreen
  enabled: boolean
}) {
  const router = useRouter()
  const [threads, setThreads] = React.useState<CopilotThread[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [input, setInput] = React.useState('')
  const [restored, setRestored] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const panelRef = React.useRef<HTMLElement>(null)

  const active = threads.find((t) => t.id === activeId) ?? null
  // Memoised because the `?? []` fallback would otherwise be a new array on
  // every render, re-running the scroll-to-bottom effect continuously whenever
  // no thread is active.
  const messages = React.useMemo(() => active?.messages ?? [], [active])

  /** Applies a change to the active thread and keeps its title and order fresh. */
  const updateActive = React.useCallback(
    (next: (current: CopilotMessage[]) => CopilotMessage[]) => {
      setThreads((current) =>
        current.map((t) =>
          t.id === activeId
            ? { ...t, messages: next(t.messages), title: titleFor(next(t.messages)), updatedAt: Date.now() }
            : t,
        ),
      )
    },
    [activeId],
  )

  /**
   * Approving re-sends the original request with approve=true.
   *
   * Replaying rather than executing the stored arguments keeps a single code
   * path: the write still goes through the same guard, validation and audit it
   * would have on the first pass, so approval cannot smuggle in a call the
   * model never actually made.
   */
  function approveProposal(message: CopilotMessage) {
    const index = messages.findIndex((m) => m.id === message.id)
    const request = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user')
    if (!request) return

    updateActive((current) =>
      current.map((m) => (m.id === message.id ? { ...m, resolved: 'approved' } : m)),
    )
    send(request.content, true)
  }

  function declineProposal(message: CopilotMessage) {
    updateActive((current) =>
      current.map((m) => (m.id === message.id ? { ...m, resolved: 'declined' } : m)),
    )
  }

  function startNewChat() {
    const fresh = newThread()
    // Drop the current thread if it was never used, so "+" twice does not
    // litter the history with blanks.
    setThreads((current) => [fresh, ...current.filter((t) => t.messages.length > 0)])
    setActiveId(fresh.id)
    setHistoryOpen(false)
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  function deleteActive() {
    setThreads((current) => {
      const remaining = current.filter((t) => t.id !== activeId)
      if (remaining.length > 0) {
        setActiveId(remaining[0].id)
        return remaining
      }
      const fresh = newThread()
      setActiveId(fresh.id)
      return [fresh]
    })
    setHistoryOpen(false)
  }
  const [isPending, startTransition] = React.useTransition()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  // Dictation appends rather than replaces, so speaking after typing extends
  // the message instead of discarding it.
  const speech = useSpeechInput(
    React.useCallback((text: string) => {
      setInput((current) => (current ? `${current.trimEnd()} ${text}` : text))
      inputRef.current?.focus()
    }, []),
  )

  // Keep the newest message in view as the conversation grows.
  React.useEffect(() => {
    const viewport = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages, isPending])

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  // Restore this project's threads, or begin one.
  React.useEffect(() => {
    const stored = loadThreads(projectId)
    if (stored.length > 0) {
      setThreads(stored)
      setActiveId(stored[0].id)
    } else {
      const fresh = newThread()
      setThreads([fresh])
      setActiveId(fresh.id)
    }
    setRestored(true)
  }, [projectId])

  // Persist after every change, but never before the restore has run — that
  // would write an empty list over saved threads.
  React.useEffect(() => {
    if (!restored) return
    saveThreads(projectId, threads)
  }, [threads, projectId, restored])

  // Escape closes the panel; clicking the scrim does the same.
  React.useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (historyOpen) { setHistoryOpen(false); return }
      onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, historyOpen, onOpenChange])

  function send(text: string, approve = false) {
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

    updateActive((current) => [...current, userMessage])
    setInput('')

    startTransition(async () => {
      const result = await copilotAction({
        message: trimmed,
        projectId,
        screen,
        history,
        approve,
      })

      if (!result.success) {
        updateActive((current) => [
          ...current,
          { id: `e-${Date.now()}`, role: 'assistant', content: result.error, error: true },
        ])
        return
      }

      updateActive((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.data.reply,
          toolRuns: result.data.toolRuns,
          proposals: result.data.proposals?.length ? result.data.proposals : undefined,
        },
      ])

      // Anything the Copilot changed should appear in the view behind the panel.
      if (result.data.toolRuns.some((run) => run.result.ok)) router.refresh()
    })
  }

  return (
    <>
      {/*
        Scrim. Present at every breakpoint — the panel behaves as a modal, so
        clicking away from it should dismiss it on desktop too, not only on
        mobile. Kept lighter on large screens so the board stays readable
        behind it.
      */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] transition-opacity duration-200',
          'lg:bg-black/10 lg:backdrop-blur-0',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
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

          {/* New chat */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={startNewChat}
            disabled={messages.length === 0}
            title="New chat"
            aria-label="New chat"
          >
            <SquarePen className="size-3.5" />
          </Button>

          {/* History */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setHistoryOpen((v) => !v)}
              disabled={threads.filter((t) => t.messages.length > 0).length === 0}
              title="Previous chats"
              aria-label="Previous chats"
              aria-expanded={historyOpen}
            >
              <History className="size-3.5" />
            </Button>

            {historyOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setHistoryOpen(false)}
                  aria-hidden
                />
                <ul className="absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                  {threads
                    .filter((t) => t.messages.length > 0)
                    .map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId(thread.id)
                            setHistoryOpen(false)
                          }}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent',
                            thread.id === activeId && 'bg-accent',
                          )}
                        >
                          <span className="w-full truncate text-xs">{thread.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {thread.messages.length} messages · {relativeTime(thread.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>

          {/* Delete current */}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 hover:text-destructive"
              onClick={deleteActive}
              title="Delete this chat"
              aria-label="Delete this chat"
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
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onApprove={approveProposal}
                    onDecline={declineProposal}
                  />
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
                  value={speech.interim ? `${input}${input ? ' ' : ''}${speech.interim}` : input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={
                    speech.listening
                      ? 'Listening…'
                      : 'Create a ticket, find work, or ask how things are going…'
                  }
                  rows={2}
                  disabled={isPending}
                  className={cn(
                    'resize-none pr-20',
                    speech.listening && 'ring-2 ring-primary/40',
                  )}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      send(input)
                    }
                  }}
                />
                {speech.supported && (
                  <Button
                    size="icon"
                    variant={speech.listening ? 'default' : 'ghost'}
                    className="absolute right-11 bottom-2 size-7"
                    onClick={() => (speech.listening ? speech.stop() : speech.start())}
                    disabled={isPending || speech.busy}
                    aria-label={speech.listening ? 'Stop dictation' : 'Dictate a message'}
                    title={
                      speech.engine === 'native'
                        ? 'Dictate — browser speech recognition'
                        : 'Dictate — transcribed by Whisper'
                    }
                  >
                    {speech.busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : speech.listening ? (
                      <Square className="size-3 fill-current" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                  </Button>
                )}

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
              <p
                className={cn(
                  'mt-1.5 text-[10px]',
                  speech.error ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {speech.error
                  ? speech.error
                  : speech.listening
                    ? 'Listening — click the square to stop'
                    : speech.busy
                      ? 'Transcribing…'
                      : 'Enter to send · Shift+Enter for a new line'}
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function MessageBubble({
  message,
  onApprove,
  onDecline,
}: {
  message: CopilotMessage
  onApprove?: (message: CopilotMessage) => void
  onDecline?: (message: CopilotMessage) => void
}) {
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

      {message.proposals && message.proposals.length > 0 && !message.resolved && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <ShieldQuestion className="size-3.5 text-primary" />
            {message.proposals.length === 1
              ? 'Approve this change?'
              : `Approve ${message.proposals.length} changes?`}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {message.proposals.map((proposal, index) => (
              <li key={index} className="text-xs text-muted-foreground">
                • {proposal.label}
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" className="h-7" onClick={() => onApprove?.(message)}>
              <Check className="size-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => onDecline?.(message)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {message.resolved === 'declined' && (
        <p className="text-[11px] text-muted-foreground italic">Cancelled — nothing was changed.</p>
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
        <MarkdownText
          content={message.content}
          className={cn('min-w-0', message.error && 'text-destructive')}
        />
      </div>
    </div>
  )
}
