'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { logAppError } from '@/lib/appFeedback'

type Review = {
  id: string
  project_id: string
  reviewer_id: string
  reviewed_user_id: string
  rating: number
  text: string | null
  created_at: string
}

type ProfileRow = {
  user_id: string
  display_name: string | null
}

type ProjectRow = {
  id: string
  title: string | null
}

interface ProfileReviewsProps {
  userId: string
}

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU')
}

const renderStars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating))

export function ProfileReviews({ userId }: ProfileReviewsProps) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [reviewersById, setReviewersById] = useState<Record<string, ProfileRow>>({})
  const [projectsById, setProjectsById] = useState<Record<string, ProjectRow>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadReviews = async () => {
      setLoading(true)

      const { data, error } = await supabase
        .from('profile_reviews')
        .select('id, project_id, reviewer_id, reviewed_user_id, rating, text, created_at')
        .eq('reviewed_user_id', userId)
        .order('created_at', { ascending: false })

      if (error) {
        logAppError('Ошибка загрузки отзывов', error)
        setReviews([])
        setReviewersById({})
        setProjectsById({})
        setLoading(false)
        return
      }

      const rows = (data || []) as Review[]
      setReviews(rows)

      const reviewerIds = Array.from(new Set(rows.map((review) => review.reviewer_id).filter(Boolean)))
      const projectIds = Array.from(new Set(rows.map((review) => review.project_id).filter(Boolean)))

      if (reviewerIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles_collaboration')
          .select('user_id, display_name')
          .in('user_id', reviewerIds)

        if (profilesError) {
          logAppError('Ошибка загрузки авторов отзывов', profilesError)
          setReviewersById({})
        } else {
          setReviewersById(Object.fromEntries(((profilesData || []) as ProfileRow[]).map((profile) => [profile.user_id, profile])))
        }
      } else {
        setReviewersById({})
      }

      if (projectIds.length > 0) {
        const { data: projectsData, error: projectsError } = await supabase
          .from('listings')
          .select('id, title')
          .in('id', projectIds)

        if (projectsError) {
          logAppError('Ошибка загрузки проектов отзывов', projectsError)
          setProjectsById({})
        } else {
          setProjectsById(Object.fromEntries(((projectsData || []) as ProjectRow[]).map((project) => [project.id, project])))
        }
      } else {
        setProjectsById({})
      }

      setLoading(false)
    }

    if (userId) void loadReviews()
  }, [userId])

  const stats = useMemo(() => {
    if (reviews.length === 0) return { count: 0, average: 0 }
    const sum = reviews.reduce((acc, review) => acc + Number(review.rating || 0), 0)
    return { count: reviews.length, average: Math.round((sum / reviews.length) * 10) / 10 }
  }, [reviews])

  if (loading) {
    return (
      <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-2">Отзывы</h2>
        <p className="text-sm text-gray-500">Загрузка отзывов...</p>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold">Отзывы</h2>
          <p className="text-sm text-gray-500 mt-1">
            Отзывы по завершённым и текущим проектам платформы.
          </p>
        </div>

        <div className="rounded-lg bg-gray-50 border px-4 py-2 text-sm">
          {stats.count > 0 ? (
            <>
              <span className="text-yellow-600 font-semibold">★ {stats.average}</span>
              <span className="text-gray-500"> · отзывов: {stats.count}</span>
            </>
          ) : (
            <span className="text-gray-500">Отзывов пока нет</span>
          )}
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-500">
          У пользователя пока нет отзывов.
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => {
            const reviewer = reviewersById[review.reviewer_id]
            const project = projectsById[review.project_id]

            return (
              <article key={review.id} className="rounded-xl border bg-gray-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium text-gray-900">
                      {reviewer?.display_name || 'Пользователь'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {project ? (
                        <Link href={`/listings/${project.id}`} className="text-blue-600 hover:underline">
                          {project.title || 'Проект'}
                        </Link>
                      ) : (
                        'Проект'
                      )}
                      {' · '}{formatDate(review.created_at)}
                    </div>
                  </div>

                  <div className="text-sm text-yellow-600 font-semibold whitespace-nowrap">
                    {renderStars(Number(review.rating || 0))}
                  </div>
                </div>

                {review.text && (
                  <p className="text-sm text-gray-700 whitespace-pre-line mt-3">
                    {review.text}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}