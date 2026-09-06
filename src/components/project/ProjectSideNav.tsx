'use client'

import { LayoutDashboard, ListChecks, Fingerprint, FolderOpen, Star, History, MessagesSquare } from 'lucide-react'

const sections = [
  { href: '#project-top', title: 'Обзор', description: 'Прогресс и дедлайн', icon: LayoutDashboard },
  { href: '#plan', title: 'План работ', description: 'Задачи и календарь', icon: ListChecks },
  { href: '#contributions', title: 'Вклад', description: 'Работы и подтверждения', icon: Fingerprint },
  { href: '#materials', title: 'Материалы', description: 'Файлы и документы', icon: FolderOpen },
  { href: '#reviews', title: 'Отзывы', description: 'Оценки участников', icon: Star },
  { href: '#activity', title: 'История', description: 'Действия в проекте', icon: History },
]

export function ProjectSideNav({ projectProgress, overdueTasks }: { projectProgress: number; overdueTasks: number }) {
  return (
    <aside className="project-nav lg:sticky lg:self-start">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <p className="eyebrow px-2 mb-4">Рабочая зона</p>
        <div className="mb-4 rounded-xl bg-blue-50 p-4">
          <div className="flex items-center justify-between text-sm text-blue-800 mb-3"><span>Выполнено</span><strong>{projectProgress}%</strong></div>
          <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden" role="progressbar" aria-label="Прогресс проекта" aria-valuenow={projectProgress} aria-valuemin={0} aria-valuemax={100}><div className={`h-full transition-all ${projectProgress === 100 ? 'bg-green-600' : 'bg-blue-600'}`} style={{ width: `${projectProgress}%` }} /></div>
          {overdueTasks > 0 && <p className="mt-3 text-sm text-red-700">Просрочено задач: <strong>{overdueTasks}</strong></p>}
        </div>
        <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1" aria-label="Разделы проекта">{sections.map(({ href, title, description, icon: Icon }) => <a key={href} href={href} className="project-nav-link"><Icon size={19} className="shrink-0" /><div><strong>{title}</strong><p>{description}</p></div></a>)}</nav>
        <p className="mt-4 border-t px-2 pt-4 text-xs text-gray-500 flex gap-2"><MessagesSquare size={16} className="shrink-0" />Обсудите задачу с командой в чате проекта.</p>
      </div>
    </aside>
  )
}
