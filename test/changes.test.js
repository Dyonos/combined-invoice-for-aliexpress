'use strict';
// Changes typed on the invoice page: quantities, unit prices, amounts and lines added by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/core.js');
const D = require('../src/documents.js');
const S = require('../src/settings.js');
const F = require('./fixtures/receipts.js');

// order 1000000000010001: 1 x 8.16, shipping 1.99, discount -1.55, shipping and fees 3.69 = 12.29, VAT 23 % 2.30
const order = () => A.normalizeReceipt(F.payment3770[0]);
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

const company = { id: 'c', name: 'Example Trading s.r.o.', street: 'Main Street 1', city: '811 01 Bratislava', country: 'Slovakia', ico: '12345678', dic: '2020123456', icdph: 'SK2020123456' };
const settings = Object.assign({}, S.DEFAULTS, { profileId: 'c', profiles: [company] });

function build(draft, extra) {
  return D.buildDocuments(D.draftParts(draft), Object.assign({
    lang: 'en', settings, profileId: 'c', title: 'Invoice', mode: 'detail', euWarehouse: false, shipNote: false,
    docType: 'invoice', show: {}, date: '', today: '2026-11-23', edits: {}, numbers: {}, changes: {},
  }, extra));
}

test('no changes: the order stays as on its receipt', () => {
  const o = order();
  assert.equal(A.applyOrderChanges(o, undefined), o);
  assert.equal(A.applyOrderChanges(o, {}), o);
  // values typed the same as on the receipt are no change
  assert.equal(A.applyOrderChanges(o, { items: { 0: { qty: 1, unitCents: 816 } }, charges: { shippingFee: 199 } }), o);
});

test('quantity: line, total, VAT at the receipt rate and the paid amount follow', () => {
  const o = A.applyOrderChanges(order(), { items: { 0: { qty: 2 } } });
  assert.equal(o.items[0].qty, 2);
  assert.equal(o.items[0].lineCents, 1632);
  assert.equal(o.items[0].changed, true);
  assert.equal(o.totalCents, 2045);
  assert.equal(o.includedTaxCents, 382); // 20.45 * 23 / 123 = 3.8239
  assert.equal(o.taxRate, 23);
  assert.equal(o.paidCents, 2045);
  assert.equal(o.receiptTotalCents, 1229);
  for (const mode of ['detail', 'allocated']) assert.equal(sum(A.orderLines(o, mode), (l) => l.lineCents), 2045);
});

test('unit price and a shipping amount', () => {
  const o = A.applyOrderChanges(order(), { items: { 0: { unitCents: 1000 } }, charges: { shippingFee: 0 } });
  assert.equal(o.items[0].lineCents, 1000);
  assert.equal(o.charges.find((c) => c.key === 'shippingFee').cents, 0);
  assert.equal(o.totalCents, 1000 + 0 - 155 + 369);
  assert.equal(o.includedTaxCents, Math.round((1214 * 23) / 123));
  const lines = A.orderLines(o, 'detail');
  assert.deepEqual(lines.filter((l) => l.changed).map((l) => l.kind), ['item', 'charge']);
});

test('lines added by hand: an item and a fee, also spread into prices in the allocated view', () => {
  const o = A.applyOrderChanges(order(), { added: [{ id: '1', kind: 'item', qty: 2, unitCents: 250 }, { id: '2', kind: 'fee', cents: 100 }] });
  assert.equal(o.totalCents, 1229 + 500 + 100);
  assert.equal(o.includedTaxCents, Math.round((1829 * 23) / 123));
  const detail = A.orderLines(o, 'detail');
  const item = detail.find((l) => l.manual === '1');
  assert.deepEqual([item.kind, item.ref, item.qty, item.unitCents, item.lineCents], ['item', 'm1', 2, 250, 500]);
  const fee = detail.find((l) => l.manual === '2');
  assert.deepEqual([fee.kind, fee.key, fee.lineCents], ['charge', 'm2', 100]);
  assert.equal(sum(detail, (l) => l.lineCents), 1829);
  const allocated = A.orderLines(o, 'allocated');
  assert.equal(allocated.length, 2);
  assert.equal(sum(allocated, (l) => l.lineCents), 1829);
});

