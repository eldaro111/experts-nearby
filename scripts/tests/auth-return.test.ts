// Unit tests for src/lib/authReturn.ts (pure functions; localStorage and document.cookie are
// in-memory stand-ins).
// Run: node --import tsx --test scripts/tests/auth-return.test.ts
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
// The module touches `window` and `document` only when its functions run, so the stand-ins below are in time.
import {
  authCallbackUrl,
  destinationOfStep,
  nextStepAfterSignIn,
  passwordStepHref,
  readPasswordStep,
  rememberPasswordStep,
  rememberPendingReturn,
  returnPathFromLocation,
  safeReturnPath,
  takePendingReturn,
} from '../../src/lib/authReturn'

const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  location: { search: '' },
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  },
}

// A cookie jar like document.cookie: `name=value; Path=/; Max-Age=N`, Max-Age=0 removes.
const jar = new Map<string, string>()
const written: string[] = []
;(globalThis as unknown as { document: unknown }).document = {
  get cookie() {
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  },
  set cookie(line: string) {
    written.push(line)
    const [pair, ...attributes] = line.split(';').map((part) => part.trim())
    const at = pair.indexOf('=')
    const name = pair.slice(0, at)
    if (attributes.some((attribute) => attribute.toLowerCase() === 'max-age=0')) jar.delete(name)
    else jar.set(name, pair.slice(at + 1))
  },
}

beforeEach(() => { store.clear(); jar.clear(); written.length = 0 })

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

test('password step: the link and the kept continuation accept only same-site paths outside /auth', () => {
  assert.equal(passwordStepHref('/onboarding?next=%2F%3Fworkspace%3Dplan'), '/auth/set-password?next=%2Fonboarding%3Fnext%3D%252F%253Fworkspace%253Dplan')
  assert.equal(passwordStepHref('/profile'), '/auth/set-password?next=%2Fprofile')
  for (const value of ['//evil.example', 'https://evil.example', '/\\evil.example', '/auth/set-password', null]) {
    assert.equal(passwordStepHref(value), '/auth/set-password', String(value))
  }

  rememberPasswordStep('/onboarding?next=%2Fprojects%2FP1%23plan')
  assert.match(written.at(-1)!, /^pw_step_next=[^;]+; Path=\/; Max-Age=1800; SameSite=Lax$/)
  assert.ok(!/[;,\s]/.test(jar.get('pw_step_next')!), 'the value is encoded: no separators reach the cookie header')
  assert.equal(readPasswordStep(), '/onboarding?next=%2Fprojects%2FP1%23plan')

  rememberPasswordStep(null)
  assert.equal(readPasswordStep(), null, 'removed after the password is saved')

  rememberPasswordStep('https://evil.example')
  assert.equal(readPasswordStep(), null, 'an unsafe value is not kept')
  for (const raw of ['https%3A%2F%2Fevil.example', '%2F%2Fevil.example', '%2F%5Cevil.example', '%2Fauth%2Fset-password', '%E0%A4%A', '']) {
    jar.set('pw_step_next', raw)
    assert.equal(readPasswordStep(), null, `crafted cookie ${raw}`)
  }
})

test('the destination behind a continuation: onboarding is skipped to its `next`, unsafe values give null', () => {
  assert.equal(destinationOfStep('/onboarding?next=%2F%3Fworkspace%3Dteam'), '/?workspace=team')
  assert.equal(destinationOfStep('/onboarding'), null)
  assert.equal(destinationOfStep('/projects/P1#plan'), '/projects/P1#plan')
  assert.equal(destinationOfStep('/onboarding?next=https%3A%2F%2Fevil.example'), null)
  assert.equal(destinationOfStep('/auth/callback'), null)
  assert.equal(destinationOfStep(null), null)
})
