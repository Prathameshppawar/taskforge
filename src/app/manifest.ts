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
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
