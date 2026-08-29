'use client'

import { useState } from 'react'
import { ProjectChat } from './ProjectChat'
import type { ProjectMember } from './types'

interface FloatingProjectChatProps {
  projectId: string
  currentUserId: string | null | undefined
  members: ProjectMember[]
}

export function FloatingProjectChat({
  projectId,
  currentUserId,
  members,
}: FloatingProjectChatProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {isOpen && (
        <div className="mb-3 w-[calc(100vw-2.5rem)] max-w-[520px] rounded-2xl border bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b bg-gray-50 px-4 py-3">
            <div>
              <div className="font-semibold text-gray-900">Чат проекта</div>
              <div className="text-xs text-gray-500">
                Обсуждение команды в отдельном окне.
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="rounded-full border bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 transition"
            >
              Закрыть
            </button>
          </div>

          <div className="max-h-[75vh] overflow-hidden">
            <ProjectChat
              projectId={projectId}
              currentUserId={currentUserId}
              members={members}
            />
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen((value) => !value)}
        className="ml-auto flex items-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-white shadow-xl hover:bg-blue-700 transition"
      >
        <span>💬</span>
        <span>{isOpen ? 'Свернуть чат' : 'Чат'}</span>
      </button>
    </div>
  )
}
