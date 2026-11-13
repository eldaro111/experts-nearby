// User-facing labels for the «Рынок проектов» section.
// Internal names (auctions table, auction_* RPC, /auctions routes, `request`/`offer`
// type codes and status codes) are unchanged; only the wording shown to people lives here.

export const MARKET_TYPE_LABELS: Record<string, string> = {
  request: 'Заказ на разработку',
  offer: 'Готовый проект',
}

/** Listing (объявление, neuter) status. */
export const MARKET_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  open: 'Открыто',
  closed: 'Закрыто',
  cancelled: 'Отменено',
}

/** Proposal (предложение) and access-request statuses. */
export const PROPOSAL_STATUS_LABELS: Record<string, string> = {
  new: 'Новое',
  shortlisted: 'В шорт-листе',
  accepted: 'Выбрано',
  rejected: 'Отклонено',
  withdrawn: 'Отозвано',
  pending: 'На рассмотрении',
  approved: 'Одобрено',
}

export const marketTypeLabel = (type: string | null | undefined) =>
  (type && MARKET_TYPE_LABELS[type]) || 'Объявление'

export const marketStatusLabel = (status: string | null | undefined) =>
  (status && MARKET_STATUS_LABELS[status]) || status || '—'

export const proposalStatusLabel = (status: string | null | undefined) =>
  (status && (PROPOSAL_STATUS_LABELS[status] || MARKET_STATUS_LABELS[status])) || status || '—'
