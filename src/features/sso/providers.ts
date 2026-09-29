import Google from 'next-auth/providers/google'
import Keycloak from 'next-auth/providers/keycloak'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'
import type { Provider } from 'next-auth/providers'

/**
 * Single sign-on, configured by environment only. A provider appears on the
 * sign-in page when its keys are set, and not otherwise — so nothing changes
 * until someone decides it should.
 *
 * Keycloak first: an organisation that runs one already manages its people
 * there, and Keycloak can itself broker Google, Microsoft and LDAP. Google and
 * Microsoft can also be connected directly, for anyone without Keycloak.
 *
 * None of them creates accounts. A sign-in is accepted only for an existing,
 * active TaskForge account whose email the provider has verified — accounts
 * stay provisioned by an administrator (see the signIn callback in auth.ts).
 */

export interface SsoOption {
  id: 'keycloak' | 'google' | 'microsoft-entra-id'
  label: string
}

export function ssoProviders(): Provider[] {
  const providers: Provider[] = []
  if (process.env.KEYCLOAK_ISSUER && process.env.KEYCLOAK_CLIENT_ID && process.env.KEYCLOAK_CLIENT_SECRET) {
    providers.push(
      Keycloak({
        issuer: process.env.KEYCLOAK_ISSUER,
        clientId: process.env.KEYCLOAK_CLIENT_ID,
        clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      }),
    )
  }
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }))
  }
  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
    providers.push(
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        // A tenant's own issuer keeps sign-in to that organisation's accounts.
        issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      }),
    )
  }
  return providers
}

export function ssoOptions(): SsoOption[] {
  const options: SsoOption[] = []
  if (process.env.KEYCLOAK_ISSUER && process.env.KEYCLOAK_CLIENT_ID && process.env.KEYCLOAK_CLIENT_SECRET) {
    options.push({ id: 'keycloak', label: process.env.KEYCLOAK_LABEL || 'Keycloak' })
  }
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) options.push({ id: 'google', label: 'Google' })
  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET) options.push({ id: 'microsoft-entra-id', label: 'Microsoft' })
  return options
}

/**
 * The verified email from a provider's profile, or null. Keycloak and Google
 * say explicitly whether the address is verified; Entra ID addresses are the
 * organisation's own and verified by it.
 */
export function verifiedEmail(provider: string, profile: Record<string, unknown> | undefined): string | null {
  if (!profile) return null
  const email = (typeof profile.email === 'string' && profile.email) || (provider === 'microsoft-entra-id' && typeof profile.preferred_username === 'string' ? profile.preferred_username : null)
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return null
  if (provider === 'microsoft-entra-id') return email.toLowerCase()
  return profile.email_verified === true || profile.email_verified === 'true' ? email.toLowerCase() : null
}
