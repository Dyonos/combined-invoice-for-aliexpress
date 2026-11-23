'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../src/documents.js');
const E = require('../src/export.js');
const S = require('../src/settings.js');
const F = require('./fixtures/receipts.js');

const company = { id: 'c', name: 'Example Trading s.r.o.', street: 'Main Street 1', city: '811 01 Bratislava', country: 'Slovakia', ico: '12345678', dic: '2020123456', icdph: 'SK2020123456' };
const settings = Object.assign({}, S.DEFAULTS, { profileId: 'c', profiles: [company] });

function build(draft, extra) {
  return D.buildDocuments(D.draftParts(draft), Object.assign({
    lang: 'en', settings, profileId: 'c', title: 'Invoice', mode: 'detail', euWarehouse: false, shipNote: false,
    docType: 'invoice', show: {}, date: '', today: '2026-11-23', edits: {}, numbers: {},
  }, extra));
}

const bonusReceipt = Object.assign({}, F.subsidy, {
  paymentInfo: { methodName: 'Card', cardNo: '************0000', paymentAmount: '32.53', bonusAmount: '2.00', bonusAmountStr: '€ 2,00', paymentDate: 'Sep 27, 2026' },
});

// ---------------------------------------------------------------- a small XML reader for the checks

function parseXml(text) {
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  const re = /<\?[^>]*\?>|<(\/?)([A-Za-z][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith('<?')) continue;
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.text += decode(m[5]);
    } else if (m[1]) {
      assert.equal(m[2], top.name, 'closing tag ' + m[2]);
      stack.pop();
    } else {
      const attrs = Object.fromEntries([...m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]));
      const el = { name: m[2], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  assert.equal(stack.length, 1, 'unclosed elements');
  return root.children[0];
}

const child = (el, name) => el.children.find((c) => c.name === name);
const children = (el, name) => el.children.filter((c) => c.name === name);
const value = (el, path) => path.split('/').reduce((e, n) => e && child(e, n), el);
const cents = (el, path) => Math.round(Number(value(el, path).text.trim()) * 100);

// element order of the ISDOC 6.0.2 schema (isdoc-invoice-6.0.2.xsd) for the elements the export writes;
// the export was also validated against the official schema itself
const ORDER = {
  Invoice: ['DocumentType', 'SubDocumentType', 'SubDocumentTypeOrigin', 'TargetConsolidator', 'ClientOnTargetConsolidator',
    'ClientBankAccount', 'ID', 'UUID', 'EgovFlag', 'ISDS_ID', 'FileReference', 'ReferenceNumber', 'EgovClassifiers', 'IssuingSystem',
    'IssueDate', 'TaxPointDate', 'VATApplicable', 'ElectronicPossibilityAgreementReference', 'Note', 'LocalCurrencyCode',
    'ForeignCurrencyCode', 'CurrRate', 'RefCurrRate', 'Extensions', 'AccountingSupplierParty', 'SellerSupplierParty',
    'AnonymousCustomerParty', 'AccountingCustomerParty', 'BuyerCustomerParty', 'OrderReferences', 'DeliveryNoteReferences',
    'OriginalDocumentReferences', 'ContractReferences', 'Delivery', 'InvoiceLines', 'NonTaxedDeposits', 'TaxedDeposits', 'TaxTotal',
    'LegalMonetaryTotal', 'PaymentMeans', 'SupplementsList'],
  Party: ['PartyIdentification', 'PartyName', 'PostalAddress', 'PartyTaxScheme', 'RegisterIdentification', 'Contact'],
  PostalAddress: ['StreetName', 'BuildingNumber', 'CityName', 'PostalZone', 'Country'],
  InvoiceLine: ['ID', 'OrderReference', 'DeliveryNoteReference', 'OriginalDocumentReference', 'ContractReference', 'EgovClassifier',
    'InvoicedQuantity', 'LineExtensionAmountCurr', 'LineExtensionAmount', 'LineExtensionAmountBeforeDiscount',
    'LineExtensionAmountTaxInclusiveCurr', 'LineExtensionAmountTaxInclusive', 'LineExtensionAmountTaxInclusiveBeforeDiscount',
    'LineExtensionTaxAmount', 'UnitPrice', 'UnitPriceTaxInclusive', 'ClassifiedTaxCategory', 'Note', 'VATNote', 'Item', 'Extensions'],
  TaxSubTotal: ['TaxableAmountCurr', 'TaxableAmount', 'TaxAmountCurr', 'TaxAmount', 'TaxInclusiveAmountCurr', 'TaxInclusiveAmount',
    'AlreadyClaimedTaxableAmountCurr', 'AlreadyClaimedTaxableAmount', 'AlreadyClaimedTaxAmountCurr', 'AlreadyClaimedTaxAmount',
    'AlreadyClaimedTaxInclusiveAmountCurr', 'AlreadyClaimedTaxInclusiveAmount', 'DifferenceTaxableAmountCurr', 'DifferenceTaxableAmount',
    'DifferenceTaxAmountCurr', 'DifferenceTaxAmount', 'DifferenceTaxInclusiveAmountCurr', 'DifferenceTaxInclusiveAmount', 'TaxCategory'],
  LegalMonetaryTotal: ['TaxExclusiveAmount', 'TaxExclusiveAmountCurr', 'TaxInclusiveAmount', 'TaxInclusiveAmountCurr',
    'AlreadyClaimedTaxExclusiveAmount', 'AlreadyClaimedTaxExclusiveAmountCurr', 'AlreadyClaimedTaxInclusiveAmount',
    'AlreadyClaimedTaxInclusiveAmountCurr', 'DifferenceTaxExclusiveAmount', 'DifferenceTaxExclusiveAmountCurr',
    'DifferenceTaxInclusiveAmount', 'DifferenceTaxInclusiveAmountCurr', 'PayableRoundingAmount', 'PayableRoundingAmountCurr',
    'PaidDepositsAmount', 'PaidDepositsAmountCurr', 'PayableAmount', 'PayableAmountCurr'],
  ClassifiedTaxCategory: ['Percent', 'VATCalculationMethod', 'VATApplicable', 'LocalReverseCharge'],
  Payment: ['PaidAmount', 'PaymentMeansCode', 'Details'],
};
const REQUIRED = {
  Invoice: ['DocumentType', 'ID', 'UUID', 'IssueDate', 'VATApplicable', 'ElectronicPossibilityAgreementReference', 'LocalCurrencyCode',
    'CurrRate', 'RefCurrRate', 'AccountingSupplierParty', 'AccountingCustomerParty', 'InvoiceLines', 'TaxTotal', 'LegalMonetaryTotal'],
  Party: ['PartyIdentification', 'PartyName', 'PostalAddress'],
  PostalAddress: ['StreetName', 'BuildingNumber', 'CityName', 'PostalZone', 'Country'],
  InvoiceLine: ['ID', 'LineExtensionAmount', 'LineExtensionAmountTaxInclusive', 'LineExtensionTaxAmount', 'UnitPrice', 'UnitPriceTaxInclusive', 'ClassifiedTaxCategory'],
  LegalMonetaryTotal: ['TaxExclusiveAmount', 'TaxInclusiveAmount', 'AlreadyClaimedTaxExclusiveAmount', 'AlreadyClaimedTaxInclusiveAmount',
    'DifferenceTaxExclusiveAmount', 'DifferenceTaxInclusiveAmount', 'PaidDepositsAmount', 'PayableAmount'],
};

function checkOrder(el) {
  const order = ORDER[el.name];
  if (order) {
    const idx = el.children.map((c) => order.indexOf(c.name));
    assert.ok(idx.every((i) => i >= 0), `${el.name}: unknown child in ${el.children.map((c) => c.name)}`);
    for (let i = 1; i < idx.length; i++) assert.ok(idx[i] >= idx[i - 1], `${el.name}: ${el.children[i].name} out of order`);
  }
  for (const name of REQUIRED[el.name] || []) assert.ok(child(el, name), `${el.name}: missing ${name}`);
  el.children.forEach(checkOrder);
}

/** The amounts of an ISDOC add up: lines -> tax subtotals -> totals, as the ISDOC rules require. */
function checkSums(inv) {
  const lines = children(child(inv, 'InvoiceLines'), 'InvoiceLine');
  for (const l of lines) {
    assert.equal(cents(l, 'LineExtensionAmount') + cents(l, 'LineExtensionTaxAmount'), cents(l, 'LineExtensionAmountTaxInclusive'));
  }
  const tax = child(inv, 'TaxTotal');
  const subs = children(tax, 'TaxSubTotal');
  for (const s of subs) {
    assert.equal(cents(s, 'TaxableAmount') + cents(s, 'TaxAmount'), cents(s, 'TaxInclusiveAmount'));
    assert.equal(cents(s, 'DifferenceTaxInclusiveAmount'), cents(s, 'TaxInclusiveAmount') - cents(s, 'AlreadyClaimedTaxInclusiveAmount'));
    const percent = value(s, 'TaxCategory/Percent').text;
    const mine = lines.filter((l) => value(l, 'ClassifiedTaxCategory/Percent').text === percent);
    assert.equal(cents(s, 'TaxableAmount'), mine.reduce((a, l) => a + cents(l, 'LineExtensionAmount'), 0));
    assert.equal(cents(s, 'TaxAmount'), mine.reduce((a, l) => a + cents(l, 'LineExtensionTaxAmount'), 0));
  }
  const total = child(inv, 'LegalMonetaryTotal');
  assert.equal(cents(tax, 'TaxAmount'), subs.reduce((a, s) => a + cents(s, 'TaxAmount'), 0));
  assert.equal(cents(total, 'TaxExclusiveAmount'), subs.reduce((a, s) => a + cents(s, 'TaxableAmount'), 0));
  assert.equal(cents(total, 'TaxInclusiveAmount'), subs.reduce((a, s) => a + cents(s, 'TaxInclusiveAmount'), 0));
  assert.equal(cents(total, 'DifferenceTaxInclusiveAmount') - cents(total, 'PaidDepositsAmount'), cents(total, 'PayableAmount'));
  // line references point to an order of the document
  const ids = children(child(inv, 'OrderReferences'), 'OrderReference').map((o) => o.attrs.id);
  for (const l of lines) assert.ok(ids.includes(child(l, 'OrderReference').attrs.ref));
}

// ---------------------------------------------------------------- CSV

test('CSV: lines of every invoice, totals on the first row of each, Excel-friendly', () => {
  const docs = build(F.demoMulti, { shipNote: true });
  const csv = E.toCsv(docs, D.csvLabels('en'), '.');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.endsWith('\r\n'));
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], 'Document,No.,Date of issue,Date of payment,Customer,Order No.,Description,Variant,Qty,Unit price,Amount,Currency,Total excl. VAT,VAT %,VAT,Total');
  assert.equal(lines.length, 1 + 4 + 12 + 2);
  // the item name contains commas, so it is quoted; the order number stays text in spreadsheets
  assert.equal(lines[1], 'Invoice,AE-20260809-612,2026-08-09,2026-08-09,Example Trading s.r.o.,"=""1000000000030002""",' +
    '"LED strip 5V USB, warm white, 2 m",2M,1,4.59,4.59,EUR,4.98,23,1.14,6.12');
  assert.equal(lines[2], 'Invoice,AE-20260809-612,2026-08-09,2026-08-09,Example Trading s.r.o.,"=""1000000000030002""",Shipping,,,,0.99,EUR,,,,');
  // the amounts of the lines add up to the totals; totals only once per invoice
  const parsed = E.toCsv(docs, D.csvLabels('en'), ',').slice(1).trimEnd().split('\r\n').map((r) => r.split(';'));
  assert.equal(parsed[0].length, 16);
  const amount = (r) => Number(r[10].replace(',', '.'));
  const totals = parsed.slice(1).filter((r) => r[15] !== '');
  assert.deepEqual(totals.map((r) => r[15]), ['6,12', '37,70', '8,47']);
  assert.deepEqual(totals.map((r) => r[14]), ['1,14', '7,04', '1,58']);
  assert.equal(Math.round(parsed.slice(1).reduce((a, r) => a + amount(r), 0) * 100), 612 + 3770 + 847);
  assert.ok(parsed.some((r) => r[6] === 'Shipping and fees (no tracking)'));
});

