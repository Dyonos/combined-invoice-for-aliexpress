/*
 * Combined Invoice for AliExpress - shared logic: amounts in cents, AliExpress receipts, allocation, search by amount.
 * Runs in the extension (content script, invoice page) and in the Node tests.
 *
 * The data comes from the official order receipt (the "Receipt" button in the order details), API
 * mtop.global.finance.taxation.invoice.queryOrderReceiptInfo. The order and nesting of the lines
 * follow how the AliExpress receipt itself renders them (tax-ui).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AliFa = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- money

  const CURRENCY_SYMBOLS = [
    ['US $', 'USD'], ['US$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['zł', 'PLN'],
    ['Kč', 'CZK'], ['Ft', 'HUF'], ['CHF', 'CHF'], ['lei', 'RON'], ['Lei', 'RON'], ['$', 'USD'],
  ];
  const CURRENCY_CODES = /\b(EUR|USD|GBP|PLN|CZK|HUF|CHF|RON|BGN|SEK|DKK|NOK)\b/;

  /** "€ 33,30" | "-€ 1,99" | "EUR 34.53" | "1 234,56 €" | 12.3 -> { cents, currency } or null */
  function parseMoney(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') {
      return Number.isFinite(input) ? { cents: Math.round(input * 100), currency: null } : null;
    }
    const s = String(input)
      .replace(/[\u2212\u2012\u2013\u2014]/g, '-')
      .replace(/[\u00a0\u202f\u2009]/g, ' ')
      .trim();
    const m = s.match(/\d[\d.,' ]*\d|\d/);
    if (!m) return null;
    const negative = s.slice(0, m.index).includes('-');
    const num = m[0].replace(/[ ']/g, '');
    const lastSep = Math.max(num.lastIndexOf('.'), num.lastIndexOf(','));
    let intPart = num;
    let frac = '';
    if (lastSep !== -1) {
      const after = num.slice(lastSep + 1);
      // 1-2 digits after the last separator = decimals, 3 digits = thousands separator
      if (after.length >= 1 && after.length <= 2) {
        intPart = num.slice(0, lastSep);
        frac = after;
      }
    }
    intPart = intPart.replace(/[.,]/g, '');
    if (!/^\d+$/.test(intPart)) return null;
    const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
    let currency = null;
    const code = s.match(CURRENCY_CODES);
    if (code) currency = code[1];
    else {
      for (const [sym, cur] of CURRENCY_SYMBOLS) {
        if (s.includes(sym)) { currency = cur; break; }
      }
    }
    return { cents: negative ? -cents : cents, currency };
  }

  function joinAmount(neg, int, frac, currency, locale) {
    const sym = !currency || currency === 'EUR' ? '€' : currency;
    if (locale === 'en') {
      // English format for the invoice: "€1,234.56", "-€1.55", "1,234.56 USD"
      const num = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + frac;
      return (neg ? '-' : '') + (sym === '€' ? '€' + num : num + ' ' + sym);
    }
    // Slovak format: "1 234,56 €" with non-breaking spaces
    return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ',' + frac + '\u00a0' + sym;
  }

  /** 123456 -> "1 234,56 €" (Slovak by default) or "€1,234.56" (locale "en") */
  function formatMoney(cents, currency, locale) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return '';
    const abs = Math.abs(Math.round(cents));
    return joinAmount(cents < 0, String(Math.floor(abs / 100)), String(abs % 100).padStart(2, '0'), currency, locale);
  }

  /** Unit price after allocation: shows 4 decimal places when it is not a whole number of cents. */
  function formatUnit(lineCents, qty, currency, locale) {
    if (!qty || lineCents % qty === 0) return formatMoney(qty ? lineCents / qty : lineCents, currency, locale);
    const value = lineCents / qty / 100;
    const [int, frac] = Math.abs(value).toFixed(4).split('.');
    return joinAmount(value < 0, int, frac, currency, locale);
  }

  // ---------------------------------------------------------------- dates

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function iso(y, m, d) {
    if (!y || !m || !d || m > 12 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** "Sep 27, 2026" | "27 Sep 2026" | "2026-09-27" | "27. 9. 2026" -> "2026-09-27" */
  function parseDate(input) {
    if (!input) return null;
    const t = String(input).trim();
    let m = t.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
    m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = t.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (m) return iso(+m[3], +m[2], +m[1]);
    return null;
  }

  /** "2026-08-16", -2 -> "2026-08-14" (calendar days, no time zones) */
  function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  /** "2026-09-27" -> "27. 9. 2026" */
  function formatDate(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    return `${d}. ${m}. ${y}`;
  }

  // ---------------------------------------------------------------- bank statement lines

  /** Payment date in a bank statement line: 18.08.2026, 18. 8. 2026, 2026-08-18, 2026/08/18, 2026. 8. 18., 18-08-2026, 18/08/2026, Aug 18, 2026. */
  function statementDate(line) {
    let m = line.match(/(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})\.?/);
    if (m) return { text: m[0], date: iso(+m[1], +m[2], +m[3]) };
    m = line.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (m) return { text: m[0], date: iso(+m[3], +m[2], +m[1]) };
    m = line.match(/(\d{1,2})-(\d{1,2})-(\d{4})/); // Dutch bank statements
    if (m) return { text: m[0], date: iso(+m[3], +m[2], +m[1]) };
    m = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      // day first (European), unless only the other order gives a valid date
      const a = +m[1];
      const b = +m[2];
      return { text: m[0], date: a > 12 || b <= 12 ? iso(+m[3], b, a) : iso(+m[3], a, b) };
    }
    const named = parseDate(line);
    return named ? { text: '', date: named } : null;
  }

  /**
   * Payments pasted from a bank statement, one per line: an amount and an optional date in any order
   * ("37,70 18.08.2026", "2026-08-18;-37.70 EUR"). Returns [{ line, cents, currency, date }];
   * cents is null for a line without an amount, debits (negative amounts) count as positive.
   */
  function parsePayments(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const d = statementDate(line);
      const rest = d && d.text ? line.replace(d.text, ' ') : line;
      const amounts = rest.match(/-?\d{1,3}(?:[ .'\u00a0]\d{3})+[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g) || [];
      const money = parseMoney(amounts.length ? amounts[amounts.length - 1] : rest);
      const whole = parseMoney(rest);
      out.push({
        line,
        cents: money && money.cents ? Math.abs(money.cents) : null,
        currency: whole ? whole.currency : null,
        date: d ? d.date : null,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- receipt

  // sign -1: AliExpress sends a positive number that is subtracted from the total (discounts).
  // sign  0: taken with the sign it came with.
  // Labels are in English, they are printed on the invoice.
  const CHARGE_FIELDS = [
    { key: 'shippingFee', label: 'Shipping', sign: 0 },
    { key: 'totalDiscountAmount', label: 'Discount', sign: -1 },
    { key: 'adjustPriceAmount', label: 'Price adjustment', sign: 0 },
    { key: 'totalApplicableFeeAmount', label: 'Applicable fee', sign: 0 },
    { key: 'totalTaxAmount', label: 'Tax', sign: 0 },
    {
      key: 'totalReceivableTaxAmount', label: 'Shipping and fees', sign: 0,
      children: [
        { key: 'totalHandlingFeeAmount', label: 'handling fee' },
        { key: 'totalDutyAmount', label: 'customs duty' },
      ],
    },
    {
      key: 'totalSubsidyTaxAmount', label: 'AliExpress fee reduction', sign: -1,
      children: [
        { key: 'platformTaxCouponSubsidyAmount', label: 'import charge coupon' },
        { key: 'taxationSubsidyAmount', label: 'buy 3+, import charges on us' },
        { key: 'mergeTaxDiscountAmount', label: 'import charge benefits' },
      ],
    },
    { key: 'totalRefundTaxAmount', label: 'VAT adjustment', sign: 0 },
  ];

  function maskCard(cardNo) {
    if (!cardNo) return '';
    const digits = String(cardNo).replace(/\D/g, '');
    return digits ? '****' + digits.slice(-4) : String(cardNo);
  }

  /**
   * Raw receipt from the API -> order with amounts in cents.
   * Invariant: itemsTotalCents + sum of charges + residualCents === totalCents.
   */
  function normalizeReceipt(raw, fallbackOrderId) {
    const r = raw || {};
    const warnings = [];
    const notes = [];

    const total = parseMoney(r.orderTotal);
    const itemsTotal = parseMoney(r.itemsTotal);
    const currency = (total && total.currency) || (itemsTotal && itemsTotal.currency) ||
      ((parseMoney(r.paymentInfo && r.paymentInfo.paymentAmountStr) || {}).currency) || 'EUR';

    const items = (Array.isArray(r.subOrders) ? r.subOrders : []).map((s) => {
      const unit = parseMoney(s.amount);
      const qty = Math.max(1, parseInt(s.itemCount, 10) || 1);
      const unitCents = unit ? unit.cents : 0;
      return {
        title: String(s.itemTitle || '').trim(),
        sku: String(s.relateInfo || '').trim(),
        seller: String(s.sellerName || '').trim(),
        unitCents,
        qty,
        lineCents: unitCents * qty,
        img: s.imgUrl || '',
      };
    });
    const itemLinesCents = items.reduce((a, i) => a + i.lineCents, 0);
    const itemsTotalCents = itemsTotal ? itemsTotal.cents : itemLinesCents;
    if (!itemsTotal) warnings.push({ code: 'noSubtotal' });

    const charges = [];
    for (const f of CHARGE_FIELDS) {
      const v = parseMoney(r[f.key]);
      if (!v || v.cents === 0) continue;
      const cents = f.sign === -1 ? -Math.abs(v.cents) : v.cents;
      const children = (f.children || [])
        .map((c) => ({ key: c.key, label: c.label, money: parseMoney(r[c.key]) }))
        .filter((c) => c.money && c.money.cents !== 0)
        .map((c) => ({ key: c.key, label: c.label, cents: c.money.cents }));
      charges.push({ key: f.key, label: f.label, cents, flexible: f.sign === 0, children });
    }

    let totalCents = total ? total.cents : null;
    if (totalCents === null) {
      warnings.push({ code: 'noTotal' });
      totalCents = itemsTotalCents + charges.reduce((a, c) => a + c.cents, 0);
    }

    const sumOf = () => itemsTotalCents + charges.reduce((a, c) => a + c.cents, 0);

    // AliExpress sometimes shows symbolic shipping on the receipt (typically €0.01) that it leaves out of
    // the order total. Only for tiny amounts, larger shipping is never dropped this way.
    const shipping = charges.find((c) => c.key === 'shippingFee');
    if (shipping && Math.abs(shipping.cents) <= 10 && sumOf() !== totalCents && sumOf() - shipping.cents === totalCents) {
      charges.splice(charges.indexOf(shipping), 1);
      notes.push({ code: 'pennyShipping', cents: shipping.cents, currency });
    }

    // If the sum does not match, try flipping the sign of lines where AliExpress does not make it clear.
    if (sumOf() !== totalCents) {
      const flexible = charges.filter((c) => c.flexible);
      const combos = 1 << flexible.length;
      for (let mask = 1; mask < combos; mask++) {
        const delta = flexible.reduce((a, c, i) => a + (mask & (1 << i) ? -2 * c.cents : 0), 0);
        if (sumOf() + delta === totalCents) {
          flexible.forEach((c, i) => {
            if (mask & (1 << i)) {
              c.cents = -c.cents;
              notes.push({ code: 'signFlip', label: c.label });
            }
          });
          break;
        }
      }
    }
    const residualCents = totalCents - sumOf();
    if (residualCents !== 0) {
      warnings.push({ code: 'residual', cents: residualCents, currency });
    }
    const itemsDiffCents = itemsTotalCents - itemLinesCents;

    const p = r.paymentInfo || {};
    const paid = p.paymentAmount !== undefined && p.paymentAmount !== null && p.paymentAmount !== ''
      ? parseMoney(String(p.paymentAmount))
      : parseMoney(p.paymentAmountStr);
    const bonus = Number(p.bonusAmount) > 0 ? parseMoney(p.bonusAmountStr || String(p.bonusAmount)) : null;
    const bonusCents = bonus ? Math.abs(bonus.cents) : 0;
    const paidCents = paid ? paid.cents : totalCents - bonusCents;

    // includedTaxDisplay = VAT amount included in the price; includeTax = only a "true" flag (EU warehouse, VAT included without an amount)
    const includedTax = parseMoney(r.includedTaxDisplay);
    const vatIncluded = !!includedTax || String(r.includeTax).toLowerCase() === 'true';
    let refund = null;
    if (r.refundInfo && (r.refundInfo.refundAmount || r.refundInfo.refundCount)) {
      const ra = parseMoney(r.refundInfo.refundAmount);
      refund = { count: Number(r.refundInfo.refundCount) || 1, cents: ra ? Math.abs(ra.cents) : null };
      warnings.push(refund.cents !== null ? { code: 'refund', cents: refund.cents, currency } : { code: 'refundUnknown' });
    }

    return {
      orderId: String(r.orderId || fallbackOrderId || ''),
      orderTime: r.orderTime || '',
      orderDate: parseDate(r.orderTime),
      paidOn: p.paymentDate || '',
      paidDate: parseDate(p.paymentDate),
      paymentMethod: p.methodName || '',
      card: maskCard(p.cardNo),
      currency,
      items,
      itemsTotalCents,
      itemsDiffCents,
      charges,
      totalCents,
      residualCents,
      includedTaxCents: includedTax ? includedTax.cents : null,
      vatIncluded,
      bonusCents,
      paidCents,
      refund,
      sellers: [...new Set(items.map((i) => i.seller).filter(Boolean))],
      notes,
      warnings,
    };
  }

  // ---------------------------------------------------------------- invoice lines

  /** Splits amount (cents) by weights so that the sum matches to the cent (largest remainder method). */
  function allocate(amount, weights) {
    const n = weights.length;
    if (!n) return [];
    let w = weights.map((x) => Math.max(0, x));
    let W = w.reduce((a, x) => a + x, 0);
    if (W === 0) { w = weights.map(() => 1); W = n; }
    const parts = w.map((x, i) => {
      const num = amount * x;
      const base = Math.floor(num / W);
      return { i, base, rest: num - base * W };
    });
    let remaining = amount - parts.reduce((a, p) => a + p.base, 0);
    const order = parts.slice().sort((a, b) => b.rest - a.rest || a.i - b.i);
    for (let k = 0; remaining > 0; k = (k + 1) % n, remaining--) order[k].base += 1;
    return parts.map((p) => p.base);
  }

  /**
   * Lines of one order on the invoice.
   * mode "detail": items at AliExpress prices + shipping, discounts and fees as separate lines.
   * mode "allocated": shipping, discounts and fees spread into the item prices.
   * The lines always add up to exactly totalCents.
   */
  function orderLines(order, mode) {
    const lines = [];
    if (mode === 'allocated' && order.items.length) {
      const extra = order.totalCents - order.items.reduce((a, i) => a + i.lineCents, 0);
      const shares = allocate(extra, order.items.map((i) => i.lineCents));
      order.items.forEach((it, k) => {
        lines.push({ kind: 'item', title: it.title, sku: it.sku, qty: it.qty, origUnitCents: it.unitCents, lineCents: it.lineCents + shares[k] });
      });
    } else {
      for (const it of order.items) {
        lines.push({ kind: 'item', title: it.title, sku: it.sku, qty: it.qty, unitCents: it.unitCents, lineCents: it.lineCents });
      }
      if (order.itemsDiffCents) {
        lines.push({ kind: 'diff', key: 'items', label: 'Item price adjustment', lineCents: order.itemsDiffCents });
      }
      for (const c of order.charges) {
        lines.push({ kind: 'charge', key: c.key, label: c.label, lineCents: c.cents, children: c.children });
      }
      if (order.residualCents) {
        lines.push({ kind: 'diff', key: 'other', label: 'Other adjustment', lineCents: order.residualCents });
      }
    }
    const sum = lines.reduce((a, l) => a + l.lineCents, 0);
    if (sum !== order.totalCents) {
      // should not happen; a visible line is better than a silent mismatch
      lines.push({ kind: 'diff', key: 'rounding', label: 'Rounding', lineCents: order.totalCents - sum });
    }
    return lines;
  }

  function vatRate(totalCents, taxCents) {
    if (!taxCents || totalCents <= taxCents) return null;
    const rate = (taxCents / (totalCents - taxCents)) * 100;
    const rounded = Math.round(rate);
    return Math.abs(rate - rounded) <= 0.6 ? rounded : null;
  }

  /** Combines orders into one invoice and compares it with the bank payment. */
  function combine(orders, opts) {
    const o = opts || {};
    const sorted = orders.slice().sort((a, b) =>
      String(a.paidDate || a.orderDate || '').localeCompare(String(b.paidDate || b.orderDate || '')) ||
      a.orderId.localeCompare(b.orderId));
    const currencies = [...new Set(sorted.map((x) => x.currency))];
    const totalCents = sorted.reduce((a, x) => a + x.totalCents, 0);
    const taxKnown = sorted.filter((x) => x.includedTaxCents !== null);
    const includedTaxCents = taxKnown.length ? taxKnown.reduce((a, x) => a + x.includedTaxCents, 0) : null;
    const rates = [...new Set(taxKnown.map((x) => vatRate(x.totalCents, x.includedTaxCents)))];
    const bonusCents = sorted.reduce((a, x) => a + x.bonusCents, 0);
    const paidCents = sorted.reduce((a, x) => a + x.paidCents, 0);
    const bankCents = Number.isInteger(o.bankCents) ? o.bankCents : null;
    const paidDates = sorted.map((x) => x.paidDate || x.orderDate).filter(Boolean).sort();
    const warnings = [];
    if (currencies.length > 1) warnings.push({ code: 'mixedCurrency', list: currencies.join(', ') });
    if (paidDates.length && paidDates[0] !== paidDates[paidDates.length - 1]) {
      warnings.push({ code: 'multipleDays', from: paidDates[0], to: paidDates[paidDates.length - 1] });
    }
    return {
      orders: sorted.map((x) => ({ ...x, lines: orderLines(x, o.mode) })),
      currency: currencies[0] || 'EUR',
      totalCents,
      includedTaxCents,
      includedTaxComplete: taxKnown.length === sorted.length,
      vatIncludedAll: sorted.length > 0 && sorted.every((x) => x.vatIncluded),
      vatRate: rates.length === 1 ? rates[0] : null,
      bonusCents,
      paidCents,
      bankCents,
      bankDiffCents: bankCents === null ? null : bankCents - paidCents,
      firstPaidDate: paidDates[0] || null,
      lastPaidDate: paidDates[paidDates.length - 1] || null,
      warnings,
    };
  }

  // ---------------------------------------------------------------- search by bank amount

  /** Combinations of {id, cents} whose sum is exactly target. Returns at most `limit` solutions. */
  function subsetSums(entries, target, limit, maxSteps) {
    const lim = limit || 2;
    const cap = maxSteps || 300000;
    const arr = entries.filter((e) => e.cents > 0).slice().sort((a, b) => b.cents - a.cents);
    const suffix = new Array(arr.length + 1).fill(0);
    for (let i = arr.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + arr[i].cents;
    const out = [];
    const pick = [];
    let steps = 0;
    (function dfs(i, rest) {
      if (out.length >= lim || ++steps > cap) return;
      if (rest === 0) { out.push(pick.map((e) => e.id)); return; }
      if (i >= arr.length || suffix[i] < rest) return;
      if (arr[i].cents <= rest) {
        pick.push(arr[i]);
        dfs(i + 1, rest - arr[i].cents);
        pick.pop();
      }
      dfs(i + 1, rest);
    })(0, target);
    return { solutions: out, truncated: steps > cap };
  }

  /**
   * Finds orders that add up to the bank amount. Prefers orders from one day
   * (one checkout = one payment, several orders with the same date).
   * list: [{ id, cents, date }] in page order (newest first).
   * opts.sameDayOnly: only within one day; with many orders a combination
   * across days would often match only by chance.
   */
  function findOrdersForAmount(list, targetCents, opts) {
    if (!Number.isInteger(targetCents) || targetCents <= 0) return null;
    const sameDayOnly = !!(opts && opts.sameDayOnly);
    const groups = new Map();
    for (const o of list) {
      const k = o.date || '?';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    const hits = [];
    for (const [date, entries] of groups) {
      const res = subsetSums(entries, targetCents, 2);
      if (res.solutions.length) hits.push({ date, solutions: res.solutions });
    }
    if (hits.length) {
      return {
        ids: hits[0].solutions[0],
        date: hits[0].date === '?' ? null : hits[0].date,
        sameDay: true,
        ambiguous: hits.length > 1 || hits[0].solutions.length > 1,
      };
    }
    if (sameDayOnly) return null;
    const res = subsetSums(list, targetCents, 2);
    if (res.solutions.length) {
      return { ids: res.solutions[0], date: null, sameDay: false, ambiguous: res.solutions.length > 1 };
    }
    return null;
  }

  return {
    parseMoney,
    formatMoney,
    formatUnit,
    parseDate,
    formatDate,
    addDays,
    normalizeReceipt,
    allocate,
    orderLines,
    combine,
    vatRate,
    subsetSums,
    findOrdersForAmount,
    parsePayments,
    CHARGE_FIELDS,
  };
});
