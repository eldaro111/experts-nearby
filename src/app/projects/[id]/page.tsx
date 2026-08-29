'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { ProjectHeader } from '@/components/project/ProjectHeader'
import { ProjectAccessStatus } from '@/components/project/ProjectAccessStatus'
import { ProjectFiles } from '@/components/project/ProjectFiles'
import { ProjectContributions } from '@/components/project/ProjectContributions'
import { ProjectSideNav } from '@/components/project/ProjectSideNav'
import { FloatingProjectChat } from '@/components/project/FloatingProjectChat'
import { ProjectTasks } from '@/components/project/ProjectTasks'
import { ProjectCalendar } from '@/components/project/ProjectCalendar'
import { ProjectDocuments } from '@/components/project/ProjectDocuments'
import { ProjectActivity } from '@/components/project/ProjectActivity'
import { ProjectReviews } from '@/components/project/ProjectReviews'

import type {
  Listing,
  Task,
  ProjectMember,
} from '@/components/project/types'

export default function ProjectWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const [listing, setListing] = useState<Listing | null>(null)
  const [user, setUser] = useState<any>(null)
  const [projectDeadline, setProjectDeadline] = useState('')
  const [savingProjectDeadline, setSavingProjectDeadline] = useState(false)

  const [members, setMembers] = useState<ProjectMember[]>([])

  const [tasks, setTasks] = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)

  const toDateTimeLocalValue = (value: string | null) => {
    if (!value) return ''

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''

    const offsetMs = date.getTimezoneOffset() * 60 * 1000
    const local = new Date(date.getTime() - offsetMs)

    return local.toISOString().slice(0, 16)
  }

  const fromDateTimeLocalValue = (value: string) => {
    if (!value) return null

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null

    return date.toISOString()
  }

  const formatDateTime = (value: string | null) => {
    if (!value) return '—'
    return new Date(value).toLocaleString()
  }

  const isTaskOverdue = (task: Task) => {
    if (!task.due_at) return false

    const due = new Date(task.due_at).getTime()

    if (task.status !== 'done') {
      return Date.now() > due
    }

    if (task.completed_at) {
      return new Date(task.completed_at).getTime() > due
    }

    return false
  }

  const loadMembers = async (project: Listing) => {
    const { data: acceptedApps, error: appsError } = await supabase
      .from('applications')
      .select('user_id')
      .eq('listing_id', project.id)
      .eq('status', 'accepted')

    if (appsError) {
      logAppError('Ошибка загрузки участников проекта', appsError)
      setMembers([])
      return
    }

    const memberIds = [
      project.created_by,
      ...(acceptedApps || []).map((a: any) => a.user_id),
    ]

    const uniqueMemberIds = [...new Set(memberIds)]

    if (uniqueMemberIds.length === 0) {
      setMembers([])
      return
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles_collaboration')
      .select('user_id, display_name')
      .in('user_id', uniqueMemberIds)

    if (profilesError) {
      logAppError('Ошибка загрузки профилей участников', profilesError)
      setMembers([])
      return
    }

    setMembers(profiles || [])
  }

  const refreshTasks = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })

    if (error) {
      logAppError('Ошибка обновления задач', error)
      return
    }

    setTasks((data || []) as Task[])
  }

  useEffect(() => {
    const fetchWorkspace = async () => {
      setLoading(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/auth')
        return
      }

      setUser(user)

      const { data: project, error: projectError } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .single()

      if (projectError || !project) {
        logAppError('Ошибка загрузки проекта', projectError)
        setListing(null)
        setHasAccess(false)
        setLoading(false)
        return
      }

      setListing(project)
      setProjectDeadline(toDateTimeLocalValue(project.deadline_at || null))

      const isAuthor = project.created_by === user.id
      let access = isAuthor

      if (!isAuthor) {
        const { data: membership, error: membershipError } = await supabase
          .from('applications')
          .select('id, status')
          .eq('listing_id', id)
          .eq('user_id', user.id)
          .eq('status', 'accepted')
          .maybeSingle()

        if (membershipError) {
          logAppError('Ошибка проверки доступа', membershipError)
          setHasAccess(false)
          setLoading(false)
          return
        }

        access = !!membership
      }

      setHasAccess(access)

      if (access) {
        await loadMembers(project)
      }

      setLoading(false)
    }

    fetchWorkspace()
  }, [id, router])

  useEffect(() => {
    const fetchTasks = async () => {
      if (!hasAccess) return

      setTasksLoading(true)

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: false })

      if (error) {
        logAppError('Ошибка загрузки задач', error)
        setTasks([])
      } else {
        setTasks((data || []) as Task[])
      }

      setTasksLoading(false)
    }

    fetchTasks()
  }, [id, hasAccess])

  const handleSaveProjectDeadline = async () => {
    if (!listing || !user?.id || savingProjectDeadline) return

    if (listing.created_by !== user.id) {
      showAppMessage('Менять дедлайн проекта может только автор проекта.', 'warning')
      return
    }

    const deadlineAt = fromDateTimeLocalValue(projectDeadline)
    setSavingProjectDeadline(true)

    try {
      const { data, error } = await supabase
        .from('listings')
        .update({ deadline_at: deadlineAt })
        .eq('id', listing.id)
        .eq('created_by', user.id)
        .select('*')
        .single()

      if (error) {
        showAppError(
          error,
          'Не удалось сохранить дедлайн проекта.',
          'Ошибка сохранения дедлайна проекта'
        )
        return
      }

      setListing(data as Listing)
      setProjectDeadline(toDateTimeLocalValue((data as Listing).deadline_at))
      showAppMessage('Дедлайн проекта сохранён.', 'success')
    } catch (error) {
      showAppError(
        error,
        'Не удалось сохранить дедлайн проекта.',
        'Ошибка сохранения дедлайна проекта'
      )
    } finally {
      setSavingProjectDeadline(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">
        Загрузка рабочей зоны...
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="text-center py-12 text-gray-500">
        Проект не найден.
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4 text-center">
          Рабочая зона проекта
        </h1>

        <div className="border rounded-lg bg-white p-6 text-center shadow-sm">
          <p className="text-gray-700 mb-4">
            У вас нет доступа к рабочей зоне этого проекта.
          </p>

          <button
            onClick={() => router.push(`/listings/${id}`)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
          >
            Вернуться к обзору проекта
          </button>
        </div>
      </div>
    )
  }

  const isAuthor = user?.id === listing.created_by

  const totalTasks = tasks.length
  const completedTasks = tasks.filter((t) => t.status === 'done').length
  const overdueTasks = tasks.filter((task) => isTaskOverdue(task)).length
  const projectProgress = totalTasks > 0
    ? Math.round((completedTasks / totalTasks) * 100)
    : 0
  const projectDeadlineTime = listing.deadline_at
    ? new Date(listing.deadline_at).getTime()
    : null
  const isProjectOverdue =
    !!projectDeadlineTime &&
    Number.isFinite(projectDeadlineTime) &&
    Date.now() > projectDeadlineTime &&
    projectProgress < 100

  return (
    <div id="project-top" className="max-w-7xl mx-auto py-10 px-4">
      <ProjectHeader
        listing={listing}
        isAuthor={isAuthor}
        totalTasks={totalTasks}
        completedTasks={completedTasks}
        overdueTasks={overdueTasks}
        projectProgress={projectProgress}
        isProjectOverdue={isProjectOverdue}
        projectDeadline={projectDeadline}
        savingProjectDeadline={savingProjectDeadline}
        formatDateTime={formatDateTime}
        onBackToOverview={() => router.push(`/listings/${id}`)}
        onProjectDeadlineChange={setProjectDeadline}
        onSaveProjectDeadline={handleSaveProjectDeadline}
      />

      <ProjectAccessStatus isAuthor={isAuthor} />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        <ProjectSideNav
          projectProgress={projectProgress}
          overdueTasks={overdueTasks}
        />

        <main className="min-w-0 space-y-10">
          <section id="plan" className="scroll-mt-24 space-y-10">
            <ProjectTasks
              projectId={id}
              currentUserId={user?.id}
              isAuthor={isAuthor}
              members={members}
              tasks={tasks}
              tasksLoading={tasksLoading}
              onTasksChanged={refreshTasks}
            />

            <ProjectCalendar
              projectId={id}
              currentUserId={user?.id}
              listing={listing}
              members={members}
              tasks={tasks}
              projectProgress={projectProgress}
            />
          </section>

          <section id="contributions" className="scroll-mt-24">
            <ProjectContributions
              projectId={id}
              currentUserId={user?.id}
              isAuthor={isAuthor}
              members={members}
              tasks={tasks}
            />
          </section>

          <section id="materials" className="scroll-mt-24 space-y-10">
            <ProjectFiles
              projectId={id}
              currentUserId={user?.id}
              isAuthor={isAuthor}
              members={members}
              tasks={tasks}
            />

            <ProjectDocuments
              projectId={id}
              currentUserId={user?.id}
              isAuthor={isAuthor}
              members={members}
            />
          </section>

          <section id="reviews" className="scroll-mt-24">
            <ProjectReviews
              projectId={id}
              currentUserId={user?.id}
              listing={listing}
              members={members}
            />
          </section>

          <section id="activity" className="scroll-mt-24">
            <ProjectActivity projectId={id} />
          </section>
        </main>
      </div>

      <FloatingProjectChat
        projectId={id}
        currentUserId={user?.id}
        members={members}
      />
    </div>
  )
}