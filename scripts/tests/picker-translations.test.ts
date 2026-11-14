// Static check: every Russian interface string of the home shortcuts, the project picker and the shared
// modal window has an English entry in src/lib/translations.ts (shown through useT / UiText).
// Run from the repository root: node --import tsx --test scripts/tests/picker-translations.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { english } from '../../src/lib/translations'

const FILES = ['src/components/home/WorkspacePanel.tsx', 'src/components/ui/Modal.tsx']
// Developer log messages, not interface text.
const NOT_INTERFACE = new Set(['Ошибка загрузки проектов для главной страницы'])

const CYRILLIC = /[А-Яа-яЁё]/

/** String literals with Cyrillic letters outside comments; template literals give their static text. */
function collect(source: string, found: Set<string>) {
  for (const match of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    if (match[3] !== undefined) {
      // `${t(title)}: ${t('выберите проект')}` — the parts inside ${…} are scanned on their own.
      for (const part of match[3].matchAll(/\$\{([^}]*)\}/g)) collect(part[1], found)
      const fixed = match[3].replace(/\$\{[^}]*\}/g, '')
      if (CYRILLIC.test(fixed)) found.add(`template: ${match[3]}`)
      continue
    }
    const text = match[1] ?? match[2] ?? ''
    if (CYRILLIC.test(text)) found.add(text)
  }
}

function russianLiterals(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '')
  const found = new Set<string>()
  collect(source, found)
  return [...found]
}

test('home shortcuts, project picker and modal: each Russian label has an English translation', () => {
  const missing: string[] = []
  let checked = 0
  for (const file of FILES) {
    for (const text of russianLiterals(file)) {
      if (NOT_INTERFACE.has(text)) continue
      // A label assembled from parts must keep its Russian text in the translated parts only.
      assert.ok(!text.startsWith('template: '), `${file}: Russian text outside t(): ${text}`)
      checked += 1
      const value = english[text]
      if (!value || CYRILLIC.test(value)) missing.push(`${file}: ${text}`)
    }
  }
  assert.deepEqual(missing, [])
  assert.ok(checked >= 40, `expected the picker labels to be found, got ${checked}`)
})
