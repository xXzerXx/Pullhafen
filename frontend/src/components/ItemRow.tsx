import type { Item } from '../types'

function formatBytes(n: number | null): string {
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

const STATUS_LABELS: Record<string, string> = {
  queued: 'Wartet',
  downloading: 'Lädt',
  paused: 'Pausiert',
  completed: 'Fertig',
  failed: 'Fehlgeschlagen',
}

interface ItemRowProps {
  item: Item
  onPause?: () => void
  onResume?: () => void
  onStart?: () => void
  onRestart?: () => void
  busy?: boolean
}

export function ItemRow({ item, onPause, onResume, onStart, onRestart, busy }: ItemRowProps) {
  const progressPct =
    item.total_bytes && item.total_bytes > 0
      ? Math.min(100, Math.round((item.bytes_downloaded / item.total_bytes) * 100))
      : null

  return (
    <li className={`item-row item-row--${item.status}`}>
      <div className="item-row__main">
        <div className="item-row__title">
          <span className={`badge badge--${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span>
          <span className="badge badge--engine">{item.engine === 'ytdlp' ? 'Video' : 'Datei'}</span>
          {item.restricted && <span className="badge badge--restricted">Eingeschränkt</span>}
          <span className="item-row__name" title={item.url}>
            {item.filename ?? item.url}
          </span>
        </div>
        {item.source && <div className="item-row__source">{item.source}</div>}
        {(item.status === 'downloading' || item.status === 'paused') && (
          <div className="progress">
            <div
              className="progress__bar"
              style={{ width: progressPct !== null ? `${progressPct}%` : '100%' }}
            />
            <span className="progress__label">
              {formatBytes(item.bytes_downloaded)} / {formatBytes(item.total_bytes)}
              {progressPct !== null ? ` (${progressPct}%)` : ''}
            </span>
          </div>
        )}
        {item.status === 'failed' && item.error_message && (
          <div className="item-row__error">{item.error_message}</div>
        )}
        {(item.tags.length > 0 || item.performers.length > 0) && (
          <div className="item-row__tags">
            {item.tags.map((t) => (
              <span key={`tag-${t}`} className="chip">
                {t}
              </span>
            ))}
            {item.performers.map((p) => (
              <span key={`performer-${p}`} className="chip chip--performer">
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="item-row__actions">
        {item.status === 'downloading' && onPause && (
          <button disabled={busy} onClick={onPause}>
            Pause
          </button>
        )}
        {item.status === 'paused' && onResume && (
          <button disabled={busy} onClick={onResume}>
            Fortsetzen
          </button>
        )}
        {item.status === 'queued' && onStart && (
          <button disabled={busy} onClick={onStart}>
            Starten
          </button>
        )}
        {(item.status === 'failed' || item.status === 'completed' || item.status === 'paused') &&
          onRestart && (
            <button disabled={busy} onClick={onRestart}>
              Neu starten
            </button>
          )}
      </div>
    </li>
  )
}
