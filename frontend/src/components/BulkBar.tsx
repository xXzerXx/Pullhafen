import { TrashIcon, PlayIcon } from './icons'

export function BulkBar({
  count,
  busy,
  onDelete,
  onClear,
  onStart,
}: {
  count: number
  busy: boolean
  onDelete: () => void
  onClear: () => void
  /** Nur in der Warteschlange gesetzt - "alles laden" für die Auswahl. */
  onStart?: () => void
}) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Sammelaktionen">
      <span className="bulk-bar__count">{count} ausgewählt</span>
      {onStart && (
        <button className="bulk-bar__start" disabled={busy} onClick={onStart}>
          <PlayIcon size={13} />
          Alle laden
        </button>
      )}
      <button className="bulk-bar__delete" disabled={busy} onClick={onDelete}>
        <TrashIcon size={13} />
        Löschen
      </button>
      <button className="bulk-bar__clear" disabled={busy} onClick={onClear}>
        Auswahl aufheben
      </button>
    </div>
  )
}
