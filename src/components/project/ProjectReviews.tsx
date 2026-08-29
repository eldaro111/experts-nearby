'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { createNotification } from '@/lib/notifications'
import { createProjectActivity } from '@/lib/projectActivity'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

type ProjectMemberLike = {
  user_id: string
  display_name?: string | null
}

type ListingLike = {
  id: string
  title?: string | null
  created_by: string
}

type Review = {
  id: string
  project_id: string
  reviewer_id: string
  reviewed_user_id: string
  rating: number
  text: string | null
  created_at: string
  updated_at?: string | null
}

interface ProjectReviewsProps {
  projectId: string
  currentUserId?: string | null
  listing: ListingLike
  members: ProjectMemberLike[]
}

const renderStars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating))

export function ProjectReviews({
  projectId,
  currentUserId,
  listing,
  members,
}: ProjectReviewsProps) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const memberById = useMemo(
    () => Object.fromEntries(members.map((member) => [member.user_id, member])),
    [members]
  )

  const reviewTargets = useMemo(
    () => members.filter((member) => member.user_id !== currentUserId),
    [members, currentUserId]
  )

  const loadReviews = async () => {
    setLoading(true)

    const { data, error } = await supabase
      .from('profile_reviews')
      .select('id, project_id, reviewer_id, reviewed_user_id, rating, text, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      logAppError('Ошибка загрузки отзывов проекта:', error)
      setReviews([])
    } else {
      setReviews((data || []) as Review[])
    }

    setLoading(false)
  }

  useEffect(() => {
    void loadReviews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!selectedUserId && reviewTargets.length > 0) {
      setSelectedUserId(reviewTargets[0].user_id)
    }
  }, [selectedUserId, reviewTargets])

  const myReviewsByTarget = useMemo(() => {
    if (!currentUserId) return {}
    return Object.fromEntries(
      reviews
        .filter((review) => review.reviewer_id === currentUserId)
        .map((review) => [review.reviewed_user_id, review])
    ) as Record<string, Review>
  }, [reviews, currentUserId])

  useEffect(() => {
    const existing = selectedUserId ? myReviewsByTarget[selectedUserId] : null
    if (existing) {
      setRating(existing.rating)
      setText(existing.text || '')
    } else {
      setRating(5)
      setText('')
    }
  }, [selectedUserId, myReviewsByTarget])

  const handleSubmit = async () => {
    if (!currentUserId) {
      showAppMessage('Нужно войти в систему.')
      return
    }

    if (!selectedUserId) {
      showAppMessage('Выберите участника для отзыва.')
      return
    }

    if (selectedUserId === currentUserId) {
      showAppMessage('Нельзя оставить отзыв самому себе.')
      return
    }

    setSaving(true)

    const payload = {
      project_id: projectId,
      reviewer_id: currentUserId,
      reviewed_user_id: selectedUserId,
      rating,
      text: text.trim() || null,
    }

    const { error } = await supabase
      .from('profile_reviews')
      .upsert(payload, {
        onConflict: 'project_id,reviewer_id,reviewed_user_id',
      })

    setSaving(false)

    if (error) {
      logAppError('Ошибка сохранения отзыва:', error)
      showAppMessage('Ошибка сохранения отзыва: ' + error.message)
      return
    }

    const targetName = memberById[selectedUserId]?.display_name || 'участнику'

    await createNotification({
      recipientId: selectedUserId,
      actorId: currentUserId,
      projectId,
      type: 'profile_review_created',
      title: 'Вам оставили отзыв',
      body: `По проекту «${listing.title || 'Проект'}» вам оставили отзыв.`,
      href: `/users/${selectedUserId}`,
      payload: {
        project_id: projectId,
        project_title: listing.title,
        rating,
      },
    })

    await createProjectActivity({
      projectId,
      actorId: currentUserId,
      type: 'profile_review_created',
      title: 'Добавлен отзыв',
      body: `Оставлен отзыв ${targetName}. Оценка: ${rating}/5.`,
      entityType: 'profile_review',
      metadata: {
        reviewed_user_id: selectedUserId,
        rating,
      },
    })

    await loadReviews()
    showAppMessage('Отзыв сохранён.')
  }

  const handleDeleteMyReview = async () => {
    if (!currentUserId || !selectedUserId) return

    const existing = myReviewsByTarget[selectedUserId]
    if (!existing) return

    const ok = window.confirm('Удалить ваш отзыв?')
    if (!ok) return

    const { error } = await supabase
      .from('profile_reviews')
      .delete()
      .eq('id', existing.id)
      .eq('reviewer_id', currentUserId)

    if (error) {
      logAppError('Ошибка удаления отзыва:', error)
      showAppMessage('Ошибка удаления отзыва: ' + error.message)
      return
    }

    setText('')
    setRating(5)
    await loadReviews()
  }

  const selectedExistingReview = selectedUserId ? myReviewsByTarget[selectedUserId] : null

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold">Отзывы по проекту</h2>
          <p className="text-sm text-gray-500 mt-1">
            Участники проекта могут оставить оценку и короткий отзыв друг о друге.
          </p>
        </div>

        <Link href={`/listings/${projectId}`} className="text-sm text-blue-600 hover:underline">
          Открыть обзор проекта
        </Link>
      </div>

      {reviewTargets.length === 0 ? (
        <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-500">
          Пока нет других участников, которым можно оставить отзыв.
        </div>
      ) : (
        <div className="rounded-xl border bg-gray-50 p-4 mb-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Кому оставить отзыв
              </label>
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              >
                {reviewTargets.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.display_name || 'Участник'}
                    {member.user_id === listing.created_by ? ' · автор проекта' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Оценка
              </label>
              <select
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              >
                <option value={5}>5 — отлично</option>
                <option value={4}>4 — хорошо</option>
                <option value={3}>3 — нормально</option>
                <option value={2}>2 — плохо</option>
                <option value={1}>1 — очень плохо</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Текст отзыва
            </label>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              placeholder="Что было сделано хорошо, насколько человек надёжен, как шла коммуникация..."
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition disabled:opacity-60"
            >
              {saving ? 'Сохраняем...' : selectedExistingReview ? 'Обновить отзыв' : 'Оставить отзыв'}
            </button>

            {selectedExistingReview && (
              <button
                onClick={handleDeleteMyReview}
                className="rounded-lg border px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
              >
                Удалить мой отзыв
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3">Отзывы в этом проекте</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Загрузка отзывов...</p>
        ) : reviews.length === 0 ? (
          <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-500">
            По этому проекту пока нет отзывов.
          </div>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => {
              const reviewer = memberById[review.reviewer_id]
              const target = memberById[review.reviewed_user_id]

              return (
                <article key={review.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="text-sm">
                      <b>{reviewer?.display_name || 'Пользователь'}</b>
                      <span className="text-gray-500"> → </span>
                      <b>{target?.display_name || 'участник'}</b>
                    </div>
                    <div className="text-sm text-yellow-600 font-semibold">
                      {renderStars(Number(review.rating || 0))}
                    </div>
                  </div>

                  {review.text && (
                    <p className="mt-3 text-sm text-gray-700 whitespace-pre-line">
                      {review.text}
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}