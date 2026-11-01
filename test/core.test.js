'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/core.js');
const F = require('./fixtures/receipts.js');

const sum = (lines) => lines.reduce((a, l) => a + l.lineCents, 0);

test('parseMoney: AliExpress and bank statement formats', () => {
  const cases = [
    ['€ 33,30', 3330, 'EUR'],
    ['-€ 1,99', -199, 'EUR'],
    ['−€1.55', -155, 'EUR'],
    ['EUR 34.53', 3453, 'EUR'],
    ['Total:€22.39', 2239, 'EUR'],
    ['€3.74   x5', 374, 'EUR'],
    ['1 234,56 €', 123456, 'EUR'],
    ['€1,234.56', 123456, 'EUR'],
    ['US $12.30', 1230, 'USD'],
    ['37,7', 3770, null],
    ['37.70', 3770, null],
    ['100', 10000, null],
    ['1.234', 123400, null],
  ];
  for (const [input, cents, currency] of cases) {
    assert.deepEqual(A.parseMoney(input), { cents, currency }, input);
  }
  assert.equal(A.parseMoney('Free shipping'), null);
  assert.equal(A.parseMoney(''), null);
  assert.deepEqual(A.parseMoney(34.53), { cents: 3453, currency: null });
});

test('formatMoney and formatUnit: Slovak format', () => {
  assert.equal(A.formatMoney(123456), '1 234,56 €');
  assert.equal(A.formatMoney(-155), '-1,55 €');
  assert.equal(A.formatMoney(5, 'USD'), '0,05 USD');
  assert.equal(A.formatUnit(1229, 3), '4,0967 €');
  assert.equal(A.formatUnit(1014, 3), '3,38 €');
});

