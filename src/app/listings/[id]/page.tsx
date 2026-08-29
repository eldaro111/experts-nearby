'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { createNotification } from '@/lib/notifications'

interface Listing {
  id: string
  title: string
  description: string
  roles_needed: string[] | string
  skills: string[] | string
  timezone: string
  created_by: string
  created_at: string
  visibility?: string
}

interface ApplicantProfile {
  user_id: string
  display_name: string
}

interface ApplicationRow {
  user_id: string
  status: string
  invited_by_author?: boolean
}

export default function ListingDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [listing, setListing] = useState<Listing | null>(null)
  const [author, setAuthor] = useState<ApplicantProfile | null>(null)
  const [participants, setParticipants] = useState<ApplicantProfile[]>([])
  const [pendingApplicants, setPendingApplicants] = useState<ApplicantProfile[]>([])
  const [experts, setExperts] = useState<ApplicantProfile[]>([])
  const [busyUserIds, setBusyUserIds] = useState<string[]>([])
  const [selectedExpert, setSelectedExpert] = useState<string>('')
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoadingUserId, setActionLoadingUserId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      setUser(user)

      const { data: project, error: projectError } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .single()

      if (projectError || !project) {
        logAppError('Ошибка загрузки проекта:', projectError)
        setListing(null)
        setAuthor(null)
        setParticipants([])
        setPendingApplicants([])
        setExperts([])
        setBusyUserIds([])
        setLoading(false)
        return
      }

      setListing(project)

      const { data: authorData, error: authorError } = await supabase
        .from('profiles_collaboration')
        .select('user_id, display_name')
        .eq('user_id', project.created_by)
        .maybeSingle()

      if (authorError) {
        logAppError('Ошибка при загрузке автора:', authorError)
        setAuthor(null)
      } else {
        setAuthor(authorData || null)
      }

      const { data: applications, error: appError } = await supabase
        .from('applications')
        .select('user_id, status, invited_by_author')
        .eq('listing_id', id)

      if (appError) {
        logAppError('Ошибка при загрузке заявок проекта:', appError)
        setParticipants([])
        setPendingApplicants([])
        setBusyUserIds([])
      } else {
        const apps = (applications || []) as ApplicationRow[]

        const existingApplicationUserIds = apps
          .filter((a) => a.status !== 'declined' && a.status !== 'removed' && a.status !== 'left')
          .map((a) => a.user_id)

        setBusyUserIds(existingApplicationUserIds)

        const acceptedUserIds = apps
          .filter((a) => a.status === 'accepted')
          .map((a) => a.user_id)
          .filter((uid) => uid !== project.created_by)

        const pendingUserIds = apps
        .filter((a) => a.status === 'pending' && !a.invited_by_author)
        .map((a) => a.user_id)
        .filter((uid) => uid !== project.created_by)


        if (acceptedUserIds.length === 0) {
          setParticipants([])
        } else {
          const { data: acceptedProfiles, error: acceptedProfilesError } = await supabase
            .from('profiles_collaboration')
            .select('user_id, display_name')
            .in('user_id', acceptedUserIds)

          if (acceptedProfilesError) {
            logAppError('Ошибка при загрузке профилей участников:', acceptedProfilesError)
            setParticipants([])
          } else {
            setParticipants(acceptedProfiles || [])
          }
        }

        if (pendingUserIds.length === 0) {
          setPendingApplicants([])
        } else {
          const { data: pendingProfiles, error: pendingProfilesError } = await supabase
            .from('profiles_collaboration')
            .select('user_id, display_name')
            .in('user_id', pendingUserIds)

          if (pendingProfilesError) {
            logAppError('Ошибка при загрузке профилей откликов:', pendingProfilesError)
            setPendingApplicants([])
          } else {
            setPendingApplicants(pendingProfiles || [])
          }
        }
      }

      const { data: expertsData, error: expertsError } = await supabase
        .from('profiles_public')
        .select('user_id, display_name')
        .order('display_name', { ascending: true })

      if (expertsError) {
        logAppError('Ошибка загрузки экспертов:', expertsError)
        setExperts([])
      } else {
        setExperts(expertsData || [])
      }

      setLoading(false)
    }

    fetchData()
  }, [id])

  const goToUserProfile = (targetUserId: string) => {
    if (targetUserId === user?.id) {
      router.push('/profile')
    } else {
      router.push(`/users/${targetUserId}`)
    }
  }

