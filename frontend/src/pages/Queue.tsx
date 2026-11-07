import { useEffect, useState } from 'react'
import { items as itemsApi, settings as settingsApi } from '../api'
import { useItems } from '../ItemsContext'
import { useSelection } from '../useSelection'
import { Thumbnail } from '../components/Thumbnail'
import { BulkBar } from '../components/BulkBar'
import { CloseIcon } from '../components/icons'
import { formatDuration } from '../format'

export function Queue() {
  const { items, removeItem, removeItems } = useItems()
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [maxConcurrent, setMaxConcurrent] = useState<number | null>(null)
  const [limitNotice, setLimitNotice] = useState<string | null>(null)

  // Nur für den Hinweis unten geladen (siehe checkLimitAndNotify) - die
  // tatsächliche Begrenzung läuft serverseitig über das Nebenläufigkeits-Gate
  // in download_manager.py und greift unabhängig davon, ob dieser Wert hier
  // schon geladen ist.
  useEffect(() => {
    settingsApi.get().then((s) => setMaxConcurrent(s.max_concurrent_downloads)).catch(() => {})
  }, [])

  // Warteschlange = wirklich wartend, noch nicht gestartet (siehe Vorschau) -
  // sobald ein Download läuft oder pausiert ist, gehört er in den
  // Downloads-Reiter.
  const queued = items.filter((i) => i.status === 'queued')
  const downloadingCount = items.filter((i) => i.status === 'downloading').length
  const { selected, toggle, toggleAll, allSelected, clear } = useSelection(queued.map((i) => i.id))

  function checkLimitAndNotify() {
    if (maxConcurrent !== null && downloadingCount >= maxConcurrent) {
      setLimitNotice(
        `Es laufen bereits ${downloadingCount} von ${maxConcurrent} gleichzeitig möglichen Downloads - weitere starten automatisch, sobald ein Platz frei wird.`,
      )
      window.setTimeout(() => setLimitNotice(null), 7000)
    }
  }

  function setBusy(id: number, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleStart(id: number) {
    checkLimitAndNotify()
    setBusy(id, true)
    try {
      await itemsApi.start(id)
    } finally {
      setBusy(id, false)
    }
  }

  async function handleBulkStart() {
    checkLimitAndNotify()
    const ids = Array.from(selected)
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(ids.map((id) => itemsApi.start(id)))
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed > 0) {
        window.alert(`${failed} Eintrag/Einträge konnten nicht gestartet werden.`)
      }
      clear()
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleRemove(id: number) {
    setBusy(id, true)
    try {
      await removeItem(id)
    } finally {
      setBusy(id, false)
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected)
    const confirmed = window.confirm(
      `${ids.length} Einträge wirklich aus der Warteschlange entfernen? Das lässt sich nicht rückgängig machen.`,
    )
    if (!confirmed) return
    setBulkBusy(true)
    try {
      const failed = await removeItems(ids)
      if (failed.length > 0) {
        window.alert(`${failed.length} Eintrag/Einträge konnten nicht entfernt werden.`)
      }
      clear()
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <div className="section-head__title">Warteschlange</div>
          <div className="section-head__subtitle">Wartet auf den Start - in den Einstellungen lässt sich festlegen, ob neue Links sofort loslegen.</div>
        </div>
      </div>

      {queued.length === 0 ? (
        <p className="empty-hint">Nichts in der Warteschlange.</p>
      ) : (
        <>
          <label className="select-all-row">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Alle angezeigten markieren
          </label>
          <BulkBar
            count={selected.size}
            busy={bulkBusy}
            onDelete={handleBulkDelete}
            onClear={clear}
            onStart={handleBulkStart}
          />
          {limitNotice && <p className="hint queue-limit-notice">{limitNotice}</p>}
          <ul className="item-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {queued.map((item) => (
            <li key={item.id} className="queue-row">
              <input
                type="checkbox"
                className="queue-row__checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                aria-label={`"${item.title ?? item.filename ?? item.url}" auswählen`}
              />
              <Thumbnail item={item} className="queue-row__thumb" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="queue-row__title" title={item.url}>
                  {item.title ?? item.filename ?? item.url}
                </div>
                {(item.title || item.filename) && <div className="queue-row__url">{item.url}</div>}
                <div className="queue-row__meta">
                  {item.source && <span className="badge-source">{item.source}</span>}
                  <span className="queue-row__duration">{formatDuration(item.duration_seconds)}</span>
                </div>
              </div>
              <button disabled={busyIds.has(item.id)} onClick={() => handleStart(item.id)}>
                Starten
              </button>
              <button
                className="icon-btn"
                aria-label={`"${item.title ?? item.filename ?? item.url}" aus der Warteschlange entfernen`}
                disabled={busyIds.has(item.id)}
                onClick={() => handleRemove(item.id)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
          </ul>
        </>
      )}
    </div>
  )
}
