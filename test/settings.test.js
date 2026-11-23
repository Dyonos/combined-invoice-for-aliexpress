'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/settings.js');

test('the default settings contain no company (public version)', () => {
  assert.equal(S.DEFAULTS.profiles.length, 1);
  for (const [k, v] of Object.entries(S.DEFAULTS.profiles[0])) if (k !== 'id') assert.equal(v, '', k);
  assert.equal(S.DEFAULTS.lang, 'en');
  assert.equal(S.DEFAULTS.euDefault, false);
});

test('settings backup: export and import', () => {
  const settings = Object.assign({}, S.DEFAULTS, {
    lang: 'sk',
    profileId: 'a',
    profiles: [{ id: 'a', name: 'Company A', street: 'Street 1', city: '00000 City', country: 'Slovakia', ico: '1', dic: '2', icdph: 'SK2' }],
    invoiceNote: '',
  });
  const file = JSON.parse(JSON.stringify(S.toExport(settings)));
  const back = S.fromExport(file);
  assert.equal(back.lang, 'sk');
  assert.equal(back.invoiceNote, '');
  assert.deepEqual(back.profiles, settings.profiles);

  // a foreign file or empty companies are rejected, unknown fields are left out
  assert.equal(S.fromExport({ app: 'other-app', settings: {} }), null);
  assert.equal(S.fromExport({ app: 'combined-invoice-for-aliexpress', settings: { profiles: [] } }), null);
  const partial = S.fromExport({ app: 'combined-invoice-for-aliexpress', settings: { euDefault: true, hack: 1, profiles: [{ name: 'X' }] } });
  assert.deepEqual(Object.keys(partial).sort(), ['euDefault', 'profiles']);
  assert.equal(partial.profiles[0].id, 'p1');
  assert.equal(partial.profiles[0].ico, '');
});

test('settings backup keeps a valid logo and drops anything else', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  const back = S.fromExport({ app: 'combined-invoice-for-aliexpress', settings: { profiles: [
    { id: 'a', name: 'A', logo },
    { id: 'b', name: 'B', logo: 'javascript:alert(1)' },
  ] } });
  assert.equal(back.profiles[0].logo, logo);
  assert.equal(back.profiles[1].logo, undefined);
  assert.equal(S.DEFAULTS.invoiceNote, '');
});
