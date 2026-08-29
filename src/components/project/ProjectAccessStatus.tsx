'use client'

interface ProjectAccessStatusProps {
  isAuthor: boolean
}

export function ProjectAccessStatus({ isAuthor }: ProjectAccessStatusProps) {
  return (
    <div className="mt-8 border rounded-xl bg-white p-5 shadow-sm mb-8">
      <h2 className="text-xl font-semibold mb-3">Статус доступа</h2>

      <p className="text-sm text-gray-700">
        {isAuthor
          ? 'Вы автор проекта и имеете полный доступ к рабочей зоне.'
          : 'Вы участник проекта и имеете доступ к рабочей зоне.'}
      </p>
    </div>
  )
}