// Unit tests for src/lib/safeRedirect.ts (pure functions, no network, no database).
// Run: node --import tsx --test scripts/tests/safe-redirect.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeInternalPath, signInHref } from '../../src/lib/safeRedirect'

test('same-site paths are kept with query and hash', () => {
  assert.equal(safeInternalPath('/dashboard'), '/dashboard')
  assert.equal(safeInternalPath('/?workspace=plan'), '/?workspace=plan')
  assert.equal(safeInternalPath('/projects/abc?task=1#plan'), '/projects/abc?task=1#plan')
  assert.equal(safeInternalPath('  /listings/1#members '), '/listings/1#members')
})

test('other sites and scheme tricks are rejected', () => {
  for (const value of [
    'https://example.com/', 'http://example.com', '//example.com/path', '/\\example.com', '\\\\example.com',
    'javascript:alert(1)', 'data:text/html,x', 'example.com', 'dashboard', '/a\\b', '/a\nb', '/a\tb',
    '///example.com', '/a\r\nLocation: https://example.com',
  ]) {
    assert.equal(safeInternalPath(value), null, value)
  }
})

test('empty, non-string and oversized values are rejected', () => {
  assert.equal(safeInternalPath(null), null)
  assert.equal(safeInternalPath(undefined), null)
  assert.equal(safeInternalPath(''), null)
  assert.equal(safeInternalPath('   '), null)
  assert.equal(safeInternalPath(`/${'a'.repeat(600)}`), null)
})

test('sign-in pages are not a return target', () => {
  assert.equal(safeInternalPath('/auth'), null)
  assert.equal(safeInternalPath('/auth?next=/auth'), null)
  assert.equal(safeInternalPath('/auth/callback?type=recovery'), null)
  assert.equal(safeInternalPath('/authors'), '/authors')
})

test('dot segments cannot escape into the sign-in flow', () => {
  assert.equal(safeInternalPath('/x/../auth'), null)
  assert.equal(safeInternalPath('/x/../dashboard'), '/dashboard')
})

test('signInHref encodes a safe path and drops an unsafe one', () => {
  assert.equal(signInHref('/?workspace=team'), '/auth?next=%2F%3Fworkspace%3Dteam')
  assert.equal(signInHref('https://example.com'), '/auth')
})
