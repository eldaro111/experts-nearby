import { UiText } from '@/components/LocaleProvider'
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
        {eyebrow && <p className="eyebrow"><UiText text={eyebrow}/></p>}
        <h1><UiText text={title}/></h1>
        {description && <p className="page-description"><UiText text={description}/></p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  )
}
