'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** One task date, event or project deadline of a calendar day. Only facts that exist in the data. */
export type CalendarDayItem = {
  id: string
  tone: 'task-start' | 'task-due' | 'event' | 'project-deadline'
  /** «Старт задачи», «Дедлайн задачи», «Созвон»… */
  label: string
  title: string
  /** «09:30» or «10:00–11:00»; null when the record has no time to show. */
  time: string | null
  /** Project title — for calendars that span several projects. */
  project?: string | null
  status?: string | null
  overdue?: boolean
  /** Task assignee, or event participants when such data exists. Never inferred. */
  people?: { label: string; value: string } | null
  action: {
    label: string
    href: string
    /** In-page handler for an ordinary click; the link itself keeps working for a new tab. */
    onOpen?: () => void
  }
}

const HOVER_OPEN_MS = 140
const HOVER_CLOSE_MS = 220
const FOCUSABLE = 'a[href], button:not([disabled])'

/**
 * Calendar day cell with an accessible details panel.
 * - Mouse: the panel opens on hover and stays while the pointer is over the day or the panel.
 * - Keyboard: it opens on focus of the day button; Tab moves into the panel, Escape closes it.
 * - Touch: a tap on the day button opens and closes it.
 * The panel is rendered at the end of <body>, because the calendar scrolls horizontally on narrow
 * screens and would clip it.
 */
