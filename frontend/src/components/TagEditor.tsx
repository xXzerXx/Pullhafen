import { useMemo, useRef, useState } from 'react'
import { CloseIcon } from './icons'

interface TagEditorProps {
  label: string
  values: string[]
  chipClassName?: string
  /** Bereits anderswo verwendete Werte, fürs Autocomplete-Hilfsfenster. */
  knownValues?: string[]
  onChange: (next: string[]) => Promise<void>
}

const COLLAPSE_AFTER = 5

export function TagEditor({ label, values, chipClassName, knownValues, onChange }: TagEditorProps) {
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [focused, setFocused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [lastRemoved, setLastRemoved] = useState<{ value: string; index: number } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearUndoTimer() {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
  }

  async function add(value: string) {
    const clean = value.trim()
    if (!clean || values.includes(clean)) {
      setInput('')
      return
    }
    setSaving(true)
    try {
      await onChange([...values, clean])
      setInput('')
    } finally {
      setSaving(false)
    }
  }

  async function removeAt(index: number) {
    const removedValue = values[index]
    const next = values.filter((_, i) => i !== index)
    setSaving(true)
    try {
      await onChange(next)
      clearUndoTimer()
      setLastRemoved({ value: removedValue, index })
      undoTimer.current = setTimeout(() => setLastRemoved(null), 6000)
    } finally {
      setSaving(false)
    }
  }

  async function undo() {
    if (!lastRemoved) return
    const restored = [...values]
    restored.splice(Math.min(lastRemoved.index, restored.length), 0, lastRemoved.value)
    setSaving(true)
    try {
      await onChange(restored)
      clearUndoTimer()
      setLastRemoved(null)
    } finally {
      setSaving(false)
    }
  }

  const suggestions = useMemo(() => {
    if (!knownValues || knownValues.length === 0) return []
    const query = input.trim().toLowerCase()
    return knownValues
      .filter((v) => !values.includes(v))
      .filter((v) => !query || v.toLowerCase().includes(query))
      .slice(0, 8)
  }, [knownValues, input, values])

  const showSuggestions = focused && suggestions.length > 0
  const visibleValues = expanded ? values : values.slice(0, COLLAPSE_AFTER)
  const hiddenCount = values.length - visibleValues.length

  return (
    <div className="tag-editor">
      <label>
        {label}
        <div style={{ position: 'relative' }}>
          <input
            value={input}
            disabled={saving}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current)
              setFocused(true)
            }}
            onBlur={() => {
              // Kurze Verzögerung, damit ein Klick auf einen Vorschlag noch
              // ankommt, bevor das Hilfsfenster verschwindet (ein Blur feuert
              // sonst VOR dem Klick-Event des Vorschlags).
              blurTimer.current = setTimeout(() => setFocused(false), 150)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add(input)
              }
            }}
            placeholder="Eingeben, Enter zum Hinzufügen…"
          />
          {showSuggestions && (
            <ul className="tag-editor__suggestions">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void add(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      {values.length > 0 && (
        <div className="tag-editor__chips">
          {visibleValues.map((v) => {
            const idx = values.indexOf(v)
            return (
              <span key={v} className={`chip chip--removable ${chipClassName ?? ''}`}>
                {v}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`"${v}" entfernen`}
                  disabled={saving}
                  onClick={() => removeAt(idx)}
                >
                  <CloseIcon size={10} />
                </button>
              </span>
            )
          })}
          {hiddenCount > 0 && (
            <button type="button" className="tag-editor__expand" onClick={() => setExpanded(true)}>
              +{hiddenCount} weitere
            </button>
          )}
          {expanded && values.length > COLLAPSE_AFTER && (
            <button type="button" className="tag-editor__expand" onClick={() => setExpanded(false)}>
              weniger anzeigen
            </button>
          )}
        </div>
      )}
      {lastRemoved && (
        <p className="tag-editor__undo">
          "{lastRemoved.value}" entfernt.{' '}
          <button type="button" onClick={undo}>
            Rückgängig
          </button>
        </p>
      )}
    </div>
  )
}
