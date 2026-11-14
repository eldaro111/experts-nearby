'use client'

import type { ReactNode } from 'react'
import { useT } from '@/components/LocaleProvider'
import { ERROR_TEXT, type PlanningError } from '@/lib/planning'
import type { ProjectMember, Task } from '../types'
import type { PlanningController, PlanningData } from './usePlanning'

export interface PanelProps {
  planning: PlanningController
  data: PlanningData
  projectId: string
  members: ProjectMember[]
  /** All project tasks of the page (board, Gantt and calendar use the same list). */
  tasks: Task[]
  onOpenTask: (taskId: string) => void
}

export type Notice = { tone: 'success' | 'info' | 'warning' | 'error'; text: string; detail?: string } | null

/** What the person should know after a failed write. The server text is kept as the detail. */
export function errorNotice(error: PlanningError): Notice {
  const general = ERROR_TEXT[error.kind]
  const detail = error.message && error.message !== general ? error.message : undefined
  const tone = error.kind === 'conflict' || error.kind === 'timeout' || error.kind === 'network' ? 'warning' : 'error'
  return { tone, text: general, detail }
}

export function NoticeBox({ notice, children }: { notice: Notice; children?: ReactNode }) {
  const t = useT()
  if (!notice) return null
  const alert = notice.tone === 'error' || notice.tone === 'warning'
  return (
    <div className={`planning-notice is-${notice.tone}`} role={alert ? 'alert' : 'status'}>
      <p>{t(notice.text)}</p>
      {notice.detail && <p className="planning-notice-detail">{t(notice.detail)}</p>}
      {children && <div className="planning-notice-actions">{children}</div>}
    </div>
  )
}

export function useMemberName(members: ProjectMember[]) {
  const t = useT()
  return (id: string | null | undefined) => {
    if (!id) return t('Не назначен')
    return members.find((member) => member.user_id === id)?.display_name || t('Участник без имени')
  }
}
