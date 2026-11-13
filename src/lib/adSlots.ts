// ER-003: managed advertising places (placeholders only).
//
// - One central config: stable place IDs, sizes per breakpoint, per-place enable flag.
// - Global mode from NEXT_PUBLIC_AD_SLOTS: 'off' (default) renders nothing; 'demo' renders clearly
//   marked placeholders. There is no ad network, no cookies, no counters and no external requests.
// - Only public pages (home and catalogues); never inside the private project workspace.
// - A real advertiser/campaign model, labelling requisites and moderation are a separate task.

export type AdSlotMode = 'off' | 'demo'

export type AdSlotId = 'home-after-entry-points' | 'listings-after-filters' | 'experts-after-filters'

export type AdSlotConfig = {
  id: AdSlotId
  /** Where the place is, for people reading the config. */
  placement: string
  enabled: boolean
  /** Reserved size in CSS pixels per breakpoint: mobile < 768, tablet 768–1279, desktop ≥ 1280. */
  sizes: { mobile: [number, number]; tablet: [number, number]; desktop: [number, number] }
}

export const AD_SLOTS: Record<AdSlotId, AdSlotConfig> = {
  'home-after-entry-points': {
    id: 'home-after-entry-points',
    placement: 'Главная, после блока «С чего начать»',
    enabled: true,
    sizes: { mobile: [320, 100], tablet: [728, 90], desktop: [970, 90] },
  },
  'listings-after-filters': {
    id: 'listings-after-filters',
    placement: 'Каталог проектов, между фильтрами и результатами',
    enabled: true,
    sizes: { mobile: [320, 100], tablet: [728, 90], desktop: [728, 90] },
  },
  'experts-after-filters': {
    id: 'experts-after-filters',
    placement: 'Каталог экспертов, между фильтрами и результатами',
    enabled: true,
    sizes: { mobile: [320, 100], tablet: [728, 90], desktop: [728, 90] },
  },
}

export function resolveAdSlotMode(value: string | undefined | null): AdSlotMode {
  return value?.trim().toLowerCase() === 'demo' ? 'demo' : 'off'
}

export const AD_SLOT_MODE: AdSlotMode = resolveAdSlotMode(process.env.NEXT_PUBLIC_AD_SLOTS)

/** A place is shown only if the global mode is on and the place itself is enabled. */
export function isAdSlotVisible(id: AdSlotId, mode: AdSlotMode = AD_SLOT_MODE) {
  return mode !== 'off' && AD_SLOTS[id]?.enabled === true
}
