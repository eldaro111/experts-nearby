import type { ReactNode } from 'react'
import { SearchX, LoaderCircle } from 'lucide-react'

export function PageLoading({ label = 'Загружаем данные…' }: { label?: string }) {
  return (
    <div className="page-shell" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-label"><LoaderCircle size={20} className="loading-spinner" />{label}</div>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-filter" />
      <div className="grid gap-5 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-card" />)}
      </div>
    </div>
  )
}

export function EmptyState({ title, description, children }: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-icon"><SearchX size={26} aria-hidden="true" /></span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}
