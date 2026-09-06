'use client'

import { useEffect, useRef, useState } from 'react'
import { MessagesSquare, X } from 'lucide-react'
import { ProjectChat } from './ProjectChat'
import type { ProjectMember } from './types'

export function FloatingProjectChat({ projectId, currentUserId, members }: {
  projectId: string
  currentUserId: string | null | undefined
  members: ProjectMember[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [isOpen])

  const close = () => { setIsOpen(false); trigger.current?.focus() }

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-5 sm:right-5">
      {isOpen && (
        <div ref={panel} id="project-chat-panel" role="region" aria-label="Чат проекта" className="floating-chat-panel mb-3 w-[calc(100vw-2rem)] max-w-[520px] rounded-2xl border border-blue-200 bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b bg-blue-600 text-white px-4 py-3">
            <div className="flex items-center gap-2"><MessagesSquare size={20} /><div><p className="font-semibold">Чат проекта</p><p className="text-xs text-blue-100">Обсуждение с командой</p></div></div>
            <button onClick={close} aria-label="Закрыть чат" className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/15"><X size={21} /></button>
          </div>
          <ProjectChat projectId={projectId} currentUserId={currentUserId} members={members} />
        </div>
      )}
      <button ref={trigger} onClick={() => setIsOpen((value) => !value)} aria-expanded={isOpen} aria-controls="project-chat-panel" className="ml-auto flex items-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-white shadow-xl hover:bg-blue-700 transition"><MessagesSquare size={20} /><span>{isOpen ? 'Свернуть чат' : 'Чат команды'}</span></button>
    </div>
  )
}
