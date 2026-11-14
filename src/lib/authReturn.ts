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

// Mandatory password step: a new password after a first magic link or invite, or after recovery.
// While the `needs_pw_setup` / `needs_pw_reset` marker is set, src/proxy.ts sends every page except
// /auth* to /auth/set-password. Where the person continues after the password (onboarding or the
// destination) is kept in a cookie with the marker's lifetime, so leaving the page, reloading it or
// visiting other /auth pages does not lose it. The cookie is a convenience, not an access right:
// every reader accepts only a same-site path outside the sign-in flow (safeInternalPath).
export const PASSWORD_STEP_COOKIE = 'pw_step_next'
const PASSWORD_STEP_MAX_AGE_S = 1800

/** The password step page that continues to `next` afterwards. */
export function passwordStepHref(next: string | null): string {
  const safe = safeInternalPath(next)
  return safe ? `/auth/set-password?next=${encodeURIComponent(safe)}` : '/auth/set-password'
}

/** Keeps where to continue after the password step; `null` removes it. */
export function rememberPasswordStep(next: string | null) {
  if (typeof document === 'undefined') return
  const safe = safeInternalPath(next)
  document.cookie = safe
    ? `${PASSWORD_STEP_COOKIE}=${encodeURIComponent(safe)}; Path=/; Max-Age=${PASSWORD_STEP_MAX_AGE_S}; SameSite=Lax`
    : `${PASSWORD_STEP_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

/** The kept continuation of the password step, or null when missing, malformed or unsafe. */
export function readPasswordStep(): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${PASSWORD_STEP_COOKIE}=`
  const entry = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  if (!entry) return null
  try {
    return safeInternalPath(decodeURIComponent(entry.slice(prefix.length)))
  } catch {
    return null
  }
}

/** The final destination behind a continuation: `/onboarding?next=X` gives X. */
export function destinationOfStep(step: string | null): string | null {
  const safe = safeInternalPath(step)
  if (!safe) return null
  const url = new URL(safe, BASE)
  if (url.pathname === '/onboarding') return safeReturnPath(url.searchParams.get('next'))
  return safeReturnPath(safe)
}
