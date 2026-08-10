// background.js — service worker (module).
// Sets sensible defaults on install and offers a context-menu shortcut to jump
// straight to the market dashboard.

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const { prefs } = await chrome.storage.local.get('prefs');
    if (!prefs) {
      await chrome.storage.local.set({
        prefs: { yearMin: 2015, yearMax: 2020, model: 'both' },
      });
    }
  } catch {
    /* ignore */
  }

  chrome.contextMenus?.create(
    {
      id: 'gt350-dashboard',
      title: 'GT350 Hunter — open market dashboard',
      contexts: ['action'],
    },
    () => void chrome.runtime.lastError // ignore "duplicate id" on reload
  );
});

chrome.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId === 'gt350-dashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
  }
});
