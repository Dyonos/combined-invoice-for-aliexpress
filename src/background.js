/* Combined Invoice for AliExpress - service worker: opens the invoice page and the order list. */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'alifa-open-invoice') {
    const opts = { url: chrome.runtime.getURL('src/invoice.html' + (msg.draft ? '?draft=' + encodeURIComponent(msg.draft) : '')) };
    if (msg.active === false) opts.active = false;
    if (sender.tab) {
      opts.index = sender.tab.index + 1;
      opts.openerTabId = sender.tab.id;
    }
    chrome.tabs.create(opts).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg && msg.type === 'alifa-open-options') {
    chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

// After installation open the settings, so the company is filled in first.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

// Clicking the extension icon opens My orders on AliExpress.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'https://www.aliexpress.com/p/order/index.html' });
});
