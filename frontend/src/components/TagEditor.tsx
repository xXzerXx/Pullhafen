import { useRef, useState } from 'react'
import { CloseIcon } from './icons'

interface TagEditorProps {
  label: string
  values: string[]
  chipClassName?: string
  onChange: (next: string[]) => Promise<void>
}

export function TagEditor({ label, values, chipClassName, onChange }: TagEditorProps) {
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastRemoved, setLastRemoved] = useState<{ value: string; index: number } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearUndoTimer() {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
  }

  async function commitAdd() {
    const value = input.trim()
    if (!value || values.includes(value)) {
      setInput('')
      return
    }
    setSaving(true)
    try {
      await onChange([...values, value])
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

  return (
    <div className="tag-editor">
      <label>
        {label}
        <input
          value={input}
          disabled={saving}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commitAdd()
            }
          }}
          placeholder="Eingeben, Enter zum Hinzufügen…"
        />
      </label>
      {values.length > 0 && (
        <div className="tag-editor__chips">
          {values.map((v, idx) => (
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
          ))}
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
