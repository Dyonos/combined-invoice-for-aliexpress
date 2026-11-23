/*
 * Combined Invoice for AliExpress - the invoice page: one invoice, or several invoices on one page, each starting on
 * a new printed page (one print = one PDF). Controls in the interface language, the invoices in their own language
 * (settings.invoiceLang). The documents come from documents.js; export.js makes the CSV and ISDOC downloads.
 */
(async () => {
  'use strict';
  const A = globalThis.AliFa;
  const S = globalThis.AliFaSettings;
  const I = globalThis.AliFaI18n;
  const D = globalThis.AliFaDocs;
  const E = globalThis.AliFaExport;
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
    // each invoice tab reads its own draft (?draft=<id>); without it the last one
    const draftId = new URLSearchParams(location.search).get('draft');
    const key = draftId ? 'alifa.draft.' + draftId : 'alifa.draft';
    draft = (await chrome.storage.local.get(key))[key] || null;
  } else {
    // preview outside the extension (file opened directly in the browser): ?demo=multi shows several invoices,
    // window.ALIFA_DEMO can also be a draft itself
    try {
      await loadScript('../test/fixtures/receipts.js');
      const F = globalThis.ALIFA_FIXTURES;
      const demo = new URLSearchParams(location.search).get('demo') || globalThis.ALIFA_DEMO;
      if (demo && typeof demo === 'object') draft = demo;
      else draft = F ? (demo === 'multi' ? F.demoMulti : demo === 'multi-refund' ? F.demoMultiRefund : F.demoDraft) : null;
    } catch (e) { draft = null; }
  }
  let settings = await S.load();
  I.setLang(settings.lang);
  const docLangOf = (s) => (I.STRINGS[s.invoiceLang] ? s.invoiceLang : 'en');
  let docLang = docLangOf(settings);

  const parts = D.draftParts(draft);
  // several invoices on one page: the toolbar options apply to all of them, each keeps its own number and dates
  const multi = parts.length > 1;
  const ui = {
    profileId: settings.profileId,
    title: settings.title,
    mode: settings.mode === 'allocated' ? 'allocated' : 'detail',
    // the checkboxes remember their state: they stay as last set for the next invoice
    euWarehouse: settings.euDefault !== false, // "EU Stock" on items
    shipNote: !!settings.shipNoteOn, // "(no tracking)" on Shipping and fees
    docType: 'invoice', // or 'credit': credit notes for the refunded amounts
    date: '', // date of issue typed in the toolbar ('' = automatic), one invoice only
    show: Object.assign({ logo: true, images: false, stores: true, status: false, dates: false }, settings.show),
  };
  const edits = {}; // edited item names: "orderId:index" -> text
  const numbers = {}; // typed document numbers: "invoice:<k>" / "credit:<k>" -> text

  // ---------------------------------------------------------------- panel above the invoice

  function fillProfiles() {
    const sel = $('profile');
    if (!settings.profiles.some((p) => p.id === ui.profileId)) ui.profileId = settings.profiles[0].id;
    sel.innerHTML = settings.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name || I.t('panel.noName'))}</option>`).join('');
    sel.value = ui.profileId;
    const eu = D.settingText(docLang, settings, 'euNote', 'doc.euNote');
    const ship = D.settingText(docLang, settings, 'shipNote', 'doc.shipNote');
    $('euHint').textContent = eu ? I.t('inv.euHint', { text: eu }) : '';
    $('shipHint').textContent = ship ? I.t('inv.shipHint', { text: ship, line: I.tIn(docLang, 'doc.charge.totalReceivableTaxAmount') }) : '';
  }

  function version() {
    return hasExt && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : globalThis.ALIFA_VERSION;
  }

  /** Control texts in the interface language (the invoice has its own language). */
  function applyTexts() {
    document.documentElement.lang = I.lang();
    I.apply(document);
    $('lang').innerHTML = I.langOptions(I.lang());
    $('docLang').innerHTML = I.langOptions(docLang);
    const ver = version();
    $('version').textContent = I.t('brand') + ' ' + (ver ? 'v' + ver : I.t('demo'));
    if (multi) $('hint').textContent = I.t('inv.hintMulti');
    fillProfiles();
  }

  function bankText(cents) {
    return cents === null || cents === undefined ? '' : I.amount(cents);
  }

  applyTexts();
  $('title').value = ui.title;
  $('eu').checked = ui.euWarehouse;
  $('ship').checked = ui.shipNote;
  for (const box of document.querySelectorAll('[data-show]')) box.checked = !!ui.show[box.dataset.show];
  $('docTypeWrap').hidden = !parts.some((p) => p.orders.some((o) => o.refund && o.refund.cents));
  // number, date and bank amount belong to one invoice; with several, each has its own
  for (const id of ['numberWrap', 'dateWrap', 'bankWrap']) $(id).hidden = multi;
  $('bank').value = parts.length ? bankText(parts[0].bankCents) : '';
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
    if (parts.length) $('bank').value = bankText(parts[0].bankCents);
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
  $('number').addEventListener('input', (e) => {
    numbers[ui.docType + ':0'] = e.target.value;
    render();
  });
  $('bank').addEventListener('input', (e) => {
    const m = A.parseMoney(e.target.value);
    if (parts.length) parts[0].bankCents = m && m.cents > 0 ? m.cents : null;
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
  for (const box of document.querySelectorAll('[data-show]')) {
    box.addEventListener('change', async () => {
      ui.show[box.dataset.show] = box.checked;
      settings.show = Object.assign({}, ui.show);
      render();
      await S.save(settings);
    });
  }
  $('docType').addEventListener('change', (e) => {
    ui.docType = e.target.value;
    ui.date = '';
    $('docDate').value = '';
    render();
  });
  $('docDate').addEventListener('input', (e) => { ui.date = e.target.value; render(); });
  $('print').addEventListener('click', () => window.print());
  $('csv').addEventListener('click', downloadCsv);
  $('isdoc').addEventListener('click', downloadIsdoc);
  $('settings').addEventListener('click', () => {
    if (hasExt && chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open('options.html', '_blank');
  });
  // edits in the invoice text: item names, and with several invoices also their numbers
  $('doc').addEventListener('input', (e) => {
    const title = e.target.closest && e.target.closest('.title[data-key]');
    if (title) edits[title.dataset.key] = title.textContent;
    const no = e.target.closest && e.target.closest('[data-num]');
    if (no) {
      numbers[no.dataset.num] = no.textContent.trim();
      document.title = pageTitle(documents());
    }
  });
  // a number is one line: Enter ends the editing
  $('doc').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-num]')) {
      e.preventDefault();
      e.target.blur();
    }
  });
  // the footer of each invoice depends on its printed height: images change it when they load
  $('doc').addEventListener('load', updatePageCss, true);
  window.addEventListener('beforeprint', updatePageCss);
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

  // ---------------------------------------------------------------- invoices (in the invoice language)

  // function declarations: the toolbar (applyTexts above) already needs them before this point runs
  function T(key, params) {
    return I.tIn(docLang, key, params);
  }

  function dateText(iso) {
    return I.dateIn(docLang, iso, { dateStyle: 'medium' });
  }

  /** The shown documents with the current toolbar options, typed numbers and edited item names. */
  function documents() {
    return D.buildDocuments(parts, {
      lang: docLang,
      settings,
      profileId: ui.profileId,
      title: ui.title,
      mode: ui.mode,
      euWarehouse: ui.euWarehouse,
      shipNote: ui.shipNote,
      docType: ui.docType,
      show: ui.show,
      date: multi ? '' : ui.date,
      today: todayIso(),
      edits,
      numbers,
    });
  }

  function totalRow(label, value, cls) {
    return `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
  }

  /** Picture of an item from the receipt (AliExpress sometimes gives it without the protocol). */
  function imgSrc(url) {
    const u = String(url || '');
    if (u.startsWith('//')) return 'https:' + u;
    return /^https:\/\//.test(u) ? u : '';
  }

  /** One invoice or credit note as HTML (the inside of its sheet). */
  function docHtml(d) {
    const money = (c) => I.moneyIn(docLang, c, d.currency);
    const [supplierName, ...supplierRest] = d.supplier;
    const p = d.customer;
    const buyerLines = [p.street, p.city, p.country].filter(Boolean).join('\n');
    const buyerIds = [
      p.ico ? T('opt.f.ico') + ': ' + p.ico : '',
      p.dic ? T('opt.f.dic') + ': ' + p.dic : '',
      p.icdph ? T('opt.f.icdph') + ': ' + p.icdph : '',
    ].filter(Boolean).join('\n');
    const logo = d.logo ? `<img class="doc-logo" src="${esc(d.logo)}" alt="">` : '';
    // with several invoices the number is edited right on the invoice
    const number = multi
      ? `<span class="doc-no-val" contenteditable="plaintext-only" spellcheck="false" data-num="${d.type}:${d.k}">${esc(d.number)}</span>`
      : esc(d.number);

    const head = `
      <div class="doc-head">
        <div>
          ${logo}
          <h1>${esc(d.title)}</h1>
          <div class="doc-no">${esc(T('doc.no'))} ${number}</div>
          ${d.credit ? `<div class="doc-ref">${esc(T('doc.toInvoice', { number: d.invoiceNumber }))}</div>` : ''}
        </div>
        <table class="meta">
          <tr><td>${esc(T('doc.issueDate'))}</td><td>${esc(dateText(d.issueDate))}</td></tr>
          ${d.credit ? '' : `<tr><td>${esc(T('doc.paymentDate'))}</td><td>${esc(dateText(d.paymentDate))}</td></tr>`}
          <tr><td>${esc(T('doc.paymentMethod'))}</td><td>${esc(d.methods.join(', '))}</td></tr>
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
          <div class="name">${esc(p.name)}</div>
          <p>${esc(buyerLines)}</p>
          <p>${esc(buyerIds)}</p>
        </div>
      </div>`;

    let n = 0;
    const bodies = d.orders.map((o) => {
      const orderHead = `<tr class="order-head"><td colspan="5">${esc(T('doc.orderNo'))} <b>${esc(o.orderId)}</b>${o.extra.length ? ` (${esc(o.extra.join(', '))})` : ''}</td></tr>`;
      const allocation = o.allocation ? `<tr class="alloc-note"><td class="num"></td><td colspan="4">${esc(o.allocation)}</td></tr>` : '';
      const rows = o.lines.map((l) => {
        if (l.kind === 'refund') {
          n++;
          return `<tr class="item"><td class="num">${n}.</td><td><div class="title">${esc(l.text)}</div></td>` +
            `<td class="qty"></td><td class="unit"></td><td class="sum">${esc(money(l.lineCents))}</td></tr>`;
        }
        if (l.kind === 'item') {
          n++;
          const unit = Number.isInteger(l.unitCents) ? money(l.unitCents) : I.moneyIn(docLang, l.unitCents, d.currency, 4);
          const img = d.images && imgSrc(l.img) ? `<img class="item-img" src="${esc(imgSrc(l.img))}" alt="">` : '';
          return `<tr class="item"><td class="num">${n}.</td>` +
            `<td>${img}<div class="title" contenteditable="plaintext-only" spellcheck="false" data-key="${esc(l.key)}">${esc(l.text)}</div>` +
            `${l.sku ? `<div class="sku">${esc(l.sku)}</div>` : ''}</td>` +
            `<td class="qty">${esc(I.pluralIn(docLang, l.qty, 'doc.pcs'))}</td><td class="unit">${esc(unit)}</td><td class="sum">${esc(money(l.lineCents))}</td></tr>`;
        }
        // receipt sub-lines (customs duty and benefit breakdowns) are not printed on the invoice, only the main lines
        return `<tr class="${l.kind}"><td class="num"></td><td>${esc(l.text)}</td><td class="qty"></td><td class="unit"></td><td class="sum">${esc(money(l.lineCents))}</td></tr>`;
      }).join('');
      const total = d.credit ? '' : `<tr class="order-total"><td class="num"></td><td colspan="3">${esc(T('doc.orderTotal'))}</td><td class="sum">${esc(money(o.totalCents))}</td></tr>`;
      return `<tbody>${orderHead}${allocation}${rows}${total}</tbody>`;
    }).join('');

    const table = `
      <table class="items">
        <thead><tr><th class="num">#</th><th>${esc(T('doc.description'))}</th><th class="qty">${esc(T('doc.qty'))}</th><th class="unit">${esc(T('doc.unitPrice'))}</th><th class="sum">${esc(T('doc.amount'))}</th></tr></thead>
        ${bodies}
      </table>`;

    const t = [];
    if (d.credit) {
      t.push(totalRow(T('doc.total'), money(d.totalCents), 'grand'));
    } else {
      if (d.vatCents !== null) {
        t.push(totalRow(T('doc.totalExclVat'), money(d.totalCents - d.vatCents), 'muted'));
        t.push(totalRow(`${T('doc.vat')}${d.vatRate ? ' ' + d.vatRate + '%' : ''}`, money(d.vatCents), 'muted'));
      }
      if (d.bonusCents) {
        t.push(totalRow(T('doc.total'), money(d.totalCents)));
        t.push(totalRow(T('doc.paidCredit'), money(-d.bonusCents)));
        t.push(totalRow(T('doc.paidCard'), money(d.paidCents), 'grand'));
      } else {
        t.push(totalRow(T('doc.total'), money(d.totalCents), 'grand'));
      }
    }
    const totals = `<div class="totals"><table>${t.join('')}</table></div>`;

    // note at the bottom of the invoice from the settings (empty = none)
    const foot = d.note ? `<p class="doc-foot">${esc(d.note)}</p>` : '';
    return head + table + totals + foot;
  }

  /** The check against the bank amount and the warnings (screen only, in the interface language). */
  function renderChecks(docs) {
    const check = $('check');
    const uiMoney = (c, cur) => I.money(c, cur);
    const cur = docs.length ? docs[0].currency : 'EUR';
    if (ui.docType === 'credit') {
      check.className = 'check';
      check.textContent = I.t('inv.checkRefund', { amount: uiMoney(docs.reduce((sum, d) => sum + d.refundCents, 0), cur) });
    } else if (multi) {
      const bad = docs.filter((d) => d.bankDiffCents !== null && d.bankDiffCents !== 0);
      const checked = docs.some((d) => d.bankDiffCents !== null);
      const invoices = I.plural(docs.length, 'plural.invoices');
      const amount = uiMoney(docs.reduce((sum, d) => sum + d.paidCents, 0), cur);
      check.className = bad.length ? 'check bad' : checked ? 'check ok' : 'check';
      check.textContent = bad.length ? I.t('inv.multiBad', { bad: bad.length, n: docs.length })
        : I.t(checked ? 'inv.multiOk' : 'inv.multiNone', { invoices, amount });
    } else {
      const d = docs[0];
      if (d.bankDiffCents === null) {
        check.className = 'check';
        check.textContent = I.t('inv.checkNone', { amount: uiMoney(d.paidCents, d.currency) });
      } else if (d.bankDiffCents === 0) {
        check.className = 'check ok';
        check.textContent = I.t('inv.checkOk', { amount: uiMoney(d.paidCents, d.currency) });
      } else {
        check.className = 'check bad';
        check.textContent = I.t('inv.checkBad', {
          orders: uiMoney(d.paidCents, d.currency),
          bank: uiMoney(d.bankCents, d.currency),
          diff: uiMoney(Math.abs(d.bankDiffCents), d.currency),
        });
      }
    }

    const warnings = [];
    for (const d of docs) {
      const inv = d.inv;
      // with several invoices, an invoice's own warnings name the invoice; order warnings name the order
      const ofInvoice = (text) => (multi ? I.t('inv.warnInvoice', { number: d.number, text }) : text);
      if (multi && !d.credit && d.bankDiffCents) {
        warnings.push(I.t('inv.multiDiff', {
          number: d.number,
          orders: uiMoney(d.paidCents, d.currency),
          bank: uiMoney(d.bankCents, d.currency),
          diff: uiMoney(Math.abs(d.bankDiffCents), d.currency),
        }));
      }
      for (const w of inv.warnings) warnings.push(ofInvoice(warnText(w)));
      for (const o of inv.orders) {
        for (const w of o.warnings.concat(o.notes)) warnings.push(I.t('inv.warnOrder', { id: o.orderId, text: warnText(w) }));
        const listed = d.part.listTotals[o.orderId];
        if (Number.isInteger(listed) && listed !== o.totalCents) {
          warnings.push(I.t('inv.warnListTotal', { id: o.orderId, list: uiMoney(listed, d.currency), receipt: uiMoney(o.totalCents, d.currency) }));
        }
      }
    }
    $('warnings').innerHTML = warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  }

  function pageTitle(docs) {
    if (!docs.length) return I.t('storeName');
    const first = docs[0];
    const last = docs[docs.length - 1];
    return docs.length === 1 ? `${first.title} ${first.number}` : `${first.title} ${first.number} - ${last.number}`;
  }

  // ---------------------------------------------------------------- print footer

  // Chrome cannot restart the page numbers for each invoice of a longer document. So with several invoices
  // an invoice that surely fits on one page gets "Page 1 of 1", as when printed alone, and a longer one
  // its number on every page. The printable height of A4 with the page margins of invoice.css is 271 mm;
  // the sheet on screen is a little narrower than the printed page, so its text is never shorter.
  const MM = 96 / 25.4;
  const ONE_PAGE_MM = 262;

  function fitsOnePage(sheet) {
    const last = sheet.lastElementChild;
    if (!last) return true;
    const style = getComputedStyle(sheet);
    const top = sheet.getBoundingClientRect().top + parseFloat(style.paddingTop || 0);
    const bottom = last.getBoundingClientRect().bottom + parseFloat(getComputedStyle(last).marginBottom || 0);
    return (bottom - top) / MM <= ONE_PAGE_MM;
  }

  /** Print footer "Page 1 of 2" in the invoice language (CSS @page margin box); each invoice is a named page. */
  function updatePageCss() {
    if (!multi) {
      const content = T('doc.page').split('{pages}')
        .map((chunk) => chunk.split('{page}').map((s) => JSON.stringify(s)).join(' counter(page) '))
        .join(' counter(pages) ');
      $('pageCss').textContent = `@page { @bottom-right { content: ${content}; } }`;
      return;
    }
    $('pageCss').textContent = [...document.querySelectorAll('#doc > .doc[data-page]')].map((sheet) => {
      // the number as it is on the invoice now (it may have been typed after the page was drawn)
      const no = sheet.querySelector('[data-num]');
      const text = fitsOnePage(sheet) ? T('doc.page', { page: 1, pages: 1 }) : (no && no.textContent.trim()) || sheet.dataset.number;
      return `@page ${sheet.dataset.page} { @bottom-right { content: ${JSON.stringify(text)}; } }`;
    }).join('\n');
  }

  // ---------------------------------------------------------------- render

  function render() {
    const main = $('doc');
    main.lang = docLang;
    const docs = documents();
    if (!docs.length) {
      main.innerHTML = `<article class="doc"><p class="empty">${esc(I.t('inv.empty'))}</p></article>`;
      $('check').textContent = '';
      $('warnings').innerHTML = '';
      document.title = pageTitle(docs);
      return;
    }
    if (D.isDefaultTitle(ui.title) && ui.title !== docs[0].title) {
      ui.title = docs[0].title;
      $('title').value = ui.title;
    }
    $('bankCur').textContent = I.currencySymbol(docs[0].currency);
    if (!multi) {
      const d = docs[0];
      if (numbers[ui.docType + ':0'] === undefined && document.activeElement !== $('number')) $('number').value = d.number;
      if (!ui.date && document.activeElement !== $('docDate')) $('docDate').value = d.issueDate;
    }
    renderChecks(docs);
    main.innerHTML = docs.map((d, i) => (multi
      ? `<article class="doc" data-page="invoice${i + 1}" data-number="${esc(d.number)}" style="page: invoice${i + 1}">${docHtml(d)}</article>`
      : `<article class="doc">${docHtml(d)}</article>`)).join('');
    updatePageCss();
    document.title = pageTitle(docs);
  }

  // ---------------------------------------------------------------- export

  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Lines and totals of the shown documents; numbers in the format of the interface language (spreadsheets). */
  function downloadCsv() {
    const docs = documents();
    if (!docs.length) return;
    download(E.fileName(pageTitle(docs)) + '.csv', E.toCsv(docs, D.csvLabels(docLang), D.decimalSeparator(I.lang())), 'text/csv;charset=utf-8');
  }

  /** ISDOC of the shown document, or a ZIP with one ISDOC per document. */
  function downloadIsdoc() {
    const docs = documents();
    if (!docs.length) return;
    const opts = { system: `${I.tIn('en', 'storeName')} ${version() || ''}`.trim(), locale: D.localeOf(docLang) };
    if (docs.length === 1) {
      download(E.fileName(pageTitle(docs)) + '.isdoc', E.toIsdoc(docs[0], opts), 'application/xml');
      return;
    }
    const used = new Set();
    const files = docs.map((d) => {
      let name = E.fileName(`${d.title} ${d.number}`);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = E.fileName(`${d.title} ${d.number}`) + '-' + i;
      used.add(name.toLowerCase());
      return { name: name + '.isdoc', data: E.toIsdoc(d, opts) };
    });
    download(E.fileName(pageTitle(docs)) + '.zip', E.zip(files), 'application/zip');
  }

  render();
})();
