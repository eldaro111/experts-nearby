// Unit tests for src/lib/authReturn.ts (pure functions; localStorage is an in-memory stand-in).
// Run: node --import tsx --test scripts/tests/auth-return.test.ts
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
// The module touches `window` only when its functions run, so the stand-in below is in time.
import { authCallbackUrl, nextStepAfterSignIn, rememberPendingReturn, returnPathFromLocation, safeReturnPath, takePendingReturn } from '../../src/lib/authReturn'

const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  location: { search: '' },
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  },
}

beforeEach(() => store.clear())

test('final destinations are same-site paths, never the sign-in flow or onboarding', () => {
  assert.equal(safeReturnPath('/?workspace=plan'), '/?workspace=plan')
  assert.equal(safeReturnPath('/projects/P1?task=T1#plan'), '/projects/P1?task=T1#plan')
  for (const value of ['//example.com', '/\\example.com', 'https://example.com', '/auth', '/auth/set-password', '/onboarding', '/onboarding?next=/x', null, '']) {
    assert.equal(safeReturnPath(value), null, String(value))
  }
})

test('email links carry an encoded destination only when it is safe', () => {
  assert.equal(
    authCallbackUrl('https://nearbyexperts.ru', 'signup', '/?workspace=plan'),
    'https://nearbyexperts.ru/auth/callback?type=signup&next=%2F%3Fworkspace%3Dplan',
  )
  assert.equal(authCallbackUrl('https://nearbyexperts.ru', 'recovery', null), 'https://nearbyexperts.ru/auth/callback?type=recovery')
  assert.equal(authCallbackUrl('https://nearbyexperts.ru', 'magiclink', '//evil.example'), 'https://nearbyexperts.ru/auth/callback?type=magiclink')
  // Encoded: no raw `/`, `?` or `&` from the destination reaches the redirect URL.
  const url = new URL(authCallbackUrl('https://nearbyexperts.ru', 'magiclink', '/projects/P1?task=T1&x=1'))
  assert.equal(url.searchParams.get('next'), '/projects/P1?task=T1&x=1')
  assert.equal([...url.searchParams.keys()].join(','), 'type,next')
})

test('required steps come first: onboarding without a profile, then the destination', () => {
  assert.equal(nextStepAfterSignIn(false, '/?workspace=team'), '/onboarding?next=%2F%3Fworkspace%3Dteam')
  assert.equal(nextStepAfterSignIn(false, null), '/onboarding')
  assert.equal(nextStepAfterSignIn(false, '/onboarding'), '/onboarding')
  assert.equal(nextStepAfterSignIn(true, '/?workspace=team'), '/?workspace=team')
  assert.equal(nextStepAfterSignIn(true, '/auth/callback'), '/profile')
  assert.equal(nextStepAfterSignIn(true, null), '/profile')
})

test('the browser copy is used once, expires after an hour and rejects unsafe values', () => {
  rememberPendingReturn('/?workspace=materials')
  assert.equal(takePendingReturn(), '/?workspace=materials')
  assert.equal(takePendingReturn(), null, 'removed after use')

  rememberPendingReturn('/?workspace=plan')
  assert.equal(takePendingReturn(Date.now() + 61 * 60 * 1000), null, 'expired')

  rememberPendingReturn('/?workspace=plan')
  rememberPendingReturn(null)
  assert.equal(takePendingReturn(), null, 'a sign-in without a destination clears an older one')

  store.set('experts-auth-return', JSON.stringify({ path: '//evil.example', at: Date.now() }))
  assert.equal(takePendingReturn(), null)
  store.set('experts-auth-return', '{broken')
  assert.equal(takePendingReturn(), null)
})

test('returnPathFromLocation reads only a safe `next`', () => {
  const win = (globalThis as unknown as { window: { location: { search: string } } }).window
  win.location.search = '?next=%2F%3Fworkspace%3Dplan'
  assert.equal(returnPathFromLocation(), '/?workspace=plan')
  win.location.search = '?next=https%3A%2F%2Fevil.example'
  assert.equal(returnPathFromLocation(), null)
  win.location.search = ''
})
