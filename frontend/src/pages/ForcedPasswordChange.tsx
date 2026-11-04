import { useState, type FormEvent } from 'react'
import { ApiError, auth } from '../api'
import { PullhafenGlyph } from '../components/icons'

export function ForcedPasswordChange({
  username,
  onChanged,
}: {
  username: string
  onChanged: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== newPasswordRepeat) {
      setError('Die beiden neuen Passwörter stimmen nicht überein.')
      return
    }
    setBusy(true)
    try {
      await auth.changePassword(currentPassword, newPassword)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ändern fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <svg className="login-page__waves" aria-hidden="true" viewBox="0 0 600 400" preserveAspectRatio="none">
        <path d="M-20,260 Q130,220 280,260 T580,260" />
        <path d="M-20,310 Q130,270 280,310 T580,310" />
        <path d="M-20,360 Q130,320 280,360 T580,360" />
      </svg>
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-form__brand">
          <div className="login-form__brand-icon" aria-hidden="true">
            <PullhafenGlyph size={30} />
          </div>
          <h1>Pullhafen</h1>
          <p className="login-form__tagline">
            Angemeldet als <strong>{username}</strong> mit dem Erstanmelde-Passwort — bevor es weitergeht, bitte
            ein eigenes Passwort festlegen.
          </p>
        </div>
        <label>
          Aktuelles Passwort
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoFocus
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
        {error && <p className="error-text">{error}</p>}
        <button
          type="submit"
          className="btn-accent"
          style={{ justifyContent: 'center' }}
          disabled={busy || !currentPassword || !newPassword || !newPasswordRepeat}
        >
          Passwort festlegen
        </button>
      </form>
    </div>
  )
}
