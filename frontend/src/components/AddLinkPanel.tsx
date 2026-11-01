import { useState } from 'react'
import { useItems } from '../ItemsContext'
import { FileTextIcon } from './icons'

export interface AddLinkResult {
  succeeded: number
  duplicates: number
  failures: string[]
}

export function AddLinkPanel({ onDone }: { onDone: (result: AddLinkResult) => void }) {
  const { addLink } = useItems()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await file.text()
    setText((prev) => (prev ? `${prev}\n${content}` : content))
    e.target.value = ''
  }

  async function handleSubmit() {
    const urls = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (urls.length === 0) return
    setBusy(true)
    let succeeded = 0
    let duplicates = 0
    const failures: string[] = []
    for (const url of urls) {
      try {
        const item = await addLink(url)
        if (item.already_existed) duplicates += 1
        else if (item.status === 'failed') failures.push(item.error_message ?? `${url}: fehlgeschlagen`)
        else succeeded += 1
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `${url}: fehlgeschlagen`)
      }
    }
    setBusy(false)
    onDone({ succeeded, duplicates, failures })
  }

  return (
    <div className="add-panel">
      <div className="add-panel__field">
        <label className="add-panel__label" htmlFor="pf-paste">
          Links einfügen (einer pro Zeile)
        </label>
        <textarea
          id="pf-paste"
          rows={3}
          placeholder="https://… — mehrere Zeilen möglich"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      </div>
      <div className="add-panel__actions">
        <label className="add-panel__file-label">
          <FileTextIcon />
          Textdatei öffnen
          <input type="file" accept=".txt" className="sr-only" onChange={handleFile} />
        </label>
        <button className="btn-accent" disabled={busy || !text.trim()} onClick={handleSubmit}>
          {busy ? 'Wird hinzugefügt…' : 'Zur Warteschlange hinzufügen'}
        </button>
      </div>
    </div>
  )
}
