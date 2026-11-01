const backendUrlInput = document.getElementById("backendUrl");
const tokenInput = document.getElementById("token");
const statusEl = document.getElementById("status");

async function load() {
  const { backendUrl, token } = await chrome.storage.local.get(["backendUrl", "token"]);
  if (backendUrl) backendUrlInput.value = backendUrl;
  if (token) tokenInput.value = token;
}

function originPatternFor(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/*`;
}

document.getElementById("save").addEventListener("click", async () => {
  const backendUrl = backendUrlInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();
  statusEl.textContent = "";

  if (!backendUrl || !token) {
    statusEl.textContent = "Bitte Server-Adresse und Token eintragen.";
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

  await chrome.storage.local.set({ backendUrl, token });
  statusEl.textContent = "Gespeichert.";
});

load();
