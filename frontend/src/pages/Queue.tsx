import { useState, type FormEvent } from 'react'
import { items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import { ItemRow } from '../components/ItemRow'

export function Queue() {
  const { items, addLink } = useItems()
  const [url, setUrl] = useState('')
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const active = items.filter((i) => i.status === 'queued' || i.status === 'downloading' || i.status === 'paused')

  function setBusy(id: number, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setAdding(true)
    setError(null)
    try {
      await addLink(url.trim())
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link konnte nicht hinzugefügt werden.')
    } finally {
      setAdding(false)
    }
  }

  async function run(id: number, action: (id: number) => Promise<unknown>) {
    setBusy(id, true)
    try {
      await action(id)
    } finally {
      setBusy(id, false)
    }
  }

  return (
    <div className="page">
      <form className="add-link-form" onSubmit={handleSubmit}>
        <input
          placeholder="Link einfügen (Video oder Datei)…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" disabled={adding || !url.trim()}>
          Hinzufügen
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {active.length === 0 ? (
        <p className="empty-hint">Nichts in der Warteschlange.</p>
      ) : (
        <ul className="item-list">
          {active.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              busy={busyIds.has(item.id)}
              onPause={() => run(item.id, itemsApi.pause)}
              onResume={() => run(item.id, itemsApi.resume)}
              onStart={() => run(item.id, itemsApi.start)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
