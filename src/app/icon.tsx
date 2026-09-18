import { ImageResponse } from 'next/og'

/**
 * Favicon, generated rather than shipped as a binary.
 *
 * Keeps the mark in one place: it is the same rounded square and grid as the
 * sidebar logo, so the tab icon cannot drift away from the brand when one is
 * changed and the other forgotten.
 */
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2a78d6',
          borderRadius: 7,
        }}
      >
        {/* Three bars — a board, at 32px. */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          <div style={{ width: 5, height: 16, background: 'white', borderRadius: 1.5 }} />
          <div style={{ width: 5, height: 11, background: 'white', borderRadius: 1.5, opacity: 0.85 }} />
          <div style={{ width: 5, height: 14, background: 'white', borderRadius: 1.5, opacity: 0.7 }} />
        </div>
      </div>
    ),
    { ...size },
  )
}
