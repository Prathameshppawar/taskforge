import { ImageResponse } from 'next/og'

/** Home-screen icon. Same mark, scaled for 180px rather than upscaled from 32. */
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 26, height: 88, background: 'white', borderRadius: 8 }} />
          <div style={{ width: 26, height: 60, background: 'white', borderRadius: 8, opacity: 0.85 }} />
          <div style={{ width: 26, height: 76, background: 'white', borderRadius: 8, opacity: 0.7 }} />
        </div>
      </div>
    ),
    { ...size },
  )
}
