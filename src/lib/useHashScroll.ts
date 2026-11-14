'use client'

import { useEffect } from 'react'

/**
 * Opens the page at its #anchor when the content is loaded by the client.
 *
 * The browser jumps to the anchor before the data arrives, so the target is missing or moves while
 * sections above it grow. The target is aligned once the page is ready and kept aligned for a short
 * time while the layout settles — until the person scrolls, clicks or presses a key.
 */
export function useHashScroll(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    let id = ''
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    } catch {
      return
    }
    if (!id) return

    const align = () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    const frame = requestAnimationFrame(align)

    const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align)
    let timer = 0
    const stop = () => {
      observer?.disconnect()
      window.clearTimeout(timer)
      for (const type of userEvents) window.removeEventListener(type, stop)
    }
    observer?.observe(document.body)
    for (const type of userEvents) window.addEventListener(type, stop, { passive: true })
    timer = window.setTimeout(stop, 2500)

    return () => { cancelAnimationFrame(frame); stop() }
  }, [ready])
}
