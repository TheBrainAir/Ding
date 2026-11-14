const moneyFormats = new Map<string, Intl.NumberFormat>()

export function formatMoney(amount: number | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  let fmt = moneyFormats.get(currency)
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat('en', { style: 'currency', currency })
    } catch {
      fmt = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    moneyFormats.set(currency, fmt)
  }
  return fmt.format(amount)
}

const englishLanguages = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' })
  } catch {
    return null
  }
})()

/** "es" → "Spanish". Unknown or empty codes come back as-is. */
export function languageName(code: string | null | undefined): string {
  if (!code) return 'Unknown'
  try {
    return englishLanguages?.of(code) ?? code
  } catch {
    return code
  }
}

/** "es" → "español" — the language's own name for itself. */
export function nativeLanguageName(code: string | null | undefined): string | null {
  if (!code) return null
  try {
    const own = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    if (!own || own.toLowerCase() === code.toLowerCase()) return null
    return own.toLowerCase() === languageName(code).toLowerCase() ? null : own
  } catch {
    return null
  }
}

/** tree_nuts → "Tree nuts" when /api/meta has not loaded yet. */
export function humanize(id: string): string {
  const s = id.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function minutesSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const minutes = minutesSince(iso, now)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

export function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en', { hour: 'numeric' })
}
