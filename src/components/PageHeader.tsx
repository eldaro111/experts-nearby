import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, description, children }: {
  eyebrow?: string
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}
