/* Extension settings (customers, supplier, invoice texts, language). Stored in chrome.storage.local. */
(function (root) {
  'use strict';

  const KEY = 'alifa.settings';
  const EXPORT_APP = 'combined-invoice-for-aliexpress';

  const DEFAULTS = {
    lang: 'en', // interface language
    invoiceLang: 'en', // invoice language, set separately from the interface
    title: 'Invoice',
    numberPrefix: 'AE',
    mode: 'detail',
    // supplier as in the official AliExpress Imprint (Legal Information / Imprint), can be changed in the settings
    supplier: [
      'Alibaba.com Singapore E-Commerce Private Limited',
      '51 Bras Basah Road, #01-21 Lazada One',
      'Singapore 189554',
      'Company Reg. No.: 200720572D',
      'www.aliexpress.com',
    ].join('\n'),
    // note at the bottom of the invoice; empty = no note
    invoiceNote: 'Compiled by the customer from AliExpress order receipts.',
    // text that the "Shipped from an EU warehouse" checkbox adds to each item variant, and its remembered state
    euNote: 'EU Stock',
    euDefault: false,
    // text that the "Shipping without tracking" checkbox adds to the "Shipping and fees" line, and its remembered state
    shipNote: '(no tracking)',
    shipNoteOn: false,
    profileId: 'p1',
    profiles: [
      { id: 'p1', name: '', street: '', city: '', country: '', ico: '', dic: '', icdph: '' },
    ],
  };

  // Defaults of older versions: if they are saved unchanged, they are replaced with the new ones.
  const LEGACY = {
    title: ['Súhrnný doklad k platbe na AliExpress'],
    supplier: ['Predajcovia na AliExpress.com\n(obchod je uvedený pri každej objednávke)'],
    euNote: ['Goods shipped from a warehouse within the EU.'],
    shipNote: ['(order tracking: no, economy shipping without tracking)'],
  };

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function storage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
  }

  async function load() {
    const st = storage();
    let saved = null;
    if (st) saved = (await st.get(KEY))[KEY] || null;
    else {
      try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    }
    const overrides = Object.assign({}, saved || {});
    for (const [field, values] of Object.entries(LEGACY)) {
      if (values.includes(overrides[field])) delete overrides[field];
    }
    const merged = Object.assign({}, DEFAULTS, overrides);
    if (!Array.isArray(merged.profiles) || !merged.profiles.length) merged.profiles = DEFAULTS.profiles;
    return merged;
  }

  /** Saves only what differs from the defaults, so that new defaults can arrive with an update. */
  async function save(settings) {
    const overrides = {};
    for (const [field, value] of Object.entries(settings)) {
      if (!same(value, DEFAULTS[field])) overrides[field] = value;
    }
    const st = storage();
    if (st) await st.set({ [KEY]: overrides });
    else localStorage.setItem(KEY, JSON.stringify(overrides));
  }

  /** Settings backup to a file (companies, texts, language). */
  function toExport(settings) {
    return { app: EXPORT_APP, version: 1, settings };
  }

  /** Settings from a backup; returns null if the file is not a backup of this extension. Unknown fields are left out. */
  function fromExport(data) {
    const s = data && data.app === EXPORT_APP && data.settings && typeof data.settings === 'object' ? data.settings : null;
    if (!s) return null;
    const out = {};
    for (const key of Object.keys(DEFAULTS)) if (s[key] !== undefined) out[key] = s[key];
    if (out.profiles !== undefined) {
      if (!Array.isArray(out.profiles) || !out.profiles.length) return null;
      out.profiles = out.profiles.map((p, i) => ({
        id: String(p.id || 'p' + (i + 1)),
        name: String(p.name || ''),
        street: String(p.street || ''),
        city: String(p.city || ''),
        country: String(p.country || ''),
        ico: String(p.ico || ''),
        dic: String(p.dic || ''),
        icdph: String(p.icdph || ''),
      }));
    }
    return out;
  }

  const api = { DEFAULTS, load, save, KEY, toExport, fromExport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AliFaSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
