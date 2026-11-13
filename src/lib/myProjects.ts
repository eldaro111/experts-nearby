// Projects whose private workspace the signed-in user can open: own projects and projects where
// their application was accepted. Same sources as the dashboard; access itself is enforced by RLS.
import { supabase } from '@/lib/supabaseClient'

export type MyProject = {
  id: string
  title: string
  role: 'owner' | 'member'
  completedAt: string | null
  createdAt: string | null
}

type ListingRow = { id: string; title: string | null; created_by: string; created_at: string | null; completed_at?: string | null }

const COLUMNS = 'id,title,created_by,created_at,completed_at'
const LIMIT = 50

export async function loadMyProjects(userId: string): Promise<{ projects: MyProject[]; error: string | null }> {
  const [owned, accepted] = await Promise.all([
    supabase.from('listings').select(COLUMNS).eq('created_by', userId).order('created_at', { ascending: false }).limit(LIMIT),
    supabase.from('applications').select('listing_id').eq('user_id', userId).eq('status', 'accepted').limit(LIMIT),
  ])
  if (owned.error || accepted.error) {
    return { projects: [], error: (owned.error || accepted.error)?.message || 'Не удалось загрузить проекты.' }
  }

  const ownedRows = (owned.data || []) as ListingRow[]
  const ownedIds = new Set(ownedRows.map((row) => row.id))
  const memberIds = [...new Set(((accepted.data || []) as { listing_id: string }[]).map((row) => row.listing_id))]
    .filter((id) => id && !ownedIds.has(id))

  let memberRows: ListingRow[] = []
  if (memberIds.length > 0) {
    const member = await supabase.from('listings').select(COLUMNS).in('id', memberIds)
    if (member.error) return { projects: [], error: member.error.message || 'Не удалось загрузить проекты.' }
    memberRows = (member.data || []) as ListingRow[]
  }

  const toProject = (row: ListingRow, role: MyProject['role']): MyProject => ({
    id: row.id,
    title: row.title?.trim() || 'Проект без названия',
    role,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at ?? null,
  })
  const projects = [...ownedRows.map((row) => toProject(row, 'owner')), ...memberRows.map((row) => toProject(row, 'member'))]
    // Active projects first, then newest.
    .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || (b.createdAt || '').localeCompare(a.createdAt || ''))
  return { projects, error: null }
}

// The «current project» is a convenience of this browser only (which project the home page shortcuts
// open). It is not an access right: the value is always checked against the loaded project list.
const storageKey = (userId: string) => `experts-current-project:${userId}`

export function readCurrentProjectId(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId)) || null
  } catch {
    return null
  }
}

export function rememberCurrentProject(userId: string, projectId: string | null) {
  try {
    if (projectId) window.localStorage.setItem(storageKey(userId), projectId)
    else window.localStorage.removeItem(storageKey(userId))
  } catch {
    // Storage may be unavailable (private mode); the picker is shown again next time.
  }
}
