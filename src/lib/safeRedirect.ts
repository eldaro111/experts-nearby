// Return path after sign-in (`/auth?next=…`).
//
// Only same-site paths are accepted. Anything that could leave the site or loop back into the
// sign-in pages is replaced by the fallback, so a crafted link cannot send a signed-in user elsewhere.

const BASE = 'https://site.invalid'

/** Returns a same-site path (`/path?query#hash`) or null when the value is not safe to follow. */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 512) return null
  // One leading slash only: `//host` and `/\host` are treated by browsers as another site.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  // Control characters and backslashes are never needed in the app's own paths.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null

  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  // Do not return to the sign-in flow itself.
  if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** Builds the sign-in link that returns to `path` afterwards (falls back to plain `/auth`). */
export function signInHref(path: string): string {
  const safe = safeInternalPath(path)
  return safe ? `/auth?next=${encodeURIComponent(safe)}` : '/auth'
}
