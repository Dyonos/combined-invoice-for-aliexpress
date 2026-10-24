/* Combined Invoice for AliExpress - invoice from the selected orders (extension page). Controls in the language from the settings, invoice in English. */
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
    $('euHint').textContent = settings.euNote ? I.t('inv.euHint', { text: settings.euNote }) : '';
    $('shipHint').textContent = settings.shipNote ? I.t('inv.shipHint', { text: settings.shipNote }) : '';
  }

  /** Control texts in the current language (the invoice itself stays in English). */
  function applyTexts() {
    document.documentElement.lang = I.lang();
    I.apply(document);
    $('lang').innerHTML = I.langOptions(I.lang());
    const ver = hasExt && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : globalThis.ALIFA_VERSION;
    $('version').textContent = I.t('brand') + ' ' + (ver ? 'v' + ver : I.t('demo'));
    fillProfiles();
  }

  function bankText(cents) {
    if (cents === null) return '';
    const s = (cents / 100).toFixed(2);
    return I.lang() === 'en' ? s : s.replace('.', ',');
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

  // ---------------------------------------------------------------- invoice (the invoice content is in English)

  const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "2026-10-19" -> "19 Oct 2026" */
  function enDate(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    return `${d} ${EN_MONTHS[m - 1]} ${y}`;
  }

  function lcFirst(s) {
    return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }

  function paymentText(o) {
    if (/card/i.test(o.paymentMethod)) return 'Card' + (o.card ? ' ' + o.card : '');
    return o.paymentMethod || 'Online payment';
  }

  function allocationNote(o, money, labelFor) {
    const parts = o.charges.map((c) => lcFirst(labelFor(c)) + ' ' + money(c.cents));
    if (o.itemsDiffCents) parts.unshift('item price adjustment ' + money(o.itemsDiffCents));
    if (o.residualCents) parts.push('other adjustment ' + money(o.residualCents));
    if (!parts.length) return '';
    return `<tr class="alloc-note"><td class="num"></td><td colspan="4">Included in item prices: ${esc(parts.join(', '))}</td></tr>`;
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

    const inv = A.combine(orders, { bankCents: ui.bankCents, mode: ui.mode });
    const cur = inv.currency;
    const money = (c) => A.formatMoney(c, cur, 'en'); // on the invoice (in English)
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
    const [supplierName, ...supplierRest] = String(settings.supplier || '').split('\n');
    const buyerLines = [profile.street, profile.city, profile.country].filter(Boolean).join('\n');
    const buyerIds = [
      profile.ico ? 'Company ID: ' + profile.ico : '',
      profile.dic ? 'Tax ID: ' + profile.dic : '',
      profile.icdph ? 'VAT ID: ' + profile.icdph : '',
    ].filter(Boolean).join('\n');
    const methods = [...new Set(inv.orders.map(paymentText))];

    const head = `
      <div class="doc-head">
        <div>
          <h1>${esc(ui.title)}</h1>
          <div class="doc-no">No. ${esc(ui.number)}</div>
        </div>
        <table class="meta">
          <tr><td>Date of issue</td><td>${esc(enDate(docDate))}</td></tr>
          <tr><td>Date of payment</td><td>${esc(enDate(docDate))}</td></tr>
          <tr><td>Payment method</td><td>${esc(methods.join(', '))}</td></tr>
        </table>
      </div>
      <div class="parties">
        <div class="party">
          <h2>Supplier</h2>
          <div class="name">${esc(supplierName)}</div>
          <p>${esc(supplierRest.join('\n'))}</p>
        </div>
        <div class="party">
          <h2>Customer</h2>
          <div class="name">${esc(profile.name)}</div>
          <p>${esc(buyerLines)}</p>
          <p>${esc(buyerIds)}</p>
        </div>
      </div>`;

    // ---- items
    let n = 0;
    const bodies = inv.orders.map((o) => {
      const sellers = o.sellers.join(', ');
      const otherDay = o.paidDate && o.paidDate !== docDate ? `, paid ${enDate(o.paidDate)}` : '';
      const headRow = `<tr class="order-head"><td colspan="5">Order No. <b>${esc(o.orderId)}</b>${sellers || otherDay ? ` (${esc(sellers)}${esc(otherDay)})` : ''}</td></tr>`;
      // "Shipping without tracking" checkbox: "(no tracking)" on the "Shipping and fees" line
      const shipText = ui.shipNote && settings.shipNote ? settings.shipNote : '';
      const labelFor = (l) => (shipText && l.key === 'totalReceivableTaxAmount' ? `${l.label} ${shipText}` : l.label);
      const chargeRow = (cls, label, cents) =>
        `<tr class="${cls}"><td class="num"></td><td>${esc(label)}</td><td class="qty"></td><td class="unit"></td><td class="sum">${esc(money(cents))}</td></tr>`;
      const rows = o.lines.map((l, idx) => {
        if (l.kind === 'item') {
          n++;
          const key = o.orderId + ':' + idx;
          const title = edits[key] !== undefined ? edits[key] : l.title;
          const unit = ui.mode === 'allocated' ? A.formatUnit(l.lineCents, l.qty, cur, 'en') : money(l.unitCents);
          // "Shipped from an EU warehouse" checkbox: "EU Stock" in the variant line, the way AliExpress writes it ("2pcs, PL Stock")
          const eu = ui.euWarehouse && settings.euNote && !l.sku.toLowerCase().includes(settings.euNote.toLowerCase())
            ? settings.euNote : '';
          const sku = [l.sku, eu].filter(Boolean).join(', ');
          return `<tr class="item"><td class="num">${n}.</td>` +
            `<td><div class="title" contenteditable="plaintext-only" spellcheck="false" data-key="${esc(key)}">${esc(title)}</div>` +
            `${sku ? `<div class="sku">${esc(sku)}</div>` : ''}</td>` +
            `<td class="qty">${l.qty} ${l.qty === 1 ? 'pc' : 'pcs'}</td><td class="unit">${esc(unit)}</td><td class="sum">${esc(money(l.lineCents))}</td></tr>`;
        }
        // receipt sub-lines (customs duty and benefit breakdowns) are not printed on the invoice, only the main lines
        return chargeRow(l.kind, labelFor(l), l.lineCents);
      }).join('');
      const note = ui.mode === 'allocated' ? allocationNote(o, money, labelFor) : '';
      const total = `<tr class="order-total"><td class="num"></td><td colspan="3">Order total</td><td class="sum">${esc(money(o.totalCents))}</td></tr>`;
      return `<tbody>${headRow}${note}${rows}${total}</tbody>`;
    }).join('');

    const table = `
      <table class="items">
        <thead><tr><th class="num">#</th><th>Description</th><th class="qty">Qty</th><th class="unit">Unit price</th><th class="sum">Amount</th></tr></thead>
        ${bodies}
      </table>`;

    // ---- totals
    const t = [];
    if (inv.includedTaxCents !== null && inv.includedTaxComplete) {
      t.push(totalRow('Total excl. VAT', money(inv.totalCents - inv.includedTaxCents), 'muted'));
      t.push(totalRow(`VAT${inv.vatRate ? ' ' + inv.vatRate + '%' : ''}`, money(inv.includedTaxCents), 'muted'));
    }
    if (inv.bonusCents) {
      t.push(totalRow('Total', money(inv.totalCents)));
      t.push(totalRow('Paid with AliExpress credit', money(-inv.bonusCents)));
      t.push(totalRow('Paid by card', money(inv.paidCents), 'grand'));
    } else {
      t.push(totalRow('Total', money(inv.totalCents), 'grand'));
    }
    const totals = `<div class="totals"><table>${t.join('')}</table></div>`;

    // note at the bottom of the invoice from the settings (empty = none)
    const foot = settings.invoiceNote ? `<p class="doc-foot">${esc(settings.invoiceNote)}</p>` : '';
    doc.innerHTML = head + table + totals + foot;
    document.title = `Invoice ${ui.number}`;
  }

  render();
})();