const handleApply = async () => {
  if (applying) return

  if (!user) {
    showAppMessage('Пожалуйста, войдите в систему, чтобы откликнуться.', 'warning')
    return
  }

  if (!listing) {
    showAppMessage('Проект не найден.', 'warning')
    return
  }

  setApplying(true)

  try {
    const { data: existing, error: existingError } = await supabase
      .from('applications')
      .select('id, status, invited_by_author')
      .eq('listing_id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingError) {
      showAppError(existingError, 'Не удалось проверить текущий отклик.', 'Проверка отклика')
      return
    }

    const notifyAuthorAboutApplication = async (repeated = false) => {
      if (listing.created_by === user.id) return

      const { data: applicantProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle()

      const applicantName =
        applicantProfile?.display_name || user.email || 'Пользователь'

      await createNotification({
        recipientId: listing.created_by,
        actorId: user.id,
        projectId: listing.id,
        type: 'project_application',
        title: repeated ? 'Повторный отклик на проект' : 'Новый отклик на проект',
        body: `${applicantName} откликнулся на проект «${listing.title}».`,
        href: `/listings/${listing.id}`,
        payload: {
          listing_id: listing.id,
          listing_title: listing.title,
          applicant_id: user.id,
          applicant_name: applicantName,
          repeated,
        },
      })
    }

    if (existing) {
      if (existing.status === 'pending') {
        setBusyUserIds((items) =>
          items.includes(user.id) ? items : [...items, user.id]
        )
        showAppMessage(
          existing.invited_by_author
            ? 'Вас уже пригласили в этот проект. Проверьте приглашения в профиле.'
            : 'Вы уже откликались на этот проект.',
          'info'
        )
        return
      }

      if (existing.status === 'accepted') {
        setBusyUserIds((items) =>
          items.includes(user.id) ? items : [...items, user.id]
        )
        showAppMessage('Вы уже участвуете в этом проекте.', 'info')
        return
      }

      const { error: updateError } = await supabase
        .from('applications')
        .update({
          status: 'pending',
          invited_by_author: false,
        })
        .eq('id', existing.id)

      if (updateError) {
        showAppError(updateError, 'Не удалось отправить повторный отклик.', 'Повторный отклик')
        return
      }

      await notifyAuthorAboutApplication(true)
      setBusyUserIds((items) =>
        items.includes(user.id) ? items : [...items, user.id]
      )
      showAppMessage('Вы снова откликнулись на проект.', 'success')
      return
    }

    const { error } = await supabase.from('applications').insert([
      {
        listing_id: id,
        user_id: user.id,
        status: 'pending',
        invited_by_author: false,
      },
    ])

    if (error) {
      showAppError(error, 'Не удалось откликнуться на проект.', 'Создание отклика')
      return
    }

    await notifyAuthorAboutApplication(false)
    setBusyUserIds((items) =>
      items.includes(user.id) ? items : [...items, user.id]
    )
    showAppMessage('Вы успешно откликнулись на проект.', 'success')
  } catch (error) {
    showAppError(error, 'Не удалось откликнуться на проект.', 'Отклик на проект')
  } finally {
    setApplying(false)
  }
}

const handleInvite = async () => {
  if (inviting) return

  if (!selectedExpert) {
    showAppMessage('Выберите эксперта для приглашения.', 'warning')
    return
  }

  if (!user?.id) {
    showAppMessage('Пользователь не найден.', 'warning')
    return
  }

  if (!listing) {
    showAppMessage('Проект не найден.', 'warning')
    return
  }

  const targetExpertId = selectedExpert
  setInviting(true)

  try {
    const { data: existing, error: existingError } = await supabase
      .from('applications')
      .select('id, status')
      .eq('listing_id', id)
      .eq('user_id', targetExpertId)
      .maybeSingle()

    if (existingError) {
      showAppError(existingError, 'Не удалось проверить приглашение.', 'Проверка приглашения')
      return
    }

    let repeated = false

    if (existing) {
      if (existing.status === 'pending' || existing.status === 'accepted') {
        showAppMessage('Этот эксперт уже приглашён или уже участвует.', 'info')
        return
      }

      repeated = true
      const { error: updateError } = await supabase
        .from('applications')
        .update({
          status: 'pending',
          invited_by_author: true,
        })
        .eq('id', existing.id)

      if (updateError) {
        showAppError(updateError, 'Не удалось повторно пригласить эксперта.', 'Повторное приглашение')
        return
      }
    } else {
      const { error } = await supabase.from('applications').insert([
        {
          listing_id: id,
          user_id: targetExpertId,
          invited_by_author: true,
          status: 'pending',
        },
      ])

      if (error) {
        showAppError(error, 'Не удалось пригласить эксперта.', 'Создание приглашения')
        return
      }
    }

    await createNotification({
      recipientId: targetExpertId,
      actorId: user.id,
      projectId: listing.id,
      type: 'project_invite',
      title: 'Вас пригласили в проект',
      body: `Вас пригласили в проект «${listing.title}».`,
      href: '/profile',
      payload: {
        listing_id: listing.id,
        listing_title: listing.title,
        repeated,
      },
    })

    setBusyUserIds((items) =>
      items.includes(targetExpertId) ? items : [...items, targetExpertId]
    )
    setSelectedExpert('')
    showAppMessage(
      repeated ? 'Эксперт приглашён повторно.' : 'Эксперт успешно приглашён.',
      'success'
    )
  } catch (error) {
    showAppError(error, 'Не удалось пригласить эксперта.', 'Приглашение эксперта')
  } finally {
    setInviting(false)
  }
}

const handleAcceptApplicant = async (targetUserId: string) => {
  if (actionLoadingUserId) return

  if (!user?.id || !listing) {
    showAppMessage('Не удалось определить пользователя или проект.', 'warning')
    return
  }

  setActionLoadingUserId(targetUserId)

  try {
    const { data, error } = await supabase
      .from('applications')
      .update({ status: 'accepted' })
      .eq('listing_id', id)
      .eq('user_id', targetUserId)
      .eq('status', 'pending')
      .eq('invited_by_author', false)
      .select('user_id')

    if (error) {
      showAppError(error, 'Не удалось принять отклик.', 'Принятие отклика')
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Отклик уже обработан или больше недоступен.', 'warning')
      return
    }

    await createNotification({
      recipientId: targetUserId,
      actorId: user.id,
      projectId: listing.id,
      type: 'application_accepted',
      title: 'Ваш отклик приняли',
      body: `Ваш отклик на проект «${listing.title}» приняли. Теперь вы участник проекта.`,
      href: `/listings/${listing.id}`,
      payload: {
        listing_id: listing.id,
        listing_title: listing.title,
      },
    })

    const acceptedProfile = pendingApplicants.find(
      (profile) => profile.user_id === targetUserId
    )
    setPendingApplicants((items) =>
      items.filter((profile) => profile.user_id !== targetUserId)
    )
    if (acceptedProfile) {
      setParticipants((items) =>
        items.some((profile) => profile.user_id === targetUserId)
          ? items
          : [...items, acceptedProfile]
      )
    }
    showAppMessage('Пользователь принят в проект.', 'success')
  } catch (error) {
    showAppError(error, 'Не удалось принять отклик.', 'Принятие отклика')
  } finally {
    setActionLoadingUserId(null)
  }
}

const handleDeclineApplicant = async (targetUserId: string) => {
  if (actionLoadingUserId) return

  if (!user?.id || !listing) {
    showAppMessage('Не удалось определить пользователя или проект.', 'warning')
    return
  }

  setActionLoadingUserId(targetUserId)

  try {
    const { data, error } = await supabase
      .from('applications')
      .update({ status: 'declined' })
      .eq('listing_id', id)
      .eq('user_id', targetUserId)
      .eq('status', 'pending')
      .eq('invited_by_author', false)
      .select('user_id')

    if (error) {
      showAppError(error, 'Не удалось отклонить отклик.', 'Отклонение отклика')
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Отклик уже обработан или больше недоступен.', 'warning')
      return
    }

    await createNotification({
      recipientId: targetUserId,
      actorId: user.id,
      projectId: listing.id,
      type: 'application_declined',
      title: 'Ваш отклик отклонили',
      body: `Ваш отклик на проект «${listing.title}» отклонили.`,
      href: `/listings/${listing.id}`,
      payload: {
        listing_id: listing.id,
        listing_title: listing.title,
      },
    })

    setPendingApplicants((items) =>
      items.filter((profile) => profile.user_id !== targetUserId)
    )
    setBusyUserIds((items) => items.filter((item) => item !== targetUserId))
    showAppMessage('Отклик отклонён.', 'success')
  } catch (error) {
    showAppError(error, 'Не удалось отклонить отклик.', 'Отклонение отклика')
  } finally {
    setActionLoadingUserId(null)
  }
}

const handleRemoveParticipant = async (targetUserId: string) => {
  if (actionLoadingUserId) return

  if (!user?.id || !listing) {
    showAppMessage('Не удалось определить пользователя или проект.', 'warning')
    return
  }

  const ok = window.confirm('Удалить пользователя из проекта?')
  if (!ok) return

  setActionLoadingUserId(targetUserId)

  try {
    const { data, error } = await supabase
      .from('applications')
      .update({ status: 'removed' })
      .eq('listing_id', id)
      .eq('user_id', targetUserId)
      .eq('status', 'accepted')
      .select('user_id')

    if (error) {
      showAppError(error, 'Не удалось удалить участника.', 'Удаление участника')
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Участник уже удалён или действие недоступно.', 'warning')
      return
    }

    await createNotification({
      recipientId: targetUserId,
      actorId: user.id,
      projectId: listing.id,
      type: 'participant_removed',
      title: 'Вас удалили из проекта',
      body: `Вас удалили из проекта «${listing.title}».`,
      href: `/listings/${listing.id}`,
      payload: {
        listing_id: listing.id,
        listing_title: listing.title,
      },
    })

    setParticipants((items) =>
      items.filter((profile) => profile.user_id !== targetUserId)
    )
    setBusyUserIds((items) => items.filter((item) => item !== targetUserId))
    showAppMessage('Пользователь удалён из проекта.', 'success')
  } catch (error) {
    showAppError(error, 'Не удалось удалить участника.', 'Удаление участника')
  } finally {
    setActionLoadingUserId(null)
  }
}

const handleLeaveProject = async () => {
  if (actionLoadingUserId || !user?.id) return

  if (!listing) {
    showAppMessage('Проект не найден.', 'warning')
    return
  }

  const ok = window.confirm('Покинуть проект?')
  if (!ok) return

  setActionLoadingUserId(user.id)

  try {
    const { data, error } = await supabase
      .from('applications')
      .update({ status: 'left' })
      .eq('listing_id', id)
      .eq('user_id', user.id)
      .eq('status', 'accepted')
      .select('user_id')

    if (error) {
      showAppError(error, 'Не удалось покинуть проект.', 'Выход из проекта')
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Участие уже завершено или действие недоступно.', 'warning')
      return
    }

    await createNotification({
      recipientId: listing.created_by,
      actorId: user.id,
      projectId: listing.id,
      type: 'participant_left',
      title: 'Участник покинул проект',
      body: `Участник покинул проект «${listing.title}».`,
      href: `/listings/${listing.id}`,
      payload: {
        listing_id: listing.id,
        listing_title: listing.title,
        user_id: user.id,
      },
    })

    setParticipants((items) =>
      items.filter((profile) => profile.user_id !== user.id)
    )
    setBusyUserIds((items) => items.filter((item) => item !== user.id))
    showAppMessage('Вы покинули проект.', 'success')
  } catch (error) {
    showAppError(error, 'Не удалось покинуть проект.', 'Выход из проекта')
  } finally {
    setActionLoadingUserId(null)
  }
}

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">Загрузка проекта...</div>
    )
  }

  if (!listing) {
    return (
      <div className="text-center py-12 text-gray-500">
        Проект не найден или недоступен.
      </div>
    )
  }

  const isAuthor = user?.id === listing.created_by
  const isAcceptedParticipant = participants.some((p) => p.user_id === user?.id)
  const canOpenWorkspace = isAuthor || isAcceptedParticipant
  const hasActiveApplication = Boolean(
    user?.id && busyUserIds.includes(user.id)
  )

  const availableExperts = experts
    .filter((ex) => ex.user_id !== listing.created_by)
    .filter((ex) => !busyUserIds.includes(ex.user_id))

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold mb-4">{listing.title}</h1>
      <p className="text-gray-700 mb-6">{listing.description}</p>

      <div className="text-sm text-gray-600 mb-2">
        <b>Роли:</b>{' '}
        {Array.isArray(listing.roles_needed)
          ? listing.roles_needed.join(', ')
          : listing.roles_needed}
      </div>

      <div className="text-sm text-gray-600 mb-2">
        <b>Навыки:</b>{' '}
        {Array.isArray(listing.skills)
          ? listing.skills.join(', ')
          : listing.skills}
      </div>

      <div className="text-sm text-gray-600 mb-2">
        <b>Часовой пояс:</b> {listing.timezone || '—'}
      </div>

      <div className="text-xs text-gray-400 mb-6">
        Опубликовано: {new Date(listing.created_at).toLocaleString()}
      </div>

      {isAuthor ? (
        <div className="space-y-4">
          <button
            onClick={() => router.push(`/listings/${listing.id}/edit`)}
            className="bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded hover:bg-gray-300 transition"
          >
            ✏️ Редактировать проект
          </button>

          <div className="border rounded-lg p-4 bg-gray-50">
            <h3 className="font-semibold mb-2">Пригласить эксперта:</h3>

            <div className="flex gap-3 items-center">
              <select
                value={selectedExpert}
                onChange={(e) => setSelectedExpert(e.target.value)}
                className="border rounded p-2 flex-1"
              >
                <option value="">Выберите эксперта...</option>
                {availableExperts.map((ex) => (
                  <option key={ex.user_id} value={ex.user_id}>
                    {ex.display_name || 'Без имени'}
                  </option>
                ))}
              </select>

              <button
                onClick={handleInvite}
                disabled={inviting}
                className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {inviting ? 'Приглашаем...' : 'Пригласить'}
              </button>
            </div>

            {availableExperts.length === 0 && (
              <p className="text-sm text-gray-500 mt-3">
                Нет доступных экспертов для приглашения.
              </p>
            )}
          </div>
        </div>
      ) : isAcceptedParticipant ? (
        <div className="mb-6">
          <button
            onClick={handleLeaveProject}
            disabled={actionLoadingUserId === user?.id}
            className="bg-red-600 text-white text-sm px-4 py-2 rounded hover:bg-red-700 transition disabled:opacity-60"
          >
            {actionLoadingUserId === user?.id ? 'Выходим...' : 'Покинуть проект'}
          </button>
        </div>
      ) : (
        <button
          onClick={handleApply}
          disabled={applying || hasActiveApplication}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {applying
            ? 'Отправляем...'
            : hasActiveApplication
              ? 'Отклик уже отправлен'
              : 'Откликнуться'}
        </button>
      )}
      {canOpenWorkspace && (
  <div className="mb-6">
    <button
      onClick={() => router.push(`/projects/${listing.id}`)}
      className="bg-green-600 text-white text-sm px-4 py-2 rounded hover:bg-green-700 transition"
    >
      Открыть рабочую зону
    </button>
  </div>
)}


      <hr className="my-8" />

      <h2 className="text-xl font-semibold mb-4">Автор проекта</h2>
      {author ? (
        <div className="border rounded-lg p-4 bg-white shadow-sm mb-6">
          <button
            onClick={() => goToUserProfile(author.user_id)}
            className="font-medium text-blue-600 hover:underline"
          >
            {author.display_name || 'Без имени'}
          </button>
        </div>
      ) : (
        <p className="text-gray-500 mb-6">Автор не найден.</p>
      )}

      <h2 className="text-xl font-semibold mb-4">Участники</h2>
      {participants.length === 0 ? (
        <p className="text-gray-500 mb-6">Пока нет принятых участников.</p>
      ) : (
        <ul className="list-disc ml-6 text-gray-700 mb-6">
          {participants.map((a) => (
            <li key={a.user_id} className="mb-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => goToUserProfile(a.user_id)}
                  className="text-blue-600 hover:underline"
                >
                  {a.display_name || 'Без имени'}
                </button>

                {isAuthor && (
                  <button
                    onClick={() => handleRemoveParticipant(a.user_id)}
                    disabled={actionLoadingUserId === a.user_id}
                    className="bg-red-600 text-white text-xs px-3 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                  >
                    {actionLoadingUserId === a.user_id ? 'Удаляем...' : 'Удалить'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isAuthor && (
        <>
          <h2 className="text-xl font-semibold mb-4">Отклики</h2>
          {pendingApplicants.length === 0 ? (
            <p className="text-gray-500">Пока нет новых откликов.</p>
          ) : (
            <ul className="list-disc ml-6 text-gray-700">
              {pendingApplicants.map((applicant) => (
                <li key={applicant.user_id} className="mb-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => goToUserProfile(applicant.user_id)}
                      className="text-blue-600 hover:underline"
                    >
                      {applicant.display_name || 'Без имени'}
                    </button>

                    <button
                      onClick={() => handleAcceptApplicant(applicant.user_id)}
                      disabled={actionLoadingUserId === applicant.user_id}
                      className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition disabled:opacity-60"
                    >
                      {actionLoadingUserId === applicant.user_id ? '...' : 'Принять'}
                    </button>

                    <button
                      onClick={() => handleDeclineApplicant(applicant.user_id)}
                      disabled={actionLoadingUserId === applicant.user_id}
                      className="bg-gray-600 text-white text-xs px-3 py-1 rounded hover:bg-gray-700 transition disabled:opacity-60"
                    >
                      {actionLoadingUserId === applicant.user_id ? '...' : 'Отклонить'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}