// Shared helper of the static translation checks: Russian string literals of a source file.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CYRILLIC = /[А-Яа-яЁё]/

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

export function russianLiterals(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '')
  const found = new Set<string>()
  collect(source, found)
  return [...found]
}

/** Every Russian literal of `files` must have an English entry; returns what is missing. */
export function missingTranslations(files: string[], english: Record<string, string>, notInterface: Set<string>) {
  const missing: string[] = []
  let checked = 0
  for (const file of files) {
    for (const text of russianLiterals(file)) {
      if (notInterface.has(text)) continue
      checked += 1
      const value = english[text]
      if (text.startsWith('template: ') || !value || CYRILLIC.test(value)) missing.push(`${file}: ${text}`)
    }
  }
  return { missing, checked }
}
