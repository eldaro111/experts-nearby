'use client'

import { UiText } from '@/components/LocaleProvider'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, CornerUpLeft, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppMessage } from '@/lib/appFeedback'
import {
  CHAT_PAGE_SIZE,
  anchoredScrollTop,
  arrivedFromOthers,
  isNearBottom,
  isSendKey,
  mergeMessages,
  pendingOnly,
  type OutgoingMessage,
} from '@/lib/projectChat'
import styles from './ProjectChat.module.css'

import type { ProjectMember, ProjectMessage } from './types'

// Same table protocol as before: rows of project_messages / project_message_hidden under RLS.
// The table is not in the Realtime publication: the chat reads again on open, when the window regains
// focus or becomes visible, and every 30 s while it is open. No typing/read/online indicators exist.
const REFRESH_MS = 30_000
const SEND_TIMEOUT_MS = 15_000

interface ProjectChatProps {
  projectId: string
  currentUserId: string | null | undefined
  members: ProjectMember[]
}

type PendingScroll =
  | { kind: 'bottom'; smooth: boolean }
  | { kind: 'anchor'; scrollTop: number; scrollHeight: number }
  | { kind: 'message'; id: string }

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const formatMoment = (value: string, today: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === today
  return date.toLocaleString('ru-RU', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)))

