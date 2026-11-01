export function formatBytes(n: number | null): string {
  if (n === null) return '?'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex++
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—'
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatRelative(iso: string): string {
  const then = new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime()
  const diffMs = Date.now() - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'vor 1 Tag'
  if (days < 14) return `vor ${days} Tagen`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return 'vor 1 Woche'
  return `vor ${weeks} Wochen`
}

export function formatEta(secondsRemaining: number | null): string {
  if (secondsRemaining === null || !Number.isFinite(secondsRemaining)) return '—'
  return formatDuration(Math.max(0, Math.round(secondsRemaining)))
}

export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return '0 KB/s'
  return `${formatBytes(bytesPerSecond)}/s`
}
