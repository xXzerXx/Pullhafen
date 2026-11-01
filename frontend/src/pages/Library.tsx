import { useMemo, useState } from 'react'
import { items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import type { Item } from '../types'

function LibraryRow({ item }: { item: Item }) {
  const { reload } = useItems()
  const [tagsInput, setTagsInput] = useState(item.tags.join(', '))
  const [performersInput, setPerformersInput] = useState(item.performers.join(', '))
  const [saving, setSaving] = useState(false)

  function parseList(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async function saveTags() {
    setSaving(true)
    try {
      await itemsApi.setTags(item.id, parseList(tagsInput))
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function savePerformers() {
    setSaving(true)
    try {
      await itemsApi.setPerformers(item.id, parseList(performersInput))
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function setOverride(value: boolean | null) {
    setSaving(true)
    try {
      await itemsApi.setRestrictedOverride(item.id, value)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="library-row">
      <div className="library-row__header">
        <span className="item-row__name" title={item.url}>
          {item.filename ?? item.url}
        </span>
        {item.restricted && <span className="badge badge--restricted">Eingeschränkt</span>}
        {item.hidden_from_downloads && <span className="badge badge--hidden">Aufgeräumt</span>}
      </div>
      <div className="library-row__fields">
        <label>
          Tags
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} onBlur={saveTags} />
        </label>
        <label>
          Darsteller:innen
          <input
            value={performersInput}
            onChange={(e) => setPerformersInput(e.target.value)}
            onBlur={savePerformers}
          />
        </label>
      </div>
      <div className="library-row__override">
        <span>Manueller Override:</span>
        <button disabled={saving} className={item.restricted_override === true ? 'active' : ''} onClick={() => setOverride(true)}>
          Eingeschränkt
        </button>
        <button
          disabled={saving}
          className={item.restricted_override === false ? 'active' : ''}
          onClick={() => setOverride(false)}
        >
          Nicht eingeschränkt
        </button>
        <button disabled={saving || item.restricted_override === null} onClick={() => setOverride(null)}>
          Zurücksetzen
        </button>
      </div>
    </li>
  )
}

export function Library() {
  const { items } = useItems()
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [performerFilter, setPerformerFilter] = useState('')

  const allTags = useMemo(() => Array.from(new Set(items.flatMap((i) => i.tags))).sort(), [items])
  const allPerformers = useMemo(
    () => Array.from(new Set(items.flatMap((i) => i.performers))).sort(),
    [items],
  )

  const filtered = items.filter((i) => {
    if (search && !(i.filename ?? i.url).toLowerCase().includes(search.toLowerCase())) return false
    if (tagFilter && !i.tags.includes(tagFilter)) return false
    if (performerFilter && !i.performers.includes(performerFilter)) return false
    return true
  })

  return (
    <div className="page">
      <div className="page__toolbar">
        <input placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">Alle Tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={performerFilter} onChange={(e) => setPerformerFilter(e.target.value)}>
          <option value="">Alle Darsteller:innen</option>
          {allPerformers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="empty-hint">Nichts gefunden.</p>
      ) : (
        <ul className="item-list">
          {filtered.map((item) => (
            <LibraryRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}
