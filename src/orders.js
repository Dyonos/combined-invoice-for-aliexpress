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
  async function probeSiblings(days) {
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
          setStatus(esc(I.t('st.probing', { date: I.date(day), n: probes })));
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

  /** Payment with a date: searches that day, then 1-3 days before it. */
  async function findOnDate(day, amount) {
    const days = [];
    for (let back = 0; back <= DATE_LOOKBACK; back++) days.push(A.addDays(day, -back));
    const lastDay = days[days.length - 1];
    let added = 0;
    let probed = false;
    for (let loads = 0; ; loads++) {
      const list = loadedOrders();
      // orders are newest first, so once orders from an older day are loaded, the newer days are complete
      for (let back = 0; back < days.length; back++) {
        const found = A.findOrdersForAmount(list.filter((o) => o.date === days[back]), state.bankCents, { sameDayOnly: true });
        if (found) {
          selectFound(found, list, back, added);
          return;
        }
      }
      const oldest = oldestDate(domOrders()); // page orders only, orders added by number do not move the loading
      let exhausted = !!(oldest && oldest < lastDay);
      if (!exhausted) {
        if (loads >= MAX_LOADS_DATE) {
          setStatus(esc(I.t('st.loadLimitDate', { oldest: I.date(oldest), date: I.date(day) })), 'bad');
          return;
        }
        setStatus(esc(I.t('st.loadingToDate', { date: I.date(day), oldest: oldest ? I.date(oldest) : '?' })));
        const res = await loadMore();
        if (res === 'stuck') {
          setStatus(esc(I.t('st.stuck')), 'bad');
          return;
        }
        if (res === 'ok') continue;
        exhausted = true; // no more orders
      }
      // the days around the date are loaded and the sum does not match: fill in orders that AliExpress skipped in the list
      if (!probed) {
        probed = true;
        added = await probeSiblings(days.filter((d) => list.some((o) => o.date === d)));
        if (added) continue;
      }
      const inWindow = loadedOrders().filter((o) => o.date && o.date >= lastDay && o.date <= day).length;
      setStatus(esc(inWindow
        ? I.t('st.notFoundDate', { date: I.date(day), k: DATE_LOOKBACK, orders: orders(inWindow), amount })
        : I.t('st.noOrdersDate', { date: I.date(day), k: DATE_LOOKBACK })), 'bad');
      return;
    }
  }

  /** Without a date: a combination from any (single) day among the loaded orders, otherwise loads older ones. */
  async function findAnyDay(amount) {
    for (let loads = 0; ; loads++) {
      const list = loadedOrders();
      const found = A.findOrdersForAmount(list, state.bankCents, { sameDayOnly: true });
      if (found) {
        selectFound(found, list, 0, 0);
        return;
      }
      if (loads >= MAX_LOADS) {
        setStatus(esc(I.t('st.limitAny', { searched: searchedText(list), amount })), 'bad');
        return;
      }
      setStatus(esc(I.t('st.searched', { searched: searchedText(list) })));
      const res = await loadMore();
      if (res === 'end') {
        setStatus(esc(I.t('st.allSearched', { searched: searchedText(list), amount })), 'bad');
        return;
      }
      if (res === 'stuck') {
        setStatus(esc(I.t('st.stuckSearched', { searched: searchedText(list) })), 'bad');
        return;
      }
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
    const amount = I.money(state.bankCents, panelCurrency());
    try {
      if (state.bankDate) await findOnDate(state.bankDate, amount);
      else await findAnyDay(amount);
    } finally {
      state.busy = false;
      renderPanel();
    }
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

  async function createInvoice() {
    if (state.busy || !state.selected.size) return;
    state.busy = true;
    renderPanel();
    const list = [...state.selected.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
    const receipts = [];
    const failed = [];
    try {
      for (let i = 0; i < list.length; i++) {
        setStatus(esc(I.t('st.loadingReceipt', { i: i + 1, n: list.length })));
        try {
          receipts.push(await fetchReceipt(list[i].id));
        } catch (e) {
          failed.push({ order: list[i], error: e.message, code: e.code || null });
        }
        if (i < list.length - 1) await sleep(300);
      }
      if (failed.length) {
        const report = failed.every((f) => USER_ERRORS.has(f.code)) ? '' : reportLink();
        setStatus(esc(I.t('st.loadFailed')) + '<br>' + failed.map((f) => `${esc(f.order.store || f.order.id)}: ${esc(f.error)}`).join('<br>') + report, 'bad');
        return;
      }
      const draft = {
        createdAt: new Date().toISOString(),
        bankCents: state.bankCents,
        receipts,
        listTotals: Object.fromEntries(list.map((o) => [o.id, o.cents])),
      };
      await chrome.storage.local.set({ 'alifa.draft': draft });
      await chrome.runtime.sendMessage({ type: 'alifa-open-invoice' });
      setStatus(esc(I.t('st.invoiceOpened')), 'ok');
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
