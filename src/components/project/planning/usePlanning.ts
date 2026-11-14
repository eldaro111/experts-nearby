'use client'

// One planning state per opened project and signed-in account, shared by the planning panel and the
// common task card. Realtime is not enabled for the new tables: data is read on open, after every own
// operation and on «Обновить». Answers that arrive after the project or the account changed are dropped,
// so they cannot change the screen, the selection or start a navigation.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { planningDb } from '@/lib/planningClient'
import * as P from '@/lib/planning'

export interface PlanningData {
  settings: P.PlanningSettings
  roles: P.PlanningRole[]
  stages: P.ProjectStage[]
  /** false — the second migration (backlog/sprints) is not installed on the server. */
  sprintsAvailable: boolean
  backlog: P.Backlog | null
  sprints: P.Sprint[]
  /** Open scope of planned and active sprints. */
  openItems: P.SprintItem[]
  loadedAt: number
}

export type PlanningStatus = 'loading' | 'ready' | 'unavailable' | 'forbidden' | 'error' | 'session_changed'

interface State {
  key: string
  status: PlanningStatus
  data: PlanningData | null
  error: P.PlanningError | null
}

export interface PlanningController {
  status: PlanningStatus
  data: PlanningData | null
  /** Last failed read; the previous data stays visible. */
  error: P.PlanningError | null
  refreshing: boolean
  busy: string | null
  caps: P.PlanningCapabilities
  db: P.PlanningDb
  userId: string | null
  refresh: () => Promise<void>
  /**
   * Runs one write. Afterwards the planning data and the project tasks are read again (also after a
   * conflict, a refusal or an unknown outcome). Returns null when the answer was dropped because the
   * project/account changed or another write is still running.
   */
  perform: <T>(label: string, operation: (db: P.PlanningDb) => Promise<P.Result<T>>) => Promise<P.Result<T> | null>
}

const NO_RIGHTS = P.capabilities({ userId: null, ownerId: '', closed: true, settings: { delegate_to_roles: false }, roles: [] })

export function usePlanning({ enabled, projectId, userId, ownerId, closed, onTasksChanged }: {
  /** false until the page has confirmed the session and access to the project. */
  enabled: boolean
  projectId: string
  userId: string | null
  ownerId: string
  closed: boolean
  onTasksChanged: () => Promise<void>
}): PlanningController {
  const key = enabled ? `${userId ?? ''}:${projectId}` : 'off'
  const [state, setState] = useState<State>({ key, status: 'loading', data: null, error: null })
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const generation = useRef(0)
  const busyRef = useRef(false)
  const tasksChanged = useRef(onTasksChanged)
  useEffect(() => { tasksChanged.current = onTasksChanged }, [onTasksChanged])

  const load = useCallback(async (my: number, stateKey: string) => {
    setRefreshing(true)
    const db = planningDb
    const [settings, roles, stages, backlog, sprints] = await Promise.all([
      P.loadSettings(db, projectId), P.loadRoles(db, projectId), P.loadStages(db, projectId),
      P.loadBacklog(db, projectId), P.loadSprints(db, projectId),
    ])
    if (my !== generation.current) return
    const keep = (patch: Partial<State>) => setState((before) => ({ ...(before.key === stateKey ? before : { key: stateKey, data: null, error: null, status: 'loading' as const }), ...patch }))
    const finish = () => { if (my === generation.current) setRefreshing(false) }

    if (!settings.ok && settings.error.kind === 'unavailable') { keep({ status: 'unavailable', data: null, error: null }); finish(); return }
    if (!backlog.ok && backlog.error.kind === 'forbidden') { keep({ status: 'forbidden', data: null, error: null }); finish(); return }
    const firstError = [settings, roles, stages].find((r) => !r.ok)
    if (firstError && !firstError.ok) {
      setState((before) => (before.key === stateKey && before.data
        ? { ...before, error: firstError.error }
        : { key: stateKey, status: 'error', data: null, error: firstError.error }))
      finish()
      return
    }
    const sprintsMissing = (!backlog.ok && backlog.error.kind === 'unavailable') || (!sprints.ok && sprints.error.kind === 'unavailable')
    const sprintError = !sprintsMissing ? [backlog, sprints].find((r) => !r.ok) : undefined
    if (sprintError && !sprintError.ok) {
      setState((before) => (before.key === stateKey && before.data
        ? { ...before, error: sprintError.error }
        : { key: stateKey, status: 'error', data: null, error: sprintError.error }))
      finish()
      return
    }
    const sprintList = sprints.ok ? sprints.data : []
    const openIds = sprintList.filter((s) => s.state === 'planned' || s.state === 'active').map((s) => s.id)
    const items = sprintsMissing ? { ok: true as const, data: [] } : await P.loadOpenItems(db, openIds)
    if (my !== generation.current) return
    if (!items.ok) {
      setState((before) => (before.key === stateKey && before.data ? { ...before, error: items.error } : { key: stateKey, status: 'error', data: null, error: items.error }))
      finish()
      return
    }
    setState({
      key: stateKey,
      status: 'ready',
      error: null,
      data: {
        settings: settings.ok ? settings.data : P.defaultSettings(projectId),
        roles: roles.ok ? roles.data : [],
        stages: stages.ok ? stages.data : [],
        sprintsAvailable: !sprintsMissing,
        backlog: backlog.ok ? backlog.data : null,
        sprints: sprintList,
        openItems: items.data,
        loadedAt: Date.now(),
      },
    })
    finish()
  }, [projectId])

  // A new project or account starts from a clean state; older answers are ignored by generation.
  useEffect(() => {
    generation.current += 1
    const my = generation.current
    busyRef.current = false
    if (key === 'off') return
    const timer = window.setTimeout(() => { setBusy(null); void load(my, key) }, 0)
    return () => { window.clearTimeout(timer); generation.current += 1 }
  }, [key, load])

  // Another tab or a sign-out may change the account while this page stays open.
  useEffect(() => {
    if (key === 'off') return
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null
      if (id === userId) return
      generation.current += 1
      busyRef.current = false
      setBusy(null)
      setRefreshing(false)
      setState({ key, status: 'session_changed', data: null, error: null })
    })
    return () => data.subscription.unsubscribe()
  }, [key, userId])

  const refresh = useCallback(async () => {
    if (state.status === 'session_changed') return
    const my = generation.current
    await Promise.all([load(my, key), tasksChanged.current()])
  }, [key, load, state.status])

  const perform = useCallback(async <T,>(label: string, operation: (db: P.PlanningDb) => Promise<P.Result<T>>): Promise<P.Result<T> | null> => {
    if (busyRef.current) return null
    const my = generation.current
    busyRef.current = true
    setBusy(label)
    try {
      const result = await operation(planningDb)
      if (my !== generation.current) return null
      if (!result.ok && result.error.kind === 'unavailable') {
        setState({ key, status: 'unavailable', data: null, error: null })
        return result
      }
      // Success, conflict, refusal or unknown outcome: show what the server has now.
      await Promise.all([load(my, key), tasksChanged.current()])
      return my === generation.current ? result : null
    } finally {
      if (my === generation.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }, [key, load])

  const current = state.key === key ? state : { key, status: 'loading' as const, data: null, error: null }
  const caps = useMemo(() => (current.status === 'ready' && current.data
    ? P.capabilities({ userId, ownerId, closed, settings: current.data.settings, roles: current.data.roles })
    : NO_RIGHTS), [current.status, current.data, userId, ownerId, closed])

  return { status: current.status, data: current.data, error: current.error, refreshing, busy, caps, db: planningDb, userId, refresh, perform }
}
