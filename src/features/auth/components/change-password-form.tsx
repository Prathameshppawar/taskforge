'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { changePasswordAction } from '../actions'
import { changePasswordSchema, type ChangePasswordInput } from '../schemas'

export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const router = useRouter()
  const { update } = useSession()
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  function onSubmit(values: ChangePasswordInput) {
    startTransition(async () => {
      const result = await changePasswordAction(values)

      if (!result.success) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof ChangePasswordInput, { message: messages[0] })
          }
        } else {
          toast.error(result.error)
        }
        return
      }

      form.reset()
      toast.success('Password updated.')

      // Clear the forced-change flag on the live token so middleware stops
      // redirecting, without making the user sign in again.
      await update({ mustChangePassword: false })
      router.replace('/dashboard')
      router.refresh()
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <Input {...field} type="password" autoComplete="current-password" disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input {...field} type="password" autoComplete="new-password" disabled={isPending} />
              </FormControl>
              <FormDescription>
                At least 8 characters, with an uppercase letter, a lowercase letter and a number.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input {...field} type="password" autoComplete="new-password" disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {forced ? 'Set new password' : 'Update password'}
        </Button>
      </form>
    </Form>
  )
}
