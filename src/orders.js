/*
 * Combined Invoice for AliExpress - the "My orders" page on AliExpress.
 * Adds a checkbox to every order; the bank amount is entered in the panel
 * and the selected orders are combined into one invoice. Texts are in the language from the settings (i18n.js).
 */
(() => {
  'use strict';
  if (window.__aliFakturaOrders) return;
  window.__aliFakturaOrders = true;

  const A = globalThis.AliFa;
  const I = globalThis.AliFaI18n;
  const S = globalThis.AliFaSettings;
  const SEL_KEY = 'alifa.selection';
  // order status in the language of AliExpress, not of the extension
  const SKIP_STATUS = /cancel|closed|to pay|awaiting payment|unpaid|zrušen|nezaplaten/i;

  const state = {
    selected: new Map(), // orderId -> { id, cents, currency, date, store, status }
    // orders added by number (AliExpress does not show them in the list); search by amount uses them too
    extra: new Map(),
    bankCents: null,
    bankDate: null, // "YYYY-MM-DD", search only on this day (and 1-3 days before it)
    // several payments at once: the pasted lines and one result per payment
    batchText: '',
    batch: [],
    busy: false,
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const orders = (n) => I.plural(n, 'plural.orders');

  // ---------------------------------------------------------------- reading orders from the page

  function readOrder(el) {
    const link = el.querySelector('a[href*="orderId="]');
    const fromLink = link ? (link.getAttribute('href').match(/orderId=(\d+)/) || [])[1] : null;
    const info = el.querySelector('.order-item-header-right-info');
    const lines = info ? info.innerText.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    const fromText = (lines.join(' ').match(/(\d{12,})/) || [])[1];
    const dateLine = lines.find((l) => /\d{4}/.test(l) && !/\d{12,}/.test(l)) || '';
    const dateRaw = dateLine.replace(/^[^:]*:\s*/, '');
    const totalEl = el.querySelector('.order-item-content-opt-price-total');
    const total = totalEl ? A.parseMoney(totalEl.textContent) : null;
    const storeEl = el.querySelector('.order-item-store-name');
    const statusEl = el.querySelector('.order-item-header-status-text');
    return {
      id: fromLink || fromText || null,
      cents: total ? total.cents : null,
      currency: total ? total.currency : null,
      date: A.parseDate(dateRaw),
      dateRaw,
      store: storeEl ? storeEl.textContent.trim() : '',
      status: statusEl ? statusEl.textContent.trim() : '',
    };
  }

  function orderElements() {
    return [...document.querySelectorAll('.order-item')];
  }

  // ---------------------------------------------------------------- selection

  function saveSelection() {
    try {
      sessionStorage.setItem(SEL_KEY, JSON.stringify({
        orders: [...state.selected.values()],
        extra: [...state.extra.values()],
        bankCents: state.bankCents,
        bankDate: state.bankDate,
      }));
    } catch (e) { /* private window etc. */ }
  }

  function restoreSelection() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SEL_KEY) || 'null');
      if (!saved) return;
      for (const o of saved.orders || []) if (o && o.id) state.selected.set(o.id, o);
      for (const o of saved.extra || []) if (o && o.id) state.extra.set(o.id, o);
      if (Number.isInteger(saved.bankCents)) state.bankCents = saved.bankCents;
      if (/^\d{4}-\d{2}-\d{2}$/.test(saved.bankDate || '')) state.bankDate = saved.bankDate;
    } catch (e) { /* ignore a corrupted record */ }
  }

  function setSelected(order, on) {
    if (!order || !order.id) return;
    if (on) state.selected.set(order.id, order);
    else {
      state.selected.delete(order.id);
      state.extra.delete(order.id);
    }
    saveSelection();
    decorate();
    renderPanel();
  }

  // ---------------------------------------------------------------- checkboxes on orders

  // most common currency of the orders on the page, for the panel amounts
  let pageCurrency = null;

  function topCurrency(counts) {
    let best = null;
    for (const [c, n] of counts) if (!best || n > counts.get(best)) best = c;
    return best;
  }

  function decorate() {
    const counts = new Map();
    for (const el of orderElements()) {
      const order = readOrder(el);
      if (order.currency) counts.set(order.currency, (counts.get(order.currency) || 0) + 1);
      if (!order.id) continue;
      let pick = el.querySelector(':scope .alifa-pick');
      if (!pick) {
        pick = document.createElement('label');
        pick.className = 'alifa-pick';
        pick.innerHTML = '<input type="checkbox"><span></span>';
        pick.addEventListener('click', (e) => e.stopPropagation());
        pick.querySelector('input').addEventListener('change', (e) => {
          setSelected(readOrder(el), e.target.checked);
        });
        const header = el.querySelector('.order-item-header') || el;
        header.insertBefore(pick, header.firstChild);
      }
      const label = I.t('pick.label');
      const span = pick.querySelector('span');
      if (span.textContent !== label) {
        span.textContent = label;
        pick.title = I.t('pick.title');
      }
      pick.dataset.orderId = order.id;
      const on = state.selected.has(order.id);
      pick.querySelector('input').checked = on;
      el.classList.toggle('alifa-selected', on);
      if (on) state.selected.set(order.id, Object.assign({}, state.selected.get(order.id), order));
    }
    pageCurrency = topCurrency(counts) || pageCurrency;
  }

  // ---------------------------------------------------------------- panel

  let panel;
  let settings = null;

  /** Version from manifest.json: the panel shows whether the latest one is loaded. */
  function extVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (e) {
      return '?';
    }
  }

  function contextError(err) {
    return /Extension context invalidated/i.test(String(err && err.message))
      ? I.t('st.updated')
      : esc(err && err.message ? err.message : err);
  }

  const ISSUES_URL = 'https://github.com/Dyonos/combined-invoice-for-aliexpress/issues';
  // errors the user can fix (sign in, robot check, wrong order number) get no "Report a problem" link
  const USER_ERRORS = new Set(['login', 'captcha', 'badId']);

  function reportLink() {
    return ` <a class="alifa-report" href="${ISSUES_URL}" target="_blank" rel="noopener">${esc(I.t('st.report'))}</a>`;
  }

  /** "Report a problem" link for a technical error; nothing for errors the user can fix or after an update. */
  function reportFor(err) {
    if (/Extension context invalidated/i.test(String(err && err.message))) return '';
    return err && USER_ERRORS.has(err.code) ? '' : reportLink();
  }

  async function loadSettings() {
    try {
      settings = await S.load();
    } catch (err) {
      settings = null;
    }
    I.setLang(settings && settings.lang);
  }

  function fillProfiles() {
    if (!panel || !settings) return;
    const sel = panel.querySelector('.alifa-profile');
    sel.innerHTML = settings.profiles
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name || I.t('panel.noName'))}</option>`)
      .join('');
    sel.value = settings.profiles.some((p) => p.id === settings.profileId) ? settings.profileId : settings.profiles[0].id;
    // no company filled in yet (e.g. right after installation): point to Edit
    const named = settings.profiles.some((p) => String(p.name || '').trim());
    panel.querySelector('.alifa-setup').hidden = named;
    panel.querySelector('.alifa-edit-profiles').classList.toggle('alifa-primary', !named);
  }

  function buildPanel() {
    const collapsed = panel && panel.classList.contains('alifa-collapsed');
    const batchOpen = !!(panel && panel.querySelector('.alifa-batch[open]'));
    const status = panel ? panel.querySelector('.alifa-status') : null;
    const statusHtml = status ? status.innerHTML : '';
    const statusClass = status ? status.className : 'alifa-status';
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'alifa-panel';
    panel.innerHTML = `
      <div class="alifa-head">
        <span class="alifa-logo">${esc(I.t('brand'))} <span class="alifa-ver" title="${esc(I.t('versionTitle'))}">v${esc(extVersion())}</span></span>
        <span class="alifa-head-right">
          <select class="alifa-lang" title="${esc(I.t('panel.language'))}" aria-label="${esc(I.t('panel.language'))}">${I.langOptions(I.lang())}</select>
          <button type="button" class="alifa-toggle" title="${esc(I.t('panel.toggle'))}">${collapsed ? '▸' : '▾'}</button>
        </span>
      </div>
      <div class="alifa-body">
        <div class="alifa-field">
          <span>${esc(I.t('panel.invoiceTo'))}</span>
          <span class="alifa-profile-row">
            <select class="alifa-profile" aria-label="${esc(I.t('panel.invoiceToAria'))}"></select>
            <button type="button" class="alifa-btn alifa-edit-profiles" title="${esc(I.t('panel.editTitle'))}">${esc(I.t('panel.edit'))}</button>
          </span>
          <span class="alifa-setup" hidden>${esc(I.t('panel.setupHint'))}</span>
        </div>
        <label class="alifa-bank-row">
          <span>${esc(I.t('panel.bankAmount'))}</span>
          <span class="alifa-bank-input"><input type="text" inputmode="decimal" class="alifa-bank" placeholder="${esc(I.t('panel.amountPlaceholder'))}"> <span class="alifa-cur">€</span></span>
        </label>
        <label class="alifa-bank-row">
          <span>${esc(I.t('panel.paymentDate'))} <span class="alifa-muted">${esc(I.t('panel.optional'))}</span></span>
          <span class="alifa-bank-input"><input type="date" class="alifa-date"><button type="button" class="alifa-date-clear" title="${esc(I.t('panel.anyDayTitle'))}">×</button></span>
        </label>
        <button type="button" class="alifa-btn alifa-find">${esc(I.t('panel.find'))}</button>
        <div class="alifa-sum"></div>
        <ul class="alifa-list"></ul>
        <div class="alifa-field">
          <span>${esc(I.t('panel.missing'))} <span class="alifa-muted">${esc(I.t('panel.missingHint'))}</span></span>
          <span class="alifa-profile-row">
            <input type="text" class="alifa-add-id" inputmode="numeric" placeholder="1234567890123456">
            <button type="button" class="alifa-btn alifa-add">${esc(I.t('panel.add'))}</button>
          </span>
        </div>
        <div class="alifa-actions">
          <button type="button" class="alifa-btn alifa-primary alifa-create">${esc(I.t('panel.create'))}</button>
          <button type="button" class="alifa-btn alifa-clear">${esc(I.t('panel.clear'))}</button>
        </div>
        <details class="alifa-batch"${batchOpen || state.batch.length ? ' open' : ''}>
          <summary>${esc(I.t('batch.title'))}</summary>
          <div class="alifa-batch-body">
            <span class="alifa-muted">${esc(I.t('batch.hint', { example: I.t('batch.example') }))}</span>
            <textarea class="alifa-batch-input" rows="4" spellcheck="false" placeholder="${esc(I.t('batch.example'))}"></textarea>
            <button type="button" class="alifa-btn alifa-batch-find">${esc(I.t('batch.find'))}</button>
            <ul class="alifa-batch-list"></ul>
            <button type="button" class="alifa-btn alifa-primary alifa-batch-all" hidden>${esc(I.t('batch.createAll'))}</button>
          </div>
        </details>
        <div class="${esc(statusClass)}" role="status">${statusHtml}</div>
      </div>`;
    if (collapsed) panel.classList.add('alifa-collapsed');
    document.body.appendChild(panel);

    const bank = panel.querySelector('.alifa-bank');
    if (state.bankCents !== null) {
      bank.value = I.amount(state.bankCents);
    }
    bank.addEventListener('input', () => {
      const m = A.parseMoney(bank.value);
      state.bankCents = m && m.cents > 0 ? m.cents : null;
      saveSelection();
      renderPanel();
    });
    bank.addEventListener('keydown', (e) => { if (e.key === 'Enter') findByAmount(); });
    const date = panel.querySelector('.alifa-date');
    if (state.bankDate) date.value = state.bankDate;
    date.addEventListener('change', () => {
      state.bankDate = /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : null;
      saveSelection();
    });
    panel.querySelector('.alifa-date-clear').addEventListener('click', () => {
      date.value = '';
      state.bankDate = null;
      saveSelection();
    });
    panel.querySelector('.alifa-lang').addEventListener('change', async (e) => {
      I.setLang(e.target.value);
      if (settings) {
        settings.lang = I.lang();
        try {
          await S.save(settings);
        } catch (err) {
          setStatus(contextError(err) + reportFor(err), 'bad');
        }
      }
      refreshLanguage();
    });
    panel.querySelector('.alifa-profile').addEventListener('change', async (e) => {
      if (!settings) return;
      settings.profileId = e.target.value;
      try {
        await S.save(settings);
      } catch (err) {
        setStatus(contextError(err) + reportFor(err), 'bad');
      }
    });
    panel.querySelector('.alifa-edit-profiles').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'alifa-open-options' });
      } catch (err) {
        setStatus(contextError(err) + reportFor(err), 'bad');
      }
    });
    panel.querySelector('.alifa-find').addEventListener('click', findByAmount);
    panel.querySelector('.alifa-add').addEventListener('click', addById);
    panel.querySelector('.alifa-add-id').addEventListener('keydown', (e) => { if (e.key === 'Enter') addById(); });
    panel.querySelector('.alifa-create').addEventListener('click', createInvoice);
    panel.querySelector('.alifa-clear').addEventListener('click', () => {
      state.selected.clear();
      state.extra.clear();
      saveSelection();
      decorate();
      setStatus('');
      renderPanel();
    });
    panel.querySelector('.alifa-toggle').addEventListener('click', () => {
      panel.classList.toggle('alifa-collapsed');
      panel.querySelector('.alifa-toggle').textContent = panel.classList.contains('alifa-collapsed') ? '▸' : '▾';
    });
    panel.querySelector('.alifa-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) setSelected({ id: btn.dataset.remove }, false);
    });
    const batchInput = panel.querySelector('.alifa-batch-input');
    batchInput.value = state.batchText;
    batchInput.addEventListener('input', () => {
      state.batchText = batchInput.value;
      saveBatch();
    });
    panel.querySelector('.alifa-batch-find').addEventListener('click', findBatch);
    panel.querySelector('.alifa-batch-all').addEventListener('click', () => {
      createBatch(state.batch.map((b, i) => (b.status === 'found' || b.status === 'ambiguous' ? i : -1)).filter((i) => i >= 0));
    });
    panel.querySelector('.alifa-batch-list').addEventListener('click', (e) => {
      const select = e.target.closest('[data-batch-select]');
      if (select) selectBatch(Number(select.dataset.batchSelect));
      const make = e.target.closest('[data-batch-create]');
      if (make) createBatch([Number(make.dataset.batchCreate)]);
    });
    fillProfiles();
  }

  /** After a language change: rebuild the panel and the order checkboxes in the new language. */
  function refreshLanguage() {
    buildPanel();
    decorate();
    renderPanel();
  }

  function selectedSum() {
    let cents = 0;
    let unknown = 0;
    for (const o of state.selected.values()) {
      if (Number.isInteger(o.cents)) cents += o.cents;
      else unknown++;
    }
    return { cents, unknown };
  }

  /** Currency of the panel amounts: the most common one among the selected orders, otherwise on the page. */
  function panelCurrency() {
    const counts = new Map();
    for (const o of state.selected.values()) if (o.currency) counts.set(o.currency, (counts.get(o.currency) || 0) + 1);
    return topCurrency(counts) || pageCurrency || 'EUR';
  }

  function renderPanel() {
    if (!panel) return;
    const n = state.selected.size;
    const { cents, unknown } = selectedSum();
    const cur = panelCurrency();
    panel.querySelector('.alifa-cur').textContent = I.currencySymbol(cur);
    const sumEl = panel.querySelector('.alifa-sum');
    let html = n
      ? I.t('sum.selected', { orders: `<b>${esc(orders(n))}</b>`, amount: `<b>${esc(I.money(cents, cur))}</b>` })
      : esc(I.t('sum.empty'));
    if (unknown) html += `<div class="alifa-warn">${esc(I.t('sum.unknown'))}</div>`;
    if (n && state.bankCents !== null) {
      const diff = state.bankCents - cents;
      if (diff === 0) html += `<div class="alifa-ok">${esc(I.t('sum.match'))}</div>`;
      else html += `<div class="alifa-bad">${esc(I.t(diff > 0 ? 'sum.missing' : 'sum.extra', { amount: I.money(Math.abs(diff), cur) }))}</div>`;
    }
    sumEl.innerHTML = html;

    const list = panel.querySelector('.alifa-list');
    const items = [...state.selected.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
    list.innerHTML = items.map((o) => {
      const extra = state.extra.get(o.id);
      const mark = extra ? ` <i>${esc(I.t(extra.auto ? 'list.wasMissing' : 'list.byNumber'))}</i>` : '';
      return `
      <li><span class="alifa-li-main">${esc(o.date ? I.date(o.date) : o.dateRaw || '')} · ${esc(o.store || o.id)}${mark}</span>
      <span class="alifa-li-sum">${Number.isInteger(o.cents) ? esc(I.money(o.cents, o.currency)) : '?'}</span>
      <button type="button" data-remove="${esc(o.id)}" title="${esc(I.t('list.removeTitle'))}">×</button></li>`;
    }).join('');

    panel.querySelector('.alifa-create').disabled = !n || state.busy;
    panel.querySelector('.alifa-find').disabled = state.busy;
    panel.querySelector('.alifa-add').disabled = state.busy;
    renderBatch();
  }

  function setStatus(text, kind) {
    if (!panel) return;
    const el = panel.querySelector('.alifa-status');
    el.className = 'alifa-status' + (kind ? ' alifa-' + kind : '');
    el.innerHTML = text;
  }

  // ---------------------------------------------------------------- search by amount

  // How many times at most the extension clicks "View orders" by itself (10 orders each).
  const MAX_LOADS = 25; // without a date: about 250 orders
  const MAX_LOADS_DATE = 80; // with a date it stops as soon as it passes it, so it can go further back
  // The posting date on the bank statement is often 1-3 days after the purchase.
  const DATE_LOOKBACK = 3;

  /** Orders loaded on the page (without cancelled and unpaid ones). */
  function domOrders() {
    return orderElements().map(readOrder)
      .filter((o) => o.id && Number.isInteger(o.cents) && !SKIP_STATUS.test(o.status));
  }

  /** Candidates for search by amount: loaded orders + orders added by number. */
  function loadedOrders() {
    const list = domOrders();
    for (const o of state.extra.values()) {
      if (Number.isInteger(o.cents) && !list.some((x) => x.id === o.id)) list.push(o);
    }
    return list;
  }

  /** Adds an order by its number (e.g. from the confirmation e-mail), even if AliExpress does not show it in the list. */
  async function addById() {
    const input = panel.querySelector('.alifa-add-id');
    const id = (input.value.match(/\d{10,25}/) || [])[0];
    if (!id) {
      setStatus(esc(I.t('st.enterId')), 'bad');
      return;
    }
    if (state.busy) return;
    const inList = domOrders().find((o) => o.id === id);
    if (inList) {
      input.value = '';
      setSelected(inList, true);
      setStatus(esc(I.t('st.idInList', { id })), 'ok');
      return;
    }
    state.busy = true;
    renderPanel();
    setStatus(esc(I.t('st.loadingOrder', { id })));
    try {
      const o = A.normalizeReceipt(await fetchReceipt(id), id);
      const entry = {
        id: o.orderId || id,
        cents: o.totalCents,
        currency: o.currency,
        date: o.paidDate || o.orderDate,
        dateRaw: o.paidOn || o.orderTime,
        store: o.sellers.join(', '),
        status: '',
      };
      state.extra.set(entry.id, entry);
      state.selected.set(entry.id, entry);
      saveSelection();
      input.value = '';
      setStatus(esc(I.t('st.addedById', {
        id: entry.id,
        store: entry.store || 'AliExpress',
        date: I.date(entry.date) || entry.dateRaw,
        amount: I.money(entry.cents, entry.currency),
      })), 'ok');
    } catch (e) {
      setStatus(esc(I.t('st.addFailed', { id, error: '' })) + contextError(e) + reportFor(e), 'bad');
    } finally {
      state.busy = false;
      decorate();
      renderPanel();
    }
  }

  function moreButton() {
    const wrap = document.querySelector('.order-more');
    const btn = wrap && (wrap.querySelector('button') || wrap);
    if (!btn || btn.disabled || btn.offsetParent === null) return null;
    return btn;
  }

  function waitFor(check, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function tick() {
        if (check()) return resolve(true);
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(tick, 250);
      })();
    });
  }

  /** Clicks "View orders" and waits for more orders: 'ok' | 'end' (no more) | 'stuck'. */
  async function loadMore() {
    const more = moreButton();
    if (!more) return 'end';
    const before = orderElements().length;
    more.click();
    if (!(await waitFor(() => orderElements().length > before, 15000))) return 'stuck';
    await sleep(500); // let the amounts of the new orders render
    decorate();
    return 'ok';
  }

  function oldestDate(list) {
    return list.reduce((min, o) => (o.date && (!min || o.date < min) ? o.date : min), null);
  }

  function searchedText(list) {
    const dates = list.map((o) => o.date).filter(Boolean).sort();
    if (!dates.length) return orders(list.length);
    if (dates[0] === dates[dates.length - 1]) return `${orders(list.length)} (${I.date(dates[0])})`;
    return I.t('st.searchedRange', { orders: orders(list.length), from: I.date(dates[0]), to: I.date(dates[dates.length - 1]) });
  }

  function selectFound(found, list, back, added) {
    state.selected.clear();
    for (const id of found.ids) {
      const o = list.find((x) => x.id === id);
      if (o) state.selected.set(id, o);
    }
    saveSelection();
    decorate();
    renderPanel();
    const first = orderElements().find((el) => el.classList.contains('alifa-selected'));
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    let msg = I.t('st.found', {
      orders: orders(found.ids.length),
      from: found.date ? I.t('st.fromDate', { date: I.date(found.date) }) : '',
      days: back ? ` (${I.plural(back, 'plural.daysBefore')})` : '',
    });
    if (added) msg += I.t('st.skippedAdded', { n: added });
    if (found.ambiguous) msg += I.t('st.ambiguous');
    setStatus(esc(msg), found.ambiguous || back || added ? 'warn' : 'ok');
  }

  // Orders from one checkout have consecutive numbers in steps of 2 at the 5th-6th digit from the end
  // (e.g. …10174321, …10194321, …10214321). AliExpress pages them unstably in the list and skips some.
  const SIBLING_STEP = 20000n;
  const MAX_PROBES = 24;

  /**
   * Fills in orders from the given days that AliExpress skipped in the list: tries the receipts of neighbouring
   * order numbers from the same day. Returns the number of orders added.
   */
  async function probeSiblings(days, progress) {
    let probes = 0;
    let added = 0;
    const known = new Set(loadedOrders().map((o) => o.id));
    const tried = new Set();
    for (const day of days) {
      const queue = loadedOrders().filter((o) => o.date === day && /^\d+$/.test(o.id)).map((o) => o.id);
      while (queue.length && probes < MAX_PROBES) {
        const base = BigInt(queue.shift());
        for (const cand of [base - SIBLING_STEP, base + SIBLING_STEP]) {
          const id = cand.toString();
          if (known.has(id) || tried.has(id) || probes >= MAX_PROBES) continue;
          tried.add(id);
          probes++;
          progress(I.t('st.probing', { date: I.date(day), n: probes }));
          let o = null;
          try {
            o = A.normalizeReceipt(await fetchReceipt(id), id);
          } catch (e) {
            o = null; // no such order, or it is not yours
          }
          await sleep(250);
          if (!o || !Number.isInteger(o.totalCents) || (o.paidDate || o.orderDate) !== day) continue;
          state.extra.set(id, {
            id,
            cents: o.totalCents,
            currency: o.currency,
            date: day,
            dateRaw: o.paidOn || o.orderTime,
            store: o.sellers.join(', '),
            status: '',
            auto: true,
          });
          known.add(id);
          queue.push(id);
          added++;
        }
      }
    }
    if (added) {
      saveSelection();
      renderPanel();
    }
    return added;
  }

  /**
   * Searches the orders of one payment (amount in cents, optional date "YYYY-MM-DD"). Loads older orders and fills in
   * orders that AliExpress skipped in the list when needed, but does not change the selection.
   * exclude: ids already used for other payments; progress(text): status while searching.
   * Returns { found, list, back, added } or { error, ... } (see searchErrorText).
   */
  async function searchPayment(cents, day, exclude, progress) {
    const usable = () => loadedOrders().filter((o) => !exclude.has(o.id));
    if (day) {
      const days = [];
      for (let back = 0; back <= DATE_LOOKBACK; back++) days.push(A.addDays(day, -back));
      const lastDay = days[days.length - 1];
      let added = 0;
      let probed = false;
      for (let loads = 0; ; loads++) {
        const list = usable();
        // orders are newest first, so once orders from an older day are loaded, the newer days are complete
        for (let back = 0; back < days.length; back++) {
          const found = A.findOrdersForAmount(list.filter((o) => o.date === days[back]), cents, { sameDayOnly: true });
          if (found) return { found, list, back, added };
        }
        const oldest = oldestDate(domOrders()); // page orders only, orders added by number do not move the loading
        if (!(oldest && oldest < lastDay)) {
          if (loads >= MAX_LOADS_DATE) return { error: 'loadLimitDate', oldest };
          progress(I.t('st.loadingToDate', { date: I.date(day), oldest: oldest ? I.date(oldest) : '?' }));
          const res = await loadMore();
          if (res === 'stuck') return { error: 'stuck' };
          if (res === 'ok') continue;
        }
        // the days around the date are loaded and the sum does not match: fill in orders that AliExpress skipped in the list
        if (!probed) {
          probed = true;
          added = await probeSiblings(days.filter((d) => list.some((o) => o.date === d)), progress);
          if (added) continue;
        }
        const inWindow = usable().filter((o) => o.date && o.date >= lastDay && o.date <= day).length;
        return { error: inWindow ? 'notFoundDate' : 'noOrdersDate', inWindow };
      }
    }
    for (let loads = 0; ; loads++) {
      const list = usable();
      const found = A.findOrdersForAmount(list, cents, { sameDayOnly: true });
      if (found) return { found, list, back: 0, added: 0 };
      if (loads >= MAX_LOADS) return { error: 'limitAny', list };
      progress(I.t('st.searched', { searched: searchedText(list) }));
      const res = await loadMore();
      if (res === 'end') return { error: 'allSearched', list };
      if (res === 'stuck') return { error: 'stuckSearched', list };
    }
  }

  /** Message for a search that found nothing (an error of searchPayment), in the interface language. */
  function searchErrorText(r, day, amount) {
    switch (r.error) {
      case 'loadLimitDate': return I.t('st.loadLimitDate', { oldest: I.date(r.oldest), date: I.date(day) });
      case 'stuck': return I.t('st.stuck');
      case 'notFoundDate': return I.t('st.notFoundDate', { date: I.date(day), k: DATE_LOOKBACK, orders: orders(r.inWindow), amount });
      case 'noOrdersDate': return I.t('st.noOrdersDate', { date: I.date(day), k: DATE_LOOKBACK });
      case 'limitAny': return I.t('st.limitAny', { searched: searchedText(r.list), amount });
      case 'allSearched': return I.t('st.allSearched', { searched: searchedText(r.list), amount });
      default: return I.t('st.stuckSearched', { searched: searchedText(r.list || []) });
    }
  }

  /**
   * Looks for orders from one day whose sum = the bank amount. If none are found among the loaded ones,
   * it loads older ones by itself (the "View orders" button on the page) and searches again.
   */
  async function findByAmount() {
    if (state.bankCents === null) {
      setStatus(esc(I.t('st.enterAmount')), 'bad');
      return;
    }
    if (state.busy) return;
    state.busy = true;
    renderPanel();
    try {
      const r = await searchPayment(state.bankCents, state.bankDate, new Set(), (text) => setStatus(esc(text)));
      if (r.found) selectFound(r.found, r.list, r.back, r.added);
      else setStatus(esc(searchErrorText(r, state.bankDate, I.money(state.bankCents, panelCurrency()))), 'bad');
    } finally {
      state.busy = false;
      renderPanel();
    }
  }

  // ---------------------------------------------------------------- several payments at once

  const BATCH_KEY = 'alifa.batch';

  function saveBatch() {
    try {
      sessionStorage.setItem(BATCH_KEY, JSON.stringify({ text: state.batchText, items: state.batch }));
    } catch (e) { /* private window etc. */ }
  }

  function restoreBatch() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(BATCH_KEY) || 'null');
      if (!saved) return;
      state.batchText = String(saved.text || '');
      state.batch = Array.isArray(saved.items) ? saved.items.filter((b) => b && typeof b === 'object') : [];
      for (const b of state.batch) {
        if (!Array.isArray(b.orders)) b.orders = [];
        if (b.status === 'searching') b.status = 'pending'; // a search interrupted by a reload
      }
    } catch (e) { /* ignore a corrupted record */ }
  }

  const hasOrders = (b) => b.orders.length > 0 && b.status !== 'notFound';

  function batchResult(b) {
    if (b.status === 'noAmount') return I.t('batch.noAmount');
    if (b.status === 'searching') return I.t('batch.searching');
    if (b.status === 'notFound') return I.t('batch.notFound');
    if (!hasOrders(b)) return '';
    const text = I.t('batch.found', { orders: orders(b.orders.length), date: I.date(b.foundDate) });
    if (b.status === 'ambiguous') return text + ', ' + I.t('batch.ambiguous');
    if (b.status === 'opened') return text + ', ' + I.t('batch.opened');
    return text;
  }

  function renderBatch() {
    if (!panel) return;
    const list = panel.querySelector('.alifa-batch-list');
    const cur = panelCurrency();
    list.innerHTML = state.batch.map((b, i) => {
      const cls = b.status === 'notFound' || b.status === 'noAmount' ? 'bad' : b.status === 'ambiguous' ? 'warn' : hasOrders(b) ? 'ok' : 'new';
      const head = [b.date ? I.date(b.date) : '', b.cents ? I.money(b.cents, cur) : ''].filter(Boolean).join(' · ') || b.line;
      const buttons = hasOrders(b)
        ? `<span class="alifa-b-btns"><button type="button" class="alifa-btn" data-batch-select="${i}" title="${esc(I.t('batch.selectTitle'))}">${esc(I.t('batch.select'))}</button>` +
          `<button type="button" class="alifa-btn" data-batch-create="${i}" title="${esc(I.t('batch.createTitle'))}">${esc(I.t('batch.create'))}</button></span>`
        : '';
      return `<li class="alifa-b-${cls}" title="${esc(b.error || b.line)}"><span class="alifa-b-head">${esc(head)}</span>` +
        `<span class="alifa-b-res">${esc(batchResult(b))}</span>${buttons}</li>`;
    }).join('');
    const all = panel.querySelector('.alifa-batch-all');
    all.hidden = !state.batch.some((b) => b.status === 'found' || b.status === 'ambiguous');
    all.disabled = state.busy;
    panel.querySelector('.alifa-batch-find').disabled = state.busy;
    for (const btn of list.querySelectorAll('button')) btn.disabled = state.busy;
  }

  /** Finds the orders of every pasted payment; each order is used for one payment only. */
  async function findBatch() {
    if (state.busy) return;
    state.batchText = panel.querySelector('.alifa-batch-input').value;
    state.batch = A.parsePayments(state.batchText).map((p) => Object.assign(p, { status: p.cents ? 'pending' : 'noAmount', orders: [] }));
    saveBatch();
    renderBatch();
    // newest payments first: the order list loads from the newest orders
    const queue = state.batch.filter((b) => b.status === 'pending')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (!queue.length) {
      setStatus(esc(I.t('batch.empty')), 'bad');
      return;
    }
    state.busy = true;
    renderPanel();
    const used = new Set();
    try {
      for (let i = 0; i < queue.length; i++) {
        const b = queue[i];
        b.status = 'searching';
        renderBatch();
        const prefix = I.t('batch.progress', { i: i + 1, n: queue.length }) + ' ';
        const r = await searchPayment(b.cents, b.date, used, (text) => setStatus(esc(prefix + text)));
        if (r.found) {
          b.orders = r.found.ids.map((id) => r.list.find((o) => o.id === id)).filter(Boolean)
            .map((o) => ({ id: o.id, cents: o.cents, currency: o.currency, date: o.date, dateRaw: o.dateRaw, store: o.store, status: o.status }));
          b.foundDate = r.found.date || (b.orders[0] && b.orders[0].date) || null;
          b.status = r.found.ambiguous ? 'ambiguous' : 'found';
          b.error = '';
          for (const o of b.orders) used.add(o.id);
        } else {
          b.status = 'notFound';
          b.error = searchErrorText(r, b.date, I.money(b.cents, panelCurrency()));
        }
        saveBatch();
        renderBatch();
      }
      const found = state.batch.filter(hasOrders).length;
      setStatus(esc(I.t('batch.summary', { found, n: state.batch.length })), found === state.batch.length ? 'ok' : 'warn');
    } finally {
      state.busy = false;
      renderPanel();
    }
  }

  /** Ticks the orders of one payment on the page to check them, and fills in its amount and date. */
  function selectBatch(i) {
    const b = state.batch[i];
    if (!b || !hasOrders(b) || state.busy) return;
    state.selected.clear();
    for (const o of b.orders) state.selected.set(o.id, o);
    state.bankCents = b.cents;
    state.bankDate = b.date || null;
    panel.querySelector('.alifa-bank').value = I.amount(b.cents);
    panel.querySelector('.alifa-date').value = b.date || '';
    saveSelection();
    decorate();
    renderPanel();
    const first = orderElements().find((el) => el.classList.contains('alifa-selected'));
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------------------------------------------------------------- receipts and invoice

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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  /**
   * Loads the receipts of the orders, stores them as a draft and opens the invoice page in a new tab
   * (in the background for several payments). Returns false when a receipt could not be loaded.
   */
  async function openInvoice(list, bankCents, prefix, background) {
    const receipts = [];
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      setStatus(esc(prefix + I.t('st.loadingReceipt', { i: i + 1, n: list.length })));
      try {
        receipts.push(await fetchReceipt(list[i].id));
      } catch (e) {
        failed.push({ order: list[i], error: e.message, code: e.code || null });
      }
      if (i < list.length - 1) await sleep(300);
    }
    if (failed.length) {
      const report = failed.every((f) => USER_ERRORS.has(f.code)) ? '' : reportLink();
      setStatus(esc(prefix + I.t('st.loadFailed')) + '<br>' + failed.map((f) => `${esc(f.order.store || f.order.id)}: ${esc(f.error)}`).join('<br>') + report, 'bad');
      return false;
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await storeDraft(id, {
      createdAt: new Date().toISOString(),
      bankCents,
      receipts,
      listTotals: Object.fromEntries(list.map((o) => [o.id, o.cents])),
    });
    await chrome.runtime.sendMessage({ type: 'alifa-open-invoice', draft: id, active: !background });
    return true;
  }

  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id);

  async function createInvoice() {
    if (state.busy || !state.selected.size) return;
    state.busy = true;
    renderPanel();
    try {
      if (await openInvoice([...state.selected.values()].sort(byDate), state.bankCents, '', false)) {
        setStatus(esc(I.t('st.invoiceOpened')), 'ok');
      }
    } catch (e) {
      setStatus(contextError(e) + reportFor(e), 'bad');
    } finally {
      state.busy = false;
      renderPanel();
    }
  }

  /** Invoices for the given payments of the batch, one tab each (in the background when there are several). */
  async function createBatch(indexes) {
    if (state.busy) return;
    const items = indexes.map((i) => state.batch[i]).filter((b) => b && hasOrders(b));
    if (!items.length) return;
    state.busy = true;
    renderPanel();
    let opened = 0;
    try {
      for (let k = 0; k < items.length; k++) {
        const b = items[k];
        const prefix = items.length > 1 ? I.t('batch.progress', { i: k + 1, n: items.length }) + ' ' : '';
        if (!(await openInvoice(b.orders.slice().sort(byDate), b.cents, prefix, items.length > 1))) return;
        b.status = 'opened';
        opened++;
        saveBatch();
        renderBatch();
      }
      setStatus(esc(I.plural(opened, 'plural.invoicesOpened')), 'ok');
    } catch (e) {
      setStatus(contextError(e) + reportFor(e), 'bad');
    } finally {
      state.busy = false;
      renderPanel();
    }
  }

  // ---------------------------------------------------------------- start

  async function start() {
    await loadSettings();
    restoreSelection();
    restoreBatch();
    buildPanel();
    decorate();
    renderPanel();
    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local' || !changes[S.KEY]) return;
        const before = I.lang();
        await loadSettings();
        if (I.lang() !== before) refreshLanguage();
        else fillProfiles();
      });
    } catch (e) { /* the extension was updated in the meantime */ }
    let pending = null;
    new MutationObserver((mutations) => {
      if (mutations.every((m) => panel.contains(m.target) || (m.target.closest && m.target.closest('.alifa-pick')))) return;
      clearTimeout(pending);
      pending = setTimeout(() => { decorate(); renderPanel(); }, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
