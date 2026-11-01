/* Combined Invoice for AliExpress - invoice from the selected orders (extension page). Controls in the interface language, the invoice in its own language (settings.invoiceLang). */
(async () => {
  'use strict';
  const A = globalThis.AliFa;
  const S = globalThis.AliFaSettings;
  const I = globalThis.AliFaI18n;
  const $ = (id) => document.getElementById(id);
  const hasExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- data

  let draft = null;
  if (hasExt) {
    draft = (await chrome.storage.local.get('alifa.draft'))['alifa.draft'] || null;
  } else {
    // preview outside the extension (file opened directly in the browser)
    try {
      await loadScript('../test/fixtures/receipts.js');
      draft = globalThis.ALIFA_FIXTURES ? globalThis.ALIFA_FIXTURES.demoDraft : null;
    } catch (e) { draft = null; }
  }
  let settings = await S.load();
  I.setLang(settings.lang);
  const docLangOf = (s) => (I.STRINGS[s.invoiceLang] ? s.invoiceLang : 'en');
  let docLang = docLangOf(settings);

  const orders = draft && Array.isArray(draft.receipts) ? draft.receipts.map((r) => A.normalizeReceipt(r)) : [];
  const ui = {
    profileId: settings.profileId,
    title: settings.title,
    number: '',
    numberTouched: false,
    bankCents: draft && Number.isInteger(draft.bankCents) ? draft.bankCents : null,
    mode: settings.mode === 'allocated' ? 'allocated' : 'detail',
    // the checkboxes remember their state: they stay as last set for the next invoice
    euWarehouse: settings.euDefault !== false, // "EU Stock" on items
    shipNote: !!settings.shipNoteOn, // "(no tracking)" on Shipping and fees
  };
  const edits = {}; // edited item names: "orderId:index" -> text

  // ---------------------------------------------------------------- panel above the invoice

  function fillProfiles() {
    const sel = $('profile');
    if (!settings.profiles.some((p) => p.id === ui.profileId)) ui.profileId = settings.profiles[0].id;
    sel.innerHTML = settings.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name || I.t('panel.noName'))}</option>`).join('');
    sel.value = ui.profileId;
    const eu = docText('euNote', 'doc.euNote');
    const ship = docText('shipNote', 'doc.shipNote');
    $('euHint').textContent = eu ? I.t('inv.euHint', { text: eu }) : '';
    $('shipHint').textContent = ship ? I.t('inv.shipHint', { text: ship, line: T('doc.charge.totalReceivableTaxAmount') }) : '';
  }

  /** Control texts in the interface language (the invoice has its own language). */
  function applyTexts() {
    document.documentElement.lang = I.lang();
    I.apply(document);
    $('lang').innerHTML = I.langOptions(I.lang());
    $('docLang').innerHTML = I.langOptions(docLang);
    const ver = hasExt && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : globalThis.ALIFA_VERSION;
    $('version').textContent = I.t('brand') + ' ' + (ver ? 'v' + ver : I.t('demo'));
    fillProfiles();
  }

  function bankText(cents) {
    return cents === null ? '' : I.amount(cents);
  }

  applyTexts();
  $('title').value = ui.title;
  $('eu').checked = ui.euWarehouse;
  $('ship').checked = ui.shipNote;
  $('bank').value = bankText(ui.bankCents);
  document.querySelector(`input[name="mode"][value="${ui.mode}"]`).checked = true;

  $('profile').addEventListener('change', async (e) => {
    ui.profileId = e.target.value;
    settings.profileId = ui.profileId;
    await S.save(settings);
    render();
  });
  $('lang').addEventListener('change', async (e) => {
    I.setLang(e.target.value);
    settings.lang = I.lang();
    applyTexts();
    $('bank').value = bankText(ui.bankCents);
    render();
    await S.save(settings);
  });
  $('docLang').addEventListener('change', async (e) => {
    docLang = e.target.value;
    settings.invoiceLang = docLang;
    fillProfiles();
    render();
    await S.save(settings);
  });
  $('title').addEventListener('input', (e) => { ui.title = e.target.value; render(); });
  $('number').addEventListener('input', (e) => { ui.number = e.target.value; ui.numberTouched = true; render(); });
  $('bank').addEventListener('input', (e) => {
    const m = A.parseMoney(e.target.value);
    ui.bankCents = m && m.cents > 0 ? m.cents : null;
    render();
  });
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener('change', async (e) => {
      ui.mode = e.target.value;
      settings.mode = ui.mode;
      await S.save(settings);
      render();
    });
  }
  // a checkbox change is saved, so it stays set for the next invoices
  $('eu').addEventListener('change', async (e) => {
    ui.euWarehouse = e.target.checked;
    settings.euDefault = ui.euWarehouse;
    render();
    await S.save(settings);
  });
  $('ship').addEventListener('change', async (e) => {
    ui.shipNote = e.target.checked;
    settings.shipNoteOn = ui.shipNote;
    render();
    await S.save(settings);
  });
  $('print').addEventListener('click', () => window.print());
  $('settings').addEventListener('click', () => {
    if (hasExt && chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open('options.html', '_blank');
  });
  $('doc').addEventListener('input', (e) => {
    const el = e.target.closest && e.target.closest('.title[data-key]');
    if (el) edits[el.dataset.key] = el.textContent;
  });
  if (hasExt && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local' || !changes[S.KEY]) return;
      settings = await S.load();
      if (settings.lang !== I.lang()) I.setLang(settings.lang);
      docLang = docLangOf(settings);
      applyTexts();
      render();
    });
  }

  /** Warning from the calculations ({ code, ... }) as text in the interface language. */
  function warnText(w) {
    if (typeof w === 'string') return w;
    const p = Object.assign({}, w);
    if (w.cents !== undefined && w.cents !== null) p.amount = I.money(w.cents, w.currency);
    if (w.from) p.from = I.date(w.from);
    if (w.to) p.to = I.date(w.to);
    return I.t('w.' + w.code, p);
  }

  // ---------------------------------------------------------------- invoice (in the invoice language)

  // function declarations: the toolbar (applyTexts above) already needs them before this point runs
  function T(key, params) {
    return I.tIn(docLang, key, params);
  }

  function dateText(iso) {
    return I.dateIn(docLang, iso, { dateStyle: 'medium' });
  }

  function docLocale() {
    return (I.LANGS.find((l) => l.code === docLang) || I.LANGS[0]).locale;
  }

  // texts from the settings follow the invoice language while they are the defaults
  function docText(field, key) {
    const v = settings[field];
    return v === S.DEFAULTS[field] ? T(key) : v;
  }

  const DEFAULT_TITLES = new Set([S.DEFAULTS.title].concat(I.LANGS.map((l) => I.tIn(l.code, 'doc.invoice'))));

  function docTitle() {
    return DEFAULT_TITLES.has(ui.title) ? T('doc.invoice') : ui.title;
  }

  function docSupplier() {
    const s = String(settings.supplier || '');
    const label = T('doc.regNo');
    return s === S.DEFAULTS.supplier ? s.replace('Company Reg. No.:', label.endsWith(':') ? label : label + ':') : s;
  }

  /** Label of a charge or adjustment line in the invoice language (the English label if the key is unknown). */
  function lineLabel(l) {
    const key = l.kind === 'diff' ? (l.key ? 'doc.diff.' + l.key : '') : l.key ? 'doc.charge.' + l.key : '';
    const text = key ? T(key) : '';
    return text && text !== key ? text : l.label;
  }

  // lower case inside a sentence; German nouns, abbreviations and names (VAT, AliExpress, ÁFA) keep their capitals
  function lc(s) {
    if (!s || docLang === 'de') return s;
    const firstWord = s.split(/[\s.-]/)[0];
    if (/\p{Lu}/u.test(firstWord.slice(1))) return s;
    return s.charAt(0).toLocaleLowerCase(docLocale()) + s.slice(1);
  }

  function paymentText(o) {
    if (/card/i.test(o.paymentMethod)) return T('doc.card') + (o.card ? ' ' + o.card : '');
    return o.paymentMethod || T('doc.onlinePayment');
  }

  function allocationNote(o, money, labelFor) {
    const parts = o.charges.map((c) => lc(labelFor(c)) + ' ' + money(c.cents));
    if (o.itemsDiffCents) parts.unshift(lc(T('doc.diff.items')) + ' ' + money(o.itemsDiffCents));
    if (o.residualCents) parts.push(lc(T('doc.diff.other')) + ' ' + money(o.residualCents));
    if (!parts.length) return '';
    return `<tr class="alloc-note"><td class="num"></td><td colspan="4">${esc(T('doc.includedInPrices', { list: parts.join(', ') }))}</td></tr>`;
  }

  /** Print footer "Page 1 of 2" in the invoice language (CSS @page margin box). */
  function pageFooterCss() {
    const content = T('doc.page').split('{pages}')
      .map((chunk) => chunk.split('{page}').map((s) => JSON.stringify(s)).join(' counter(page) '))
      .join(' counter(pages) ');
    return `@page { @bottom-right { content: ${content}; } }`;
  }

  function totalRow(label, value, cls) {
    return `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
  }

  function render() {
    const doc = $('doc');
    if (!orders.length) {
      doc.innerHTML = `<p class="empty">${esc(I.t('inv.empty'))}</p>`;
      $('check').textContent = '';
      return;
    }

    if (DEFAULT_TITLES.has(ui.title) && ui.title !== docTitle()) {
      ui.title = docTitle();
      $('title').value = ui.title;
    }
    const inv = A.combine(orders, { bankCents: ui.bankCents, mode: ui.mode });
    const cur = inv.currency;
    $('bankCur').textContent = I.currencySymbol(cur);
    const money = (c) => I.moneyIn(docLang, c, cur); // on the invoice (invoice language)
    const uiMoney = (c) => I.money(c, cur); // in on-screen messages (interface language)
    const profile = settings.profiles.find((p) => p.id === ui.profileId) || settings.profiles[0];
    // combined orders are paid on one day: issue date = payment date = order date
    const docDate = inv.lastPaidDate || inv.firstPaidDate || todayIso();
    if (!ui.numberTouched) {
      ui.number = `${settings.numberPrefix || 'AE'}-${docDate.replace(/-/g, '')}-${inv.paidCents}`;
      $('number').value = ui.number;
    }

    // ---- check and warnings (screen only)
    const check = $('check');
    if (inv.bankDiffCents === null) {
      check.className = 'check';
      check.textContent = I.t('inv.checkNone', { amount: uiMoney(inv.paidCents) });
    } else if (inv.bankDiffCents === 0) {
      check.className = 'check ok';
      check.textContent = I.t('inv.checkOk', { amount: uiMoney(inv.paidCents) });
    } else {
      check.className = 'check bad';
      check.textContent = I.t('inv.checkBad', {
        orders: uiMoney(inv.paidCents),
        bank: uiMoney(inv.bankCents),
        diff: uiMoney(Math.abs(inv.bankDiffCents)),
      });
    }
    const warnings = inv.warnings.map(warnText);
    for (const o of inv.orders) {
      for (const w of o.warnings.concat(o.notes)) warnings.push(I.t('inv.warnOrder', { id: o.orderId, text: warnText(w) }));
      const listed = draft.listTotals && draft.listTotals[o.orderId];
      if (Number.isInteger(listed) && listed !== o.totalCents) {
        warnings.push(I.t('inv.warnListTotal', { id: o.orderId, list: uiMoney(listed), receipt: uiMoney(o.totalCents) }));
      }
    }
    $('warnings').innerHTML = warnings.map((w) => `<li>${esc(w)}</li>`).join('');

    // ---- header
    const [supplierName, ...supplierRest] = docSupplier().split('\n');
    const buyerLines = [profile.street, profile.city, profile.country].filter(Boolean).join('\n');
    const buyerIds = [
      profile.ico ? T('opt.f.ico') + ': ' + profile.ico : '',
      profile.dic ? T('opt.f.dic') + ': ' + profile.dic : '',
      profile.icdph ? T('opt.f.icdph') + ': ' + profile.icdph : '',
    ].filter(Boolean).join('\n');
    const methods = [...new Set(inv.orders.map(paymentText))];

    const head = `
      <div class="doc-head">
        <div>
          <h1>${esc(docTitle())}</h1>
          <div class="doc-no">${esc(T('doc.no'))} ${esc(ui.number)}</div>
        </div>
        <table class="meta">
          <tr><td>${esc(T('doc.issueDate'))}</td><td>${esc(dateText(docDate))}</td></tr>
          <tr><td>${esc(T('doc.paymentDate'))}</td><td>${esc(dateText(docDate))}</td></tr>
          <tr><td>${esc(T('doc.paymentMethod'))}</td><td>${esc(methods.join(', '))}</td></tr>
        </table>
      </div>
      <div class="parties">
        <div class="party">
          <h2>${esc(T('doc.supplier'))}</h2>
          <div class="name">${esc(supplierName)}</div>
          <p>${esc(supplierRest.join('\n'))}</p>
        </div>
        <div class="party">
          <h2>${esc(T('doc.customer'))}</h2>
          <div class="name">${esc(profile.name)}</div>
          <p>${esc(buyerLines)}</p>
          <p>${esc(buyerIds)}</p>
        </div>
      </div>`;

    // ---- items
    let n = 0;
    const bodies = inv.orders.map((o) => {
      const sellers = o.sellers.join(', ');
      const otherDay = o.paidDate && o.paidDate !== docDate ? ', ' + T('doc.paidOn', { date: dateText(o.paidDate) }) : '';
      const headRow = `<tr class="order-head"><td colspan="5">${esc(T('doc.orderNo'))} <b>${esc(o.orderId)}</b>${sellers || otherDay ? ` (${esc(sellers)}${esc(otherDay)})` : ''}</td></tr>`;
      // "Shipping without tracking" checkbox: "(no tracking)" on the "Shipping and fees" line
      const shipText = ui.shipNote ? docText('shipNote', 'doc.shipNote') : '';
      const labelFor = (l) => (shipText && l.key === 'totalReceivableTaxAmount' ? `${lineLabel(l)} ${shipText}` : lineLabel(l));
      const chargeRow = (cls, label, cents) =>
        `<tr class="${cls}"><td class="num"></td><td>${esc(label)}</td><td class="qty"></td><td class="unit"></td><td class="sum">${esc(money(cents))}</td></tr>`;
      const rows = o.lines.map((l, idx) => {
        if (l.kind === 'item') {
          n++;
          const key = o.orderId + ':' + idx;
          const title = edits[key] !== undefined ? edits[key] : l.title;
          const unit = ui.mode === 'allocated' ? I.unitIn(docLang, l.lineCents, l.qty, cur) : money(l.unitCents);
          // "Shipped from an EU warehouse" checkbox: "EU Stock" in the variant line, the way AliExpress writes it ("2pcs, PL Stock")
          const euText = ui.euWarehouse ? docText('euNote', 'doc.euNote') : '';
          const eu = euText && !l.sku.toLowerCase().includes(euText.toLowerCase()) ? euText : '';
          const sku = [l.sku, eu].filter(Boolean).join(', ');
          return `<tr class="item"><td class="num">${n}.</td>` +
            `<td><div class="title" contenteditable="plaintext-only" spellcheck="false" data-key="${esc(key)}">${esc(title)}</div>` +
            `${sku ? `<div class="sku">${esc(sku)}</div>` : ''}</td>` +
            `<td class="qty">${esc(I.pluralIn(docLang, l.qty, 'doc.pcs'))}</td><td class="unit">${esc(unit)}</td><td class="sum">${esc(money(l.lineCents))}</td></tr>`;
        }
        // receipt sub-lines (customs duty and benefit breakdowns) are not printed on the invoice, only the main lines
        return chargeRow(l.kind, labelFor(l), l.lineCents);
      }).join('');
      const note = ui.mode === 'allocated' ? allocationNote(o, money, labelFor) : '';
      const total = `<tr class="order-total"><td class="num"></td><td colspan="3">${esc(T('doc.orderTotal'))}</td><td class="sum">${esc(money(o.totalCents))}</td></tr>`;
      return `<tbody>${headRow}${note}${rows}${total}</tbody>`;
    }).join('');

    const table = `
      <table class="items">
        <thead><tr><th class="num">#</th><th>${esc(T('doc.description'))}</th><th class="qty">${esc(T('doc.qty'))}</th><th class="unit">${esc(T('doc.unitPrice'))}</th><th class="sum">${esc(T('doc.amount'))}</th></tr></thead>
        ${bodies}
      </table>`;

    // ---- totals
    const t = [];
    if (inv.includedTaxCents !== null && inv.includedTaxComplete) {
      t.push(totalRow(T('doc.totalExclVat'), money(inv.totalCents - inv.includedTaxCents), 'muted'));
      t.push(totalRow(`${T('doc.vat')}${inv.vatRate ? ' ' + inv.vatRate + '%' : ''}`, money(inv.includedTaxCents), 'muted'));
    }
    if (inv.bonusCents) {
      t.push(totalRow(T('doc.total'), money(inv.totalCents)));
      t.push(totalRow(T('doc.paidCredit'), money(-inv.bonusCents)));
      t.push(totalRow(T('doc.paidCard'), money(inv.paidCents), 'grand'));
    } else {
      t.push(totalRow(T('doc.total'), money(inv.totalCents), 'grand'));
    }
    const totals = `<div class="totals"><table>${t.join('')}</table></div>`;

    // note at the bottom of the invoice from the settings (empty = none)
    const note = docText('invoiceNote', 'doc.note');
    const foot = note ? `<p class="doc-foot">${esc(note)}</p>` : '';
    doc.lang = docLang;
    doc.innerHTML = head + table + totals + foot;
    $('pageCss').textContent = pageFooterCss();
    document.title = `${docTitle()} ${ui.number}`;
  }

  render();
})();
