'use client'

interface ProjectSideNavProps {
  projectProgress: number
  overdueTasks: number
}

const sections = [
  {
    href: '#project-top',
    title: 'Обзор',
    description: 'Шапка, прогресс, дедлайн',
  },
  {
    href: '#plan',
    title: 'План работ',
    description: 'Задачи, сроки, календарь',
  },
  {
    href: '#contributions',
    title: 'Вклад',
    description: 'Журнал работ и подтверждения',
  },
  {
    href: '#materials',
    title: 'Материалы',
    description: 'Файлы, документы, версии',
  },
  {
    href: '#reviews',
    title: 'Отзывы',
    description: 'Оценки и доверие',
  },
  {
    href: '#activity',
    title: 'История',
    description: 'Ключевые действия проекта',
  },
]

export function ProjectSideNav({
  projectProgress,
  overdueTasks,
}: ProjectSideNavProps) {
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-4">
          <div className="text-sm font-semibold text-gray-900">
            Навигация проекта
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Быстрые переходы по рабочей зоне.
          </div>
        </div>

        <div className="mb-4 rounded-xl border bg-gray-50 p-3">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
            <span>Прогресс</span>
            <b className="text-gray-900">{projectProgress}%</b>
          </div>

          <div className="h-2 rounded-full bg-white border overflow-hidden">
            <div
              className={`h-full transition-all ${
                projectProgress === 100 ? 'bg-green-600' : 'bg-blue-600'
              }`}
              style={{ width: `${projectProgress}%` }}
            />
          </div>

          {overdueTasks > 0 && (
            <div className="mt-2 text-xs text-red-700">
              Просрочено задач: <b>{overdueTasks}</b>
            </div>
          )}
        </div>

        <nav className="grid gap-2">
          {sections.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="group block rounded-xl border bg-white px-3 py-3 hover:border-blue-200 hover:bg-blue-50 transition"
            >
              <div className="font-medium text-gray-900 group-hover:text-blue-800">
                {section.title}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {section.description}
              </div>
            </a>
          ))}
        </nav>

        <div className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
          Чат вынесен в отдельное окно справа снизу, чтобы не раздувать страницу.
        </div>
      </div>
    </aside>
  )
}