export function CalendarDay({
  date,
  items,
  className = '',
  numberClassName = '',
  children,
}: {
  date: Date
  items: CalendarDayItem[]
  className?: string
  numberClassName?: string
  /** The compact chips shown inside the cell. */
  children?: ReactNode
}) {
  const panelId = useId()
  const cell = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // 'hover' closes when the pointer leaves; 'pinned' (focus, tap, click) closes explicitly.
  const [mode, setMode] = useState<'hover' | 'pinned' | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const timer = useRef(0)
  const openedAt = useRef(0)
  const skipFocusOpen = useRef(false)
  const open = mode !== null

  const dayLabel = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' })
  const shortLabel = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  const close = useCallback((returnFocus = false) => {
    window.clearTimeout(timer.current)
    setMode(null)
    setPosition(null)
    if (returnFocus) {
      // Focus returns to the day without reopening the panel.
      skipFocusOpen.current = true
      trigger.current?.focus()
      skipFocusOpen.current = false
    }
  }, [])

  const place = useCallback(() => {
    const anchor = cell.current
    const box = panel.current
    if (!anchor || !box) return
    const rect = anchor.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight
    const margin = 8
    const width = Math.min(340, viewportWidth - margin * 2)
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, margin), viewportWidth - width - margin)
    const height = box.offsetHeight
    let top = rect.bottom + 6
    if (top + height > viewportHeight - margin) {
      const above = rect.top - 6 - height
      top = above >= margin ? above : Math.max(margin, viewportHeight - height - margin)
    }
    setPosition((current) => (current && current.left === left && current.top === top && current.width === width ? current : { left, top, width }))
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place, items.length])

  useEffect(() => {
    if (!open) return
    const onScroll = () => place()
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (cell.current?.contains(target) || panel.current?.contains(target)) return
      close()
    }
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const active = document.activeElement
      close(Boolean(active && (panel.current?.contains(active) || active === trigger.current)))
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('pointerdown', onOutside, true)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open, place, close])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const pin = () => {
    window.clearTimeout(timer.current)
    openedAt.current = Date.now()
    setMode('pinned')
  }

  const hoverEnter = (pointerType: string) => {
    if (pointerType !== 'mouse' || items.length === 0) return
    window.clearTimeout(timer.current)
    if (!open) timer.current = window.setTimeout(() => { openedAt.current = Date.now(); setMode((current) => current ?? 'hover') }, HOVER_OPEN_MS)
  }
  const hoverLeave = (pointerType: string) => {
    if (pointerType !== 'mouse') return
    window.clearTimeout(timer.current)
    if (mode === 'hover') timer.current = window.setTimeout(() => close(), HOVER_CLOSE_MS)
  }

  const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === 'Tab' && !event.shiftKey && open) || event.key === 'ArrowDown') {
      if (event.key === 'ArrowDown') event.preventDefault()
      if (!open) { pin(); return }
      // ArrowDown goes straight to the first record; Tab follows the panel order (close button first).
      const first = event.key === 'ArrowDown'
        ? panel.current?.querySelector<HTMLElement>('.calendar-popover-action') || focusables()[0]
        : focusables()[0]
      if (first) { event.preventDefault(); setMode('pinned'); first.focus() }
    }
  }

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const list = focusables()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (event.shiftKey && index <= 0) {
      event.preventDefault()
      skipFocusOpen.current = true
      trigger.current?.focus()
      skipFocusOpen.current = false
    } else if (!event.shiftKey && index === list.length - 1) {
      // Leaving the panel forwards: back to the day, panel closed, the next Tab goes on.
      event.preventDefault()
      close(true)
    }
  }

  const leaveFocus = (related: EventTarget | null) => {
    const next = related as Node | null
    if (next && (panel.current?.contains(next) || next === trigger.current)) return
    // Without a new focus target the click handlers (outside pointerdown, links) decide.
    if (next) close()
  }

  const onActionClick = (event: MouseEvent<HTMLAnchorElement>, item: CalendarDayItem) => {
    const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    if (!plain) return
    if (item.action.onOpen) {
      event.preventDefault()
      close()
      item.action.onOpen()
    } else {
      close()
    }
  }

  return (
    <div
      ref={cell}
      className={`calendar-day ${open ? 'is-open' : ''} ${className}`}
      onPointerEnter={(event) => hoverEnter(event.pointerType)}
      onPointerLeave={(event) => hoverLeave(event.pointerType)}
    >
      {items.length > 0 ? (
        <button
          ref={trigger}
          type="button"
          className={`calendar-day-trigger ${numberClassName}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${shortLabel}: записей — ${items.length}. Показать подробности`}
          onFocus={() => { if (!skipFocusOpen.current) pin() }}
          onBlur={(event) => leaveFocus(event.relatedTarget)}
          onClick={() => {
            // The same tap first focuses the button (which opens the panel) and then clicks it.
            if (open && mode === 'pinned' && Date.now() - openedAt.current > 350) close()
            else pin()
          }}
          onKeyDown={onTriggerKeyDown}
        >
          <span aria-hidden="true">{date.getDate()}</span>
          <span className="calendar-day-count" aria-hidden="true">{items.length}</span>
        </button>
      ) : (
        <div className={`calendar-day-number ${numberClassName}`}>{date.getDate()}</div>
      )}

      {children}

      {open && createPortal(
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={`${dayLabel}: задачи и события`}
          className="calendar-popover"
          style={position ? { left: position.left, top: position.top, width: position.width } : { left: 0, top: 0, visibility: 'hidden' }}
          onPointerEnter={(event) => { if (event.pointerType === 'mouse') window.clearTimeout(timer.current) }}
          onPointerLeave={(event) => hoverLeave(event.pointerType)}
          onKeyDown={onPanelKeyDown}
          onBlur={(event) => leaveFocus(event.relatedTarget)}
        >
          <div className="calendar-popover-head">
            <strong>{dayLabel}</strong>
            <button type="button" className="calendar-popover-close" aria-label="Закрыть подробности дня" onClick={() => close(true)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <ul className="calendar-popover-list">
            {items.map((item) => (
              <li key={item.id} className={`calendar-popover-item is-${item.overdue ? 'overdue' : item.tone}`}>
                <div className="calendar-popover-meta">
                  <span>{item.label}</span>
                  {item.time && <time>{item.time}</time>}
                </div>
                <div className="calendar-popover-title">{item.title}</div>
                {item.project && <div className="calendar-popover-line">Проект: {item.project}</div>}
                {(item.status || item.overdue) && (
                  <div className="calendar-popover-line">
                    {item.status && <>Статус: {item.status}</>}
                    {item.status && item.overdue && ' · '}
                    {item.overdue && <span className="text-red-700 font-medium">Просрочено</span>}
                  </div>
                )}
                {item.people && <div className="calendar-popover-line">{item.people.label}: {item.people.value}</div>}
                <Link href={item.action.href} scroll={!item.action.onOpen} className="calendar-popover-action" onClick={(event) => onActionClick(event, item)}>
                  {item.action.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}

const timeOf = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

/** Time of a single moment, or null for an empty or invalid value. */
export function momentTime(value: string | null | undefined): string | null {
  if (!value || Number.isNaN(new Date(value).getTime())) return null
  return timeOf(value)
}

/** «10:00–11:00» for the same day, «10:00 — до 14 нояб., 12:00» otherwise; the end is shown only when it is set. */
export function rangeTime(start: string | null | undefined, end: string | null | undefined): string | null {
  const from = momentTime(start)
  if (!from || !start) return null
  if (!end || Number.isNaN(new Date(end).getTime()) || new Date(end).getTime() === new Date(start).getTime()) return from
  const a = new Date(start)
  const b = new Date(end)
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay) return `${from}–${timeOf(end)}`
  return `${from} — до ${b.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${timeOf(end)}`
}
