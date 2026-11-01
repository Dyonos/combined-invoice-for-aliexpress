'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/i18n.js');

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every language has all texts and the same placeholders as English', () => {
  const en = I.STRINGS.en;
  assert.equal(I.LANGS.length, 17);
  for (const { code } of I.LANGS) {
    const d = I.STRINGS[code];
    assert.ok(d, 'missing language ' + code);
    assert.deepEqual(Object.keys(d).sort(), Object.keys(en).sort(), 'keys in ' + code);
    for (const [key, value] of Object.entries(en)) {
      if (typeof value === 'object') {
        assert.ok(d[key].other, `${code}.${key}: missing the other form`);
        for (const [form, s] of Object.entries(d[key])) assert.ok(s.includes('{n}'), `${code}.${key}.${form} without {n}`);
      } else {
        assert.equal(placeholders(d[key]), placeholders(value), `${code}.${key}: different placeholders`);
        assert.ok(d[key].trim(), `${code}.${key} is empty`);
      }
    }
  }
  for (const code of ['sk', 'cs', 'hu', 'pl']) assert.ok(I.LANGS.some((l) => l.code === code), code);
});

test('warning codes from the calculations and error codes from the bridge are translated', () => {
  const codes = ['noSubtotal', 'noTotal', 'pennyShipping', 'signFlip', 'residual', 'refund', 'refundUnknown', 'mixedCurrency', 'multipleDays'];
  for (const c of codes) assert.ok(I.STRINGS.en['w.' + c], 'w.' + c);
  for (const c of ['noMtop', 'login', 'captcha', 'badId', 'empty']) assert.ok(I.STRINGS.en['err.' + c], 'err.' + c);
  // core.js uses only these codes
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'core.js'), 'utf8');
  for (const m of src.matchAll(/code: '(\w+)'/g)) assert.ok(codes.includes(m[1]), 'unknown code ' + m[1]);
});

test('plurals by language', () => {
  I.setLang('sk');
  assert.equal(I.plural(1, 'plural.orders'), '1 objednávka');
  assert.equal(I.plural(3, 'plural.orders'), '3 objednávky');
  assert.equal(I.plural(7, 'plural.orders'), '7 objednávok');
  assert.equal(I.plural(2, 'plural.daysBefore'), '2 dni pred zadaným dátumom');
  I.setLang('pl');
  assert.equal(I.plural(3, 'plural.orders'), '3 zamówienia');
  assert.equal(I.plural(5, 'plural.orders'), '5 zamówień');
  assert.equal(I.plural(22, 'plural.orders'), '22 zamówienia');
  I.setLang('ru');
  assert.equal(I.plural(1, 'plural.orders'), '1 заказ');
  assert.equal(I.plural(3, 'plural.orders'), '3 заказа');
  assert.equal(I.plural(7, 'plural.orders'), '7 заказов');
  assert.equal(I.plural(21, 'plural.orders'), '21 заказ');
  I.setLang('en');
  assert.equal(I.plural(1, 'plural.orders'), '1 order');
  assert.equal(I.plural(2, 'plural.orders'), '2 orders');
});

test('texts with parameters, amount and date by language', () => {
  I.setLang('en');
  assert.equal(I.t('st.loadingReceipt', { i: 1, n: 3 }), 'Loading receipt 1 of 3…');
  assert.equal(I.money(3770), '€37.70');
  assert.equal(I.date('2026-08-16'), '16/08/2026');
  I.setLang('sk');
  assert.equal(I.money(3770).replace(/\s/g, ' '), '37,70 €');
  assert.equal(I.date('2026-08-16').replace(/\s/g, ' '), '16. 8. 2026');
  assert.equal(I.t('neexistuje.kluc'), 'neexistuje.kluc');
  I.setLang('xx');
  assert.equal(I.lang(), 'en');
});

test('currency symbol next to amount fields', () => {
  I.setLang('pl');
  assert.equal(I.currencySymbol('PLN'), 'zł');
  I.setLang('en');
  assert.equal(I.currencySymbol('EUR'), '€');
  assert.equal(I.currencySymbol(null), '€');
});

test('invoice language helpers', () => {
  assert.equal(I.tIn('en', 'doc.invoice'), 'Invoice');
  assert.equal(I.pluralIn('en', 1, 'doc.pcs'), '1 pc');
  assert.equal(I.pluralIn('en', 3, 'doc.pcs'), '3 pcs');
  assert.equal(I.dateIn('en', '2026-08-16', { dateStyle: 'medium' }), '16 Aug 2026');
  assert.equal(I.moneyIn('en', 123456, 'EUR'), '€1,234.56');
  assert.equal(I.unitIn('en', 1000, 3, 'EUR'), '€3.3333');
});

test('amount field in the number format of the interface language', () => {
  I.setLang('sk');
  assert.equal(I.amount(3770), '37,70');
  I.setLang('ja');
  assert.equal(I.amount(3770), '37.70');
  I.setLang('en');
  assert.equal(I.amount(123456), '1234.56');
});
