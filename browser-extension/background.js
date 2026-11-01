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

// Das Symbol öffnet seit dem Zwischenablage-Feature ein Popup
// (siehe manifest.json "default_popup") statt direkt zu senden - das Popup
// ruft stattdessen handleAddLink() per Message auf, um echtes Feedback
// (statt nur ein Badge) im Popup selbst anzeigen zu können.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "pullhafen-add-link" && msg.url) {
    handleAddLink(msg.url).then(sendResponse);
    return true;
  }
});

// Exportiert als benannte Funktion (statt nur als Closure im Listener), damit
// Tests den exakt gleichen Code direkt im Service-Worker aufrufen können,
// ohne ein natives Kontextmenü simulieren zu müssen - echtes Rechtsklick-UI
// ist von außerhalb des Browsers selbst nicht automatisierbar.
async function handleAddLink(url) {
  const { backendUrl, token } = await chrome.storage.local.get(["backendUrl", "token"]);
  if (!backendUrl || !token) {
    return { ok: false, reason: "no-config" };
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
    if (!res.ok) return { ok: false, reason: "server" };
    const item = await res.json().catch(() => null);
    return { ok: true, alreadyExisted: item?.already_existed === true };
  } catch {
    return { ok: false, reason: "network" };
  }
}

async function handleLinkClicked(url) {
  const result = await handleAddLink(url);
  if (result.ok) {
    await setBadge(result.alreadyExisted ? "=" : "✓", result.alreadyExisted ? "#8c98a8" : "#3fb97f");
  } else if (result.reason === "no-config") {
    await setBadge("!", "#e0a940");
  } else {
    await setBadge("✗", "#e05b5b");
  }
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}

// Für die echte Browser-Testfahrt (siehe backend-unabhängiges Testskript):
// macht die Funktionen im Service-Worker-Global-Scope aufrufbar.
globalThis.__pullhafenHandleLinkClicked = handleLinkClicked;
globalThis.__pullhafenHandleAddLink = handleAddLink;
