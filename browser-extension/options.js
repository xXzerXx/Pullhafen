const backendUrlInput = document.getElementById("backendUrl");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const statusEl = document.getElementById("status");

async function load() {
  const { backendUrl, token } = await chrome.storage.local.get(["backendUrl", "token"]);
  if (backendUrl) backendUrlInput.value = backendUrl;
  if (token) {
    statusEl.textContent = `Bereits verbunden mit ${backendUrl}. Erneut eintragen, um die Verbindung zu wechseln.`;
  }
}

function originPatternFor(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/*`;
}

document.getElementById("save").addEventListener("click", async () => {
  const backendUrl = backendUrlInput.value.trim().replace(/\/$/, "");
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  statusEl.textContent = "";

  if (!backendUrl || !username || !password) {
    statusEl.textContent = "Bitte Server-Adresse, Benutzername und Passwort eintragen.";
    return;
  }

  let pattern;
  try {
    pattern = originPatternFor(backendUrl);
  } catch {
    statusEl.textContent = "Ungültige Server-Adresse.";
    return;
  }

  // Erst JETZT, als Reaktion auf einen echten Klick, nach der konkreten
  // Origin fragen - optional_host_permissions im Manifest lässt das zu,
  // weil die eigentliche Serveradresse erst hier zur Laufzeit feststeht.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    statusEl.textContent = "Ohne Berechtigung für diese Adresse kann die Extension nichts senden.";
    return;
  }

  statusEl.textContent = "Verbinde …";
  try {
    const res = await fetch(`${backendUrl}/api/extension/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, label: "Browser-Extension" }),
    });
    if (!res.ok) {
      statusEl.textContent =
        res.status === 401 ? "Benutzername oder Passwort falsch." : "Server antwortet nicht wie erwartet.";
      return;
    }
    const { token } = await res.json();
    await chrome.storage.local.set({ backendUrl, token });
    passwordInput.value = "";
    statusEl.textContent = "Verbunden.";
  } catch {
    statusEl.textContent = "Server nicht erreichbar.";
  }
});

load();
