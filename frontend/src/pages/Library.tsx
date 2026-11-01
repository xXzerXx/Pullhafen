import { useMemo, useState } from 'react'
import { items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import type { Item } from '../types'
import { Thumbnail } from '../components/Thumbnail'
import { VideoPlayer } from '../components/VideoPlayer'
import { PlayIcon, FolderIcon, DownloadIcon } from '../components/icons'
import { formatDuration, formatRelative } from '../format'
import { ToggleSwitch } from '../components/ToggleSwitch'

function LibraryCard({ item, onPlay }: { item: Item; onPlay: (item: Item) => void }) {
  const { reload } = useItems()
  const [tagsInput, setTagsInput] = useState(item.tags.join(', '))
  const [performersInput, setPerformersInput] = useState(item.performers.join(', '))
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

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

  async function copyPath() {
    if (!item.file_path) return
    try {
      await navigator.clipboard.writeText(item.file_path)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Zwischenablage evtl. nicht erlaubt (z.B. kein HTTPS) - Pfad bleibt
      // trotzdem als Titel-Attribut am Button sichtbar.
    }
  }

  return (
    <div className="library-card">
      <Thumbnail item={item} className="library-card__thumb">
        <span className="library-card__duration-badge">{formatDuration(item.duration_seconds)}</span>
      </Thumbnail>
      <div className="library-card__body">
        <div className="library-card__title" title={item.filename ?? item.url}>
          {item.filename ?? item.url}
        </div>
        <div className="library-card__meta">
          {item.source && <span className="badge-source">{item.source}</span>}
          <span className="library-card__added">{formatRelative(item.created_at)}</span>
          {item.restricted && <span className="badge-restricted">Eingeschränkt</span>}
        </div>

        <div className="library-card__edit">
          <label>
            Tags (kommagetrennt)
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={saveTags}
              onKeyDown={(e) => {
                // Enter ist die naheliegende Erwartung zum Bestätigen - vorher
                // griff nur onBlur, Enter tat buchstäblich nichts (echter
                // Fund: Thomas tippte Tags, drückte Enter, nichts wurde
                // gespeichert). blur() löst onBlur ohnehin aus, kein doppeltes
                // Speichern.
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </label>
          <label>
            Darsteller:innen
            <input
              value={performersInput}
              onChange={(e) => setPerformersInput(e.target.value)}
              onBlur={savePerformers}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </label>
        </div>
        {(item.tags.length > 0 || item.performers.length > 0) && (
          <div className="library-card__tags">
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

        <div className="library-card__override">
          <span>Einschränkung:</span>
          <button
            disabled={saving}
            className={item.restricted_override === true ? 'active' : ''}
            onClick={() => setOverride(true)}
          >
            Ja
          </button>
          <button
            disabled={saving}
            className={item.restricted_override === false ? 'active' : ''}
            onClick={() => setOverride(false)}
          >
            Nein
          </button>
          <button disabled={saving || item.restricted_override === null} onClick={() => setOverride(null)}>
            Auto
          </button>
        </div>

        <div className="library-card__actions">
          <button className="library-card__play" onClick={() => onPlay(item)}>
            <PlayIcon size={13} />
            Abspielen
          </button>
          <a
            href={itemsApi.streamUrl(item.id)}
            download={item.filename ?? undefined}
            aria-label="Datei herunterladen"
            title="Herunterladen (falls Abspielen im Browser nicht geht, z.B. in Safari)"
          >
            <DownloadIcon />
          </a>
          <button
            aria-label="Speicherort kopieren"
            title={item.file_path ?? undefined}
            onClick={copyPath}
          >
            {copied ? '✓' : <FolderIcon />}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Library({ search, onSearchChange }: { search: string; onSearchChange: (v: string) => void }) {
  const { items } = useItems()
  const [tagFilter, setTagFilter] = useState('')
  const [performerFilter, setPerformerFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'title'>('newest')
  const [playing, setPlaying] = useState<Item | null>(null)
  // Standardmäßig an (Datenschutz war der eigentliche Grund für die ganze
  // Einschränkungs-Logik, siehe Plan) - bewusst kein persistenter Zustand,
  // damit es nie "versehentlich dauerhaft sichtbar" bleibt.
  const [hideRestricted, setHideRestricted] = useState(true)

  const completed = items.filter((i) => i.status === 'completed')
  const restrictedCount = completed.filter((i) => i.restricted).length

  const allTags = useMemo(() => Array.from(new Set(completed.flatMap((i) => i.tags))).sort(), [completed])
  const allPerformers = useMemo(
    () => Array.from(new Set(completed.flatMap((i) => i.performers))).sort(),
    [completed],
  )
  const allSources = useMemo(
    () => Array.from(new Set(completed.map((i) => i.source).filter((s): s is string => !!s))).sort(),
    [completed],
  )

  const filtered = completed
    .filter((i) => {
      if (hideRestricted && i.restricted) return false
      if (search && !(i.filename ?? i.url).toLowerCase().includes(search.toLowerCase())) return false
      if (tagFilter && !i.tags.includes(tagFilter)) return false
      if (performerFilter && !i.performers.includes(performerFilter)) return false
      if (sourceFilter && i.source !== sourceFilter) return false
      return true
    })
    .sort((a, b) => {
      if (sortOrder === 'title') return (a.filename ?? a.url).localeCompare(b.filename ?? b.url)
      const cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortOrder === 'newest' ? -cmp : cmp
    })

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <div className="section-head__title">Bibliothek</div>
          <div className="section-head__subtitle">
            {filtered.length} von {completed.length} Videos angezeigt
            {restrictedCount > 0 && hideRestricted && ` (${restrictedCount} eingeschränkt ausgeblendet)`}
          </div>
        </div>
        <ToggleSwitch
          label="Eingeschränkte Inhalte ausblenden"
          checked={hideRestricted}
          onChange={setHideRestricted}
        />
      </div>

      <div className="library-toolbar">
        <input
          type="search"
          placeholder="Suchen…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <span className="filter-chip">
          Website
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">alle</option>
            {allSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </span>
        <span className="filter-chip">
          Tags
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">alle</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </span>
        <span className="filter-chip">
          Darsteller:innen
          <select value={performerFilter} onChange={(e) => setPerformerFilter(e.target.value)}>
            <option value="">alle</option>
            {allPerformers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </span>
        <span className="filter-chip">
          Sortierung
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}>
            <option value="newest">neueste zuerst</option>
            <option value="oldest">älteste zuerst</option>
            <option value="title">Titel A–Z</option>
          </select>
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-hint">Nichts gefunden.</p>
      ) : (
        <div className="library-grid">
          {filtered.map((item) => (
            <LibraryCard key={item.id} item={item} onPlay={setPlaying} />
          ))}
        </div>
      )}

      {playing && <VideoPlayer item={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}
