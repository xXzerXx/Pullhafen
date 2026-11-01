import { useState } from 'react'
import { downloads, items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import { Thumbnail } from '../components/Thumbnail'
import { PlayIcon, PauseIcon, CloseIcon } from '../components/icons'
import { formatBytes, formatEta, formatSpeed } from '../format'
import { useDownloadSpeeds } from '../useDownloadSpeeds'

export function Downloads() {
  const { items, reload, removeItem } = useItems()
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [cleaning, setCleaning] = useState(false)

  const active = items.filter(
    (i) => (i.status === 'downloading' || i.status === 'paused' || i.status === 'failed') && !i.hidden_from_downloads,
  )
  const speeds = useDownloadSpeeds(active)

  function setBusy(id: number, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function run(id: number, action: (id: number) => Promise<unknown>) {
    setBusy(id, true)
    try {
      await action(id)
    } finally {
      setBusy(id, false)
    }
  }

  async function handleCleanup() {
    setCleaning(true)
    try {
      await downloads.cleanup()
      await reload()
    } finally {
      setCleaning(false)
    }
  }

  const hasFailed = active.some((i) => i.status === 'failed')

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <div className="section-head__title">Downloads</div>
          <div className="section-head__subtitle">Laufende Übertragungen - pausieren, fortsetzen oder entfernen.</div>
        </div>
        <button onClick={handleCleanup} disabled={cleaning || !hasFailed}>
          Aufräumen
        </button>
      </div>

      {active.length === 0 ? (
        <p className="empty-hint">Keine aktiven Downloads.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map((item) => {
            const running = item.status === 'downloading'
            const pct =
              item.total_bytes && item.total_bytes > 0
                ? Math.min(100, (item.bytes_downloaded / item.total_bytes) * 100)
                : null
            const speed = speeds.get(item.id) ?? null
            const remainingBytes =
              item.total_bytes !== null ? item.total_bytes - item.bytes_downloaded : null
            const eta = speed && speed > 0 && remainingBytes !== null ? remainingBytes / speed : null

            return (
              <li key={item.id} className="download-card">
                <div className="download-card__top">
                  <Thumbnail item={item} className="download-card__thumb" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {running && <span className="live-dot" aria-hidden="true" />}
                      <div className="download-card__title" title={item.url}>
                        {item.title ?? item.filename ?? item.url}
                      </div>
                    </div>
                    {(item.title || item.filename) && (
                      <div className="download-card__url">{item.url}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      {item.source && <span className="badge-source">{item.source}</span>}
                      <span
                        className="download-card__status"
                        style={{ color: item.status === 'failed' ? 'var(--danger)' : running ? 'var(--success)' : 'var(--text-muted)' }}
                      >
                        {item.status === 'failed' ? 'Fehlgeschlagen' : running ? 'Lädt herunter' : 'Pausiert'}
                      </span>
                    </div>
                  </div>

                  {item.status !== 'failed' && (
                    <button
                      className="toggle-btn"
                      disabled={busyIds.has(item.id)}
                      onClick={() => run(item.id, running ? itemsApi.pause : itemsApi.resume)}
                    >
                      {running ? <PauseIcon /> : <PlayIcon size={12} />}
                      {running ? 'Pause' : 'Fortsetzen'}
                    </button>
                  )}
                  {item.status === 'failed' && (
                    <button disabled={busyIds.has(item.id)} onClick={() => run(item.id, itemsApi.restart)}>
                      Neu versuchen
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    aria-label="Entfernen"
                    disabled={busyIds.has(item.id)}
                    onClick={() => run(item.id, removeItem)}
                  >
                    <CloseIcon />
                  </button>
                </div>

                {item.status === 'failed' && item.error_message ? (
                  <div className="download-card__error">{item.error_message}</div>
                ) : (
                  <div className="download-card__progress">
                    <div className="download-card__bar-track">
                      <div
                        className="download-card__bar-fill"
                        style={{
                          width: pct !== null ? `${pct}%` : '100%',
                          background: running ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      />
                    </div>
                    <div className="download-card__stat">{pct !== null ? `${pct.toFixed(0)} %` : '—'}</div>
                    <div className="download-card__stat">{running ? formatSpeed(speed) : '—'}</div>
                    <div className="download-card__stat">
                      {running ? `noch ${formatEta(eta)}` : `${formatBytes(item.bytes_downloaded)} geladen`}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
