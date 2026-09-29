import type { MetadataRoute } from 'next'

import { APP_NAME } from '@/lib/env'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — Project & Ticket Management`,
    short_name: APP_NAME,
    description: 'AI-first internal project and ticket management platform.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0b0b0e',
    theme_color: '#2a78d6',
    // Installable on phones and desktops: 192 and 512 are what browsers ask
    // for, and the maskable one keeps the mark inside Android's crop.
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/maskable-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My tickets', url: '/my-tickets' },
      { name: 'Inbox', url: '/inbox' },
      { name: 'Timesheet', url: '/time' },
    ],
  }
}