test('an order without VAT on its receipt stays without VAT', () => {
  const raw = Object.assign({}, F.payment3770[0], { includedTaxDisplay: undefined });
  const o = A.applyOrderChanges(A.normalizeReceipt(raw), { items: { 0: { qty: 3 } } });
  assert.equal(o.includedTaxCents, null);
  assert.equal(o.taxRate, null);
});

test('invoice: totals, VAT, bank check and warnings use the changed lines, the number stays', () => {
  const changes = {
    '1000000000010001': { items: { 0: { qty: 2 } } },
    '1000000000010003': { added: [{ id: '1', kind: 'fee', cents: -200 }] },
  };
  const [plain] = build(F.demoDraft);
  const [d] = build(F.demoDraft, { changes, edits: { '1000000000010003:c:m1': 'Coupon' } });
  assert.equal(d.number, plain.number);
  assert.equal(d.changed, true);
  assert.equal(plain.changed, false);
  assert.equal(d.totalCents, plain.totalCents + 816 - 200);
  assert.equal(d.paidCents, d.totalCents);
  assert.equal(d.bankDiffCents, plain.totalCents - d.totalCents);
  assert.equal(d.vatRate, 23);
  assert.equal(d.vatCents, sum(d.orders, (o) => o.vatCents));
  for (const o of d.orders) assert.equal(sum(o.lines, (l) => l.lineCents), o.totalCents);
  const first = d.orders.find((o) => o.orderId === '1000000000010001');
  assert.equal(first.receiptTotalCents, 1229);
  assert.equal(first.totalCents, 2045);
  const fee = d.orders.find((o) => o.orderId === '1000000000010003').lines.find((l) => l.manual === '1');
  assert.deepEqual([fee.kind, fee.text, fee.lineCents, fee.nameKey], ['charge', 'Coupon', -200, '1000000000010003:c:m1']);
});

test('lines added by hand get a default name in the invoice language, names can be typed over', () => {
  const changes = { '1000000000010001': { added: [{ id: '4', kind: 'item', qty: 1, unitCents: 990 }, { id: '5', kind: 'fee', cents: 50 }] } };
  const [d] = build(F.demoDraft, { changes, edits: { '1000000000010001:m4': 'Spare brush' } });
  const lines = d.orders.find((o) => o.orderId === '1000000000010001').lines;
  const item = lines.find((l) => l.manual === '4');
  assert.deepEqual([item.text, item.key, item.ref, item.sku, item.editable], ['Spare brush', '1000000000010001:m4', 'm4', '', true]);
  assert.equal(lines.find((l) => l.manual === '5').text, 'Fee');
  // original items keep their keys for edited names
  assert.equal(lines[0].key, '1000000000010001:0');
});

test('quantities and prices are changed only in the view with separate lines of an invoice', () => {
  assert.equal(build(F.demoDraft)[0].editable, true);
  assert.equal(build(F.demoDraft, { mode: 'allocated' })[0].editable, false);
  const [credit] = build(F.demoMultiRefund.invoices ? { invoices: [F.demoMultiRefund.invoices[1]] } : F.demoMultiRefund, { docType: 'credit' });
  if (credit) assert.equal(credit.editable, false);
  // in the allocated view the changes still count
  const changes = { '1000000000010001': { items: { 0: { qty: 2 } } } };
  const [d] = build(F.demoDraft, { mode: 'allocated', changes });
  assert.equal(d.totalCents, 3770 + 816);
  for (const o of d.orders) assert.equal(sum(o.lines, (l) => l.lineCents), o.totalCents);
});
