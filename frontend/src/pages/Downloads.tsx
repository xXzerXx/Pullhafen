import { useState, type FormEvent } from 'react'
import { ApiError, downloads, items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import { useSelection } from '../useSelection'
import type { Item } from '../types'
import { Thumbnail } from '../components/Thumbnail'
import { BulkBar } from '../components/BulkBar'
import { PlayIcon, PauseIcon, CloseIcon } from '../components/icons'
import { formatBytes, formatEta, formatSpeed } from '../format'
import { useDownloadSpeeds } from '../useDownloadSpeeds'

function CookieRetryForm({ item, onRetried }: { item: Item; onRetried: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await itemsApi.setCookiesAndRetry(item.id, trimmed)
      setValue('')
      onRetried()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="cookie-retry" onSubmit={handleSubmit}>
      <p className="cookie-retry__hint">
        Diese Seite verlangt vermutlich einen Login oder eine Altersbestätigung per Cookie.
        {item.has_cookies
          ? ' Der zuletzt hinterlegte Cookie hat nicht gereicht - neuen eintragen:'
          : ' Cookie-Wert aus den Browser-Entwicklertools der Seite eintragen (name1=wert1; name2=wert2):'}
      </p>
      <div className="cookie-retry__row">
        <input
          type="text"
          placeholder="name1=wert1; name2=wert2"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          Übernehmen &amp; erneut versuchen
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  )
}

export function Downloads() {
  const { items, reload, removeItem, removeItems } = useItems()
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [cleaning, setCleaning] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  const active = items.filter(
    (i) => (i.status === 'downloading' || i.status === 'paused' || i.status === 'failed') && !i.hidden_from_downloads,
  )
  const speeds = useDownloadSpeeds(active)
  const { selected, toggle, toggleAll, allSelected, clear } = useSelection(active.map((i) => i.id))

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

  async function handleBulkDelete() {
    const ids = Array.from(selected)
    const confirmed = window.confirm(
      `${ids.length} Einträge wirklich entfernen? Laufende Downloads müssen dafür erst pausiert sein, bereits geladene Teildateien werden mit gelöscht.`,
    )
    if (!confirmed) return
    setBulkBusy(true)
    try {
      const failed = await removeItems(ids)
      if (failed.length > 0) {
        window.alert(`${failed.length} Eintrag/Einträge konnten nicht entfernt werden (vermutlich noch aktiv - erst pausieren).`)
      }
      clear()
    } finally {
      setBulkBusy(false)
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
        <>
          <label className="select-all-row">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Alle angezeigten markieren
          </label>
          <BulkBar count={selected.size} busy={bulkBusy} onDelete={handleBulkDelete} onClear={clear} />
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
                  <input
                    type="checkbox"
                    className="download-card__checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`"${item.title ?? item.filename ?? item.url}" auswählen`}
                  />
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
                  <>
                    <div className="download-card__error">{item.error_message}</div>
                    {item.needs_cookies && <CookieRetryForm item={item} onRetried={reload} />}
                  </>
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
        </>
      )}
    </div>
  )
}
