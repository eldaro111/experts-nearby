import type { CSSProperties } from 'react'
import { AD_SLOTS, isAdSlotVisible, type AdSlotId } from '@/lib/adSlots'

/**
 * Managed advertising place (ER-003). Renders nothing when disabled, so no empty band remains.
 * In demo mode it shows a neutral placeholder that is clearly not an advertiser and not a project card.
 * Server component: no client JavaScript, no network requests, no tracking.
 */
export function AdSlot({ id, className = '' }: { id: AdSlotId; className?: string }) {
  if (!isAdSlotVisible(id)) return null
  const { sizes } = AD_SLOTS[id]
  const style = {
    '--ad-w-mobile': `${sizes.mobile[0]}px`,
    '--ad-h-mobile': `${sizes.mobile[1]}px`,
    '--ad-w-tablet': `${sizes.tablet[0]}px`,
    '--ad-h-tablet': `${sizes.tablet[1]}px`,
    '--ad-w-desktop': `${sizes.desktop[0]}px`,
    '--ad-h-desktop': `${sizes.desktop[1]}px`,
  } as CSSProperties
  return (
    <aside className={`ad-slot ${className}`} data-ad-slot={id} aria-label="Рекламное место" style={style}>
      <div className="ad-slot-box">
        <span className="ad-slot-label">Рекламное место</span>
        <span className="ad-slot-note">Демонстрационный блок · не реклама · {id}</span>
      </div>
    </aside>
  )
}