test('parseDate a formatDate', () => {
  assert.equal(A.parseDate('Sep 27, 2026'), '2026-09-27');
  assert.equal(A.parseDate('Date: Oct 20, 2026'), '2026-10-20');
  assert.equal(A.parseDate('27 Sep 2026'), '2026-09-27');
  assert.equal(A.parseDate('2026-08-16'), '2026-08-16');
  assert.equal(A.parseDate('16. 8. 2026'), '2026-08-16');
  assert.equal(A.parseDate('nothing'), null);
  assert.equal(A.formatDate('2026-08-16'), '16. 8. 2026');
  assert.equal(A.addDays('2026-08-16', -3), '2026-08-13');
  assert.equal(A.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(A.addDays('2026-10-25', -1), '2026-10-24');
});

test('payment €37.70: three orders match the receipts and the bank to the cent', () => {
  const orders = F.payment3770.map((r) => A.normalizeReceipt(r));
  const expected = { '1000000000010001': 1229, '1000000000010002': 1121, '1000000000010003': 1420 };
  for (const o of orders) {
    assert.equal(o.totalCents, expected[o.orderId]);
    assert.equal(o.residualCents, 0, 'receipt lines add up to the order total');
    assert.equal(o.itemsDiffCents, 0);
    assert.deepEqual(o.warnings, []);
  }
  const first = orders.find((o) => o.orderId === '1000000000010001');
  assert.deepEqual(first.charges.map((c) => [c.key, c.cents]), [
    ['shippingFee', 199],
    ['totalDiscountAmount', -155],
    ['totalReceivableTaxAmount', 369],
  ]);
  const inv = A.combine(orders, { bankCents: 3770, mode: 'detail' });
  assert.equal(inv.totalCents, 3770);
  assert.equal(inv.paidCents, 3770);
  assert.equal(inv.bankDiffCents, 0);
  assert.equal(inv.includedTaxCents, 230 + 209 + 265);
  assert.equal(inv.vatRate, 23);
  assert.deepEqual(inv.warnings, []);
  for (const o of inv.orders) assert.equal(sum(o.lines), o.totalCents);
  // spread into item prices: the items alone add up to the order total
  const alloc = A.combine(orders, { bankCents: 3770, mode: 'allocated' });
  for (const o of alloc.orders) {
    assert.ok(o.lines.every((l) => l.kind === 'item'));
    assert.equal(sum(o.lines), o.totalCents);
  }
  const strips = alloc.orders.find((o) => o.orderId === '1000000000010003').lines[0];
  assert.equal(strips.qty, 3);
  assert.equal(strips.lineCents, 1420);
  // the bank amount reveals a wrong selection
  const two = A.combine(orders.slice(0, 2), { bankCents: 3770 });
  assert.equal(two.bankDiffCents, 3770 - two.paidCents);
  assert.notEqual(two.bankDiffCents, 0);
});

test('discount on import charges: the sub-line is not counted twice', () => {
  const o = A.normalizeReceipt(F.subsidy);
  assert.equal(o.totalCents, 3453);
  assert.equal(o.residualCents, 0);
  const subsidy = o.charges.find((c) => c.key === 'totalSubsidyTaxAmount');
  assert.equal(subsidy.cents, -199);
  assert.deepEqual(subsidy.children.map((c) => [c.key, c.cents]), [['mergeTaxDiscountAmount', -199]]);
  assert.equal(o.charges.find((c) => c.key === 'shippingFee'), undefined, 'zero shipping is not listed');
  const lines = A.orderLines(o, 'detail');
  assert.equal(sum(lines), 3453);
  assert.equal(o.includedTaxCents, 646);
  assert.equal(A.vatRate(o.totalCents, o.includedTaxCents), 23);
});

test('€0.01 shipping that AliExpress left out of the total is not on the invoice', () => {
  const o = A.normalizeReceipt(F.pennyShipping);
  assert.equal(o.totalCents, 2239);
  assert.equal(o.residualCents, 0);
  assert.equal(o.charges.find((c) => c.key === 'shippingFee'), undefined);
  assert.equal(o.notes.length, 1);
  assert.deepEqual(o.warnings, []);
  assert.equal(A.orderLines(o, 'detail').reduce((a, l) => a + l.lineCents, 0), 2239);

  // January 2026: the receipt listed -€0.09 shipping that the order total did not include either
  const jan = A.normalizeReceipt({
    orderId: 'jan02-a', orderTime: 'Jan 2, 2026', includeTax: 'true', includedTaxDisplay: '€ 4,96',
    itemsTotal: '€ 26,52', shippingFee: '-€ 0,09', orderTotal: '€ 26,52',
    paymentInfo: { paymentAmount: '26.52', paymentDate: 'Jan 2, 2026' },
    subOrders: [{ amount: '€ 13,26', itemCount: 2, itemTitle: 'Fan Motor' }],
  });
  assert.equal(jan.residualCents, 0);
  assert.deepEqual(jan.charges, []);

  // real shipping is not dropped this way, the difference stays visible
  const big = A.normalizeReceipt(Object.assign({}, F.pennyShipping, { shippingFee: '€ 2,50', orderTotal: '€ 22,39' }));
  assert.equal(big.charges.find((c) => c.key === 'shippingFee').cents, 250);
  assert.equal(big.residualCents, -250);
  assert.equal(big.warnings.length, 1);
});

test('EU warehouse: VAT included without an amount, no import charges', () => {
  const o = A.normalizeReceipt(F.euWarehouse);
  assert.equal(o.residualCents, 0);
  assert.equal(o.includedTaxCents, null);
  assert.equal(o.vatIncluded, true);
  const inv = A.combine([o, A.normalizeReceipt(F.subsidy)], {});
  assert.equal(inv.vatIncludedAll, true);
  assert.equal(inv.includedTaxComplete, false);
});

test('a price adjustment with the opposite sign is flipped so that the sum matches', () => {
  const o = A.normalizeReceipt({
    orderId: '1', orderTime: 'Oct 1, 2026', itemsTotal: '€ 10,00', adjustPriceAmount: '€ 0,50',
    shippingFee: '€ 1,00', orderTotal: '€ 10,50', paymentInfo: { paymentAmount: '10.50', paymentDate: 'Oct 1, 2026' },
    subOrders: [{ amount: '€ 10,00', itemCount: 1, itemTitle: 'X' }],
  });
  assert.equal(o.residualCents, 0);
  assert.equal(o.charges.find((c) => c.key === 'adjustPriceAmount').cents, -50);
  assert.equal(o.notes.length, 1);
});

test('an unexplained difference becomes its own line with a warning', () => {
  const o = A.normalizeReceipt({
    orderId: '2', orderTime: 'Oct 1, 2026', itemsTotal: '€ 10,00', shippingFee: '€ 1,00', orderTotal: '€ 11,40',
    paymentInfo: { paymentAmount: '11.40' }, subOrders: [{ amount: '€ 10,00', itemCount: 1, itemTitle: 'X' }],
  });
  assert.equal(o.residualCents, 40);
  assert.equal(o.warnings.length, 1);
  const lines = A.orderLines(o, 'detail');
  assert.equal(lines[lines.length - 1].kind, 'diff');
  assert.equal(sum(lines), 1140);
});

test('AliExpress credit: the card pays less than the order total', () => {
  const o = A.normalizeReceipt({
    orderId: '3', orderTime: 'Oct 2, 2026', itemsTotal: '€ 12,00', orderTotal: '€ 12,00',
    paymentInfo: { paymentAmount: '10.00', bonusAmount: '2.00', bonusAmountStr: '€ 2,00', paymentDate: 'Oct 2, 2026' },
    subOrders: [{ amount: '€ 6,00', itemCount: 2, itemTitle: 'Y' }],
  });
  assert.equal(o.bonusCents, 200);
  assert.equal(o.paidCents, 1000);
  const inv = A.combine([o], { bankCents: 1000 });
  assert.equal(inv.totalCents, 1200);
  assert.equal(inv.bankDiffCents, 0);
});

test('a refund is a warning, the order total does not change', () => {
  const o = A.normalizeReceipt(Object.assign({}, F.subsidy, { refundInfo: { refundCount: 1, refundAmount: '€ 16,65' } }));
  assert.equal(o.totalCents, 3453);
  assert.deepEqual(o.refund, { count: 1, cents: 1665 });
  assert.equal(o.warnings.length, 1);
});

test('allocation: several items, sum exact to the cent', () => {
  const o = A.normalizeReceipt({
    orderId: '4', orderTime: 'Oct 3, 2026', itemsTotal: '€ 10,01', shippingFee: '€ 1,99', totalDiscountAmount: '€ 0,50',
    totalReceivableTaxAmount: '€ 3,69', orderTotal: '€ 15,19', paymentInfo: { paymentAmount: '15.19' },
    subOrders: [
      { amount: '€ 5,00', itemCount: 1, itemTitle: 'A' },
      { amount: '€ 2,50', itemCount: 2, itemTitle: 'B' },
      { amount: '€ 0,01', itemCount: 1, itemTitle: 'C' },
    ],
  });
  assert.equal(o.residualCents, 0);
  const lines = A.orderLines(o, 'allocated');
  assert.equal(sum(lines), 1519);
  assert.deepEqual(lines.map((l) => l.lineCents), [759, 759, 1]);
  assert.deepEqual(A.allocate(-7, [1, 1, 1]), [-2, -2, -3]);
  assert.deepEqual(A.allocate(10, [0, 0]), [5, 5]);
  assert.equal(A.allocate(518, [500, 500, 1]).reduce((a, x) => a + x, 0), 518);
});

test('search by bank amount: prefers orders from one day', () => {
  const r1 = A.findOrdersForAmount(F.orderList, 3770);
  assert.deepEqual(r1.ids.slice().sort(), ['aug16-a', 'aug16-b', 'aug16-c']);
  assert.equal(r1.date, '2026-08-16');
  assert.equal(r1.sameDay, true);
  assert.equal(r1.ambiguous, false);

  const r2 = A.findOrdersForAmount(F.orderList, 6980);
  assert.deepEqual(r2.ids.slice().sort(), ['okt19-a', 'okt19-b', 'okt19-c']);

  const r3 = A.findOrdersForAmount(F.orderList, 3453 + 655 + 2735 + 7106 + 4115);
  assert.equal(r3.ids.length, 5);
  assert.equal(r3.date, '2026-09-27');

  assert.equal(A.findOrdersForAmount(F.orderList, 1), null);

  // the same amount twice on one day = ambiguous
  const twin = [{ id: 'a', cents: 500, date: '2026-01-01' }, { id: 'b', cents: 500, date: '2026-01-01' }];
  assert.equal(A.findOrdersForAmount(twin, 500).ambiguous, true);

  // across days only if one day does not work
  const cross = A.findOrdersForAmount(F.orderList, 2239 + 1229);
  assert.equal(cross.sameDay, false);
  // the panel searches within one day only
  assert.equal(A.findOrdersForAmount(F.orderList, 2239 + 1229, { sameDayOnly: true }), null);
  assert.deepEqual(A.findOrdersForAmount(F.orderList, 3770, { sameDayOnly: true }).ids.slice().sort(), ['aug16-a', 'aug16-b', 'aug16-c']);
});

test('parseMoney: Romanian lei', () => {
  assert.deepEqual(A.parseMoney('123,45 lei'), { cents: 12345, currency: 'RON' });
  assert.deepEqual(A.parseMoney('RON 9.99'), { cents: 999, currency: 'RON' });
});

test('parsePayments: payments pasted from a bank statement', () => {
  const p = A.parsePayments([
    '37,70 18.08.2026',
    '2026-09-09;-149.73 EUR',
    '',
    '18. 8. 2026 1 234,56 €',
    'Card payment 4234****1234 ALIEXPRESS 22,39 EUR 2026. 10. 20.',
    'no amount here',
    '08/18/2026 12.29',
    'Aug 16, 2026 6.12',
    '-12,29 18-08-2026',
  ].join('\n'));
  assert.deepEqual(p.map((x) => [x.cents, x.date]), [
    [3770, '2026-08-18'], [14973, '2026-09-09'], [123456, '2026-08-18'], [2239, '2026-10-20'],
    [null, null], [1229, '2026-08-18'], [612, '2026-08-16'], [1229, '2026-08-18'],
  ]);
  assert.equal(p[1].currency, 'EUR');
});
