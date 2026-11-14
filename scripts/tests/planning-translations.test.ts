// Static check: every Russian interface string of the ER-012 planning interface (components and the
// messages of the client module) has an English entry in src/lib/translations.ts (shown through useT).
// Server rule texts come from the database at run time and are shown as received.
// Run from the repository root: node --import tsx --test scripts/tests/planning-translations.test.ts
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'
import { english } from '../../src/lib/translations'
import { missingTranslations } from './translation-coverage'

const DIR = 'src/components/project/planning'
const FILES = [...readdirSync(DIR).filter((name) => /\.tsx?$/.test(name)).map((name) => `${DIR}/${name}`), 'src/lib/planning.ts']
// The hour unit is chosen by locale in text.ts, not translated through the dictionary.
const NOT_INTERFACE = new Set(['ч'])

test('planning interface: each Russian label and message has an English translation', () => {
  const { missing, checked } = missingTranslations(FILES, english, NOT_INTERFACE)
  assert.deepEqual(missing, [])
  assert.ok(checked >= 200, `expected the planning labels to be found, got ${checked}`)
})
