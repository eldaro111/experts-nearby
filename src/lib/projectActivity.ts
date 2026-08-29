/**
 * История проекта теперь создаётся серверными триггерами в той же
 * транзакции, что и изменение задачи, файла, вклада или отзыва.
 *
 * Функция оставлена как временный совместимый shim, чтобы существующие
 * компоненты не требовали массовой синхронной переделки. Переданные
 * клиентом title/body/type намеренно не записываются в БД.
 */

export interface CreateProjectActivityInput {
  projectId: string
  actorId: string | null | undefined
  type: string
  title: string
  body?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
}

export async function createProjectActivity(
  input: CreateProjectActivityInput
) {
  void input

  return {
    data: null,
    error: null,
    skipped: true,
  }
}
