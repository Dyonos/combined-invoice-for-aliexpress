/*
 * Combined Invoice for AliExpress - the documents of the invoice page: every invoice or credit note with its lines,
 * totals and texts in the invoice language. invoice.js prints them, export.js turns them into CSV and ISDOC.
 * Runs in the extension and in the Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./core.js'), require('./i18n.js'), require('./settings.js'));
  } else {
    root.AliFaDocs = factory(root.AliFa, root.AliFaI18n, root.AliFaSettings);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (A, I, S) {
  'use strict';

  /**
   * Invoices of a draft: one invoice, or several invoices opened on one page ({ invoices: [draft, ...] }).
   * Returns [{ orders (normalized receipts), bankCents, listTotals, listStatus }].
   */
  function draftParts(draft) {
    if (!draft) return [];
    const list = Array.isArray(draft.invoices) ? draft.invoices : [draft];
    return list.filter((p) => p && Array.isArray(p.receipts) && p.receipts.length).map((p) => ({
      orders: p.receipts.map((r) => A.normalizeReceipt(r)),
      bankCents: Number.isInteger(p.bankCents) ? p.bankCents : null,
      listTotals: p.listTotals && typeof p.listTotals === 'object' ? p.listTotals : {},
      listStatus: p.listStatus && typeof p.listStatus === 'object' ? p.listStatus : {},
    }));
  }

  const DEFAULT_TITLES = new Set([S.DEFAULTS.title].concat(...I.LANGS.map((l) => [I.tIn(l.code, 'doc.invoice'), I.tIn(l.code, 'doc.creditNote')])));

  const isDefaultTitle = (title) => DEFAULT_TITLES.has(title);

  /** Title of a document: a default title follows the invoice language and the document type, a custom one stays. */
  function titleFor(lang, title, type) {
    return DEFAULT_TITLES.has(title) ? I.tIn(lang, type === 'credit' ? 'doc.creditNote' : 'doc.invoice') : title;
  }

  /** A text from the settings (EU Stock, (no tracking)) follows the invoice language while it is the default. */
  function settingText(lang, settings, field, key) {
    const v = settings[field];
    return v === S.DEFAULTS[field] ? I.tIn(lang, key) : v;
  }

  /** Supplier text of the invoice header; the default one gets "Company Reg. No." in the invoice language. */
  function supplierText(lang, settings) {
    const s = String(settings.supplier || '');
    const label = I.tIn(lang, 'doc.regNo');
    return s === S.DEFAULTS.supplier ? s.replace('Company Reg. No.:', label.endsWith(':') ? label : label + ':') : s;
  }

  function localeOf(lang) {
    return (I.LANGS.find((l) => l.code === lang) || I.LANGS[0]).locale;
  }

  /** Decimal separator of a language: "." or ",". */
  function decimalSeparator(lang) {
    try {
      const part = new Intl.NumberFormat(localeOf(lang)).formatToParts(1.5).find((p) => p.type === 'decimal');
      return part && part.value === ',' ? ',' : '.';
    } catch (e) {
      return '.';
    }
  }

  // lower case inside a sentence; German nouns, abbreviations and names (VAT, AliExpress, ÁFA) keep their capitals
  function lc(lang, s) {
    if (!s || lang === 'de') return s;
    const firstWord = s.split(/[\s.-]/)[0];
    if (/\p{Lu}/u.test(firstWord.slice(1))) return s;
    return s.charAt(0).toLocaleLowerCase(localeOf(lang)) + s.slice(1);
  }

  /** Label of a charge or adjustment line in the invoice language (the English label if the key is unknown). */
  function lineLabel(lang, l) {
    const key = l.kind === 'diff' ? (l.key ? 'doc.diff.' + l.key : '') : l.key ? 'doc.charge.' + l.key : '';
    const text = key ? I.tIn(lang, key) : '';
    return text && text !== key ? text : l.label;
  }

  function paymentText(lang, o) {
    if (/card/i.test(o.paymentMethod)) return I.tIn(lang, 'doc.card') + (o.card ? ' ' + o.card : '');
    return o.paymentMethod || I.tIn(lang, 'doc.onlinePayment');
  }

  /** VAT rate of an order: a whole percentage when it is one, otherwise with two decimals. */
  function orderVatPercent(o) {
    if (!o.includedTaxCents || o.totalCents <= o.includedTaxCents) return null;
    const rate = A.vatRate(o.totalCents, o.includedTaxCents);
    return rate !== null ? rate : Math.round((o.includedTaxCents / (o.totalCents - o.includedTaxCents)) * 10000) / 100;
  }

  /** Automatic numbers stay unique: a second invoice with the same date and amount gets "-2" and so on. */
  function uniqueNumbers() {
    const used = new Set();
    return (n) => {
      let out = n;
      for (let i = 2; used.has(out); i++) out = `${n}-${i}`;
      used.add(out);
      return out;
    };
  }

  /**
   * The documents shown on the invoice page, in the invoice language.
   * parts: from draftParts(). opts: {
   *   lang (invoice language), settings, profileId, title (title field of the toolbar), mode ('detail' | 'allocated'),
   *   euWarehouse, shipNote (the two checkboxes), docType ('invoice' | 'credit'), show ({ logo, images, stores, status, dates }),
   *   date (typed date of issue, '' = automatic), today ('YYYY-MM-DD'),
   *   edits (edited item names by "orderId:index"), numbers (typed numbers by "invoice:<k>" and "credit:<k>")
   * }
   * A credit note is made only for an invoice with refunded orders. Every line of a document belongs to an order;
   * the lines of an order add up to its total and the orders to the total of the document.
   */
  function buildDocuments(parts, opts) {
    const lang = opts.lang;
    const T = (key, params) => I.tIn(lang, key, params);
    const dateText = (iso) => I.dateIn(lang, iso, { dateStyle: 'medium' });
    const settings = opts.settings;
    const show = opts.show || {};
    const edits = opts.edits || {};
    const numbers = opts.numbers || {};
    const credit = opts.docType === 'credit';
    const type = credit ? 'credit' : 'invoice';
    const prefix = settings.numberPrefix || 'AE';
    const profile = settings.profiles.find((p) => p.id === opts.profileId) || settings.profiles[0];
    const supplier = supplierText(lang, settings).split('\n');
    const note = String(settings.invoiceNote || '').trim();
    // "Shipped from an EU warehouse": "EU Stock" in the variant line, the way AliExpress writes it ("2pcs, PL Stock")
    const euText = opts.euWarehouse ? settingText(lang, settings, 'euNote', 'doc.euNote') : '';
    // "Shipping without tracking": "(no tracking)" on the "Shipping and fees" line
    const shipText = opts.shipNote ? settingText(lang, settings, 'shipNote', 'doc.shipNote') : '';
    const labelFor = (l) => (shipText && l.key === 'totalReceivableTaxAmount' ? `${lineLabel(lang, l)} ${shipText}` : lineLabel(lang, l));
    const invoiceNo = uniqueNumbers();
    const creditNo = uniqueNumbers();
    const docs = [];

    parts.forEach((part, k) => {
      const inv = A.combine(part.orders, { bankCents: part.bankCents, mode: opts.mode });
      const cur = inv.currency;
      const money = (c) => I.moneyIn(lang, c, cur);
      // combined orders are paid on one day: issue date = payment date = order date; a credit note is issued today
      const docDate = inv.lastPaidDate || inv.firstPaidDate || opts.today;
      const autoInvoiceNo = invoiceNo(`${prefix}-${docDate.replace(/-/g, '')}-${inv.paidCents}`);
      const refunded = inv.orders.filter((o) => o.refund && o.refund.cents);
      if (credit && !refunded.length) return;
      const refundCents = refunded.reduce((sum, o) => sum + o.refund.cents, 0);
      const issueDate = opts.date || (credit ? opts.today : docDate);
      const autoNumber = credit ? creditNo(`${prefix}-CN-${issueDate.replace(/-/g, '')}-${refundCents}`) : autoInvoiceNo;

      // order heading: the stores, status and date when they are switched on
      const extraOf = (o) => {
        const extra = [];
        if (show.stores && o.sellers.length) extra.push(o.sellers.join(', '));
        const status = show.status ? part.listStatus[o.orderId] : '';
        if (status) extra.push(status);
        const day = o.paidDate || o.orderDate;
        if (show.dates && day) extra.push(dateText(day));
        else if (o.paidDate && o.paidDate !== docDate) extra.push(T('doc.paidOn', { date: dateText(o.paidDate) }));
        return extra;
      };
      // allocated mode: what was spread into the item prices
      const allocationOf = (o) => {
        const list = o.charges.map((c) => lc(lang, labelFor(c)) + ' ' + money(c.cents));
        if (o.itemsDiffCents) list.unshift(lc(lang, T('doc.diff.items')) + ' ' + money(o.itemsDiffCents));
        if (o.residualCents) list.push(lc(lang, T('doc.diff.other')) + ' ' + money(o.residualCents));
        return list.length ? T('doc.includedInPrices', { list: list.join(', ') }) : '';
      };
      const orderOf = (o, lines, allocation) => ({
        orderId: o.orderId,
        date: o.paidDate || o.orderDate || null,
        extra: extraOf(o),
        allocation,
        lines,
        totalCents: credit ? -o.refund.cents : o.totalCents,
        vatCents: o.includedTaxCents,
        vatPercent: orderVatPercent(o),
      });
      const itemLine = (o, l, idx) => {
        const key = o.orderId + ':' + idx;
        const eu = euText && !l.sku.toLowerCase().includes(euText.toLowerCase()) ? euText : '';
        return {
          kind: 'item',
          key,
          text: edits[key] !== undefined ? edits[key] : l.title,
          sku: [l.sku, eu].filter(Boolean).join(', '),
          qty: l.qty,
          // allocated mode: the unit price is often not a whole number of cents
          unitCents: opts.mode === 'allocated' ? l.lineCents / l.qty : l.unitCents,
          lineCents: l.lineCents,
          img: l.img || '',
        };
      };
      // a credit note has one line per refunded order
      const orders = credit
        ? refunded.map((o) => orderOf(o, [{ kind: 'refund', key: '', text: T('doc.refundFor', { id: o.orderId }), sku: '', qty: null, unitCents: null, lineCents: -o.refund.cents, img: '' }], ''))
        : inv.orders.map((o) => orderOf(o, o.lines.map((l, idx) => (l.kind === 'item'
          ? itemLine(o, l, idx)
          // receipt sub-lines (customs duty and benefit breakdowns) are not printed, only the main lines
          : { kind: l.kind, key: l.key || '', text: labelFor(l), sku: '', qty: null, unitCents: null, lineCents: l.lineCents, img: '' })),
        opts.mode === 'allocated' ? allocationOf(o) : ''));

      const vatKnown = !credit && inv.includedTaxCents !== null && inv.includedTaxComplete;
      docs.push({
        k,
        type,
        credit,
        title: titleFor(lang, opts.title, type),
        number: numbers[type + ':' + k] || autoNumber,
        autoNumber,
        // the invoice a credit note refers to
        invoiceNumber: numbers['invoice:' + k] || autoInvoiceNo,
        invoiceDate: docDate,
        issueDate,
        paymentDate: credit ? null : docDate,
        methods: [...new Set(inv.orders.map((o) => paymentText(lang, o)))],
        paidByCard: inv.orders.every((o) => /card/i.test(o.paymentMethod)),
        currency: cur,
        supplier,
        customer: profile,
        logo: show.logo && profile.logo ? profile.logo : '',
        images: !!show.images,
        orders,
        totalCents: credit ? -refundCents : inv.totalCents,
        vatCents: vatKnown ? inv.includedTaxCents : null,
        vatRate: vatKnown ? inv.vatRate : null,
        bonusCents: credit ? 0 : inv.bonusCents,
        paidCents: credit ? -refundCents : inv.paidCents,
        refundCents,
        bankCents: inv.bankCents,
        bankDiffCents: inv.bankDiffCents,
        note,
        // for the checks and warnings on the page
        inv,
        part,
      });
    });
    return docs;
  }

  /** Column names of the CSV export in the invoice language. */
  function csvLabels(lang) {
    const T = (key) => I.tIn(lang, key);
    return {
      document: T('doc.document'),
      no: T('doc.no'),
      issueDate: T('doc.issueDate'),
      paymentDate: T('doc.paymentDate'),
      customer: T('doc.customer'),
      orderNo: T('doc.orderNo'),
      description: T('doc.description'),
      variant: T('doc.variant'),
      qty: T('doc.qty'),
      unitPrice: T('doc.unitPrice'),
      amount: T('doc.amount'),
      currency: T('doc.currency'),
      totalExclVat: T('doc.totalExclVat'),
      vatPercent: T('doc.vatPercent'),
      vat: T('doc.vat'),
      total: T('doc.total'),
      paidCredit: T('doc.paidCredit'),
      paidCard: T('doc.paidCard'),
    };
  }

  return { draftParts, buildDocuments, titleFor, isDefaultTitle, settingText, supplierText, decimalSeparator, localeOf, csvLabels };
});
