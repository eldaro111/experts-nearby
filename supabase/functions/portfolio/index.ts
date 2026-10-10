import { createClient } from 'npm:@supabase/supabase-js@2.87.1'

const LIMIT = 15 * 1024 * 1024
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST')
    return json({ error: 'Метод не поддерживается.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer '))
    return json({ error: 'Войдите в аккаунт.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!,
    anon = Deno.env.get('SUPABASE_ANON_KEY')!,
    service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (!url || !anon || !service)
    return json({ error: 'Сервис документов ещё не настроен.' }, 503)
  const viewer = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const {
    data: { user },
    error: authError,
  } = await viewer.auth.getUser(authorization.slice(7).trim())
  if (authError || !user)
    return json({ error: 'Сессия истекла. Войдите ещё раз.' }, 401)
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile) return json({ error: 'Сначала сохраните профиль.' }, 409)
  try {
    if (request.headers.get('Content-Type')?.includes('application/json')) {
      const text = await readLimited(request, 2048)
      const body = JSON.parse(new TextDecoder().decode(text))
      if (body.action !== 'delete' || typeof body.id !== 'string')
        return json({ error: 'Неверная операция.' }, 400)
      const { data: file, error } = await admin
        .from('portfolio_files')
        .select('id,storage_path')
        .eq('id', body.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (error || !file) return json({ error: 'Документ не найден.' }, 404)
      const { error: storageError } = await admin.storage
        .from('portfolio')
        .remove([file.storage_path])
      if (storageError)
        return json(
          { error: 'Не удалось удалить документ. Повторите попытку.' },
          503,
        )
      const { error: deleteError } = await admin
        .from('portfolio_files')
        .delete()
        .eq('id', file.id)
        .eq('user_id', user.id)
      if (deleteError)
        return json(
          {
            error: 'Не удалось обновить список документов. Повторите удаление.',
          },
          503,
        )
      return json({ ok: true })
    }
    const bytes = await readLimited(request, LIMIT + 64 * 1024)
    const form = await new Response(new Uint8Array(bytes).buffer, {
      headers: { 'Content-Type': request.headers.get('Content-Type') || '' },
    }).formData()
    const file = form.get('file')
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > LIMIT ||
      !/\.pdf$/i.test(file.name)
    )
      return json({ error: 'Выберите PDF размером не более 15 МБ.' }, 400)
    const content = new Uint8Array(await file.arrayBuffer())
    // Validate the bytes on the server, not only the browser MIME type or extension.
    if (
      new TextDecoder().decode(content.subarray(0, 5)) !== '%PDF-' ||
      !new TextDecoder()
        .decode(content.subarray(Math.max(0, content.length - 2048)))
        .includes('%%EOF')
    )
      return json({ error: 'Файл не является корректным PDF.' }, 400)
    const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(-180)
    const { data: reservationData, error: quotaError } = await admin.rpc(
      'reserve_portfolio_file',
      { p_user: user.id, p_name: name, p_bytes: file.size },
    )
    const reservation = Array.isArray(reservationData)
      ? reservationData[0]
      : reservationData
    if (quotaError || !reservation?.id || !reservation.storage_path)
      return json(
        {
          error:
            'Общий размер портфолио не должен превышать 15 МБ. Удалите лишние документы и повторите попытку.',
        },
        409,
      )
    const { error: uploadError } = await admin.storage
      .from('portfolio')
      .upload(reservation.storage_path, content, {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (uploadError) {
      await admin
        .from('portfolio_files')
        .delete()
        .eq('id', reservation.id)
        .eq('user_id', user.id)
      return json(
        { error: 'Не удалось загрузить PDF. Повторите попытку.' },
        503,
      )
    }
    const { data: finalized, error: finalError } = await admin
      .from('portfolio_files')
      .update({ status: 'ready' })
      .eq('id', reservation.id)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle()
    if (finalError || !finalized) {
      await admin.storage.from('portfolio').remove([reservation.storage_path])
      await admin
        .from('portfolio_files')
        .delete()
        .eq('id', reservation.id)
        .eq('user_id', user.id)
      return json(
        { error: 'Не удалось сохранить документ. Повторите попытку.' },
        503,
      )
    }
    return json({ id: reservation.id })
  } catch (error) {
    if (error instanceof Error && error.message === 'too_large')
      return json({ error: 'Размер запроса превышает лимит 15 МБ.' }, 413)
    return json(
      {
        error:
          'Не удалось обработать запрос. Проверьте документ и повторите попытку.',
      },
      400,
    )
  }
})

async function readLimited(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get('Content-Length')) > limit)
    throw new Error('too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('empty_body')
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error('too_large')
    }
    chunks.push(value)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
