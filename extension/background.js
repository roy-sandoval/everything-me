const MENU_ID = "add-to-space";
const CONVEX_SITE_URL = "https://strong-roadrunner-765.convex.site";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Add to The Space",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  void showPickerOnTab(tab.id, {
    text: info.selectionText || "",
    sourceUrl: tab.url || "",
    sourceTitle: tab.title || "",
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ADD_NODE") {
    return false;
  }

  void (async () => {
    try {
      const response = await fetch(`${CONVEX_SITE_URL}/api/addNode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: message.payload.text,
          label: message.payload.label,
          sourceUrl: message.payload.sourceUrl,
          sourceTitle: message.payload.sourceTitle,
          createdAt: Date.now(),
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Could not add that highlight.");
      }

      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Could not add that highlight.",
      });
    }
  })();

  return true;
});

async function showPickerOnTab(tabId, payload) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles.css"],
    });
  } catch {
    // Ignore if CSS is already present or the page disallows injection.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch {
    // Ignore if the declarative content script is already present.
  }

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "SHOW_PICKER",
      ...payload,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}
