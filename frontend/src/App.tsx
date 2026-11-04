import { useEffect, useState } from 'react'
import { auth } from './api'
import { ItemsProvider } from './ItemsContext'
import { Login } from './pages/Login'
import { ForcedPasswordChange } from './pages/ForcedPasswordChange'
import { Queue } from './pages/Queue'
import { Downloads } from './pages/Downloads'
import { Library } from './pages/Library'
import { Settings } from './pages/Settings'
import { SearchIcon, PlusIcon, PullhafenGlyph } from './components/icons'
import { AddLinkPanel, type AddLinkResult } from './components/AddLinkPanel'

type Tab = 'queue' | 'downloads' | 'library' | 'settings'

function AppShell({ username, onLoggedOut }: { username: string; onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('queue')
  const [librarySearch, setLibrarySearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  async function handleLogout() {
    await auth.logout()
    onLoggedOut()
  }

  function handleHeaderSearch(value: string) {
    setLibrarySearch(value)
    if (value.trim()) setTab('library')
  }

  function handleAddDone(result: AddLinkResult) {
    setAddOpen(false)
    const parts: string[] = []
    if (result.succeeded > 0) {
      parts.push(`${result.succeeded} Link${result.succeeded === 1 ? '' : 's'} hinzugefügt`)
    }
    if (result.duplicates > 0) {
      parts.push(`${result.duplicates} schon vorhanden`)
    }
    if (result.failures.length > 0) {
      parts.push(`${result.failures.length} fehlgeschlagen: ${result.failures[0]}`)
    }
    setToast(parts.length > 0 ? parts.join(', ') + '.' : 'Nichts hinzugefügt.')
    window.setTimeout(() => setToast(null), 7000)
  }

  return (
    <ItemsProvider>
      {(counts) => (
        <div className="app-shell">
          <header className="app-header">
            <div className="app-header__brand">
              <div className="app-header__brand-icon" aria-hidden="true">
                <PullhafenGlyph size={22} />
              </div>
              <div className="app-header__brand-name">Pullhafen</div>
            </div>

            <div className="app-header__search">
              <SearchIcon />
              <label htmlFor="pf-search" className="sr-only">
                Bibliothek durchsuchen
              </label>
              <input
                id="pf-search"
                type="search"
                placeholder="Titel, Tag oder Website suchen …"
                value={librarySearch}
                onChange={(e) => handleHeaderSearch(e.target.value)}
              />
            </div>

            <div className="app-header__spacer" />

            <button className="btn-accent" aria-expanded={addOpen} onClick={() => setAddOpen((o) => !o)}>
              <PlusIcon />
              Links hinzufügen
            </button>

            <div className="app-header__user">
              <span>{username}</span>
              <button onClick={handleLogout}>Abmelden</button>
            </div>
          </header>

          {addOpen && <AddLinkPanel onDone={handleAddDone} />}
          {toast && (
            <div className="add-panel" role="status" style={{ padding: '12px 32px' }}>
              {toast}
            </div>
          )}

          <nav className="tabs" role="tablist" aria-label="Hauptbereiche">
            <button
              role="tab"
              aria-selected={tab === 'queue'}
              className={tab === 'queue' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('queue')}
            >
              Warteschlange
              <span className="tab__count">{counts.queue}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'downloads'}
              className={tab === 'downloads' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('downloads')}
            >
              Downloads
              <span className="tab__count">{counts.downloads}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'library'}
              className={tab === 'library' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('library')}
            >
              Bibliothek
              <span className="tab__count">{counts.library}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'settings'}
              className={tab === 'settings' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('settings')}
            >
              Einstellungen
            </button>
          </nav>

          <main>
            {tab === 'queue' && <Queue />}
            {tab === 'downloads' && <Downloads />}
            {tab === 'library' && <Library search={librarySearch} onSearchChange={setLibrarySearch} />}
            {tab === 'settings' && <Settings />}
          </main>
        </div>
      )}
    </ItemsProvider>
  )
}

export function App() {
  const [username, setUsername] = useState<string | null>(null)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    auth
      .me()
      .then((res) => {
        setUsername(res.username)
        setMustChangePassword(res.must_change_password)
      })
      .catch(() => setUsername(null))
      .finally(() => setChecking(false))
  }, [])

  function handleLoggedIn(res: { username: string; must_change_password: boolean }) {
    setUsername(res.username)
    setMustChangePassword(res.must_change_password)
  }

  if (checking) return <div className="page">Lädt…</div>
  if (!username) return <Login onLoggedIn={handleLoggedIn} />
  if (mustChangePassword) {
    return <ForcedPasswordChange username={username} onChanged={() => setMustChangePassword(false)} />
  }
  return <AppShell username={username} onLoggedOut={() => setUsername(null)} />
}
