import { useState } from 'react'
import { items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import { Thumbnail } from '../components/Thumbnail'
import { CloseIcon } from '../components/icons'
import { formatDuration } from '../format'

export function Queue() {
  const { items, removeItem } = useItems()
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())

  // Warteschlange = wirklich wartend, noch nicht gestartet (siehe Vorschau) -
  // sobald ein Download läuft oder pausiert ist, gehört er in den
  // Downloads-Reiter.
  const queued = items.filter((i) => i.status === 'queued')

  function setBusy(id: number, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleStart(id: number) {
    setBusy(id, true)
    try {
      await itemsApi.start(id)
    } finally {
      setBusy(id, false)
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
        <ul className="item-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {queued.map((item) => (
            <li key={item.id} className="queue-row">
              <Thumbnail item={item} className="queue-row__thumb" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="queue-row__title" title={item.url}>
                  {item.filename ?? item.url}
                </div>
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
                aria-label={`"${item.filename ?? item.url}" aus der Warteschlange entfernen`}
                disabled={busyIds.has(item.id)}
                onClick={() => handleRemove(item.id)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
