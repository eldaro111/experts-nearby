// Keyset pagination for the existing table API. No new RPC or broader access.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectMessage } from '@/components/project/types'
import { CHAT_PAGE_SIZE, compareMessages } from './projectChat'

export type MessageCursor = Pick<ProjectMessage, 'created_at' | 'id'>
type Reader = Pick<SupabaseClient, 'from'>
const quoted = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

export async function readChatPage(db: Reader, projectId: string, before?: MessageCursor, floor?: MessageCursor) {
  let query = db.from('project_messages').select('*').eq('project_id', projectId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(CHAT_PAGE_SIZE)
  if (before) {
    const at = quoted(before.created_at), id = quoted(before.id)
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`)
  }
  if (floor) query = query.gte('created_at', floor.created_at)
  const { data, error } = await query
  if (error) throw error
  return (data || []) as ProjectMessage[] // newest first, with the exact timestamp from PostgreSQL
}

/** Re-read the entire loaded window, including edits/deletions and every arrival, not just 50 rows.
 * The first page bounds the head of this pass. A later arrival is picked up by the next invalidation.
 * Lower historical rows are left to the explicit "older" button. No offset can drift under inserts.
 */
export async function readChatWindow(db: Reader, projectId: string, floor: MessageCursor | undefined, alive: () => boolean) {
  const rows: ProjectMessage[] = []
  let cursor: MessageCursor | undefined
  do {
    if (!alive()) return null
    const page = await readChatPage(db, projectId, cursor, floor)
    if (!alive()) return null
    // Include the whole boundary timestamp, including a just-committed UUID sorting below floor.id.
    rows.push(...page)
    const last = page.at(-1)
    if (page.length < CHAT_PAGE_SIZE || !last) break
    if (cursor && compareMessages(last, cursor) >= 0) throw new Error('Chat cursor did not advance')
    cursor = last
  } while (true)
  return rows
}