export function ProjectChat({ projectId, currentUserId, members }: ProjectChatProps) {
  const [messages, setMessages] = useState<ProjectMessage[]>([])
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [hasOlder, setHasOlder] = useState(false)
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([])
  // Messages that arrived while the chat is open play the entrance animation once; history never does.
  const [fresh, setFresh] = useState<string[]>([])
  const [unseen, setUnseen] = useState<string[]>([])
  const [atBottom, setAtBottom] = useState(true)
  const [sessionChanged, setSessionChanged] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [today] = useState(() => new Date().toDateString())

  const [newMessageBody, setNewMessageBody] = useState('')
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editMessageBody, setEditMessageBody] = useState('')
  const [savingMessageEditId, setSavingMessageEditId] = useState<string | null>(null)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const generation = useRef(0)
  const stickToBottom = useRef(true)
  // A programmatic smooth scroll to the bottom is under way: its intermediate positions are not the
  // person leaving the bottom. Their own wheel, touch or keys end it.
  const autoScrolling = useRef(false)
  const pendingScroll = useRef<PendingScroll | null>(null)
  const messagesRef = useRef<ProjectMessage[]>([])
  const readyRef = useRef(false)
  const inFlight = useRef(new Set<string>())
  const composing = useRef(false)

  /** All message list updates go through here, so async merges always start from the latest list. */
  const commit = useCallback((next: ProjectMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }, [])

  const readHidden = useCallback(async (ids: string[]) => {
    if (!currentUserId || ids.length === 0) return { ids: [] as string[], error: null }
    const { data, error } = await supabase
      .from('project_message_hidden')
      .select('message_id')
      .eq('user_id', currentUserId)
      .in('message_id', ids)
    return { ids: ((data || []) as { message_id: string }[]).map((row) => row.message_id), error }
  }, [currentUserId])

  const readLatest = useCallback(() => supabase
    .from('project_messages')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE_SIZE), [projectId])

  // First page. The component is keyed by project and account (FloatingProjectChat), and every answer
  // is checked against the generation, so a late answer of a previous session is dropped.
  useEffect(() => {
    generation.current += 1
    const my = generation.current
    const load = async () => {
      const { data, error } = await readLatest()
      if (my !== generation.current) return
      if (error) {
        logAppError('Ошибка загрузки обсуждения:', error)
        setLoadState('error')
        return
      }
      const rows = ((data || []) as ProjectMessage[]).reverse()
      const hidden = await readHidden(rows.map((row) => row.id))
      if (my !== generation.current) return
      if (hidden.error) logAppError('Ошибка загрузки скрытых сообщений:', hidden.error)
      pendingScroll.current = { kind: 'bottom', smooth: false }
      commit(mergeMessages([], rows))
      setHiddenMessageIds(hidden.ids)
      setHasOlder(rows.length === CHAT_PAGE_SIZE)
      readyRef.current = true
      setLoadState('ready')
    }
    void load()
    return () => { generation.current += 1 }
  }, [commit, readHidden, readLatest])

  /** Reads the latest page again and merges it; new messages of others below the view are counted. */
  const refresh = useCallback(async () => {
    if (!readyRef.current) return
    const my = generation.current
    const { data, error } = await readLatest()
    if (my !== generation.current || error) {
      if (error) logAppError('Ошибка обновления обсуждения:', error)
      return
    }
    const rows = ((data || []) as ProjectMessage[]).reverse()
    const previous = messagesRef.current
    const known = new Set(previous.map((message) => message.id))
    const added = rows.filter((row) => !known.has(row.id))
    const hidden = await readHidden(added.map((row) => row.id))
    if (my !== generation.current) return
    const next = mergeMessages(messagesRef.current, rows)
    const arrived = arrivedFromOthers(previous, next, currentUserId).filter((message) => !hidden.ids.includes(message.id))
    if (hidden.ids.length) setHiddenMessageIds((ids) => [...new Set([...ids, ...hidden.ids])])
    if (added.length) setFresh((ids) => [...ids, ...added.map((row) => row.id)])
    if (arrived.length) {
      if (stickToBottom.current) pendingScroll.current = { kind: 'bottom', smooth: true }
      else setUnseen((ids) => [...new Set([...ids, ...arrived.map((message) => message.id)])])
      setAnnouncement(`Новых сообщений: ${arrived.length}`)
    }
    commit(next)
  }, [commit, currentUserId, readHidden, readLatest])

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const timer = window.setInterval(onVisible, REFRESH_MS)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // Another tab may sign out or sign in as someone else: hide this session's messages at once.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user?.id ?? null) === (currentUserId ?? null)) return
      generation.current += 1
      readyRef.current = false
      commit([])
      setOutgoing([])
      setUnseen([])
      setHiddenMessageIds([])
      setSessionChanged(true)
    })
    return () => data.subscription.unsubscribe()
  }, [commit, currentUserId])

  const loadOlder = async () => {
    const oldest = messagesRef.current[0]
    if (!oldest || olderState === 'loading') return
    const my = generation.current
    setOlderState('loading')
    const { data, error } = await supabase
      .from('project_messages')
      .select('*')
      .eq('project_id', projectId)
      .lte('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(CHAT_PAGE_SIZE)
    if (my !== generation.current) return
    if (error) {
      logAppError('Ошибка загрузки предыдущих сообщений:', error)
      setOlderState('error')
      return
    }
    const rows = ((data || []) as ProjectMessage[]).reverse()
    const known = new Set(messagesRef.current.map((message) => message.id))
    const added = rows.filter((row) => !known.has(row.id))
    const hidden = await readHidden(added.map((row) => row.id))
    if (my !== generation.current) return
    const element = scrollRef.current
    // Keep the message being read in place: older messages grow the content above it.
    if (element) pendingScroll.current = { kind: 'anchor', scrollTop: element.scrollTop, scrollHeight: element.scrollHeight }
    if (hidden.ids.length) setHiddenMessageIds((ids) => [...new Set([...ids, ...hidden.ids])])
    commit(mergeMessages(messagesRef.current, added))
    setHasOlder(rows.length === CHAT_PAGE_SIZE && added.length > 0)
    setOlderState('idle')
  }

  // Scroll after the new list is on screen: to the bottom, to a message, or back to the read position.
  useLayoutEffect(() => {
    const element = scrollRef.current
    const action = pendingScroll.current
    if (!element || !action) return
    pendingScroll.current = null
    if (action.kind === 'anchor') {
      element.scrollTop = anchoredScrollTop(action, element.scrollHeight)
    } else if (action.kind === 'bottom') {
      stickToBottom.current = true
      autoScrolling.current = action.smooth && !prefersReducedMotion()
      element.scrollTo({ top: element.scrollHeight, behavior: action.smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
    } else {
      element.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(action.id)}"]`)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
  })

  // Content or panel size changes (long text wrapping, an edit, the mobile keyboard): stay at the
  // bottom only if the person was there.
  useEffect(() => {
    const element = scrollRef.current
    const list = listRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const keep = () => { if (stickToBottom.current) element.scrollTop = element.scrollHeight }
    const observer = new ResizeObserver(keep)
    observer.observe(element)
    if (list) observer.observe(list)
    window.visualViewport?.addEventListener('resize', keep)
    return () => {
      observer.disconnect()
      window.visualViewport?.removeEventListener('resize', keep)
    }
  }, [loadState])

  const onScroll = () => {
    const element = scrollRef.current
    if (!element) return
    if (autoScrolling.current) {
      if (!isNearBottom(element)) return
      autoScrolling.current = false
    }
    const bottom = isNearBottom(element)
    stickToBottom.current = bottom
    if (bottom !== atBottom) setAtBottom(bottom)
    if (bottom && unseen.length) setUnseen([])
  }

  const scrollToMessage = (id: string) => {
    scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  const showNew = () => {
    const first = unseen[0]
    setUnseen([])
    if (first) scrollToMessage(first)
    else scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'
    return members.find((m) => m.user_id === userId)?.display_name || 'Неизвестный участник'
  }

  const getMessageById = (messageId: string | null) => {
    if (!messageId) return null
    return messages.find((m) => m.id === messageId) || null
  }

  const confirmSent = (row: ProjectMessage) => {
    commit(mergeMessages(messagesRef.current, [row]))
    setOutgoing((list) => list.filter((item) => item.id !== row.id))
    setAnnouncement('Сообщение отправлено.')
  }

  const failSend = (id: string, error: string) => {
    setOutgoing((list) => list.map((item) => (item.id === id ? { ...item, status: 'failed', error } : item)))
    setAnnouncement(`Сообщение не отправлено. ${error}`)
  }

  /** The id is chosen here, so a repeat after a lost answer can only find, never duplicate, the row. */
  const deliver = async (item: OutgoingMessage) => {
    if (inFlight.current.has(item.id)) return
    inFlight.current.add(item.id)
    const my = generation.current
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
    try {
      const { data, error } = await supabase
        .from('project_messages')
        .insert({ id: item.id, project_id: projectId, author_id: item.author_id, body: item.body, parent_message_id: item.parent_message_id })
        .select('*')
        .abortSignal(controller.signal)
        .single()
      if (my !== generation.current) return
      if (!error && data) { confirmSent(data as ProjectMessage); return }
      const code = String(error?.code ?? '')
      // 23505: an earlier attempt with this id was saved. No code: network or timeout — outcome unknown.
      if (code === '23505' || !code) {
        const check = await supabase.from('project_messages').select('*').eq('id', item.id).maybeSingle()
        if (my !== generation.current) return
        if (check.data) { confirmSent(check.data as ProjectMessage); return }
        failSend(item.id, check.error
          ? 'Не удалось проверить, дошло ли сообщение. Повторите отправку — дубль не появится.'
          : 'Нет связи с сервером. Текст сохранён — повторите отправку.')
        return
      }
      logAppError('Ошибка отправки сообщения:', error)
      failSend(item.id, `Сервер не принял сообщение: ${error?.message || 'ошибка'}`)
    } finally {
      window.clearTimeout(timer)
      inFlight.current.delete(item.id)
    }
  }

  const handleSendMessage = () => {
    const body = newMessageBody.trim()
    if (!body || sessionChanged) return
    if (!currentUserId) {
      showAppMessage('Пользователь не найден.')
      return
    }
    const item: OutgoingMessage = {
      id: newId(),
      author_id: currentUserId,
      body,
      parent_message_id: replyToMessageId,
      created_at: new Date().toISOString(),
      status: 'sending',
      error: null,
    }
    setOutgoing((list) => [...list, item])
    setFresh((ids) => [...ids, item.id])
    setNewMessageBody('')
    setReplyToMessageId(null)
    // The person's own message is always brought into view.
    pendingScroll.current = { kind: 'bottom', smooth: true }
    void deliver(item)
  }

  const retrySend = (item: OutgoingMessage) => {
    if (sessionChanged) return
    setOutgoing((list) => list.map((entry) => (entry.id === item.id ? { ...entry, status: 'sending', error: null } : entry)))
    void deliver({ ...item, status: 'sending', error: null })
  }

  /** Puts a failed text back into the field (the bubble is removed; nothing was saved). */
  const editFailed = (item: OutgoingMessage) => {
    setOutgoing((list) => list.filter((entry) => entry.id !== item.id))
    setNewMessageBody((current) => (current.trim() ? `${current}\n${item.body}` : item.body))
    setReplyToMessageId(item.parent_message_id)
    composerRef.current?.focus()
  }

  const discardFailed = (item: OutgoingMessage) => setOutgoing((list) => list.filter((entry) => entry.id !== item.id))

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && replyToMessageId) {
      // Handled here: the floating panel ignores an Escape that is already used (defaultPrevented).
      event.preventDefault()
      event.stopPropagation()
      setReplyToMessageId(null)
      return
    }
    if (composing.current) return
    if (isSendKey({ key: event.key, shiftKey: event.shiftKey, altKey: event.altKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode })) {
      event.preventDefault()
      handleSendMessage()
    }
  }

  const startReplyToMessage = (messageId: string) => {
    setReplyToMessageId(messageId)
    composerRef.current?.focus()
  }

  const startEditMessage = (message: ProjectMessage) => {
    if (message.author_id !== currentUserId) {
      showAppMessage('Редактировать можно только свои сообщения.')
      return
    }
    if (message.is_deleted_for_all) {
      showAppMessage('Удалённое сообщение нельзя редактировать.')
      return
    }
    setEditingMessageId(message.id)
    setEditMessageBody(message.body)
  }

  const cancelEditMessage = () => {
    setEditingMessageId(null)
    setEditMessageBody('')
  }

  const handleSaveMessageEdit = async (messageId: string) => {
    const body = editMessageBody.trim()
    if (!body) {
      showAppMessage('Сообщение не может быть пустым.')
      return
    }
    const my = generation.current
    setSavingMessageEditId(messageId)
    const { data, error } = await supabase
      .from('project_messages')
      .update({ body, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('author_id', currentUserId)
      .eq('is_deleted_for_all', false)
      .select('*')
    if (my !== generation.current) return
    setSavingMessageEditId(null)
    if (error) {
      logAppError('Ошибка редактирования сообщения:', error)
      showAppMessage('Ошибка редактирования сообщения: ' + error.message)
      return
    }
    if (!data || data.length === 0) {
      showAppMessage('Не удалось отредактировать сообщение.')
      return
    }
    cancelEditMessage()
    commit(mergeMessages(messagesRef.current, data as ProjectMessage[]))
  }

  const handleDeleteMessageForEveryone = async (messageId: string) => {
    const ok = window.confirm('Удалить сообщение для всех?')
    if (!ok) return
    const my = generation.current
    setDeletingMessageId(messageId)
    const { data, error } = await supabase
      .from('project_messages')
      .update({ body: '', is_deleted_for_all: true, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('author_id', currentUserId)
      .select('*')
    if (my !== generation.current) return
    setDeletingMessageId(null)
    if (error) {
      logAppError('Ошибка удаления сообщения для всех:', error)
      showAppMessage('Ошибка удаления сообщения для всех: ' + error.message)
      return
    }
    if (!data || data.length === 0) {
      showAppMessage('Не удалось удалить сообщение для всех.')
      return
    }
    if (replyToMessageId === messageId) setReplyToMessageId(null)
    if (editingMessageId === messageId) cancelEditMessage()
    commit(mergeMessages(messagesRef.current, data as ProjectMessage[]))
  }

  const handleDeleteMessageForMe = async (messageId: string) => {
    if (!currentUserId) return
    const ok = window.confirm('Скрыть сообщение только для себя?')
    if (!ok) return
    const my = generation.current
    setDeletingMessageId(messageId)
    const { error } = await supabase.from('project_message_hidden').insert([{ message_id: messageId, user_id: currentUserId }])
    if (my !== generation.current) return
    setDeletingMessageId(null)
    // 23505: already hidden (for example in another tab) — the result is the same.
    if (error && error.code !== '23505') {
      logAppError('Ошибка скрытия сообщения:', error)
      showAppMessage('Ошибка скрытия сообщения: ' + error.message)
      return
    }
    if (replyToMessageId === messageId) setReplyToMessageId(null)
    setHiddenMessageIds((ids) => (ids.includes(messageId) ? ids : [...ids, messageId]))
  }

  const visibleMessages = messages.filter((message) => !hiddenMessageIds.includes(message.id))
  const pending = pendingOnly(outgoing, messages)
  // One keyed list: a confirmed message keeps the element of its pending bubble (same id), so the
  // entrance animation is not replayed and nothing flickers.
  const items: ({ kind: 'message'; message: ProjectMessage } | { kind: 'pending'; item: OutgoingMessage })[] = [
    ...visibleMessages.map((message) => ({ kind: 'message' as const, message })),
    ...pending.map((item) => ({ kind: 'pending' as const, item })),
  ]
  const replyMessage = getMessageById(replyToMessageId)

  const quote = (parent: ProjectMessage | null, mine: boolean) => parent && (
    <button
      type="button"
      className={`${styles.quote} ${mine ? styles.quoteMine : ''}`}
      onClick={() => scrollToMessage(parent.id)}
      aria-label={`Перейти к сообщению ${getMemberName(parent.author_id)}`}
    >
      <span className={styles.quoteAuthor}><CornerUpLeft size={13} aria-hidden="true" /> Ответ на: {getMemberName(parent.author_id)}</span>
      <span className={styles.quoteText}>{parent.is_deleted_for_all ? 'Сообщение удалено' : parent.body}</span>
    </button>
  )

  const renderPending = (item: OutgoingMessage) => (
    <article
      key={item.id}
      data-message-id={item.id}
      data-status={item.status}
      data-fresh={fresh.includes(item.id) || undefined}
      className={`${styles.row} ${styles.mine} ${item.status === 'failed' ? styles.failed : styles.sending} ${fresh.includes(item.id) ? styles.enter : ''}`}
      aria-label={item.status === 'failed' ? 'Сообщение не отправлено' : 'Сообщение отправляется'}
    >
      <div className={styles.bubble}>
        {quote(getMessageById(item.parent_message_id), item.status !== 'failed')}
        <p className={styles.body}>{item.body}</p>
        {item.status === 'sending' ? (
          <p className={styles.status} role="status"><span className={styles.dot} aria-hidden="true" />Отправляется…</p>
        ) : (
          <>
            <p className={styles.status} role="alert">Не отправлено. {item.error}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={() => retrySend(item)}><RotateCcw size={14} aria-hidden="true" /> Повторить отправку</button>
              <button type="button" className={styles.action} onClick={() => editFailed(item)}>Изменить текст</button>
              <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => discardFailed(item)}>Удалить черновик</button>
            </div>
          </>
        )}
      </div>
    </article>
  )

  return (
    <div className={`project-chat ${styles.chat}`}>
      <div className={`project-chat-heading ${styles.heading}`}>
        <h2 className="text-xl font-semibold">Обсуждение проекта</h2>
        <p className="text-sm text-gray-500 mt-1">Внутренний чат команды проекта.</p>
      </div>

      <div className={styles.viewport}>
        <div
          ref={scrollRef}
          className={`project-chat-messages ${styles.scroll}`}
          onScroll={onScroll}
          onWheel={() => { autoScrolling.current = false }}
          onTouchStart={() => { autoScrolling.current = false }}
          onKeyDown={() => { autoScrolling.current = false }}
          role="log"
          aria-label="Сообщения чата"
          aria-busy={loadState === 'loading' || undefined}
          tabIndex={0}
        >
          {sessionChanged ? (
            <div className={styles.state} role="alert">
              <p>Аккаунт изменился в другой вкладке или Вы вышли. Сообщения прежней сессии скрыты — обновите страницу.</p>
              <button type="button" className={styles.stateButton} onClick={() => window.location.reload()}>Обновить страницу</button>
            </div>
          ) : loadState === 'loading' ? (
            <div className={styles.state} role="status">Загружаем сообщения…</div>
          ) : loadState === 'error' ? (
            <div className={styles.state} role="alert">
              <p>Не удалось загрузить сообщения.</p>
              <button type="button" className={styles.stateButton} onClick={() => window.location.reload()}>Обновить страницу</button>
            </div>
          ) : (
            <div ref={listRef} className={styles.list}>
              {hasOlder && (
                <div className={styles.older}>
                  <button type="button" className={styles.olderButton} disabled={olderState === 'loading'} onClick={() => void loadOlder()}>
                    {olderState === 'loading' ? 'Загружаем…' : olderState === 'error' ? 'Не удалось загрузить — повторить' : 'Показать предыдущие сообщения'}
                  </button>
                </div>
              )}
              {visibleMessages.length === 0 && pending.length === 0 && <div className={styles.state}>Пока сообщений нет.</div>}

              {items.map((entry) => {
                if (entry.kind === 'pending') return renderPending(entry.item)
                const message = entry.message
                const isMine = message.author_id === currentUserId
                const parentMessage = getMessageById(message.parent_message_id)
                const author = getMemberName(message.author_id)
                return (
                  <article
                    key={message.id}
                    data-message-id={message.id}
                    data-fresh={fresh.includes(message.id) || undefined}
                    className={`${styles.row} ${isMine ? styles.mine : styles.theirs} ${fresh.includes(message.id) ? styles.enter : ''}`}
                    aria-label={`${author}, ${formatMoment(message.created_at, today)}`}
                  >
                    <div className={styles.bubble}>
                      <div className={styles.meta}>
                        <span className={styles.author}>{author}</span>
                        <time dateTime={message.created_at}>{formatMoment(message.created_at, today)}</time>
                        {message.edited_at && !message.is_deleted_for_all && <span>· изменено</span>}
                      </div>

                      {quote(parentMessage, isMine)}

                      {editingMessageId === message.id ? (
                        <div className={styles.editForm}>
                          <textarea
                            value={editMessageBody}
                            aria-label="Текст сообщения"
                            autoFocus
                            onChange={(e) => setEditMessageBody(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEditMessage() }
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void handleSaveMessageEdit(message.id) }
                            }}
                            className={styles.editInput}
                          />
                          <div className={styles.actions}>
                            <button type="button" className={styles.action} onClick={() => void handleSaveMessageEdit(message.id)} disabled={savingMessageEditId === message.id}>
                              <UiText text={savingMessageEditId === message.id ? 'Сохраняем...' : 'Сохранить'} />
                            </button>
                            <button type="button" className={styles.action} onClick={cancelEditMessage} disabled={savingMessageEditId === message.id}><UiText text="Отмена" /></button>
                          </div>
                        </div>
                      ) : message.is_deleted_for_all ? (
                        <p className={`${styles.body} ${styles.deleted}`}>Сообщение удалено</p>
                      ) : (
                        <p className={styles.body}>{message.body}</p>
                      )}

                      {editingMessageId !== message.id && (
                        <div className={styles.actions} role="group" aria-label={`Действия с сообщением: ${author}`}>
                          {!message.is_deleted_for_all && (
                            <button type="button" className={styles.action} onClick={() => startReplyToMessage(message.id)}>Ответить</button>
                          )}
                          {isMine && !message.is_deleted_for_all && (
                            <button type="button" className={styles.action} onClick={() => startEditMessage(message)}>Редактировать</button>
                          )}
                          {isMine && !message.is_deleted_for_all && (
                            <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => void handleDeleteMessageForEveryone(message.id)} disabled={deletingMessageId === message.id}>
                              {deletingMessageId === message.id ? 'Удаляем...' : 'Удалить для всех'}
                            </button>
                          )}
                          <button type="button" className={`${styles.action} ${styles.danger}`} onClick={() => void handleDeleteMessageForMe(message.id)} disabled={deletingMessageId === message.id}>
                            Удалить для себя
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        {unseen.length > 0 && !atBottom && (
          <button type="button" className={styles.newBadge} onClick={showNew}>
            <ArrowDown size={16} aria-hidden="true" /> Новые сообщения ({unseen.length})
          </button>
        )}
        <div className="sr-only" aria-live="polite">{announcement}</div>
      </div>

      <div className={styles.composer}>
        {replyToMessageId && (
          <div className={styles.replyBox}>
            <div className="min-w-0">
              <div className={styles.replyTitle}>Ответ на сообщение</div>
              {!replyMessage ? (
                <div className={styles.replyText}>Сообщение не найдено.</div>
              ) : (
                <div className={styles.replyText}>
                  <b>{getMemberName(replyMessage.author_id)}:</b>{' '}
                  {replyMessage.is_deleted_for_all ? 'Сообщение удалено' : replyMessage.body}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setReplyToMessageId(null)} className={styles.replyCancel}>Отменить</button>
          </div>
        )}

        <div className={styles.composerRow}>
          <textarea
            ref={composerRef}
            aria-label="Сообщение команде"
            aria-describedby="project-chat-keys"
            placeholder="Напишите сообщение для команды..."
            value={newMessageBody}
            disabled={sessionChanged}
            onChange={(e) => setNewMessageBody(e.target.value)}
            onKeyDown={onComposerKeyDown}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
            onFocus={() => { const element = scrollRef.current; if (element && stickToBottom.current) element.scrollTop = element.scrollHeight }}
            className={styles.input}
            rows={2}
          />
          <button type="button" onClick={handleSendMessage} disabled={sessionChanged || !newMessageBody.trim()} className={styles.send}>
            Отправить
          </button>
        </div>
        <p id="project-chat-keys" className={styles.keys}>Enter — отправить, Shift+Enter — новая строка.</p>
      </div>
    </div>
  )
}
