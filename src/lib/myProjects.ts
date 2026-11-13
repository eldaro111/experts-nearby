// Projects whose private workspace the signed-in user can open: own projects and projects where
// their application was accepted. Same sources and rights as the work centre (RLS on listings and
// applications); nothing new is exposed.
//
// Loaded page by page, never all at once:
// - own projects: listings with created_by = user, ordered on the server (active first, then newest),
//   title search on the server;
// - participation: accepted applications page by page, then their listings. There is no foreign key
//   applications → listings, so the server cannot filter participation by title in one request; a
//   title search scans accepted applications in bounded batches and can be continued.
import { supabase } from '@/lib/supabaseClient'

export type MyProject = {
  id: string
  title: string
  role: 'owner' | 'member'
  completedAt: string | null
  createdAt: string | null
}

export type ProjectPage = {
  items: MyProject[]
  /** Offset for «Показать ещё»; null when there is nothing more. */
  next: number | null
  error: string | null
}

type ListingRow = { id: string; title: string | null; created_by: string; created_at: string | null; completed_at?: string | null }

const COLUMNS = 'id,title,created_by,created_at,completed_at'
export const PROJECT_PAGE_SIZE = 20
/** Accepted applications read per request during a title search of participation. */
const SEARCH_BATCH = 100
/** Requests per «Искать дальше» step, so one click never scans everything. */
const SEARCH_BATCHES_PER_STEP = 5

const toProject = (row: ListingRow, role: MyProject['role']): MyProject => ({
  id: row.id,
  title: row.title?.trim() || 'Проект без названия',
  role,
  completedAt: row.completed_at ?? null,
  createdAt: row.created_at ?? null,
})

const failure = (error: { message?: string } | null): ProjectPage => ({
  items: [],
  next: null,
  error: error?.message?.trim() || 'Не удалось загрузить проекты.',
})

/** `%`, `_` and `\` typed by a person are searched literally. */
const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

/** One page of own projects; one row more than the page is read to know whether more exist. */
export async function loadOwnedProjects(userId: string, { offset = 0, query = '' }: { offset?: number; query?: string } = {}): Promise<ProjectPage> {
  let request = supabase.from('listings').select(COLUMNS).eq('created_by', userId)
  const text = query.trim()
  if (text) request = request.ilike('title', likePattern(text))
  const { data, error } = await request
    .order('completed_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + PROJECT_PAGE_SIZE)
  if (error) return failure(error)
  const rows = (data || []) as ListingRow[]
  return {
    items: rows.slice(0, PROJECT_PAGE_SIZE).map((row) => toProject(row, 'owner')),
    next: rows.length > PROJECT_PAGE_SIZE ? offset + PROJECT_PAGE_SIZE : null,
    error: null,
  }
}

async function acceptedListingIds(userId: string, offset: number, count: number) {
  const { data, error } = await supabase
    .from('applications')
    .select('listing_id')
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + count - 1)
  if (error) return { ids: null, rows: 0, error }
  const rows = (data || []) as { listing_id: string | null }[]
  return { ids: [...new Set(rows.map((row) => row.listing_id).filter((id): id is string => Boolean(id)))], rows: rows.length, error: null }
}

/** Listings of `ids` in the order of `ids`; own projects and no longer readable listings are skipped. */
async function memberListings(userId: string, ids: string[], query: string) {
  if (ids.length === 0) return { items: [] as MyProject[], error: null }
  let request = supabase.from('listings').select(COLUMNS).in('id', ids)
  if (query) request = request.ilike('title', likePattern(query))
  const { data, error } = await request
  if (error) return { items: [] as MyProject[], error }
  const byId = new Map(((data || []) as ListingRow[]).map((row) => [row.id, row]))
  const items = ids
    .map((id) => byId.get(id))
    .filter((row): row is ListingRow => Boolean(row) && row!.created_by !== userId)
    .map((row) => toProject(row, 'member'))
  return { items, error: null }
}

/** One page of participation (newest accepted first), or one bounded step of a title search. */
export async function loadMemberProjects(userId: string, { offset = 0, query = '' }: { offset?: number; query?: string } = {}): Promise<ProjectPage> {
  const text = query.trim()
  if (!text) {
    const page = await acceptedListingIds(userId, offset, PROJECT_PAGE_SIZE + 1)
    if (page.error || !page.ids) return failure(page.error)
    const more = page.rows > PROJECT_PAGE_SIZE
    const listings = await memberListings(userId, page.ids.slice(0, PROJECT_PAGE_SIZE), '')
    if (listings.error) return failure(listings.error)
    return { items: listings.items, next: more ? offset + PROJECT_PAGE_SIZE : null, error: null }
  }

  const found: MyProject[] = []
  let cursor: number | null = offset
  for (let step = 0; step < SEARCH_BATCHES_PER_STEP && cursor !== null && found.length < PROJECT_PAGE_SIZE; step += 1) {
    const batch = await acceptedListingIds(userId, cursor, SEARCH_BATCH)
    if (batch.error || !batch.ids) return failure(batch.error)
    const listings = await memberListings(userId, batch.ids, text)
    if (listings.error) return failure(listings.error)
    found.push(...listings.items)
    cursor = batch.rows < SEARCH_BATCH ? null : cursor + SEARCH_BATCH
  }
  return { items: found, next: cursor, error: null }
}

/** One project if the user can open its workspace: owner or accepted participant; otherwise null. */
export async function loadAccessibleProject(userId: string, projectId: string): Promise<{ project: MyProject | null; error: string | null }> {
  const { data, error } = await supabase.from('listings').select(COLUMNS).eq('id', projectId).maybeSingle()
  if (error) return { project: null, error: error.message || 'Не удалось проверить проект.' }
  const row = data as ListingRow | null
  if (!row) return { project: null, error: null }
  if (row.created_by === userId) return { project: toProject(row, 'owner'), error: null }
  const membership = await supabase
    .from('applications')
    .select('id')
    .eq('listing_id', projectId)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .limit(1)
  if (membership.error) return { project: null, error: membership.error.message || 'Не удалось проверить проект.' }
  return { project: Array.isArray(membership.data) && membership.data.length > 0 ? toProject(row, 'member') : null, error: null }
}

/** Appends a page without duplicates (offset paging can repeat a row when data changes meanwhile). */
export function mergeProjects(current: MyProject[], page: MyProject[]): MyProject[] {
  const seen = new Set(current.map((project) => project.id))
  return [...current, ...page.filter((project) => !seen.has(project.id) && seen.add(project.id))]
}

// The «current project» is a convenience of this browser only (which project the home page shortcuts
// open). It is not an access right: the value is always checked with loadAccessibleProject.
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
