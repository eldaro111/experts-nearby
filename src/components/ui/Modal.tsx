'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Modal window on the native <dialog>: the browser provides the focus trap, Escape, inert background
 * and returns focus to the element that opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className = '',
  closeLabel = 'Закрыть',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  closeLabel?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`app-modal ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => { if (open) onClose() }}
      // A click on the backdrop lands on the <dialog> element itself.
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      {open && (
        <div className="app-modal-body">
          <div className="app-modal-head">
            <div className="min-w-0">
              <h2 id={titleId} className="app-modal-title">{title}</h2>
              {description && <p id={descriptionId} className="app-modal-description">{description}</p>}
            </div>
            <button type="button" className="app-modal-close" aria-label={closeLabel} onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
