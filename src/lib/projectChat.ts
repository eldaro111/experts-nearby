// Pure helpers of the project chat (src/components/project/ProjectChat.tsx). No Supabase import.
//
// Server facts (baseline migration): project_messages rows are read/inserted/updated under RLS by
// project members; a guard trigger checks membership, replies within the project and non-empty text.
// The table is NOT in the supabase_realtime publication, so new messages of other members arrive only
// when the chat reads again (on open, on focus/visibility and periodically while open).
import type { ProjectMessage } from '@/components/project/types'

export const CHAT_PAGE_SIZE = 50
/** Pixels from the bottom that still count as «reading the latest messages». */
export const BOTTOM_THRESHOLD = 72

/** A message typed here that the server has not confirmed yet. Its id is the future row id. */
export interface OutgoingMessage {
  id: string
  author_id: string
  body: string
  parent_message_id: string | null
  created_at: string
  status: 'sending' | 'failed'
  /** Why it failed; the text itself is kept in `body`. */
  error: string | null
}

const time = (value: string) => {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

/** Chronological order; the id breaks ties so the order is the same on every client. */
export function compareMessages(a: Pick<ProjectMessage, 'created_at' | 'id'>, b: Pick<ProjectMessage, 'created_at' | 'id'>) {
  return time(a.created_at) - time(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * One copy per id. A newer copy from the server replaces the old one (edits, deletion for everyone),
 * so repeated reads, a lost-and-retried send or two quick clicks can never show a message twice.
 */
export function mergeMessages(current: ProjectMessage[], incoming: ProjectMessage[]): ProjectMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort(compareMessages)
}

/** Outgoing bubbles that are not on the server list yet (a confirmed row replaces its bubble). */
export function pendingOnly(outgoing: OutgoingMessage[], messages: ProjectMessage[]) {
  const known = new Set(messages.map((message) => message.id))
  return outgoing.filter((item) => !known.has(item.id))
}

export function isNearBottom(element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>, threshold = BOTTOM_THRESHOLD) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}

/**
 * Enter sends, Shift+Enter is a new line. While an input method is composing (Chinese, Japanese,
 * Korean, some Android keyboards), Enter confirms the composition and must not send.
 */
export function isSendKey(event: { key: string; shiftKey: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number }) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false
  if (event.isComposing || event.keyCode === 229) return false
  return true
}

/** Scroll position that keeps the same content in view after older messages were added above. */
export function anchoredScrollTop(before: { scrollTop: number; scrollHeight: number }, afterScrollHeight: number) {
  return before.scrollTop + (afterScrollHeight - before.scrollHeight)
}

/** New messages of other members that arrived below while the person reads older ones. */
export function arrivedFromOthers(previous: ProjectMessage[], next: ProjectMessage[], currentUserId: string | null | undefined) {
  const known = new Set(previous.map((message) => message.id))
  const last = previous.length ? previous[previous.length - 1] : null
  return next.filter((message) => !known.has(message.id) && message.author_id !== currentUserId && (!last || compareMessages(message, last) > 0))
}
