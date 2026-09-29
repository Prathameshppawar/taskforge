'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/shared/user-avatar'
import { usePerson } from '@/components/shared/people-directory'
import { removeAvatarAction, uploadAvatarAction } from '../actions'
import { AVATAR_PIXELS } from '../avatar'

/**
 * Choose, replace or remove your profile photo.
 *
 * The image is centre-cropped to a square and scaled to 256px in the browser
 * before it is sent, so a 12-megapixel phone photo uploads as a few tens of
 * kilobytes and every avatar on the page loads the same small file.
 */
export function AvatarEditor({
  userId,
  name,
  avatarColor,
  roleName,
}: {
  userId: string
  name: string
  avatarColor: string
  roleName: string
}) {
  const router = useRouter()
  const person = usePerson(userId)
  const input = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState<'upload' | 'remove' | null>(null)

  async function choose(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file.')
      return
    }
    setBusy('upload')
    try {
      const square = await toSquare(file)
      const form = new FormData()
      form.set('file', square, 'avatar')
      const result = await uploadAvatarAction(form)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Profile photo updated.')
      router.refresh()
    } catch {
      toast.error('That image could not be read. Try a PNG or JPEG.')
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ''
    }
  }

  async function remove() {
    setBusy('remove')
    const result = await removeAvatarAction()
    setBusy(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success('Profile photo removed.')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <UserAvatar userId={userId} name={name} color={avatarColor} size="xl" />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => input.current?.click()}
            disabled={busy !== null}
          >
            {busy === 'upload' ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {person?.photo ? 'Change photo' : 'Upload photo'}
          </Button>
          {person?.photo ? (
            <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={busy !== null}>
              {busy === 'remove' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          PNG, JPEG or WebP, cropped to a square.
          {person?.ring ? ` The rim shows your role, ${roleName}.` : ''}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => choose(event.target.files?.[0])}
      />
    </div>
  )
}

/** Centre-crops to a square and scales to AVATAR_PIXELS, as WebP (JPEG where WebP encoding is missing). */
async function toSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_PIXELS
  canvas.height = AVATAR_PIXELS
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_PIXELS,
    AVATAR_PIXELS,
  )
  bitmap.close()

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
  const webp = await encode('image/webp')
  // Safari ignores an unsupported type and hands back a PNG instead.
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await encode('image/jpeg')
  if (!jpeg) throw new Error('Could not encode')
  return jpeg
}
