import { useEffect, useState } from 'react'
import { auth } from './api'
import { ItemsProvider } from './ItemsContext'
import { Login } from './pages/Login'
import { Queue } from './pages/Queue'
import { Downloads } from './pages/Downloads'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'

type Tab = 'queue' | 'downloads' | 'library' | 'settings'

const TABS: { key: Tab; label: string }[] = [
  { key: 'queue', label: 'Warteschlange' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'library', label: 'Bibliothek' },
  { key: 'settings', label: 'Einstellungen' },
]

function AppShell({ username, onLoggedOut }: { username: string; onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('queue')

  async function handleLogout() {
    await auth.logout()
    onLoggedOut()
  }

  return (
    <ItemsProvider>
      <div className="app-shell">
        <header className="app-header">
          <h1>Pullhafen</h1>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={tab === t.key ? 'tab tab--active' : 'tab'}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="app-header__user">
            <span>{username}</span>
            <button onClick={handleLogout}>Abmelden</button>
          </div>
        </header>
        <main>
          {tab === 'queue' && <Queue />}
          {tab === 'downloads' && <Downloads />}
          {tab === 'library' && <Library />}
          {tab === 'settings' && <Settings />}
        </main>
      </div>
    </ItemsProvider>
  )
}

export function App() {
  const [username, setUsername] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    auth
      .me()
      .then((res) => setUsername(res.username))
      .catch(() => setUsername(null))
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <div className="page">Lädt…</div>
  if (!username) return <Login onLoggedIn={setUsername} />
  return <AppShell username={username} onLoggedOut={() => setUsername(null)} />
}
