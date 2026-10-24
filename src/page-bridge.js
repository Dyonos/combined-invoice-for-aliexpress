/*
 * Combined Invoice for AliExpress - bridge into the AliExpress page (runs in "world": "MAIN").
 * Loads the order receipt through the page's own mtop library (request signing,
 * login and any "I am not a robot" check are handled by AliExpress).
 * Talks to the content script through window.postMessage. Errors are sent as codes (err.<code> in i18n),
 * the content script builds the text in the selected language.
 */
(() => {
  if (window.__aliFakturaBridge) return;
  window.__aliFakturaBridge = true;

  const RECEIPT_API = 'mtop.global.finance.taxation.invoice.queryOrderReceiptInfo';

  function bridgeError(code, detail) {
    const e = new Error(code);
    e.alifa = { code, detail: detail || '' };
    return e;
  }

  function waitForMtop(timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function check() {
        const mtop = window.lib && window.lib.mtop;
        if (mtop && typeof mtop.request === 'function') return resolve(mtop);
        if (Date.now() - started > timeoutMs) return reject(bridgeError('noMtop'));
        setTimeout(check, 250);
      })();
    });
  }

  /** { code, detail }: code is the err.<code> key in the translations, 'other' = only the text from AliExpress */
  function describe(err) {
    if (err && err.alifa) return err.alifa;
    if (!err) return { code: 'other', detail: '?' };
    const ret = err.ret || (err.data && err.data.ret);
    const text = Array.isArray(ret) ? ret.join(', ') : (err.message || String(err));
    if (/SESSION_EXPIRED|SID_INVALID|NOT_LOGIN|LOGIN/i.test(text)) return { code: 'login', detail: text };
    if (/RGV587|USER_VALIDATE|x5sec|captcha/i.test(text)) return { code: 'captcha', detail: text };
    return { code: 'other', detail: text };
  }

  function reply(id, ok, payload) {
    window.postMessage({ __aliFaktura: 'res', id, ok, payload }, location.origin);
  }

  // Without a time zone AliExpress returns dates in its server time (a day earlier for night-time purchases).
  // Same format as the order details send: "GMT+0200".
  function tzFor(date) {
    const off = -date.getTimezoneOffset();
    const a = Math.abs(off);
    return 'GMT' + (off >= 0 ? '+' : '-') + String(Math.floor(a / 60)).padStart(2, '0') + String(a % 60).padStart(2, '0');
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function noonOf(text) {
    const m = String(text || '').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (!m || MONTHS[m[1].toLowerCase()] === undefined) return null;
    return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2], 12);
  }

  async function fetchReceipt(mtop, orderId, timeZone) {
    const res = await mtop.request({
      api: RECEIPT_API,
      v: '1.0',
      data: { orderId: String(orderId), timeZone },
      type: 'GET',
      dataType: 'json',
      timeout: 20000,
    });
    const data = res && res.data && res.data.data;
    if (!data) throw (res && res.ret ? res : bridgeError('empty'));
    return data;
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__aliFaktura !== 'req') return;
    const { id, orderId } = ev.data;
    if (!/^\d{6,25}$/.test(String(orderId))) {
      return reply(id, false, JSON.stringify({ code: 'badId', detail: String(orderId) }));
    }
    try {
      const mtop = await waitForMtop(15000);
      const nowTz = tzFor(new Date());
      let data = await fetchReceipt(mtop, orderId, nowTz);
      // order from a period with a different offset (summer/winter time): load again with the right zone
      const placed = noonOf(data.orderTime);
      if (placed && tzFor(placed) !== nowTz) data = await fetchReceipt(mtop, orderId, tzFor(placed));
      const copy = Object.assign({}, data);
      delete copy.deliveryAddress; // the delivery address is not needed and is not stored
      reply(id, true, JSON.stringify(copy));
    } catch (err) {
      reply(id, false, JSON.stringify(describe(err)));
    }
  });
})();
