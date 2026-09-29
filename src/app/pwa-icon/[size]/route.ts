import { appIconPng } from '@/lib/png'

/**
 * The installable app's icons, drawn in code: 192 and 512 px, and a maskable
 * 512 whose mark sits inside the safe zone Android crops to.
 */
const SIZES: Record<string, { size: number; padding: number; rounded: boolean }> = {
  '192': { size: 192, padding: 0, rounded: true },
  '512': { size: 512, padding: 0, rounded: true },
  'maskable-512': { size: 512, padding: 0.1, rounded: false },
}

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const spec = SIZES[(await params).size]
  if (!spec) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(appIconPng(spec.size, { padding: spec.padding, rounded: spec.rounded })), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable' },
  })
}
