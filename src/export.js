/*
 * Combined Invoice for AliExpress - export of the shown documents for accounting: a CSV table (lines and totals) and
 * ISDOC 6.0.2 electronic invoices (the Czech and Slovak standard, namespace http://isdoc.cz/namespace/2013),
 * several ISDOC files in one ZIP. Pure functions on the documents from documents.js; runs in the extension and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AliFaExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- CSV

  /** Amount in cents as a CSV number ("8.16" or "8,16"); a unit price that is not a whole cent gets 4 decimals. */
  function csvNumber(cents, decimal) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return '';
    const text = (cents / 100).toFixed(Number.isInteger(cents) ? 2 : 4);
    return decimal === ',' ? text.replace('.', ',') : text;
  }

  /** One CSV field; a text that starts like a formula (=, +, -, @) gets an apostrophe so spreadsheets do not run it. */
  function csvField(value, sep, isText) {
    let s = value === null || value === undefined ? '' : String(value);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** AliExpress order numbers have 16 digits: spreadsheets would round them as numbers, so they are kept as text. */
  function orderNumberField(id) {
    return /^\d{12,}$/.test(id) ? `="${id}"` : id;
  }

  /**
   * CSV of the documents: one row per line (items, and shipping, discounts and fees when they are separate lines),
   * the totals of a document on its first row. labels: column names (documents.js csvLabels).
   * decimal: ',' or '.'; with a decimal comma the fields are separated by ";", as spreadsheets in those languages expect.
   * Starts with a byte order mark, so spreadsheets read the text as UTF-8.
   */
  function toCsv(docs, labels, decimal) {
    const sep = decimal === ',' ? ';' : ',';
    const num = (cents) => csvNumber(cents, decimal);
    const bonus = docs.some((d) => d.bonusCents);
    const columns = ['document', 'no', 'issueDate', 'paymentDate', 'customer', 'orderNo', 'description', 'variant', 'qty',
      'unitPrice', 'amount', 'currency', 'totalExclVat', 'vatPercent', 'vat', 'total'].concat(bonus ? ['paidCredit', 'paidCard'] : []);
    const lines = [columns.map((c) => csvField(labels[c] || c, sep, true)).join(sep)];
    for (const d of docs) {
      let first = true;
      for (const o of d.orders) {
        for (const l of o.lines) {
          const totals = first ? {
            totalExclVat: d.vatCents !== null ? num(d.totalCents - d.vatCents) : '',
            vatPercent: d.vatCents !== null && d.vatRate !== null ? String(d.vatRate).replace('.', decimal) : '',
            vat: d.vatCents !== null ? num(d.vatCents) : '',
            total: num(d.totalCents),
            paidCredit: d.bonusCents ? num(-d.bonusCents) : '',
            paidCard: d.bonusCents ? num(d.paidCents) : '',
          } : {};
          first = false;
          const row = {
            document: csvField(d.title, sep, true),
            no: csvField(d.number, sep, true),
            issueDate: d.issueDate || '',
            paymentDate: d.paymentDate || '',
            customer: csvField(d.customer && d.customer.name, sep, true),
            orderNo: csvField(orderNumberField(o.orderId), sep, false),
            description: csvField(l.text, sep, true),
            variant: csvField(l.sku, sep, true),
            qty: l.kind === 'item' ? String(l.qty) : '',
            unitPrice: l.kind === 'item' ? num(l.unitCents) : '',
            amount: num(l.lineCents),
            currency: d.currency,
          };
          lines.push(columns.map((c) => (c in row ? row[c] : csvField(totals[c], sep, false))).join(sep));
        }
      }
    }
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- SHA-1 and name-based UUID

  function utf8(s) {
    return new TextEncoder().encode(String(s));
  }

  /** SHA-1 of bytes (only for the stable document UUID). */
  function sha1(bytes) {
    const len = bytes.length;
    const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
    view.setUint32(padded.length - 4, (len * 8) >>> 0);
    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const w = new Uint32Array(80);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 80; i++) {
        const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = (x << 1) | (x >>> 31);
      }
      let [a, b, c, d, e] = h;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d;
        d = c;
        c = ((b << 30) | (b >>> 2)) >>> 0;
        b = a;
        a = t;
      }
      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0;
    }
    const out = new Uint8Array(20);
    const ov = new DataView(out.buffer);
    h.forEach((x, i) => ov.setUint32(i * 4, x));
    return out;
  }

  /** Name-based UUID (version 5, RFC 9562) in capitals: the same name always gives the same UUID. */
  function uuid5(name, namespace) {
    const ns = namespace.replace(/-/g, '').match(/../g).map((x) => parseInt(x, 16));
    const data = utf8(name);
    const bytes = new Uint8Array(16 + data.length);
    bytes.set(ns);
    bytes.set(data, 16);
    const hash = sha1(bytes).slice(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = [...hash].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // namespace of the document UUIDs of this extension
  const UUID_NAMESPACE = 'B3BF2803-7DCC-41F1-BAA8-7A0B6B6F70CC';

  // ---------------------------------------------------------------- countries and addresses

  let countryNames = null;

  const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.,()'"\u2019]/g, ' ').replace(/\s+/g, ' ').trim();

  // names the browser does not know, mostly the official long names
  const COUNTRY_ALIASES = {
    'slovak republic': 'SK', 'slovenska republika': 'SK', 'czech republic': 'CZ', 'ceska republika': 'CZ',
    'uk': 'GB', 'great britain': 'GB', 'britain': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
    'northern ireland': 'GB', 'usa': 'US', 'united states of america': 'US', 'holland': 'NL', 'the netherlands': 'NL',
  };

  /** Country names in the languages of the extension -> ISO 3166 code, built from the browser's own list once. */
  function countryMap(locales) {
    if (countryNames) return countryNames;
    const map = new Map(Object.entries(COUNTRY_ALIASES));
    // current country codes only: old ones like DD (East Germany) have the name of today's country
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const codes = letters.flatMap((a) => letters.map((b) => a + b)).filter((code) => {
      if (['EU', 'EZ', 'UN', 'QO', 'ZZ'].includes(code)) return false;
      try {
        return Intl.getCanonicalLocales('und-' + code)[0] === 'und-' + code;
      } catch (e) {
        return false;
      }
    });
    for (const locale of locales) {
      let names;
      try {
        names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
      } catch (e) {
        continue;
      }
      for (const code of codes) {
        const name = names.of(code);
        if (name && name !== code && !map.has(plain(name))) map.set(plain(name), code);
      }
    }
    countryNames = map;
    return map;
  }

  const LOCALES = ['en', 'sk', 'cs', 'hu', 'pl', 'de', 'es', 'fr', 'pt', 'ru', 'ro', 'it', 'nl', 'tr', 'uk', 'ja', 'ko'];

  /** ISO 3166 code of a country written by the user ("Slovakia", "Slovensko", "SK"), or of the VAT ID prefix, or ''. */
  function countryCode(name, vatId) {
    const text = String(name || '').trim();
    // a code: today's form of it (UK -> GB)
    if (/^[A-Z]{2}$/.test(text)) return Intl.getCanonicalLocales('und-' + text)[0].slice(4);
    const code = text ? countryMap(LOCALES).get(plain(text)) : undefined;
    if (code) return code;
    const prefix = (String(vatId || '').replace(/\s/g, '').match(/^([A-Z]{2})[0-9A-Z]{2,}/) || [])[1];
    if (prefix) return prefix === 'EL' ? 'GR' : prefix === 'XI' ? 'GB' : prefix;
    return '';
  }

  /** "811 01 Bratislava" | "00-950 Warszawa" | "Singapore 189554" | "Leeds LS1 6DT" -> { zone, city } */
  function splitCity(line) {
    const s = String(line || '').trim();
    let m = s.match(/^(\d{3} \d{2}|\d{2}-\d{3}|\d{4,6})\s+(\D.*)$/);
    if (m) return { zone: m[1], city: m[2] };
    m = s.match(/^(\D.*?),?\s+(\d{3} \d{2}|\d{4,6}|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i);
    if (m) return { zone: m[2], city: m[1] };
    return { zone: '', city: s };
  }

  /** Supplier from the text in the invoice header: name, address, registration number (a line "label: value"). */
  function parseSupplier(lines) {
    const [name = '', ...rest] = lines.map((l) => String(l).trim()).filter(Boolean);
    let id = '';
    const address = [];
    for (const line of rest) {
      const m = line.match(/^[^:]+:\s*(\S.*)$/);
      if (m && !id && /\d/.test(m[1])) id = m[1];
      else if (!/^(https?:\/\/|www\.)/i.test(line) && !line.includes('@')) address.push(line);
    }
    const street = address[0] || '';
    const { zone, city } = splitCity(address[1] || '');
    let country = '';
    let countryText = '';
    for (const candidate of [address[2], address[1], city]) {
      const c = countryCode(candidate);
      if (candidate && c) {
        country = c;
        countryText = candidate === city || candidate === address[1] ? '' : candidate;
        break;
      }
    }
    return { name, id, street, zone, city, country, countryText };
  }

  // ---------------------------------------------------------------- ISDOC

  const ISDOC_NS = 'http://isdoc.cz/namespace/2013';
  const ISDOC_VERSION = '6.0.2';

  function xml(s) {
    return String(s === null || s === undefined ? '' : s)
      // characters XML 1.0 does not allow (broken surrogate pairs become U+FFFD when the text is encoded as UTF-8)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** One element per line with indentation; elements without content are written as <Name/>. */
  function indent(text) {
    let depth = 0;
    return text.replace(/<([A-Za-z][\w.-]*)([^<>]*)><\/\1>/g, '<$1$2/>')
      .split(/(?<=>)(?=<)/)
      .map((tag) => {
        if (tag.startsWith('</')) depth--;
        const line = '  '.repeat(Math.max(depth, 0)) + tag;
        if (/^<[A-Za-z]/.test(tag) && !tag.endsWith('/>') && !tag.includes('</')) depth++;
        return line;
      })
      .join('\n') + '\n';
  }

  /** Amount in cents as an XML decimal: "8.16", "-1.55"; a unit price that is not a whole cent gets 4 decimals. */
  function dec(cents) {
    return (cents / 100).toFixed(Number.isInteger(cents) ? 2 : 4);
  }

  /** Splits amount (cents) by signed weights; the rounding difference goes to the largest weight. */
  function splitSigned(amount, weights) {
    if (!weights.length) return [];
    const total = weights.reduce((a, w) => a + w, 0);
    let big = 0;
    weights.forEach((w, i) => { if (Math.abs(w) > Math.abs(weights[big])) big = i; });
    const parts = weights.map((w) => (total ? Math.round((amount * w) / total) : 0));
    parts[big] += amount - parts.reduce((a, p) => a + p, 0);
    return parts;
  }

  /** Name and country of a postal address in ISDOC. */
  function addressXml(a, countryName) {
    return '<PostalAddress>' +
      `<StreetName>${xml(a.street)}</StreetName><BuildingNumber></BuildingNumber>` +
      `<CityName>${xml(a.city)}</CityName><PostalZone>${xml(a.zone)}</PostalZone>` +
      `<Country><IdentificationCode>${xml(a.country)}</IdentificationCode><Name>${xml(countryName)}</Name></Country>` +
      '</PostalAddress>';
  }

  function regionName(code, locale) {
    if (!code) return '';
    try {
      return new Intl.DisplayNames([locale || 'en'], { type: 'region' }).of(code) || code;
    } catch (e) {
      return code;
    }
  }

  /**
   * One document as an ISDOC 6.0.2 invoice (DocumentType 1) or credit note (2).
   * opts: { system (name and version of the issuing system), locale (for country names) }.
   * Lines are the printed lines. With a known VAT amount the VAT of each order is spread over its lines by amount,
   * so the lines add up to the VAT of the receipt; without one the document is not a VAT document (VATApplicable false).
   * A credit note has positive amounts and refers to its invoice (the ISDOC rules for credit notes).
   */
  function toIsdoc(d, opts) {
    const o = opts || {};
    const credit = d.credit;
    const sign = credit ? -1 : 1;
    const vat = !credit && d.vatCents !== null && d.vatCents !== 0;
    const customer = d.customer || {};
    const supplier = parseSupplier(d.supplier || []);
    const buyer = Object.assign({ street: customer.street || '' }, splitCity(customer.city),
      { country: countryCode(customer.country, customer.icdph || customer.dic) });

    const lines = [];
    d.orders.forEach((order, i) => {
      const ref = 'O' + (i + 1);
      const gross = order.lines.map((l) => sign * l.lineCents);
      const taxes = vat && order.vatCents ? splitSigned(order.vatCents, gross) : gross.map(() => 0);
      order.lines.forEach((l, j) => lines.push({ ref, l, gross: gross[j], tax: taxes[j], percent: vat ? order.vatPercent || 0 : 0 }));
    });

    const groups = new Map();
    for (const x of lines) {
      const g = groups.get(x.percent) || { net: 0, tax: 0, gross: 0 };
      g.net += x.gross - x.tax;
      g.tax += x.tax;
      g.gross += x.gross;
      groups.set(x.percent, g);
    }
    const total = lines.reduce((a, x) => a + x.gross, 0);
    const taxTotal = lines.reduce((a, x) => a + x.tax, 0);
    const vatFlag = vat ? 'true' : 'false';

    const lineXml = lines.map((x, i) => {
      const qty = x.l.kind === 'item' ? x.l.qty : 1;
      const unit = x.l.kind === 'item' ? '<InvoicedQuantity unitCode="ks">' + qty + '</InvoicedQuantity>' : '<InvoicedQuantity>1</InvoicedQuantity>';
      const text = x.l.sku ? `${x.l.text} (${x.l.sku})` : x.l.text;
      return '<InvoiceLine>' +
        `<ID>${i + 1}</ID>` +
        `<OrderReference ref="${x.ref}"></OrderReference>` +
        unit +
        `<LineExtensionAmount>${dec(x.gross - x.tax)}</LineExtensionAmount>` +
        `<LineExtensionAmountTaxInclusive>${dec(x.gross)}</LineExtensionAmountTaxInclusive>` +
        `<LineExtensionTaxAmount>${dec(x.tax)}</LineExtensionTaxAmount>` +
        `<UnitPrice>${dec((x.gross - x.tax) / qty)}</UnitPrice>` +
        `<UnitPriceTaxInclusive>${dec(x.gross / qty)}</UnitPriceTaxInclusive>` +
        `<ClassifiedTaxCategory><Percent>${x.percent}</Percent><VATCalculationMethod>1</VATCalculationMethod>` +
        `<VATApplicable>${vatFlag}</VATApplicable></ClassifiedTaxCategory>` +
        `<Item><Description>${xml(text)}</Description></Item>` +
        '</InvoiceLine>';
    }).join('');

    const subTotals = [...groups].map(([percent, g]) => '<TaxSubTotal>' +
      `<TaxableAmount>${dec(g.net)}</TaxableAmount><TaxAmount>${dec(g.tax)}</TaxAmount><TaxInclusiveAmount>${dec(g.gross)}</TaxInclusiveAmount>` +
      '<AlreadyClaimedTaxableAmount>0.00</AlreadyClaimedTaxableAmount><AlreadyClaimedTaxAmount>0.00</AlreadyClaimedTaxAmount>' +
      '<AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>' +
      `<DifferenceTaxableAmount>${dec(g.net)}</DifferenceTaxableAmount><DifferenceTaxAmount>${dec(g.tax)}</DifferenceTaxAmount>` +
      `<DifferenceTaxInclusiveAmount>${dec(g.gross)}</DifferenceTaxInclusiveAmount>` +
      `<TaxCategory><Percent>${percent}</Percent><VATApplicable>${vatFlag}</VATApplicable></TaxCategory>` +
      '</TaxSubTotal>').join('');

    // card payments: the amount paid by card, and AliExpress credit as a settlement between the parties
    let payment = '';
    if (!credit && d.paidByCard && d.paidCents > 0) {
      const details = `<Details><DocumentID>${xml(d.number)}</DocumentID><IssueDate>${d.paymentDate}</IssueDate></Details>`;
      payment = '<PaymentMeans>' +
        `<Payment><PaidAmount>${dec(d.paidCents)}</PaidAmount><PaymentMeansCode>48</PaymentMeansCode>${details}</Payment>` +
        (d.bonusCents ? `<Payment><PaidAmount>${dec(d.bonusCents)}</PaidAmount><PaymentMeansCode>97</PaymentMeansCode>${details}</Payment>` : '') +
        '</PaymentMeans>';
    }

    const taxSchemes = [];
    for (const [value, scheme] of [[customer.icdph, 'VAT'], [customer.dic, /^[A-Z]{2}/.test(String(customer.dic || '').trim()) ? 'VAT' : 'TIN']]) {
      const v = String(value || '').trim();
      if (v && !taxSchemes.some((t) => t.v === v)) taxSchemes.push({ v, scheme });
    }
    const name = [d.credit ? 'credit' : 'invoice', d.number, d.issueDate, customer.name, customer.ico, d.currency, total].join('|');

    return indent('<?xml version="1.0" encoding="UTF-8"?>' +
      `<Invoice xmlns="${ISDOC_NS}" version="${ISDOC_VERSION}">` +
      `<DocumentType>${credit ? 2 : 1}</DocumentType>` +
      `<ID>${xml(d.number)}</ID>` +
      `<UUID>${uuid5(name, UUID_NAMESPACE)}</UUID>` +
      (o.system ? `<IssuingSystem>${xml(String(o.system).slice(0, 80))}</IssuingSystem>` : '') +
      `<IssueDate>${d.issueDate}</IssueDate>` +
      (credit ? '' : `<TaxPointDate>${d.paymentDate}</TaxPointDate>`) +
      `<VATApplicable>${vatFlag}</VATApplicable>` +
      '<ElectronicPossibilityAgreementReference></ElectronicPossibilityAgreementReference>' +
      (d.note ? `<Note>${xml(d.note)}</Note>` : '') +
      `<LocalCurrencyCode>${xml(d.currency)}</LocalCurrencyCode>` +
      '<CurrRate>1</CurrRate><RefCurrRate>1</RefCurrRate>' +
      '<AccountingSupplierParty><Party>' +
      `<PartyIdentification><ID>${xml(supplier.id)}</ID></PartyIdentification>` +
      `<PartyName><Name>${xml(supplier.name)}</Name></PartyName>` +
      addressXml(supplier, supplier.countryText || regionName(supplier.country, o.locale)) +
      '</Party></AccountingSupplierParty>' +
      '<AccountingCustomerParty><Party>' +
      `<PartyIdentification><ID>${xml(customer.ico)}</ID></PartyIdentification>` +
      `<PartyName><Name>${xml(customer.name)}</Name></PartyName>` +
      addressXml(buyer, customer.country || regionName(buyer.country, o.locale)) +
      taxSchemes.map((t) => `<PartyTaxScheme><CompanyID>${xml(t.v)}</CompanyID><TaxScheme>${t.scheme}</TaxScheme></PartyTaxScheme>`).join('') +
      '</Party></AccountingCustomerParty>' +
      '<OrderReferences>' + d.orders.map((order, i) => `<OrderReference id="O${i + 1}">` +
        `<SalesOrderID>${xml(order.orderId)}</SalesOrderID>${order.date ? `<IssueDate>${order.date}</IssueDate>` : ''}</OrderReference>`).join('') +
      '</OrderReferences>' +
      (credit ? '<OriginalDocumentReferences><OriginalDocumentReference>' +
        `<ID>${xml(d.invoiceNumber)}</ID><IssueDate>${d.invoiceDate}</IssueDate>` +
        '</OriginalDocumentReference></OriginalDocumentReferences>' : '') +
      `<InvoiceLines>${lineXml}</InvoiceLines>` +
      `<TaxTotal>${subTotals}<TaxAmount>${dec(taxTotal)}</TaxAmount></TaxTotal>` +
      '<LegalMonetaryTotal>' +
      `<TaxExclusiveAmount>${dec(total - taxTotal)}</TaxExclusiveAmount><TaxInclusiveAmount>${dec(total)}</TaxInclusiveAmount>` +
      '<AlreadyClaimedTaxExclusiveAmount>0.00</AlreadyClaimedTaxExclusiveAmount><AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount>' +
      `<DifferenceTaxExclusiveAmount>${dec(total - taxTotal)}</DifferenceTaxExclusiveAmount><DifferenceTaxInclusiveAmount>${dec(total)}</DifferenceTaxInclusiveAmount>` +
      `<PaidDepositsAmount>0.00</PaidDepositsAmount><PayableAmount>${dec(total)}</PayableAmount>` +
      '</LegalMonetaryTotal>' +
      payment +
      '</Invoice>');
  }

  // ---------------------------------------------------------------- ZIP (stored, no compression)

  const CRC_TABLE = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });

  function crc32(bytes) {
    let c = -1;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  /** ZIP of files [{ name, data (string or bytes) }] with UTF-8 names; date = the time stamp of the entries. */
  function zip(files, date) {
    const t = date || new Date();
    const time = (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1);
    const day = ((Math.max(1980, t.getFullYear()) - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = utf8(f.name);
      const data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, day, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  /** File name without characters that Windows or macOS do not allow. */
  function fileName(s) {
    return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150) || 'invoice';
  }

  return { toCsv, toIsdoc, zip, fileName, sha1, uuid5, countryCode, splitCity, parseSupplier, splitSigned, crc32 };
});
