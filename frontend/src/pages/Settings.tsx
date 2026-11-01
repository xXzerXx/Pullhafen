import { useEffect, useState } from 'react'
import { ApiError, apiTokens, auth, type ApiTokenInfo, settings as settingsApi } from '../api'
import type { AppSettings } from '../types'
import { ToggleSwitch } from '../components/ToggleSwitch'

const QUALITY_PRESETS = [
  { label: 'Bestmöglich', value: 'bestvideo+bestaudio/best' },
  { label: '1080p', value: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]' },
  { label: '720p', value: 'bestvideo[height<=720]+bestaudio/best[height<=720]' },
  { label: 'Nur Audio', value: 'bestaudio/best' },
]

const AGE_THRESHOLD_PRESETS = [
  { label: 'Keine Alterseinschränkung beachten (0)', value: 0 },
  { label: 'Ab 13', value: 13 },
  { label: 'Ab 16', value: 16 },
  { label: 'Ab 18', value: 18 },
  { label: 'Ab 21', value: 21 },
]

const CUSTOM_PATH_OPTION = '__custom__'

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [pathOptions, setPathOptions] = useState<string[]>([])
  const [customPath, setCustomPath] = useState(false)
  const [downloadsSubpathInput, setDownloadsSubpathInput] = useState('')
  const [threshold, setThreshold] = useState(18)
  const [domains, setDomains] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([])
  const [newTokenLabel, setNewTokenLabel] = useState('')
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('')
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadAll() {
    const [s, t, d, tok, opts] = await Promise.all([
      settingsApi.get(),
      settingsApi.getRestrictedThreshold(),
      settingsApi.listRestrictedDomains(),
      apiTokens.list(),
      settingsApi.listDownloadsRootOptions(),
    ])
    setSettings(s)
    setTokens(tok)
    setPathOptions(opts)
    setDownloadsSubpathInput(s.downloads_subpath)
    setCustomPath(s.downloads_subpath !== '' && !opts.includes(s.downloads_subpath))
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

  async function saveDownloadsSubpath(subpath: string) {
    setError(null)
    try {
      const res = await settingsApi.setDownloadsRoot(subpath)
      setSettings((prev) =>
        prev ? { ...prev, downloads_subpath: res.subpath, resolved_downloads_path: res.resolved_path } : prev,
      )
      setDownloadsSubpathInput(res.subpath)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ungültiger Pfad.')
    }
  }

  function handlePathSelect(value: string) {
    if (value === CUSTOM_PATH_OPTION) {
      setCustomPath(true)
      return
    }
    setCustomPath(false)
    setDownloadsSubpathInput(value)
    void saveDownloadsSubpath(value)
  }

  async function saveThreshold(value: number) {
    setError(null)
    setThreshold(value)
    try {
      await settingsApi.setRestrictedThreshold(value)
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

  async function handleChangePassword() {
    setPasswordStatus(null)
    if (newPassword !== newPasswordRepeat) {
      setPasswordStatus('Die beiden neuen Passwörter stimmen nicht überein.')
      return
    }
    try {
      await auth.changePassword(currentPassword, newPassword)
      setPasswordStatus('Passwort geändert.')
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordRepeat('')
    } catch (err) {
      setPasswordStatus(err instanceof ApiError ? err.message : 'Ändern fehlgeschlagen.')
    }
  }

  if (loading || !settings) return <div className="page">Lädt…</div>

  const matchingQuality = QUALITY_PRESETS.find((q) => q.value === settings.default_quality)

  return (
    <div className="page settings-page">
      {error && <p className="error-text">{error}</p>}

      <section>
        <h2>Downloads</h2>
        <label>
          Downloadordner
          <select value={customPath ? CUSTOM_PATH_OPTION : downloadsSubpathInput} onChange={(e) => handlePathSelect(e.target.value)}>
            <option value="">Wurzel des Downloads-Volumes</option>
            {pathOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
            <option value={CUSTOM_PATH_OPTION}>Anderer Pfad…</option>
          </select>
        </label>
        {customPath && (
          <input
            placeholder="z.B. filme/2026"
            value={downloadsSubpathInput}
            onChange={(e) => setDownloadsSubpathInput(e.target.value)}
            onBlur={(e) => saveDownloadsSubpath(e.target.value)}
          />
        )}
        <p className="hint">Tatsächlicher Pfad: {settings.resolved_downloads_path}</p>

        <label>
          Standardqualität
          <select
            value={matchingQuality ? matchingQuality.value : QUALITY_PRESETS[0].value}
            onChange={(e) => patch({ default_quality: e.target.value })}
          >
            {QUALITY_PRESETS.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        {!matchingQuality && (
          <p className="hint">Aktuell gesetzt: {settings.default_quality} (eigener Wert, nicht in der Liste)</p>
        )}

        <label>
          Maximale parallele Downloads
          <select
            value={settings.max_concurrent_downloads}
            onChange={(e) => patch({ max_concurrent_downloads: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <ToggleSwitch
          label="Neue Links automatisch starten"
          checked={settings.autostart}
          onChange={(checked) => patch({ autostart: checked })}
        />
        <ToggleSwitch
          label="Abgeschlossene/fehlgeschlagene Downloads automatisch ausblenden"
          checked={settings.auto_remove_completed}
          onChange={(checked) => patch({ auto_remove_completed: checked })}
        />
      </section>

      <section>
        <h2>Einschränkungs-Logik</h2>
        <label>
          Schwellenwert
          <select value={threshold} onChange={(e) => saveThreshold(Number(e.target.value))}>
            {AGE_THRESHOLD_PRESETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
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
          <div className="inline-form">
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
        <div className="inline-form">
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

      <section>
        <h2>Passwort ändern</h2>
        <label>
          Aktuelles Passwort
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label>
          Neues Passwort
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          Neues Passwort wiederholen
          <input
            type="password"
            value={newPasswordRepeat}
            onChange={(e) => setNewPasswordRepeat(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {passwordStatus && <p className="hint">{passwordStatus}</p>}
        <button
          onClick={handleChangePassword}
          disabled={!currentPassword || !newPassword || !newPasswordRepeat}
        >
          Passwort ändern
        </button>
      </section>
    </div>
  )
}
