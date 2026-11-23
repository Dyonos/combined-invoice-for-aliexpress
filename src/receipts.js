/* Combined Invoice for AliExpress - order receipts through the page bridge and invoice drafts, shared by the order list and the order detail page. */
(() => {
  'use strict';
  if (globalThis.AliFaReceipts) return;
  const I = globalThis.AliFaI18n;

  /** Bridge error ({ code, detail }) as text in the selected language. */
  function bridgeErrorText(payload) {
    let e = null;
    try {
      e = JSON.parse(payload);
    } catch (x) {
      return String(payload);
    }
    if (!e || !e.code) return String(payload);
    if (e.code === 'other') return e.detail || '?';
    if (e.code === 'badId') return I.t('err.badId', { id: e.detail });
    const base = I.t('err.' + e.code);
    return e.detail ? `${base} (${e.detail})` : base;
  }

  /** Code of a bridge error ('login', 'captcha', 'other', ...), or null. */
  function bridgeErrorCode(payload) {
    try {
      const e = JSON.parse(payload);
      return e && e.code ? e.code : null;
    } catch (x) {
      return null;
    }
  }

  /** Receipt of one order, read by page-bridge.js through the page's own request library. */
  function fetchReceipt(orderId) {
    return new Promise((resolve, reject) => {
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error(I.t('st.timeout')));
      }, 30000);
      function onMessage(ev) {
        if (ev.source !== window || !ev.data || ev.data.__aliFaktura !== 'res' || ev.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (ev.data.ok) resolve(JSON.parse(ev.data.payload));
        else {
          const err = new Error(bridgeErrorText(ev.data.payload));
          err.code = bridgeErrorCode(ev.data.payload);
          reject(err);
        }
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ __aliFaktura: 'req', id, orderId }, location.origin);
    });
  }

  // drafts of the last invoices: each invoice tab reads its own (?draft=<id>), older ones are removed
  const MAX_DRAFTS = 30;

  async function storeDraft(id, draft) {
    const all = await chrome.storage.local.get(null);
    const old = Object.keys(all).filter((k) => k.startsWith('alifa.draft.'))
      .sort((a, b) => String(all[b].createdAt).localeCompare(String(all[a].createdAt)))
      .slice(MAX_DRAFTS - 1);
    if (old.length) await chrome.storage.local.remove(old);
    await chrome.storage.local.set({ ['alifa.draft.' + id]: draft, 'alifa.draft': draft });
  }

  /** Stores the draft and opens the invoice page for it in a new tab (in the background if asked). */
  async function openDraft(draft, background) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await storeDraft(id, draft);
    await chrome.runtime.sendMessage({ type: 'alifa-open-invoice', draft: id, active: !background });
  }

  globalThis.AliFaReceipts = { fetchReceipt, openDraft };
})();
