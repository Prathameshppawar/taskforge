import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Sealing for credentials that have to be stored — today, the GitHub App's
 * private key and webhook secret.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting to
 * garbage. The key is derived from AUTH_SECRET, which the deployment already
 * has to keep secret; a database dump alone therefore yields no usable key.
 *
 * The cost of that choice: rotating AUTH_SECRET makes the stored app
 * unreadable. The integrations page reports that plainly, and reconnecting
 * takes one click, so it is a better trade than a second secret to manage.
 */

const VERSION = 'v1'

function key(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is required to store integration credentials.')
  // Domain-separated, so this key is never the same bytes Auth.js signs with.
  return createHash('sha256').update(`taskforge:integration-secrets:${secret}`).digest()
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.')
}

export function unseal(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error('Unrecognised sealed value.')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
