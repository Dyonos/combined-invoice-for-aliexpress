/* Combined Invoice for AliExpress - order detail page: a button that creates the invoice of this one order. */
(() => {
  'use strict';
  if (window.__aliFakturaDetail) return;
  window.__aliFakturaDetail = true;

  const I = globalThis.AliFaI18n;
  const S = globalThis.AliFaSettings;
  const R = globalThis.AliFaReceipts;
  const ISSUES_URL = 'https://github.com/Dyonos/combined-invoice-for-aliexpress/issues';
  // errors the user can fix (sign in, robot check) get no "Report a problem" link
  const USER_ERRORS = new Set(['login', 'captcha', 'badId']);

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function start() {
    const orderId = new URLSearchParams(location.search).get('orderId') || '';
    if (!/^\d{10,25}$/.test(orderId)) return;
    try {
      I.setLang((await S.load()).lang);
    } catch (e) { /* interface in English */ }

    const box = document.createElement('div');
    box.id = 'alifa-detail';
    box.innerHTML = `<span class="alifa-logo">${esc(I.t('brand'))}</span>` +
      `<button type="button" class="alifa-detail-btn">${esc(I.t('detail.create'))}</button>` +
      '<div class="alifa-detail-status" role="status"></div>';
    document.body.appendChild(box);
    const button = box.querySelector('button');
    const status = box.querySelector('.alifa-detail-status');

    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = I.t('st.loadingReceipt', { i: 1, n: 1 });
      try {
        const receipt = await R.fetchReceipt(orderId);
        await R.openDraft({ createdAt: new Date().toISOString(), bankCents: null, receipts: [receipt], listTotals: {}, listStatus: {} }, false);
        status.textContent = I.t('st.invoiceOpened');
      } catch (e) {
        const updated = /Extension context invalidated/i.test(String(e && e.message));
        const report = updated || USER_ERRORS.has(e && e.code) ? ''
          : ` <a href="${ISSUES_URL}" target="_blank" rel="noopener">${esc(I.t('st.report'))}</a>`;
        status.innerHTML = esc(updated ? I.t('st.updated') : e && e.message ? e.message : e) + report;
      } finally {
        button.disabled = false;
      }
    });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
