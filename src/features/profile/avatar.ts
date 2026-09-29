/**
 * Profile photo rules, shared by the upload action and the route that serves
 * the bytes.
 *
 * The browser crops and resizes to a 256px square before uploading, so a real
 * photo arrives at a few tens of kilobytes. The cap is there for anything that
 * skips the browser.
 */

export const AVATAR_MAX_BYTES = 256 * 1024
export const AVATAR_PIXELS = 256

/**
 * The type is read from the bytes, never from the upload's claimed type, and
 * only raster formats are accepted. An SVG "photo" would be a script served
 * from our own origin.
 */
export function sniffImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}
