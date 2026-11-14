// Unit tests of the project chat helpers (src/lib/projectChat.ts): ordering, de-duplication,
// keyboard/IME rules and scroll anchoring. No browser, no network.
// Run: node --import tsx --test scripts/tests/project-chat.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectMessage } from '../../src/components/project/types'
import { anchoredScrollTop, arrivedFromOthers, isNearBottom, isSendKey, mergeMessages, pendingOnly, type OutgoingMessage } from '../../src/lib/projectChat'

const message = (id: string, at: string, extra: Partial<ProjectMessage> = {}): ProjectMessage => ({
  id, project_id: 'P', author_id: 'A', body: id, created_at: at, parent_message_id: null, edited_at: null, is_deleted_for_all: false, ...extra,
})

test('merge keeps one copy per id, the newer server copy wins, order is chronological with id ties', () => {
  const a = message('a', '2026-11-14T10:00:00+00:00')
  const b = message('b', '2026-11-14T10:01:00+00:00')
  const c = message('c', '2026-11-14T10:01:00+00:00')
  const merged = mergeMessages([b, a], [c, a, { ...b, body: 'edited', edited_at: '2026-11-14T10:05:00+00:00' }])
  assert.deepEqual(merged.map((m) => m.id), ['a', 'b', 'c'])
  assert.equal(merged.find((m) => m.id === 'b')?.body, 'edited')
  assert.deepEqual(mergeMessages(merged, merged).map((m) => m.id), ['a', 'b', 'c'], 'a repeated read adds nothing')
})

test('a confirmed or already-read message hides its pending bubble (no duplicate)', () => {
  const outgoing: OutgoingMessage[] = [
    { id: 'x', author_id: 'A', body: 'x', parent_message_id: null, created_at: '2026-11-14T10:00:00Z', status: 'sending', error: null },
    { id: 'y', author_id: 'A', body: 'y', parent_message_id: null, created_at: '2026-11-14T10:00:01Z', status: 'failed', error: 'нет связи' },
  ]
  assert.deepEqual(pendingOnly(outgoing, [message('x', '2026-11-14T10:00:00Z')]).map((m) => m.id), ['y'])
})

test('Enter sends; Shift+Enter, Alt+Enter and IME composition do not', () => {
  assert.equal(isSendKey({ key: 'Enter', shiftKey: false }), true)
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false)
  assert.equal(isSendKey({ key: 'Enter', shiftKey: false, altKey: true }), false)
  assert.equal(isSendKey({ key: 'Enter', shiftKey: false, isComposing: true }), false)
  assert.equal(isSendKey({ key: 'Enter', shiftKey: false, keyCode: 229 }), false, 'Safari reports the composition end as keyCode 229')
  assert.equal(isSendKey({ key: 'a', shiftKey: false }), false)
})

test('reading position: near-bottom threshold and anchoring after older messages are added above', () => {
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 }), true)
  assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 }), false)
  assert.equal(anchoredScrollTop({ scrollTop: 40, scrollHeight: 1000 }, 1800), 840, 'content grew by 800 above the read message')
})

test('only later messages of other members count as «new» below the view', () => {
  const previous = [message('a', '2026-11-14T10:00:00Z'), message('b', '2026-11-14T10:01:00Z')]
  const next = [...previous, message('c', '2026-11-14T10:02:00Z', { author_id: 'B' }), message('d', '2026-11-14T10:03:00Z', { author_id: 'A' }), message('old', '2026-11-14T09:00:00Z', { author_id: 'B' })]
  assert.deepEqual(arrivedFromOthers(previous, next, 'A').map((m) => m.id), ['c'], 'own and older history are not «new»')
})
