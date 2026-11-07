import { useMemo, useState } from 'react'
import { auth, items as itemsApi } from '../api'
import { useItems } from '../ItemsContext'
import { useSelection } from '../useSelection'
import type { Item } from '../types'
import { Thumbnail } from '../components/Thumbnail'
import { BulkBar } from '../components/BulkBar'
import { VideoPlayer } from '../components/VideoPlayer'
import {
  PlayIcon,
  DownloadIcon,
  TrashIcon,
  MusicNoteIcon,
  MusicDownloadIcon,
  SpinnerIcon,
  InfoIcon,
  CloseIcon,
} from '../components/icons'
import { formatBytes, formatDuration, formatRelative } from '../format'
import { ToggleSwitch } from '../components/ToggleSwitch'
import { TagEditor } from '../components/TagEditor'

const QUALITY_LABELS: Record<string, string> = {
  best: 'Beste Qualität',
  '1080p': '1080p',
  '720p': '720p',
  audio: 'Nur Audio',
  compatible: 'Kompatibel (H.264/AAC)',
}

interface LibraryCardProps {
  item: Item
  onPlay: (item: Item) => void
  knownTags: string[]
  knownPerformers: string[]
  selected: boolean
  onToggleSelect: () => void
}

function LibraryCard({ item, onPlay, knownTags, knownPerformers, selected, onToggleSelect }: LibraryCardProps) {
  const { reload, removeItem } = useItems()
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)

  async function saveTags(next: string[]) {
    await itemsApi.setTags(item.id, next)
    await reload()
  }

  async function savePerformers(next: string[]) {
    await itemsApi.setPerformers(item.id, next)
    await reload()
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

  async function handleConvertAudio() {
    setConverting(true)
    setConvertError(null)
    try {
      await itemsApi.convertAudio(item.id)
      await reload()
    } catch {
      setConvertError('Umwandlung fehlgeschlagen.')
    } finally {
      setConverting(false)
    }
  }

  async function handleDelete() {
    const label = item.title ?? item.filename ?? item.url
    const confirmed = window.confirm(
      `"${label}" wirklich endgültig löschen? Die Datei auf der Platte wird dabei mit entfernt - das lässt sich nicht rückgängig machen.`,
    )
    if (!confirmed) return
    setDeleting(true)
    try {
      await removeItem(item.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="library-card">
      <Thumbnail item={item} className="library-card__thumb" onClick={() => onPlay(item)}>
        <input
          type="checkbox"
          className="library-card__checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={`"${item.title ?? item.filename ?? item.url}" auswählen`}
        />
        <span className="library-card__duration-badge">{formatDuration(item.duration_seconds)}</span>
      </Thumbnail>
      <div className="library-card__body">
        <div className="library-card__title" title={item.title ?? item.filename ?? item.url}>
          {item.title ?? item.filename ?? item.url}
        </div>
        <div className="library-card__meta">
          {item.source && <span className="badge-source">{item.source}</span>}
          {item.channel && <span className="badge-source">{item.channel}</span>}
          <span className="library-card__added">{formatRelative(item.created_at)}</span>
          {item.restricted && <span className="badge-restricted">Eingeschränkt</span>}
        </div>

        <div className="library-card__edit">
          <TagEditor label="Tags" values={item.tags} knownValues={knownTags} onChange={saveTags} />
          <TagEditor
            label="Darsteller:innen"
            values={item.performers}
            chipClassName="chip--performer"
            knownValues={knownPerformers}
            onChange={savePerformers}
          />
        </div>

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
          {item.audio_path ? (
            <a
              href={itemsApi.audioUrl(item.id)}
              download
              aria-label="MP3 herunterladen"
              title="Fertig umgewandelt - MP3 herunterladen"
            >
              <MusicDownloadIcon />
            </a>
          ) : (
            <button
              className="library-card__icon-btn"
              aria-label={converting ? 'Wird umgewandelt' : 'Zu MP3 umwandeln'}
              title={convertError ?? (converting ? 'Wird gerade in MP3 umgewandelt…' : 'Audiospur als MP3 extrahieren')}
              disabled={converting}
              onClick={handleConvertAudio}
            >
              {converting ? <SpinnerIcon /> : <MusicNoteIcon />}
            </button>
          )}
          <button
            className="library-card__icon-btn"
            aria-label="Dateiinfos"
            title="Pfad, Qualität und weitere Infos anzeigen"
            onClick={() => setShowInfo((v) => !v)}
          >
            <InfoIcon />
          </button>
          <button
            className="library-card__delete"
            aria-label="Löschen"
            title="Video und Datei endgültig löschen"
            disabled={deleting}
            onClick={handleDelete}
          >
            <TrashIcon />
          </button>
        </div>

        {showInfo && (
          <div className="library-card__info">
            <div className="library-card__info-head">
              <span>Dateiinfos</span>
              <button className="icon-btn" aria-label="Schließen" onClick={() => setShowInfo(false)}>
                <CloseIcon size={14} />
              </button>
            </div>
            <dl>
              <dt>Pfad</dt>
              <dd>
                <code title={item.file_path ?? undefined}>{item.file_path ?? '—'}</code>
                {item.file_path && (
                  <button className="library-card__info-copy" onClick={copyPath}>
                    {copied ? 'Kopiert ✓' : 'Kopieren'}
                  </button>
                )}
              </dd>
              <dt>Qualität</dt>
              <dd>{item.quality_preset ? (QUALITY_LABELS[item.quality_preset] ?? item.quality_preset) : '—'}</dd>
              <dt>Größe</dt>
              <dd>{formatBytes(item.total_bytes)}</dd>
              <dt>Quelle</dt>
              <dd>{item.engine === 'ytdlp' ? item.source ?? 'Video' : 'Datei-Download'}</dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}

export function Library({ search, onSearchChange }: { search: string; onSearchChange: (v: string) => void }) {
  const { items, removeItems } = useItems()
  const [bulkBusy, setBulkBusy] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [performerFilter, setPerformerFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'title'>('newest')
  const [playing, setPlaying] = useState<Item | null>(null)
  // Standardmäßig an (Datenschutz war der eigentliche Grund für die ganze
  // Einschränkungs-Logik, siehe Plan) - bewusst kein persistenter Zustand,
  // damit es nie "versehentlich dauerhaft sichtbar" bleibt.
  const [hideRestricted, setHideRestricted] = useState(true)
  // Nur das SICHTBARMACHEN eingeschränkter Inhalte braucht eine echte
  // Passwortbestätigung (Thomas' Wunsch) - das Zurück-Verstecken bleibt ein
  // einfacher Klick, da es nie etwas zusätzlich offenlegt.
  const [pendingUnhide, setPendingUnhide] = useState(false)
  const [unhidePassword, setUnhidePassword] = useState('')
  const [unhideError, setUnhideError] = useState<string | null>(null)

  function handleHideRestrictedChange(checked: boolean) {
    if (checked) {
      setHideRestricted(true)
      setPendingUnhide(false)
      return
    }
    setPendingUnhide(true)
    setUnhidePassword('')
    setUnhideError(null)
  }

  async function confirmUnhide() {
    try {
      const res = await auth.verifyPassword(unhidePassword)
      if (res.valid) {
        setHideRestricted(false)
        setPendingUnhide(false)
        setUnhidePassword('')
      } else {
        setUnhideError('Falsches Passwort.')
      }
    } catch {
      setUnhideError('Prüfung fehlgeschlagen.')
    }
  }

  function cancelUnhide() {
    setPendingUnhide(false)
    setUnhidePassword('')
    setUnhideError(null)
  }

  const completed = items.filter((i) => i.status === 'completed')
  const restrictedCount = completed.filter((i) => i.restricted).length

  // Tags bewusst GETRENNT nach Einschränkung berechnet, nicht als eine
  // gemeinsame Liste (Thomas' Wunsch) - sonst würde ein Tag, das nur an
  // eingeschränkten Videos hängt, über Filter-Dropdown/Autocomplete
  // sichtbar bleiben, selbst während "Eingeschränkte Inhalte ausblenden"
  // aktiv ist. Derselbe Tagname darf dadurch in beiden Listen auftauchen -
  // das ist hier ausdrücklich erwünscht, es sind zwei getrennte Textlisten,
  // keine gemeinsame Identität.
  const freeTags = useMemo(
    () => Array.from(new Set(completed.filter((i) => !i.restricted).flatMap((i) => i.tags))).sort(),
    [completed],
  )
  const restrictedTags = useMemo(
    () => Array.from(new Set(completed.filter((i) => i.restricted).flatMap((i) => i.tags))).sort(),
    [completed],
  )
  // Gleiche Trennung wie bei Tags, auf Thomas' Wunsch auch für
  // Darsteller:innen (siehe freeTags/restrictedTags oben).
  const freePerformers = useMemo(
    () => Array.from(new Set(completed.filter((i) => !i.restricted).flatMap((i) => i.performers))).sort(),
    [completed],
  )
  const restrictedPerformers = useMemo(
    () => Array.from(new Set(completed.filter((i) => i.restricted).flatMap((i) => i.performers))).sort(),
    [completed],
  )
  const allSources = useMemo(
    () => Array.from(new Set(completed.map((i) => i.source).filter((s): s is string => !!s))).sort(),
    [completed],
  )
  const allChannels = useMemo(
    () => Array.from(new Set(completed.map((i) => i.channel).filter((c): c is string => !!c))).sort(),
    [completed],
  )

  const filtered = completed
    .filter((i) => {
      if (hideRestricted && i.restricted) return false
      const label = (i.title ?? i.filename ?? i.url).toLowerCase()
      if (search && !label.includes(search.toLowerCase())) return false
      if (tagFilter && !i.tags.includes(tagFilter)) return false
      if (performerFilter && !i.performers.includes(performerFilter)) return false
      if (sourceFilter && i.source !== sourceFilter) return false
      if (channelFilter && i.channel !== channelFilter) return false
      return true
    })
    .sort((a, b) => {
      if (sortOrder === 'title') {
        return (a.title ?? a.filename ?? a.url).localeCompare(b.title ?? b.filename ?? b.url)
      }
      const cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortOrder === 'newest' ? -cmp : cmp
    })

  const { selected, toggle, toggleAll, allSelected, clear } = useSelection(filtered.map((i) => i.id))

  async function handleBulkDelete() {
    const ids = Array.from(selected)
    const confirmed = window.confirm(
      `${ids.length} Videos wirklich endgültig löschen? Die Dateien auf der Platte werden dabei mit entfernt - das lässt sich nicht rückgängig machen.`,
    )
    if (!confirmed) return
    setBulkBusy(true)
    try {
      const failed = await removeItems(ids)
      if (failed.length > 0) {
        window.alert(`${failed.length} Video(s) konnten nicht gelöscht werden.`)
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
          <div className="section-head__title">Bibliothek</div>
          <div className="section-head__subtitle">
            {filtered.length} von {completed.length} Videos angezeigt
            {restrictedCount > 0 && hideRestricted && ` (${restrictedCount} eingeschränkt ausgeblendet)`}
          </div>
        </div>
        <ToggleSwitch
          label="Eingeschränkte Inhalte ausblenden"
          checked={hideRestricted}
          onChange={handleHideRestrictedChange}
        />
      </div>

      {pendingUnhide && (
        <div className="inline-form" style={{ marginBottom: 14 }}>
          <input
            type="password"
            placeholder="Eigenes Passwort zum Sichtbarmachen"
            value={unhidePassword}
            onChange={(e) => setUnhidePassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
          <button onClick={confirmUnhide} disabled={!unhidePassword}>
            Bestätigen
          </button>
          <button onClick={cancelUnhide}>Abbrechen</button>
          {unhideError && <span className="error-text">{unhideError}</span>}
        </div>
      )}

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
        {allChannels.length > 0 && (
          <span className="filter-chip">
            Kanal
            <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
              <option value="">alle</option>
              {allChannels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </span>
        )}
        <span className="filter-chip">
          Tags
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">alle</option>
            {freeTags.length > 0 && (
              <optgroup label="Frei">
                {freeTags.map((t) => (
                  <option key={`free-${t}`} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            )}
            {!hideRestricted && restrictedTags.length > 0 && (
              <optgroup label="Eingeschränkt">
                {restrictedTags.map((t) => (
                  <option key={`restricted-${t}`} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </span>
        <span className="filter-chip">
          Darsteller:innen
          <select value={performerFilter} onChange={(e) => setPerformerFilter(e.target.value)}>
            <option value="">alle</option>
            {freePerformers.length > 0 && (
              <optgroup label="Frei">
                {freePerformers.map((p) => (
                  <option key={`free-${p}`} value={p}>
                    {p}
                  </option>
                ))}
              </optgroup>
            )}
            {!hideRestricted && restrictedPerformers.length > 0 && (
              <optgroup label="Eingeschränkt">
                {restrictedPerformers.map((p) => (
                  <option key={`restricted-${p}`} value={p}>
                    {p}
                  </option>
                ))}
              </optgroup>
            )}
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
        <>
          <label className="select-all-row">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Alle angezeigten markieren
          </label>
          <BulkBar count={selected.size} busy={bulkBusy} onDelete={handleBulkDelete} onClear={clear} />
          <div className="library-grid">
            {filtered.map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                onPlay={setPlaying}
                knownTags={item.restricted ? restrictedTags : freeTags}
                knownPerformers={item.restricted ? restrictedPerformers : freePerformers}
                selected={selected.has(item.id)}
                onToggleSelect={() => toggle(item.id)}
              />
            ))}
          </div>
        </>
      )}

      {playing && <VideoPlayer item={playing} onClose={() => setPlaying(null)} />}
    </div>
  )
}
