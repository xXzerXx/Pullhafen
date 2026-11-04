import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, auth } from '../api'
import { PullhafenGlyph } from '../components/icons'

export function Login({
  onLoggedIn,
}: {
  onLoggedIn: (res: { username: string; must_change_password: boolean }) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingUsername, setPendingUsername] = useState<string | null>(null)

  useEffect(() => {
    auth
      .pendingInitialLogin()
      .then((res) => setPendingUsername(res.pending_username))
      .catch(() => setPendingUsername(null))
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await auth.login(username, password)
      onLoggedIn(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen.')
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
          <p className="login-form__tagline">Hier legt jeder Download an.</p>
        </div>
        {pendingUsername && (
          <p className="login-form__hint">
            Erste Anmeldung: Benutzername <strong>{pendingUsername}</strong>, das Passwort dazu steht in den
            Installationslogs des Containers.
          </p>
        )}
        <label>
          Benutzername
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-accent" style={{ justifyContent: 'center' }} disabled={busy}>
          Anmelden
        </button>
      </form>
    </div>
  )
}
