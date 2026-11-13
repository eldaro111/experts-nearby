// ER-002 unit tests for src/lib/timezones.ts (pure functions, no network, no database).
// Run: node --import tsx --test scripts/tests/timezones.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildTimezoneOptions,
  formatTimezone,
  matchesTimezoneQuery,
  parseTimezone,
  sameTimezone,
  utcOffsetLabel,
} from '../../src/lib/timezones'

test('IANA values compare exactly after alias canonicalization', () => {
  assert.equal(sameTimezone('Europe/Moscow', 'Europe/Moscow'), true)
  assert.equal(sameTimezone('Europe/Kiev', 'Europe/Kyiv'), true)
  assert.equal(sameTimezone('Asia/Calcutta', 'Asia/Kolkata'), true)
  assert.equal(sameTimezone('Etc/UTC', 'UTC'), true)
  assert.equal(sameTimezone('europe/moscow', 'Europe/Moscow'), true)
  // Same current offset is not the same zone.
  assert.equal(sameTimezone('Asia/Tomsk', 'Asia/Novosibirsk'), false)
  // No substring matching: «Asia/Tomsk» must not match a query fragment.
  assert.equal(sameTimezone('Asia/Tomsk', 'Asia/Tom'), false)
})

test('legacy fixed offsets are kept and never mapped to a city', () => {
  const legacy = parseTimezone('UTC+3')
  assert.equal(legacy.kind, 'legacy')
  assert.equal(sameTimezone('UTC+3', 'Europe/Moscow'), false)
  assert.equal(sameTimezone('UTC+3', 'Etc/GMT-3'), false)
  assert.equal(sameTimezone('UTC+3', 'utc+3'), true)
  assert.equal(sameTimezone('UTC+3', 'UTC+3 '), true)
  assert.equal(formatTimezone('UTC+3'), 'UTC+3')
  assert.equal(parseTimezone('МСК').kind, 'legacy')
  assert.equal(parseTimezone('Moscow/Unknown').kind, 'legacy')
})

test('empty never matches, including another empty value', () => {
  assert.equal(parseTimezone('').kind, 'empty')
  assert.equal(parseTimezone(null).kind, 'empty')
  assert.equal(sameTimezone('', ''), false)
  assert.equal(sameTimezone(null, 'Europe/Moscow'), false)
  assert.equal(sameTimezone('Europe/Moscow', undefined), false)
})

test('offset depends on the date (DST) and supports half hours', () => {
  assert.equal(utcOffsetLabel('Europe/Berlin', new Date('2026-01-15T12:00:00Z')), 'UTC+1')
  assert.equal(utcOffsetLabel('Europe/Berlin', new Date('2026-07-15T12:00:00Z')), 'UTC+2')
  assert.equal(utcOffsetLabel('America/New_York', new Date('2026-01-15T12:00:00Z')), 'UTC−5')
  assert.equal(utcOffsetLabel('Asia/Kolkata', new Date('2026-01-15T12:00:00Z')), 'UTC+5:30')
  assert.equal(utcOffsetLabel('Asia/Tomsk', new Date('2026-01-15T12:00:00Z')), 'UTC+7')
  assert.equal(utcOffsetLabel('UTC', new Date('2026-01-15T12:00:00Z')), 'UTC')
  assert.equal(formatTimezone('Europe/Berlin', new Date('2026-07-15T12:00:00Z')), 'Берлин · UTC+2')
})

test('options are searchable by Russian name, IANA id and offset', () => {
  const options = buildTimezoneOptions(new Date('2026-01-15T12:00:00Z'))
  const find = (query: string) => options.filter((option) => matchesTimezoneQuery(option, query)).map((option) => option.value)
  assert.ok(find('томск').includes('Asia/Tomsk'))
  assert.ok(find('Asia/Tomsk').includes('Asia/Tomsk'))
  assert.ok(find('спб').includes('Europe/Moscow'))
  assert.ok(find('Кемерово').includes('Asia/Novokuznetsk'))
  assert.ok(find('UTC+7').includes('Asia/Tomsk'))
  assert.ok(find('+5:30').includes('Asia/Kolkata'))
  assert.ok(!find('UTC+7').includes('Europe/Moscow'))
  // Aliases do not produce duplicates.
  const values = options.map((option) => option.value)
  assert.equal(new Set(values).size, values.length)
  assert.ok(values.includes('Europe/Kyiv'))
  assert.ok(!values.includes('Europe/Kiev'))
  assert.ok(values.length > 300, `expected the full IANA list, got ${values.length}`)
})