test('CSV: formulas in texts are not run, quotes and separators are escaped, AliExpress credit gets columns', () => {
  const docs = build({ receipts: [bonusReceipt], bankCents: 3253 }, { edits: { '1000000000020001:0': '=HYPERLINK("x");2"' } });
  const csv = E.toCsv(docs, D.csvLabels('en'), ',');
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.ok(lines[0].endsWith(';Paid with AliExpress credit;Paid by card'));
  assert.ok(lines[1].includes(';"\'=HYPERLINK(""x"");2""";'));
  assert.ok(lines[1].endsWith(';34,53;-2,00;32,53'));
  // allocated: unit price with 4 decimals
  const allocated = E.toCsv(build(F.demoDraft, { mode: 'allocated' }), D.csvLabels('en'), '.');
  assert.ok(allocated.includes(',3,4.7333,14.20,EUR,'));
});

// ---------------------------------------------------------------- ISDOC

test('ISDOC: invoice with VAT, structure in the order of the schema, amounts add up', () => {
  const docs = build(F.demoMulti, { settings: Object.assign({}, settings, { invoiceNote: 'Note & <more>' }) });
  for (const d of docs) {
    const inv = parseXml(E.toIsdoc(d, { system: 'Combined Invoice for AliExpress 1.17.0', locale: 'en-GB' }));
    assert.equal(inv.name, 'Invoice');
    assert.equal(inv.attrs.xmlns, 'http://isdoc.cz/namespace/2013');
    assert.equal(inv.attrs.version, '6.0.2');
    checkOrder(inv);
    checkSums(inv);
    assert.equal(value(inv, 'DocumentType').text, '1');
    assert.equal(value(inv, 'ID').text, d.number);
    assert.equal(value(inv, 'VATApplicable').text, 'true');
    assert.equal(value(inv, 'Note').text, 'Note & <more>');
    assert.match(value(inv, 'UUID').text, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    assert.equal(cents(inv, 'LegalMonetaryTotal/TaxInclusiveAmount'), d.totalCents);
    assert.equal(cents(inv, 'TaxTotal/TaxAmount'), d.vatCents);
    assert.equal(value(inv, 'TaxTotal/TaxSubTotal/TaxCategory/Percent').text, '23');
    assert.equal(value(inv, 'PaymentMeans/Payment/PaymentMeansCode').text, '48');
    assert.equal(cents(inv, 'PaymentMeans/Payment/PaidAmount'), d.paidCents);
  }
  const inv = parseXml(E.toIsdoc(docs[1], {}));
  const supplier = value(inv, 'AccountingSupplierParty/Party');
  assert.equal(value(supplier, 'PartyIdentification/ID').text, '200720572D');
  assert.equal(value(supplier, 'PartyName/Name').text, 'Alibaba.com Singapore E-Commerce Private Limited');
  assert.equal(value(supplier, 'PostalAddress/CityName').text, 'Singapore');
  assert.equal(value(supplier, 'PostalAddress/PostalZone').text, '189554');
  assert.equal(value(supplier, 'PostalAddress/Country/IdentificationCode').text, 'SG');
  const customer = value(inv, 'AccountingCustomerParty/Party');
  assert.equal(value(customer, 'PartyIdentification/ID').text, '12345678');
  assert.equal(value(customer, 'PostalAddress/CityName').text, 'Bratislava');
  assert.equal(value(customer, 'PostalAddress/PostalZone').text, '811 01');
  assert.equal(value(customer, 'PostalAddress/Country/IdentificationCode').text, 'SK');
  assert.deepEqual(children(customer, 'PartyTaxScheme').map((t) => value(t, 'CompanyID').text + ' ' + value(t, 'TaxScheme').text),
    ['SK2020123456 VAT', '2020123456 TIN']);
  assert.deepEqual(children(child(inv, 'OrderReferences'), 'OrderReference').map((o) => value(o, 'SalesOrderID').text),
    ['1000000000010001', '1000000000010002', '1000000000010003']);
  const item = children(child(inv, 'InvoiceLines'), 'InvoiceLine')[0];
  assert.equal(value(item, 'InvoicedQuantity').attrs.unitCode, 'ks');
  assert.equal(value(item, 'Item/Description').text, 'Screwdriver bit set, 24 pcs, magnetic (Set A)');
  assert.equal(value(item, 'ClassifiedTaxCategory/VATCalculationMethod').text, '1');
});

test('ISDOC: the same document always gets the same UUID, another number another one', () => {
  const [d] = build(F.demoDraft);
  const uuid = (doc) => value(parseXml(E.toIsdoc(doc, {})), 'UUID').text;
  assert.equal(uuid(d), uuid(build(F.demoDraft)[0]));
  assert.notEqual(uuid(d), uuid(build(F.demoDraft, { numbers: { 'invoice:0': 'X-1' } })[0]));
});

test('ISDOC: credit note in positive amounts, referring to the invoice, without VAT', () => {
  const [d] = build(F.demoMultiRefund, { docType: 'credit' });
  const inv = parseXml(E.toIsdoc(d, {}));
  checkOrder(inv);
  checkSums(inv);
  assert.equal(value(inv, 'DocumentType').text, '2');
  assert.equal(value(inv, 'VATApplicable').text, 'false');
  assert.equal(value(inv, 'OriginalDocumentReferences/OriginalDocumentReference/ID').text, 'AE-20260809-612');
  assert.equal(value(inv, 'OriginalDocumentReferences/OriginalDocumentReference/IssueDate').text, '2026-08-09');
  assert.equal(cents(inv, 'LegalMonetaryTotal/PayableAmount'), 612);
  assert.equal(value(inv, 'InvoiceLines/InvoiceLine/Item/Description').text, 'Refund for order No. 1000000000030002');
  assert.equal(child(inv, 'TaxPointDate'), undefined);
  assert.equal(child(inv, 'PaymentMeans'), undefined);
});

test('ISDOC: without a VAT amount on the receipt the document is not a VAT document', () => {
  const [d] = build({ receipts: [F.euWarehouse], bankCents: 7106 });
  const inv = parseXml(E.toIsdoc(d, {}));
  checkOrder(inv);
  checkSums(inv);
  assert.equal(value(inv, 'VATApplicable').text, 'false');
  assert.equal(cents(inv, 'TaxTotal/TaxAmount'), 0);
  assert.equal(cents(inv, 'LegalMonetaryTotal/TaxExclusiveAmount'), 7106);
  for (const l of children(child(inv, 'InvoiceLines'), 'InvoiceLine')) {
    assert.equal(value(l, 'ClassifiedTaxCategory/Percent').text, '0');
    assert.equal(value(l, 'ClassifiedTaxCategory/VATApplicable').text, 'false');
  }
});

test('ISDOC: orders with different VAT rates, AliExpress credit, allocated prices', () => {
  const rate20 = Object.assign({}, F.garden, { orderId: '1000000000040001', includedTaxDisplay: '€ 1,41' });
  const mixed = parseXml(E.toIsdoc(build({ receipts: [F.garden, rate20] })[0], {}));
  checkSums(mixed);
  assert.deepEqual(children(child(mixed, 'TaxTotal'), 'TaxSubTotal').map((s) => value(s, 'TaxCategory/Percent').text), ['23', '20']);
  assert.equal(cents(mixed, 'TaxTotal/TaxAmount'), 158 + 141);

  const bonus = parseXml(E.toIsdoc(build({ receipts: [bonusReceipt] })[0], {}));
  checkSums(bonus);
  assert.deepEqual(children(child(bonus, 'PaymentMeans'), 'Payment').map((p) => value(p, 'PaymentMeansCode').text + ' ' + value(p, 'PaidAmount').text),
    ['48 32.53', '97 2.00']);
  assert.equal(cents(bonus, 'LegalMonetaryTotal/PayableAmount'), 3453);

  const allocated = parseXml(E.toIsdoc(build(F.demoDraft, { mode: 'allocated' })[0], {}));
  checkSums(allocated);
  const nickel = children(child(allocated, 'InvoiceLines'), 'InvoiceLine')[2];
  assert.equal(value(nickel, 'UnitPriceTaxInclusive').text, '4.7333');
  assert.equal(value(nickel, 'LineExtensionAmountTaxInclusive').text, '14.20');
});

test('ISDOC: empty company, custom supplier text and texts that need escaping', () => {
  const custom = Object.assign({}, S.DEFAULTS, { supplier: 'Seller & Co. <Ltd>\nMain Street 5\n10115 Berlin\nGermany\nReg. No.: HRB 12345\nwww.example.com' });
  const paypal = Object.assign({}, F.light, { paymentInfo: { methodName: 'PayPal', paymentAmount: '6.12', paymentDate: 'Aug 9, 2026' } });
  const [d] = D.buildDocuments(D.draftParts({ receipts: [paypal] }), {
    lang: 'en', settings: custom, profileId: 'p1', title: 'Invoice', mode: 'detail', docType: 'invoice', show: {}, date: '', today: '2026-11-23',
    edits: { '1000000000030002:0': 'Strip "A" & <B>\u0007' }, numbers: {},
  });
  const text = E.toIsdoc(d, {});
  assert.ok(!text.includes('\u0007'));
  const inv = parseXml(text);
  checkOrder(inv);
  const supplier = value(inv, 'AccountingSupplierParty/Party');
  assert.equal(value(supplier, 'PartyName/Name').text, 'Seller & Co. <Ltd>');
  assert.equal(value(supplier, 'PartyIdentification/ID').text, 'HRB 12345');
  assert.equal(value(supplier, 'PostalAddress/StreetName').text, 'Main Street 5');
  assert.equal(value(supplier, 'PostalAddress/PostalZone').text, '10115');
  assert.equal(value(supplier, 'PostalAddress/Country/IdentificationCode').text, 'DE');
  assert.equal(value(inv, 'AccountingCustomerParty/Party/PartyName/Name').text, '');
  assert.equal(value(inv, 'InvoiceLines/InvoiceLine/Item/Description').text, 'Strip "A" & <B> (2M)');
  // not paid by card: no payment details
  assert.equal(child(inv, 'PaymentMeans'), undefined);
});

// ---------------------------------------------------------------- helpers

test('countries from names in several languages, codes and VAT IDs', () => {
  const cases = { Slovakia: 'SK', Slovensko: 'SK', 'Slovenská republika': 'SK', Česko: 'CZ', 'Czech Republic': 'CZ', Deutschland: 'DE',
    Germany: 'DE', Magyarország: 'HU', Polska: 'PL', Österreich: 'AT', 'United Kingdom': 'GB', UK: 'GB', Singapore: 'SG', 日本: 'JP' };
  for (const [name, code] of Object.entries(cases)) assert.equal(E.countryCode(name), code, name);
  assert.equal(E.countryCode('', 'SK2020123456'), 'SK');
  assert.equal(E.countryCode('Atlantis', 'EL123456789'), 'GR');
  assert.equal(E.countryCode('Atlantis', ''), '');
});

test('postcode and city', () => {
  assert.deepEqual(E.splitCity('811 01 Bratislava'), { zone: '811 01', city: 'Bratislava' });
  assert.deepEqual(E.splitCity('00-950 Warszawa'), { zone: '00-950', city: 'Warszawa' });
  assert.deepEqual(E.splitCity('1051 Budapest'), { zone: '1051', city: 'Budapest' });
  assert.deepEqual(E.splitCity('Singapore 189554'), { zone: '189554', city: 'Singapore' });
  assert.deepEqual(E.splitCity('Leeds LS1 6DT'), { zone: 'LS1 6DT', city: 'Leeds' });
  assert.deepEqual(E.splitCity('Bratislava'), { zone: '', city: 'Bratislava' });
});

test('SHA-1 and name-based UUID', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const bytes = crypto.randomBytes(n);
    assert.equal(Buffer.from(E.sha1(new Uint8Array(bytes))).toString('hex'), crypto.createHash('sha1').update(bytes).digest('hex'), 'length ' + n);
  }
  // RFC 9562 example: DNS namespace and www.example.com
  assert.equal(E.uuid5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ED6657D-E927-568B-95E1-2665A8AEA6A2');
});

