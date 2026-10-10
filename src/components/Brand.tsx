import Image from 'next/image'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Image src="/brand/experts-nearby.png" alt="" width={145} height={73} priority />
      </span>
      {!compact && <span className="brand-name">Эксперты<span>Рядом</span></span>}
    </span>
  )
}
