'use client'

import { useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { UiText, useT } from '@/components/LocaleProvider'
import {
  buildTimezoneOptions,
  deviceTimezone,
  formatTimezone,
  legacyOption,
  matchesTimezoneQuery,
  parseTimezone,
  sameTimezone,
  type TimezoneOption,
} from '@/lib/timezones'

const MAX_RESULTS = 100
const noopSubscribe = () => () => {}

// Options are rebuilt at most once per calendar day so offsets follow DST changes.
let optionCache: { day: string; options: TimezoneOption[] } | null = null
function zoneOptions() {
  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  if (!optionCache || optionCache.day !== day) optionCache = { day, options: buildTimezoneOptions(now) }
  return optionCache.options
}

function listOptions(query: string, value: string, extraValues: string[], emptyLabel: string) {
  const legacy = new Map<string, TimezoneOption>()
  for (const candidate of [value, ...extraValues]) {
    const parsed = parseTimezone(candidate)
    if (parsed.kind === 'legacy' && !legacy.has(parsed.key)) legacy.set(parsed.key, legacyOption(parsed.raw))
  }
  const all = [...legacy.values(), ...zoneOptions()]
  const trimmed = query.trim()
  const matches = trimmed ? all.filter((option) => matchesTimezoneQuery(option, trimmed)) : all
  const empty: TimezoneOption = { value: '', label: emptyLabel, offset: null, detail: '', curated: true, search: '' }
  return { options: [...(trimmed ? [] : [empty]), ...matches.slice(0, MAX_RESULTS)], total: matches.length }
}

/**
 * Searchable time zone picker (ARIA combobox + listbox).
 * Stores IANA identifiers; an existing unknown value (for example «UTC+3») is kept and shown as is
 * until the user explicitly picks something else. Nothing is converted automatically.
 */
export function TimezoneSelect({
  value,
  onChange,
  id,
  emptyLabel = 'Не указан',
  extraValues,
  suggestDevice = false,
  describedBy,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  /** Label of the empty choice: «Не указан» in forms, «Любой часовой пояс» in filters. */
  emptyLabel?: string
  /** Additional stored values to offer, e.g. legacy values present in a catalogue. */
  extraValues?: string[]
  /** Offer the device time zone when nothing is selected. */
  suggestDevice?: boolean
  describedBy?: string
}) {
  const t = useT()
  const generatedId = useId()
  const inputId = id || `${generatedId}-timezone`
  const listId = `${inputId}-listbox`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const device = useSyncExternalStore(noopSubscribe, deviceTimezone, () => null)
  const extras = useMemo(() => extraValues || [], [extraValues])

  const current = parseTimezone(value)
  const displayLabel = current.kind === 'empty' ? '' : formatTimezone(value)

  const { options, total } = useMemo(
    () => (open ? listOptions(query, value, extras, emptyLabel) : { options: [] as TimezoneOption[], total: 0 }),
    [open, query, value, extras, emptyLabel],
  )

  const isSelected = (option: TimezoneOption) =>
    option.value === '' ? current.kind === 'empty' : option.legacy ? option.value === value : sameTimezone(option.value, value)

  const scrollToActive = (index: number) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const openList = () => {
    if (open) return
    const index = Math.max(0, listOptions('', value, extras, emptyLabel).options.findIndex(isSelected))
    setQuery('')
    setActive(index)
    setOpen(true)
    scrollToActive(index)
  }
  const close = () => { setOpen(false); setQuery('') }
  const choose = (option: TimezoneOption) => {
    onChange(option.value)
    close()
    inputRef.current?.focus()
  }
  const move = (delta: number) => {
    if (!open) { openList(); return }
    if (!options.length) return
    const next = (active + delta + options.length) % options.length
    setActive(next)
    scrollToActive(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
    else if (event.key === 'Enter' && open) {
      event.preventDefault()
      const option = options[active]
      if (option) choose(option)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  const activeId = open && options[active] ? `${listId}-${active}` : undefined
  const offsetText = (option: TimezoneOption) => (option.value === 'UTC' ? '' : option.offset || '')

  return (
    <div className="tz-select" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}>
      <div className="tz-select-control">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-describedby={describedBy}
          value={open ? query : displayLabel}
          placeholder={open ? (displayLabel || t('Город, страна или UTC+3')) : t(emptyLabel)}
          onChange={(event) => { setQuery(event.target.value); setActive(0); if (!open) setOpen(true) }}
          onClick={openList}
          onKeyDown={onKeyDown}
          className="tz-select-input"
        />
        {value && (
          <button type="button" className="tz-select-icon tz-select-clear" onClick={() => { onChange(''); close(); inputRef.current?.focus() }} aria-label={t('Очистить часовой пояс')}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
        <button type="button" tabIndex={-1} className="tz-select-icon tz-select-toggle" onClick={() => { if (open) close(); else { openList(); inputRef.current?.focus() } }} aria-label={t(open ? 'Скрыть варианты' : 'Показать варианты')}>
          <ChevronDown size={17} aria-hidden="true" className={`tz-select-chevron ${open ? 'is-open' : ''}`} />
        </button>
      </div>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={t('Часовые пояса')} className="tz-select-list" onPointerDown={(event) => event.preventDefault()}>
          {options.length === 0 && <li className="tz-select-empty" role="presentation"><UiText text="Ничего не найдено. Попробуйте название города, страны или UTC+3." /></li>}
          {options.map((option, index) => (
            <li
              key={`${option.legacy ? 'legacy:' : ''}${option.value || 'empty'}`}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={isSelected(option)}
              className={`tz-select-option ${index === active ? 'is-active' : ''} ${isSelected(option) ? 'is-selected' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              <span className="min-w-0">
                <span className="block truncate">{option.value === '' || option.legacy ? <UiText text={option.label} /> : option.label}</span>
                {option.detail && <span className="tz-select-detail">{option.legacy ? <UiText text={option.detail} /> : option.detail}</span>}
              </span>
              {offsetText(option) && <span className="tz-select-offset">{offsetText(option)}</span>}
            </li>
          ))}
          {total > MAX_RESULTS && <li className="tz-select-empty" role="presentation"><UiText text="Показаны первые 100 вариантов — уточните запрос." /></li>}
        </ul>
      )}
      {suggestDevice && !value && device && (
        <button type="button" className="tz-select-suggest" onClick={() => onChange(device)}>
          <UiText text="Указать часовой пояс устройства:" /> {formatTimezone(device)}
        </button>
      )}
    </div>
  )
}
