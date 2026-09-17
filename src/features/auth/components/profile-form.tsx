'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { updateProfileAction } from '../actions'
import { updateProfileSchema, type UpdateProfileInput } from '../schemas'

export function ProfileForm({
  defaultValues,
}: {
  defaultValues: UpdateProfileInput
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues,
  })

  function onSubmit(values: UpdateProfileInput) {
    startTransition(async () => {
      const result = await updateProfileAction(values)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Profile updated.')
      router.refresh()
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input {...field} disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="jobTitle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job title</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} placeholder="Backend Engineer" disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Save changes
        </Button>
      </form>
    </Form>
  )
}
