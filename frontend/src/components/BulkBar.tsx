import { TrashIcon } from './icons'

export function BulkBar({
  count,
  busy,
  onDelete,
  onClear,
}: {
  count: number
  busy: boolean
  onDelete: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Sammelaktionen">
      <span className="bulk-bar__count">{count} ausgewählt</span>
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
