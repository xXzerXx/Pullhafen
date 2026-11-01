import { useState } from 'react'
import { downloads, items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import { ItemRow } from '../components/ItemRow'

export function Downloads() {
  const { items, reload } = useItems()
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [cleaning, setCleaning] = useState(false)

  const finished = items.filter(
    (i) => (i.status === 'completed' || i.status === 'failed') && !i.hidden_from_downloads,
  )

  function setBusy(id: number, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleRestart(id: number) {
    setBusy(id, true)
    try {
      await itemsApi.restart(id)
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

  return (
    <div className="page">
      <div className="page__toolbar">
        <button onClick={handleCleanup} disabled={cleaning || finished.length === 0}>
          Aufräumen
        </button>
      </div>
      {finished.length === 0 ? (
        <p className="empty-hint">Keine abgeschlossenen Downloads.</p>
      ) : (
        <ul className="item-list">
          {finished.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              busy={busyIds.has(item.id)}
              onRestart={() => handleRestart(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
