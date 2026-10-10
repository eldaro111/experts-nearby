'use client'

import { cloneElement, isValidElement, useId, type ReactNode } from 'react'
import { UiText } from '@/components/LocaleProvider'

export function FormField({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  const generatedId = useId()
  const control = isValidElement<{ id?: string }>(children) ? children : null
  const id = control?.props.id || generatedId
  return (
    <div className={`form-field ${className}`}>
      <label htmlFor={id}>
        <UiText text={label} />
      </label>
      {control ? cloneElement(control, { id }) : children}
    </div>
  )
}
