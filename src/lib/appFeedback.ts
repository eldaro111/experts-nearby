export type AppFeedbackTone = 'success' | 'error' | 'warning' | 'info'

export interface AppFeedbackPayload {
  id: string
  message: string
  tone: AppFeedbackTone
  durationMs: number
}

const APP_FEEDBACK_EVENT = 'experts-nearby:feedback'
const pendingFeedback: AppFeedbackPayload[] = []
let feedbackHostReady = false

function createFeedbackId() {
  if (
    typeof globalThis !== 'undefined' &&
    'crypto' in globalThis &&
    typeof globalThis.crypto?.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readErrorText(error: unknown): string {
  if (typeof error === 'string') return error

  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
      status?: unknown
      statusText?: unknown
    }

    const parts = [
      candidate.message,
      candidate.details,
      candidate.hint,
      candidate.code,
      candidate.status,
      candidate.statusText,
    ]
      .filter((value) => value !== null && value !== undefined)
      .map(String)
      .filter(Boolean)

    if (parts.length > 0) {
      return parts.join(' · ')
    }

    try {
      const json = JSON.stringify(error)
      if (json && json !== '{}') return json
    } catch {
      // Игнорируем ошибку сериализации.
    }
  }

  return ''
}

function replaceNetworkFailure(message: string) {
  const networkPattern =
    /failed to fetch|networkerror|network request failed|fetch failed|load failed|err_connection|err_network|err_name_not_resolved|connection reset|connection refused/i

  if (!networkPattern.test(message)) return message

  const separatorIndex = message.search(/:\s*/)
  const prefix =
    separatorIndex > 0
      ? message.slice(0, separatorIndex).trim()
      : ''

  const normalized =
    'Сервис временно недоступен. Проверьте интернет, VPN и блокировщики, затем повторите попытку.'

  return prefix ? `${prefix}: ${normalized}` : normalized
}

export function getAppErrorMessage(
  error: unknown,
  fallback = 'Не удалось выполнить действие.'
) {
  const raw = replaceNetworkFailure(readErrorText(error).trim())

  if (!raw) return fallback

  const normalized = raw.toLowerCase()

  if (
    normalized.includes('jwt expired') ||
    normalized.includes('refresh token') ||
    normalized.includes('invalid claim') ||
    normalized.includes('not authenticated')
  ) {
    return 'Сессия истекла. Войдите в аккаунт повторно.'
  }

  if (
    normalized.includes('permission denied') ||
    normalized.includes('row-level security') ||
    normalized.includes('violates row-level security') ||
    normalized.includes('42501') ||
    normalized.includes('pgrst301')
  ) {
    return 'Недостаточно прав для этого действия. Обновите страницу и проверьте доступ к проекту.'
  }

  if (
    normalized.includes('duplicate key') ||
    normalized.includes('23505') ||
    normalized.includes('already exists')
  ) {
    return 'Такая запись уже существует. Обновите страницу перед повторной попыткой.'
  }

  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('429') ||
    normalized.includes('over_email_send_rate_limit')
  ) {
    return 'Слишком много запросов. Подождите немного и повторите попытку.'
  }

  if (
    normalized.includes('invalid input syntax for type uuid') ||
    normalized.includes('22p02')
  ) {
    return 'Получены некорректные данные. Обновите страницу и повторите действие.'
  }

  if (
    normalized.includes('statement timeout') ||
    normalized.includes('57014') ||
    normalized.includes('timeout')
  ) {
    return 'Сервер не успел ответить. Повторите действие через несколько секунд.'
  }

  return raw
}

function inferTone(message: string): AppFeedbackTone {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('ошиб') ||
    normalized.includes('не удалось') ||
    normalized.includes('недоступен') ||
    normalized.includes('сбой') ||
    normalized.includes('истекла')
  ) {
    return 'error'
  }

  if (
    normalized.includes('успеш') ||
    normalized.includes('сохранён') ||
    normalized.includes('сохранено') ||
    normalized.includes('создан') ||
    normalized.includes('обновлён') ||
    normalized.includes('обновлено') ||
    normalized.includes('отправлен') ||
    normalized.includes('принят') ||
    normalized.includes('добавлен') ||
    normalized.includes('удалён') ||
    normalized.includes('удалено') ||
    normalized.includes('закрыт') ||
    normalized.includes('покинули')
  ) {
    return 'success'
  }

  if (
    normalized.includes('введите') ||
    normalized.includes('выберите') ||
    normalized.includes('нельзя') ||
    normalized.includes('только') ||
    normalized.includes('проверьте') ||
    normalized.includes('требуется')
  ) {
    return 'warning'
  }

  return 'info'
}

function emitFeedback(payload: AppFeedbackPayload) {
  if (typeof window === 'undefined' || !feedbackHostReady) {
    pendingFeedback.push(payload)
    return
  }

  window.dispatchEvent(
    new CustomEvent<AppFeedbackPayload>(APP_FEEDBACK_EVENT, {
      detail: payload,
    })
  )
}

export function showAppMessage(
  message: unknown,
  tone?: AppFeedbackTone,
  durationMs = 5000
) {
  const text = replaceNetworkFailure(readErrorText(message).trim())

  if (!text) return

  const resolvedTone = tone ?? inferTone(text)
  const resolvedMessage =
    resolvedTone === 'error'
      ? getAppErrorMessage(message, text)
      : text

  emitFeedback({
    id: createFeedbackId(),
    message: resolvedMessage,
    tone: resolvedTone,
    durationMs,
  })
}

export function showAppError(
  error: unknown,
  fallback = 'Не удалось выполнить действие.',
  context?: string
) {
  const message = getAppErrorMessage(error, fallback)
  logAppError(context ?? fallback, error)
  showAppMessage(message, 'error', 7000)
}

export function logAppError(context: unknown, error?: unknown) {
  const label =
    typeof context === 'string' && context.trim()
      ? context.trim()
      : 'Ошибка приложения'

  const details =
    error === undefined
      ? readErrorText(context)
      : readErrorText(error)

  // console.error в Next.js development открывает красный error overlay
  // даже для уже обработанных ошибок. Предупреждение сохраняет диагностику,
  // но не ломает пользовательский сценарий.
  if (details && details !== label) {
    console.warn(`[app] ${label}`, details)
  } else {
    console.warn(`[app] ${label}`)
  }
}

export function setAppFeedbackHostReady(ready: boolean) {
  feedbackHostReady = ready
}

export function drainPendingAppFeedback() {
  return pendingFeedback.splice(0, pendingFeedback.length)
}

export const appFeedbackEventName = APP_FEEDBACK_EVENT
