'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn, slugifyCode } from '@/lib/utils'
import { colorClasses } from '@/core/domain/defaults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { DatePicker } from '@/components/shared/date-picker'
import { UserPicker, MultiUserPicker, type PickableUser } from '@/components/shared/user-picker'
import { ColorPicker } from '@/components/shared/color-picker'
import { createProjectAction } from '../actions'
import { createProjectSchema, type CreateProjectInput } from '../schemas'

export interface TemplateOption {
  id: string
  name: string
  description: string | null
  color: string
  isDefault: boolean
  statusCount: number
  labelCount: number
  ticketCount: number
}

export function CreateProjectForm({
  templates,
  users,
  currentUserId,
}: {
  templates: TemplateOption[]
  users: PickableUser[]
  currentUserId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  // Once the user edits the code by hand, stop deriving it from the name.
  const [codeTouched, setCodeTouched] = React.useState(false)

  const defaultTemplate = templates.find((t) => t.isDefault) ?? templates[0]

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      code: '',
      description: '',
      status: 'PLANNING',
      startDate: null,
      endDate: null,
      ownerId: currentUserId,
      templateId: defaultTemplate?.id ?? '',
      includeTemplateTickets: true,
      color: 'indigo',
      memberIds: [],
    },
  })

  const selectedTemplateId = form.watch('templateId')
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId)

  function onSubmit(values: CreateProjectInput) {
    startTransition(async () => {
      const result = await createProjectAction(values)

      if (!result.success) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof CreateProjectInput, { message: messages[0] })
          }
        }
        toast.error(result.error)
        return
      }

      toast.success(`Project ${result.data.code} created.`)
      router.push(`/projects/${result.data.id}`)
      router.refresh()
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* --- basics --------------------------------------------------------- */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Project details</h2>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Atlas Customer Portal"
                      disabled={isPending}
                      onChange={(event) => {
                        field.onChange(event)
                        if (!codeTouched) {
                          form.setValue('code', slugifyCode(event.target.value).slice(0, 6), {
                            shouldValidate: false,
                          })
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem className="sm:w-36">
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ATLAS"
                      disabled={isPending}
                      className="font-mono uppercase"
                      onChange={(event) => {
                        setCodeTouched(true)
                        field.onChange(event.target.value.toUpperCase())
                      }}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px]">
                    Ticket prefix
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

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
                    rows={3}
                    placeholder="What is this project for?"
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
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="PLANNING">Planning</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="ON_HOLD">On hold</SelectItem>
                      <SelectItem value="COMPLETED">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start date</FormLabel>
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

            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target end date</FormLabel>
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
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Colour</FormLabel>
                <FormControl>
                  <ColorPicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* --- template ------------------------------------------------------- */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Create from template</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The template supplies this project&apos;s statuses, priorities, ticket types and
              labels. You can change all of them afterwards.
            </p>
          </div>

          <FormField
            control={form.control}
            name="templateId"
            render={({ field }) => (
              <FormItem>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {templates.map((template) => {
                    const active = field.value === template.id
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => field.onChange(template.id)}
                        className={cn(
                          'relative flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all',
                          active
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'hover:border-foreground/20 hover:bg-accent/40',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'size-2.5 rounded-full',
                              colorClasses(template.color).dot,
                            )}
                            aria-hidden
                          />
                          <span className="text-sm font-medium">{template.name}</span>
                          {active && <Check className="ml-auto size-4 text-primary" />}
                        </span>
                        {template.description && (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {template.description}
                          </span>
                        )}
                        <span className="mt-1 text-[11px] text-muted-foreground">
                          {template.statusCount} statuses · {template.labelCount} labels ·{' '}
                          {template.ticketCount} starter tickets
                        </span>
                      </button>
                    )
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedTemplate && selectedTemplate.ticketCount > 0 && (
            <FormField
              control={form.control}
              name="includeTemplateTickets"
              render={({ field }) => (
                <FormItem className="flex items-start gap-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="cursor-pointer">
                      Also create the {selectedTemplate.ticketCount} starter tickets
                    </FormLabel>
                    <FormDescription className="text-xs">
                      Creates the template&apos;s parent features with their child tasks already
                      broken down.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          )}
        </section>

        {/* --- people --------------------------------------------------------- */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">People</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="ownerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner</FormLabel>
                  <FormControl>
                    <UserPicker
                      users={users}
                      value={field.value}
                      onChange={(id) => field.onChange(id ?? currentUserId)}
                      allowUnassigned={false}
                      placeholder="Choose an owner"
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px]">
                    The owner is always a project manager.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="memberIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Members</FormLabel>
                  <FormControl>
                    <MultiUserPicker
                      users={users}
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
        </section>

        <div className="flex items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Create project
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  )
}
