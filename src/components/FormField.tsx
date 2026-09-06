import type { ReactNode } from 'react'

export function FormField({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`form-field ${className}`}><span>{label}</span>{children}</label>
}
