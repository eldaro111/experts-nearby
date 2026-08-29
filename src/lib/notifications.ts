import { supabase } from '@/lib/supabaseClient'
import { logAppError } from '@/lib/appFeedback'

interface CreateNotificationInput {
  recipientId: string
  actorId: string
  projectId?: string | null
  type: string
  title: string
  body?: string | null
  href?: string | null
  payload?: Record<string, unknown>
}

type SecureNotificationRpcRow = {
  notification_id: string | null
  skipped: boolean
}

function normalizeRpcRow(value: unknown): SecureNotificationRpcRow | null {
  const row = Array.isArray(value) ? value[0] : value

  if (!row || typeof row !== 'object') {
    return null
  }

  const record = row as Record<string, unknown>

  return {
    notification_id:
      typeof record.notification_id === 'string'
        ? record.notification_id
        : null,
    skipped: record.skipped === true,
  }
}

export async function createNotification({
  recipientId,
  actorId,
  projectId = null,
  type,
  title,
  body = null,
  href = null,
  payload = {},
}: CreateNotificationInput) {
  const { data, error } = await supabase.rpc(
    'create_notification_secure',
    {
      p_recipient_id: recipientId,
      p_expected_actor_id: actorId,
      p_project_id: projectId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_href: href,
      p_payload: payload,
    }
  )

  if (error) {
    logAppError('Ошибка создания уведомления:', error)

    return {
      error,
      skipped: false,
      notificationId: null,
    }
  }

  const result = normalizeRpcRow(data)

  return {
    error: null,
    skipped: result?.skipped ?? false,
    notificationId: result?.notification_id ?? null,
  }
}