import { useEffect, useState } from 'react'
import { ApiError, apiTokens, type ApiTokenInfo, settings as settingsApi } from '../api'
import type { AppSettings } from '../types'

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [downloadsSubpathInput, setDownloadsSubpathInput] = useState('')
  const [threshold, setThreshold] = useState(18)
  const [domains, setDomains] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([])
  const [newTokenLabel, setNewTokenLabel] = useState('')
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadAll() {
    const [s, t, d, tok] = await Promise.all([
      settingsApi.get(),
      settingsApi.getRestrictedThreshold(),
      settingsApi.listRestrictedDomains(),
      apiTokens.list(),
    ])
    setSettings(s)
    setTokens(tok)
    setDownloadsSubpathInput(s.downloads_subpath)
    setThreshold(t.threshold)
    setDomains(d)
  }

  useEffect(() => {
    loadAll().finally(() => setLoading(false))
  }, [])

  async function patch(body: Partial<AppSettings>) {
    setError(null)
    try {
      const updated = await settingsApi.patch(body)
      setSettings(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.')
    }
  }

  async function saveDownloadsSubpath() {
    setError(null)
    try {
      const res = await settingsApi.setDownloadsRoot(downloadsSubpathInput)
      setSettings((prev) => (prev ? { ...prev, downloads_subpath: res.subpath, resolved_downloads_path: res.resolved_path } : prev))
      setDownloadsSubpathInput(res.subpath)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ungültiger Pfad.')
    }
  }

  async function saveThreshold() {
    setError(null)
    try {
      const res = await settingsApi.setRestrictedThreshold(threshold)
      setThreshold(res.threshold)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ungültiger Schwellenwert.')
    }
  }

  async function addDomain() {
    if (!newDomain.trim()) return
    const updated = await settingsApi.addRestrictedDomain(newDomain.trim())
    setDomains(updated)
    setNewDomain('')
  }

  async function removeDomain(domain: string) {
    const updated = await settingsApi.removeRestrictedDomain(domain)
    setDomains(updated)
  }

  async function createToken() {
    if (!newTokenLabel.trim()) return
    const created = await apiTokens.create(newTokenLabel.trim())
    setJustCreatedToken(created.token)
    setNewTokenLabel('')
    setTokens(await apiTokens.list())
  }

  async function removeToken(id: number) {
    await apiTokens.remove(id)
    setTokens(await apiTokens.list())
  }

  if (loading || !settings) return <div className="page">Lädt…</div>

  return (
    <div className="page settings-page">
      {error && <p className="error-text">{error}</p>}

      <section>
        <h2>Downloads</h2>
        <label>
          Downloadordner (Unterpfad im Volume)
          <input
            value={downloadsSubpathInput}
            onChange={(e) => setDownloadsSubpathInput(e.target.value)}
            onBlur={saveDownloadsSubpath}
          />
        </label>
        <p className="hint">Tatsächlicher Pfad: {settings.resolved_downloads_path}</p>

        <label>
          Standardqualität (yt-dlp-Format)
          <input
            defaultValue={settings.default_quality}
            onBlur={(e) => patch({ default_quality: e.target.value })}
          />
        </label>

        <label>
          Maximale parallele Downloads
          <input
            type="number"
            min={1}
            defaultValue={settings.max_concurrent_downloads}
            onBlur={(e) => patch({ max_concurrent_downloads: Number(e.target.value) })}
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.autostart}
            onChange={(e) => patch({ autostart: e.target.checked })}
          />
          Neue Links automatisch starten
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.auto_remove_completed}
            onChange={(e) => patch({ auto_remove_completed: e.target.checked })}
          />
          Abgeschlossene Downloads automatisch aus der Liste entfernen
        </label>
      </section>

      <section>
        <h2>Einschränkungs-Logik</h2>
        <label>
          Schwellenwert (age_limit)
          <input
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            onBlur={saveThreshold}
          />
        </label>

        <div>
          <p className="hint">Domains, die immer als eingeschränkt gelten:</p>
          <ul className="domain-list">
            {domains.map((d) => (
              <li key={d}>
                {d} <button onClick={() => removeDomain(d)}>Entfernen</button>
              </li>
            ))}
            {domains.length === 0 && <li className="empty-hint">Keine Domains gelistet.</li>}
          </ul>
          <div className="add-link-form">
            <input
              placeholder="z.B. example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
            />
            <button onClick={addDomain} disabled={!newDomain.trim()}>
              Hinzufügen
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2>Browser-Extension</h2>
        <p className="hint">
          Token für die Extension erzeugen und in deren Optionsseite zusammen mit dieser Server-Adresse
          eintragen. Der Klartext wird nur einmal angezeigt.
        </p>
        {justCreatedToken && (
          <p className="hint">
            Neuer Token (jetzt kopieren, wird nicht nochmal angezeigt): <code>{justCreatedToken}</code>
          </p>
        )}
        <ul className="domain-list">
          {tokens.map((t) => (
            <li key={t.id}>
              {t.label} <button onClick={() => removeToken(t.id)}>Entfernen</button>
            </li>
          ))}
          {tokens.length === 0 && <li className="empty-hint">Noch kein Token erzeugt.</li>}
        </ul>
        <div className="add-link-form">
          <input
            placeholder="Bezeichnung, z.B. 'Firefox am Laptop'"
            value={newTokenLabel}
            onChange={(e) => setNewTokenLabel(e.target.value)}
          />
          <button onClick={createToken} disabled={!newTokenLabel.trim()}>
            Token erzeugen
          </button>
        </div>
      </section>
    </div>
  )
}