test('VAT split over lines by amount, the rounding difference on the largest line', () => {
  assert.deepEqual(E.splitSigned(230, [816, 199, -155, 369]), [153, 37, -29, 69]);
  assert.equal(E.splitSigned(704, [1229, 1121, 1420]).reduce((a, b) => a + b, 0), 704);
  assert.deepEqual(E.splitSigned(5, [0, 0]), [5, 0]);
  assert.deepEqual(E.splitSigned(0, []), []);
});

test('ZIP: stored files with UTF-8 names that any unzip program reads', () => {
  const files = [{ name: 'Invoice AE-1.isdoc', data: '<a>ž</a>' }, { name: 'Faktúra 2.isdoc', data: new Uint8Array([1, 2, 3]) }];
  const zip = Buffer.from(E.zip(files, new Date(2026, 7, 16, 12, 30, 10)));
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  let at = zip.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
    const local = zip.readUInt32LE(at + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    assert.equal(zip.readUInt16LE(local + 6) & 0x0800, 0x0800);
    const data = zip.subarray(local + 30 + zip.readUInt16LE(local + 26), local + 30 + zip.readUInt16LE(local + 26) + size);
    assert.equal(zip.readUInt32LE(at + 16), E.crc32(data));
    out.push([name, data]);
    at += 46 + nameLen;
  }
  assert.equal(out[0][0], 'Invoice AE-1.isdoc');
  assert.equal(out[0][1].toString('utf8'), '<a>ž</a>');
  assert.equal(out[1][0], 'Faktúra 2.isdoc');
  assert.deepEqual([...out[1][1]], [1, 2, 3]);
  assert.equal(E.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('file names without characters Windows does not allow', () => {
  assert.equal(E.fileName('Invoice AE/1: "x"?'), 'Invoice AE-1- -x-');
  assert.equal(E.fileName(''), 'invoice');
});
