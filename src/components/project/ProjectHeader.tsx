'use client'

import type { Listing } from './types'

interface ProjectHeaderProps {
  listing: Listing
  isAuthor: boolean

  totalTasks: number
  completedTasks: number
  overdueTasks: number
  projectProgress: number
  isProjectOverdue: boolean

  projectDeadline: string
  savingProjectDeadline: boolean

  formatDateTime: (value: string | null) => string
  onBackToOverview: () => void
  onProjectDeadlineChange: (value: string) => void
  onSaveProjectDeadline: () => void
}

export function ProjectHeader({
  listing,
  isAuthor,
  totalTasks,
  completedTasks,
  overdueTasks,
  projectProgress,
  isProjectOverdue,
  projectDeadline,
  savingProjectDeadline,
  formatDateTime,
  onBackToOverview,
  onProjectDeadlineChange,
  onSaveProjectDeadline,
}: ProjectHeaderProps) {
  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">{listing.title}</h1>
          <p className="text-gray-600 mt-2">{listing.description}</p>
        </div>

        <button
          onClick={onBackToOverview}
          className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 transition"
        >
          К обзору проекта
        </button>
      </div>

      <div className="border rounded-xl bg-white p-5 shadow-sm mb-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <h2 className="text-xl font-semibold">Прогресс проекта</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {completedTasks} из {totalTasks} задач завершено
                </p>
              </div>

              <div className="text-3xl font-bold text-blue-700">
                {projectProgress}%
              </div>
            </div>

            <div
              className="h-4 rounded-full bg-gray-100 border overflow-hidden"
              role="progressbar"
              aria-valuenow={projectProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full transition-all ${
                  projectProgress === 100 ? 'bg-green-600' : 'bg-blue-600'
                }`}
                style={{ width: `${projectProgress}%` }}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3 mt-4 text-sm">
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-gray-500">Всего задач</div>
                <div className="text-lg font-semibold">{totalTasks}</div>
              </div>

              <div className="rounded-lg border bg-green-50 p-3">
                <div className="text-green-700">Готово</div>
                <div className="text-lg font-semibold text-green-800">
                  {completedTasks}
                </div>
              </div>

              <div
                className={`rounded-lg border p-3 ${
                  overdueTasks > 0 ? 'bg-red-50' : 'bg-gray-50'
                }`}
              >
                <div className={overdueTasks > 0 ? 'text-red-700' : 'text-gray-500'}>
                  Просрочено
                </div>
                <div
                  className={`text-lg font-semibold ${
                    overdueTasks > 0 ? 'text-red-800' : 'text-gray-900'
                  }`}
                >
                  {overdueTasks}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:w-[360px]">
            <h2 className="text-xl font-semibold">Дедлайн проекта</h2>

            <div
              className={`mt-2 rounded-lg border p-3 text-sm ${
                isProjectOverdue
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-gray-50 border-gray-200 text-gray-700'
              }`}
            >
              {listing.deadline_at ? (
                <>
                  <div>
                    Текущий срок: <b>{formatDateTime(listing.deadline_at)}</b>
                  </div>

                  {isProjectOverdue && (
                    <div className="mt-1 font-medium">Проект просрочен</div>
                  )}
                </>
              ) : (
                <div>Дедлайн проекта пока не установлен.</div>
              )}
            </div>

            {isAuthor ? (
              <div className="mt-3 space-y-2">
                <input
                  type="datetime-local"
                  value={projectDeadline}
                  onChange={(e) => onProjectDeadlineChange(e.target.value)}
                  className="border rounded p-2 w-full bg-white"
                />

                <button
                  onClick={onSaveProjectDeadline}
                  disabled={savingProjectDeadline}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 w-full"
                >
                  {savingProjectDeadline ? 'Сохраняем...' : 'Сохранить дедлайн'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mt-3">
                Дедлайн проекта может менять автор проекта.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}