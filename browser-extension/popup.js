const statusEl = document.getElementById('status')
const clipboardSection = document.getElementById('clipboard-section')
const clipboardLinkText = document.getElementById('clipboard-link-text')
const addClipboardBtn = document.getElementById('add-clipboard')
const addTabBtn = document.getElementById('add-tab')
const tabTitleText = document.getElementById('tab-title')

let currentTabUrl = null
let clipboardUrl = null

function looksLikeUrl(text) {
  if (!text) return false
  try {
    const parsed = new URL(text.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  currentTabUrl = tab?.url ?? null
  tabTitleText.textContent = tab?.title || tab?.url || '(unbekannt)'

  // Es gibt keine Hintergrund-Überwachung der Zwischenablage in Manifest V3
  // (keine stabile API dafür) - deshalb hier der realistische Ersatz: beim
  // Öffnen des Popups (= echte Nutzeraktion, damit erlaubt der Browser den
  // Zugriff) einmalig nachsehen, ob gerade ein Link drinliegt.
  try {
    const text = await navigator.clipboard.readText()
    const trimmed = text.trim()
    if (looksLikeUrl(trimmed) && trimmed !== currentTabUrl) {
      clipboardUrl = trimmed
      clipboardLinkText.textContent = clipboardUrl
      clipboardSection.hidden = false
    }
  } catch {
    // Kein Zugriff auf die Zwischenablage möglich - dann gibt es halt nur
    // den Button für die aktuelle Seite, kein Fehler nötig.
  }
}

async function sendLink(url, button) {
  const otherButton = button === addClipboardBtn ? addTabBtn : addClipboardBtn
  button.disabled = true
  otherButton.disabled = true
  statusEl.textContent = 'Wird gesendet…'
  const res = await chrome.runtime.sendMessage({ type: 'pullhafen-add-link', url })
  if (res?.ok) {
    statusEl.textContent = 'Hinzugefügt ✓'
    setTimeout(() => window.close(), 700)
  } else {
    statusEl.textContent =
      res?.reason === 'no-config'
        ? 'Bitte zuerst Server-Adresse und Token in den Optionen eintragen.'
        : 'Fehlgeschlagen.'
    button.disabled = false
    otherButton.disabled = false
  }
}

addClipboardBtn.addEventListener('click', () => clipboardUrl && sendLink(clipboardUrl, addClipboardBtn))
addTabBtn.addEventListener('click', () => currentTabUrl && sendLink(currentTabUrl, addTabBtn))

init()
