'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Loader2,
  History,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DatePicker } from '@/components/shared/date-picker'
import { UserPicker, type PickableUser } from '@/components/shared/user-picker'
import {
  ConfigSelect,
  LabelMultiSelect,
  PrioritySelect,
  type ConfigOption,
  type PriorityOption,
} from './ticket-form-fields'
import {
  createTicketAction,
  suggestSimilarTicketsAction,
  suggestTriageAction,
} from '../actions'
import type { TriageSuggestion } from '../triage'
import { createTicketSchema, type CreateTicketInput } from '../schemas'

export interface TicketFormConfig {
  projectId: string
  statuses: ConfigOption[]
  priorities: PriorityOption[]
  types: ConfigOption[]
  labels: ConfigOption[]
  members: PickableUser[]
  parents: Array<{ id: string; key: string; title: string }>
}

interface SimilarTicket {
  id: string
  key: string
  title: string
  statusName: string
  score: number
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  config,
  defaultStatusId,
  defaultParentId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: TicketFormConfig
  defaultStatusId?: string
  defaultParentId?: string
  onCreated?: (ticket: { id: string; key: string }) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [similar, setSimilar] = React.useState<SimilarTicket[]>([])
  const [triage, setTriage] = React.useState<TriageSuggestion | null>(null)
  // Cleared once applied or dismissed, so it does not nag after a decision.
  const [triageDismissed, setTriageDismissed] = React.useState(false)

  const initialStatus = defaultStatusId ?? config.statuses[0]?.id
  const initialPriority =
    config.priorities.find((p) => p.name === 'Medium')?.id ?? config.priorities[0]?.id
  const initialType = config.types[0]?.id

  const form = useForm<CreateTicketInput>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      projectId: config.projectId,
      title: '',
      description: '',
      remarks: '',
      statusId: initialStatus,
      priorityId: initialPriority,
      typeId: initialType,
      assigneeId: null,
      parentId: defaultParentId ?? null,
      labelIds: [],
      dueDate: null,
      startDate: null,
      resources: [],
    },
  })

  // Reset whenever the dialog is reopened, so a previous draft never leaks in.
  React.useEffect(() => {
    if (open) {
      form.reset({
        projectId: config.projectId,
        title: '',
        description: '',
        remarks: '',
        statusId: defaultStatusId ?? config.statuses[0]?.id,
        priorityId: initialPriority,
        typeId: initialType,
        assigneeId: null,
        parentId: defaultParentId ?? null,
        labelIds: [],
        dueDate: null,
        startDate: null,
        resources: [],
      })
      setSimilar([])
      setTriage(null)
      setTriageDismissed(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStatusId, defaultParentId, config.projectId])

  const title = form.watch('title')

  // Debounced duplicate detection — runs while typing, never blocks submission.
  React.useEffect(() => {
    if (!open || title.trim().length < 5) {
      setSimilar([])
      setTriage(null)
      return
    }

    const timer = setTimeout(async () => {
      // Both read the same embeddings, so they are fetched together rather than
      // making the user's typing trigger two staggered round trips.
      const [duplicates, suggestion] = await Promise.all([
        suggestSimilarTicketsAction(config.projectId, title),
        suggestTriageAction(config.projectId, title),
      ])
      if (duplicates.success) setSimilar(duplicates.data)
      if (suggestion.success) setTriage(suggestion.data)
    }, 450)

    return () => clearTimeout(timer)
  }, [title, open, config.projectId])

  function onSubmit(values: CreateTicketInput) {
    startTransition(async () => {
      const result = await createTicketAction(values)

      if (!result.success) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof CreateTicketInput, { message: messages[0] })
          }
        }
        toast.error(result.error)
        return
      }

      toast.success(`${result.data.key} created.`)
      onOpenChange(false)
      onCreated?.(result.data)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>New ticket</DialogTitle>
          <DialogDescription>
            Ticket numbers are assigned automatically from the project code.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-col">
            <ScrollArea className="max-h-[62dvh] flex-1">
              <div className="space-y-4 px-6 py-5">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Login page returns 500 after password reset"
                          autoFocus
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Duplicate detection */}
                {triage && !triageDismissed && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <History className="size-3.5 text-muted-foreground" />
                      Suggested from {triage.basedOn} similar tickets
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {triage.typeName && (
                        <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">
                          {triage.typeName}
                        </span>
                      )}
                      {triage.priorityName && (
                        <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">
                          {triage.priorityName}
                        </span>
                      )}
                      {triage.labelNames.map((name: string) => (
                        <span key={name} className="rounded bg-background px-1.5 py-0.5 text-[11px]">
                          {name}
                        </span>
                      ))}
                    </div>

                    {/* The evidence, because a suggestion you cannot question
                        is one people either accept blindly or ignore. */}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {triage.evidence.join(' · ')}
                    </p>

                    <div className="mt-2 flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (triage.typeId) form.setValue('typeId', triage.typeId)
                          if (triage.priorityId) form.setValue('priorityId', triage.priorityId)
                          if (triage.labelIds.length) form.setValue('labelIds', triage.labelIds)
                          setTriageDismissed(true)
                        }}
                      >
                        Apply
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setTriageDismissed(true)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}

                {similar.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5" />
                      {similar.length} similar {similar.length === 1 ? 'ticket' : 'tickets'} already
                      exist
                    </p>
                    <ul className="mt-2 space-y-1">
                      {similar.map((match) => (
                        <li key={match.id} className="text-xs">
                          <Link
                            href={`/tickets/${match.key}`}
                            target="_blank"
                            className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
                          >
                            <span className="font-mono">{match.key}</span> — {match.title}
                            <span className="ml-1.5 opacity-70">({match.statusName})</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value ?? ''}
                          rows={4}
                          placeholder="What needs to happen, and how will we know it is done?"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="typeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <FormControl>
                          <ConfigSelect
                            options={config.types}
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Type"
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="statusId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <FormControl>
                          <ConfigSelect
                            options={config.statuses}
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Status"
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priorityId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <FormControl>
                          <PrioritySelect
                            options={config.priorities}
                            value={field.value}
                            onChange={field.onChange}
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="assigneeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assignee</FormLabel>
                        <FormControl>
                          <UserPicker
                            users={config.members}
                            value={field.value ?? null}
                            onChange={field.onChange}
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Due date</FormLabel>
                        <FormControl>
                          <DatePicker
                            value={field.value}
                            onChange={field.onChange}
                            disabled={isPending}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="labelIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Labels</FormLabel>
                      <FormControl>
                        <LabelMultiSelect
                          options={config.labels}
                          value={field.value}
                          onChange={field.onChange}
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent ticket</FormLabel>
                      <FormControl>
                        <ConfigSelect
                          options={[
                            { id: '', name: 'No parent', color: 'slate' },
                            ...config.parents.map((parent) => ({
                              id: parent.id,
                              name: `${parent.key} — ${parent.title}`,
                              color: 'indigo',
                            })),
                          ]}
                          value={field.value ?? ''}
                          onChange={(id) => field.onChange(id || null)}
                          placeholder="No parent"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </ScrollArea>

            <DialogFooter className="border-t px-6 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Create ticket
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
