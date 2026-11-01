const MENU_ID = "pullhafen-send-link";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Mit Pullhafen laden",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) {
    handleLinkClicked(info.linkUrl);
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.url) handleLinkClicked(tab.url);
});

// Exportiert als benannte Funktion (statt nur als Closure im Listener), damit
// Tests den exakt gleichen Code direkt im Service-Worker aufrufen können,
// ohne ein natives Kontextmenü simulieren zu müssen - echtes Rechtsklick-UI
// ist von außerhalb des Browsers selbst nicht automatisierbar.
async function handleLinkClicked(url) {
  const { backendUrl, token } = await chrome.storage.local.get(["backendUrl", "token"]);
  if (!backendUrl || !token) {
    await setBadge("!", "#e0a940");
    return;
  }
  try {
    const res = await fetch(`${backendUrl.replace(/\/$/, "")}/api/extension/links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      await setBadge("✓", "#3fb97f");
    } else {
      await setBadge("✗", "#e05b5b");
    }
  } catch {
    await setBadge("✗", "#e05b5b");
  }
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}

// Für die echte Browser-Testfahrt (siehe backend-unabhängiges Testskript):
// macht die Funktion im Service-Worker-Global-Scope aufrufbar.
globalThis.__pullhafenHandleLinkClicked = handleLinkClicked;
