// Where a person continues after signing in, signing up, confirming email, a magic link or recovery.
//
// The destination travels as `?next=` through /auth, the email link (/auth/callback?type=…&next=…),
// /auth/set-password and /onboarding. Every hop accepts only a same-site path (src/lib/safeRedirect.ts).
// Required steps always come first: password setup or recovery, then onboarding, then the destination.
//
// The email link keeps `next` only if the Supabase redirect allow-list accepts the callback URL with
// its query and the email template uses the redirect URL (see docs/reports/auth-return-projects.md).
// As a same-browser fallback the destination is also kept for one hour in localStorage.
import { safeInternalPath } from '@/lib/safeRedirect'

const PENDING_KEY = 'experts-auth-return'
const PENDING_TTL_MS = 60 * 60 * 1000
const BASE = 'https://site.invalid'

export type AuthLinkType = 'signup' | 'magiclink' | 'recovery'

/** Final destination: a same-site path that is neither the sign-in flow nor onboarding itself. */
export function safeReturnPath(value: string | null | undefined): string | null {
  const path = safeInternalPath(value)
  if (!path) return null
  const { pathname } = new URL(path, BASE)
  if (pathname === '/onboarding' || pathname.startsWith('/onboarding/')) return null
  return path
}

/** `?next=` of the current page as a safe final destination. */
export function returnPathFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return safeReturnPath(new URLSearchParams(window.location.search).get('next'))
}

/** Link target for confirmation, magic-link and recovery emails. */
export function authCallbackUrl(origin: string, type: AuthLinkType, next: string | null): string {
  const url = new URL('/auth/callback', origin)
  url.searchParams.set('type', type)
  const safe = safeReturnPath(next)
  if (safe) url.searchParams.set('next', safe)
  return url.toString()
}

/** Keeps the destination for an email link opened in this browser; `null` clears an older one. */
export function rememberPendingReturn(path: string | null) {
  try {
    const safe = safeReturnPath(path)
    if (safe) window.localStorage.setItem(PENDING_KEY, JSON.stringify({ path: safe, at: Date.now() }))
    else window.localStorage.removeItem(PENDING_KEY)
  } catch {
    // Storage may be unavailable; the `next` parameter of the link still works.
  }
}

/** Reads and removes the kept destination. Expired or unsafe values are ignored. */
export function takePendingReturn(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    window.localStorage.removeItem(PENDING_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { path?: unknown; at?: unknown }
    if (typeof value.path !== 'string' || typeof value.at !== 'number') return null
    if (now - value.at > PENDING_TTL_MS || value.at > now + 60_000) return null
    return safeReturnPath(value.path)
  } catch {
    return null
  }
}

/** Next page once a session exists: onboarding first when there is no profile yet. */
export function nextStepAfterSignIn(hasProfile: boolean, destination: string | null): string {
  const safe = safeReturnPath(destination)
  if (!hasProfile) return safe ? `/onboarding?next=${encodeURIComponent(safe)}` : '/onboarding'
  return safe || '/profile'
}
