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
    invoiceNote: '',
    // text that the "Shipped from an EU warehouse" checkbox adds to each item variant, and its remembered state
    euNote: 'EU Stock',
    euDefault: false,
    // text that the "Shipping without tracking" checkbox adds to the "Shipping and fees" line, and its remembered state
    shipNote: '(no tracking)',
    shipNoteOn: false,
    // what the invoice shows besides the items (remembers the last setting from the invoice page)
    show: { logo: true, images: false, stores: true, status: false, dates: false },
    // panel of the invoice page: 'side', 'top' or '' (on the side in wide windows, otherwise at the top), and hidden
    panel: '',
    panelHidden: false,
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
    invoiceNote: ['Compiled by the customer from AliExpress order receipts.'],
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
    merged.show = Object.assign({}, DEFAULTS.show, merged.show && typeof merged.show === 'object' ? merged.show : {});
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

  // a logo is a small PNG, JPEG or WebP data URL (options.js scales it down)
  const validLogo = (v) => typeof v === 'string' && v.length < 600000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);

  /** Settings from a backup; returns null if the file is not a backup of this extension. Unknown fields are left out. */
  function fromExport(data) {
    const s = data && data.app === EXPORT_APP && data.settings && typeof data.settings === 'object' ? data.settings : null;
    if (!s) return null;
    const out = {};
    for (const key of Object.keys(DEFAULTS)) if (s[key] !== undefined) out[key] = s[key];
    if (out.profiles !== undefined) {
      if (!Array.isArray(out.profiles) || !out.profiles.length) return null;
      out.profiles = out.profiles.map((p, i) => Object.assign({
        id: String(p.id || 'p' + (i + 1)),
        name: String(p.name || ''),
        street: String(p.street || ''),
        city: String(p.city || ''),
        country: String(p.country || ''),
        ico: String(p.ico || ''),
        dic: String(p.dic || ''),
        icdph: String(p.icdph || ''),
      }, validLogo(p.logo) ? { logo: p.logo } : {}));
    }
    return out;
  }

  const api = { DEFAULTS, load, save, KEY, toExport, fromExport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AliFaSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
