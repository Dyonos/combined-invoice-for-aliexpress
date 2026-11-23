'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/documents.js');
const I = require('../src/i18n.js');
const S = require('../src/settings.js');
const F = require('./fixtures/receipts.js');

const company = { id: 'c', name: 'Example Trading s.r.o.', street: 'Main Street 1', city: '811 01 Bratislava', country: 'Slovakia', ico: '12345678', dic: '2020123456', icdph: 'SK2020123456' };
const settings = Object.assign({}, S.DEFAULTS, { profileId: 'c', profiles: [company] });

function build(draft, extra) {
  return D.buildDocuments(D.draftParts(draft), Object.assign({
    lang: 'en', settings, profileId: 'c', title: 'Invoice', mode: 'detail', euWarehouse: false, shipNote: false,
    docType: 'invoice', show: { stores: true }, date: '', today: '2026-11-23', edits: {}, numbers: {},
  }, extra));
}

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

test('one invoice: number, dates, lines and totals as printed', () => {
  const [d] = build(F.demoDraft, { shipNote: true, euWarehouse: true });
  assert.equal(d.number, 'AE-20260816-3770');
  assert.equal(d.issueDate, '2026-08-16');
  assert.equal(d.paymentDate, '2026-08-16');
  assert.equal(d.title, 'Invoice');
  assert.equal(d.totalCents, 3770);
  assert.equal(d.vatCents, 704);
  assert.equal(d.vatRate, 23);
  assert.equal(d.bankDiffCents, 0);
  assert.deepEqual(d.methods, ['Card ****0000']);
  assert.equal(d.orders.length, 3);
  for (const o of d.orders) assert.equal(sum(o.lines, (l) => l.lineCents), o.totalCents);
  const first = d.orders[0].lines;
  assert.deepEqual(first.map((l) => l.kind), ['item', 'charge', 'charge', 'charge']);
  assert.equal(first[0].sku, 'Set A, EU Stock');
  assert.equal(first[3].text, 'Shipping and fees (no tracking)');
  assert.deepEqual(d.orders[0].extra, ['Example Tools Store']);
});

test('item names edited on the page and a typed number are used', () => {
  const [d] = build(F.demoDraft, { edits: { '1000000000010001:0': 'Bits' }, numbers: { 'invoice:0': 'INV-1' } });
  assert.equal(d.orders[0].lines[0].text, 'Bits');
  assert.equal(d.number, 'INV-1');
  assert.equal(d.autoNumber, 'AE-20260816-3770');
});

test('allocated prices: unit prices may have parts of a cent, lines still add up', () => {
  const [d] = build(F.demoDraft, { mode: 'allocated' });
  for (const o of d.orders) {
    assert.ok(o.lines.every((l) => l.kind === 'item'));
    assert.equal(sum(o.lines, (l) => l.lineCents), o.totalCents);
    assert.ok(o.allocation.startsWith('Included in item prices: shipping'));
  }
  const nickel = d.orders[2].lines[0];
  assert.equal(nickel.qty, 3);
  assert.equal(nickel.unitCents, 1420 / 3);
});

test('several invoices on one page: each keeps its own number and dates', () => {
  const docs = build(F.demoMulti);
  assert.deepEqual(docs.map((d) => d.number), ['AE-20260809-612', 'AE-20260816-3770', 'AE-20260821-847']);
  assert.deepEqual(docs.map((d) => d.issueDate), ['2026-08-09', '2026-08-16', '2026-08-21']);
  assert.deepEqual(docs.map((d) => d.k), [0, 1, 2]);
  assert.ok(docs.every((d) => d.bankDiffCents === 0));
  // the toolbar options apply to all of them
  const de = build(F.demoMulti, { lang: 'de', title: 'Invoice' });
  assert.ok(de.every((d) => d.title === 'Rechnung'));
});

test('automatic numbers stay unique on one page', () => {
  const twice = { invoices: [{ bankCents: 847, receipts: [F.garden] }, { bankCents: 847, receipts: [F.garden] }] };
  assert.deepEqual(build(twice).map((d) => d.number), ['AE-20260821-847', 'AE-20260821-847-2']);
});

test('credit notes only for invoices with refunded orders, referring to their invoice', () => {
  const docs = build(F.demoMultiRefund, { docType: 'credit', numbers: { 'invoice:0': 'INV-7' } });
  assert.equal(docs.length, 1);
  const [d] = docs;
  assert.equal(d.credit, true);
  assert.equal(d.title, 'Credit note');
  assert.equal(d.number, 'AE-CN-20261123-612');
  assert.equal(d.invoiceNumber, 'INV-7');
  assert.equal(d.invoiceDate, '2026-08-09');
  assert.equal(d.issueDate, '2026-11-23');
  assert.equal(d.paymentDate, null);
  assert.equal(d.totalCents, -612);
  assert.equal(d.vatCents, null);
  assert.deepEqual(d.orders[0].lines.map((l) => [l.kind, l.text, l.lineCents]), [['refund', 'Refund for order No. 1000000000030002', -612]]);
});

test('a draft without receipts has no documents', () => {
  assert.deepEqual(D.draftParts(null), []);
  assert.deepEqual(D.draftParts({ receipts: [] }), []);
  assert.equal(D.draftParts({ invoices: [{ receipts: [] }, { receipts: [F.light] }] }).length, 1);
});

test('CSV column names exist in every language, decimal separators by language', () => {
  for (const { code } of I.LANGS) {
    for (const [key, text] of Object.entries(D.csvLabels(code))) assert.ok(text && !text.startsWith('doc.'), `${code}.${key}`);
  }
  assert.equal(D.decimalSeparator('en'), '.');
  assert.equal(D.decimalSeparator('sk'), ',');
  assert.equal(D.decimalSeparator('de'), ',');
  assert.equal(D.decimalSeparator('ja'), '.');
});
