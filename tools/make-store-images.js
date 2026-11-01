// Chrome Web Store screenshots with made-up data: node tools/make-store-images.js
// -> store/screenshots/*.png (1280 x 800) and store/promo-440x280.png
// Needs Google Chrome (CHROME_PATH or the default path on Windows). Opens the extension pages
// in preview mode (test/fixtures) with the settings put into localStorage.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'store');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const DEMO = {
  profileId: 'demo',
  profiles: [
    { id: 'demo', name: 'Example Trading s.r.o.', street: 'Hlavná 1', city: '811 01 Bratislava', country: 'Slovakia', ico: '12345678', dic: '2020123456', icdph: 'SK2020123456' },
    { id: 'demo2', name: 'Sample Workshop Ltd.', street: '12 Market Street', city: 'Leeds LS1 6DT', country: 'United Kingdom', ico: '01234567', dic: '', icdph: 'GB123456789' },
  ],
  shipNoteOn: true,
};

function page(file, settings) {
  const html = fs.readFileSync(path.join(SRC, file), 'utf8').replace(
    '<script src="settings.js"></script>',
    `<script>localStorage.setItem('alifa.settings', ${JSON.stringify(JSON.stringify(settings))}); window.ALIFA_VERSION = ${JSON.stringify(VERSION)};</script>\n  <script src="settings.js"></script>`,
  );
  return html;
}

// "My orders" page with made-up orders. The extension's own checkboxes and panel are drawn on it:
// the three orders of one card payment (the ones on the invoice screenshot) are ticked and the bank amount is filled in.
const ORDERS = [
  { id: '1000000000030001', status: 'Awaiting delivery', date: 'Aug 21, 2026', store: 'Example Garden Store', title: 'Hose quick connector set, 1/2 inch', variant: '4PCS', price: '€6.84', qty: 1, total: '€8.47', icon: '🚿' },
  { id: '1000000000010001', status: 'Completed', date: 'Aug 16, 2026', store: 'Example Tools Store', title: 'Screwdriver bit set, 24 pcs, magnetic', variant: 'Set A', price: '€8.16', qty: 1, total: '€12.29', icon: '🔧', pick: true },
  { id: '1000000000010002', status: 'Completed', date: 'Aug 16, 2026', store: 'Example Parts Store', title: 'Water tank float replacement for robot vacuum, 6 pcs', variant: 'Transparent White', price: '€8.31', qty: 1, total: '€11.21', icon: '💧', pick: true },
  { id: '1000000000010003', status: 'Completed', date: 'Aug 16, 2026', store: 'Example Battery Store', title: 'Nickel strip for 18650 battery welding', variant: '18650 0.15x23x18.5mm,2M', price: '€3.38', qty: 3, total: '€14.20', icon: '🔋', pick: true },
  { id: '1000000000030002', status: 'Completed', date: 'Aug 9, 2026', store: 'Example Light Store', title: 'LED strip 5V USB, warm white, 2 m', variant: '2M', price: '€4.59', qty: 1, total: '€6.12', icon: '💡' },
];

// Several payments at once: three payments from a bank statement, each matched to its orders above.
const BATCH_DEMO = {
  text: '8.47 23.08.2026\n37.70 18.08.2026\n6.12 11.08.2026',
  items: [
    { line: '8.47 23.08.2026', cents: 847, currency: null, date: '2026-08-23', status: 'found', foundDate: '2026-08-21',
      orders: [{ id: '1000000000030001', cents: 847, currency: 'EUR', date: '2026-08-21', store: 'Example Garden Store' }] },
    { line: '37.70 18.08.2026', cents: 3770, currency: null, date: '2026-08-18', status: 'found', foundDate: '2026-08-16',
      orders: [
        { id: '1000000000010001', cents: 1229, currency: 'EUR', date: '2026-08-16', store: 'Example Tools Store' },
        { id: '1000000000010002', cents: 1121, currency: 'EUR', date: '2026-08-16', store: 'Example Parts Store' },
        { id: '1000000000010003', cents: 1420, currency: 'EUR', date: '2026-08-16', store: 'Example Battery Store' },
      ] },
    { line: '6.12 11.08.2026', cents: 612, currency: null, date: '2026-08-11', status: 'found', foundDate: '2026-08-09',
      orders: [{ id: '1000000000030002', cents: 612, currency: 'EUR', date: '2026-08-09', store: 'Example Light Store' }] },
  ],
};

function ordersPage(settings, orders = ORDERS, bankCents = 3770, batch = null) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const selection = { orders: orders.filter((o) => o.pick).map((o) => ({ id: o.id })), extra: [], bankCents, bankDate: null };
  const cards = orders.map((o) => `
  <div class="order-item">
    <div class="order-item-header">
      <span class="order-item-header-status-text">${esc(o.status)}</span>
      <div class="order-item-header-right-info"><div>Order date: ${esc(o.date)}</div><div>Order ID: ${esc(o.id)}</div></div>
      <a class="details" href="https://www.aliexpress.com/p/order/detail.html?orderId=${esc(o.id)}">Order details &rsaquo;</a>
    </div>
    <div class="order-item-content">
      <div class="thumb">${o.icon}</div>
      <div class="info">
        <div class="store"><span class="order-item-store-name">${esc(o.store)}</span> &rsaquo;</div>
        <div class="title">${esc(o.title)}</div>
        <div class="variant">${esc(o.variant)} &nbsp;·&nbsp; ${esc(o.price)} x${o.qty}</div>
      </div>
      <div class="order-item-content-opt">
        <div class="order-item-content-opt-price-total">Total: ${esc(o.total)}</div>
        <span class="btn">Add to cart</span>
      </div>
    </div>
  </div>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>My orders</title>
<link rel="stylesheet" href="orders.css">
<style>
  html, body { margin: 0; }
  body { background: #f2f3f5; color: #191919; font: 14px/1.4 "Segoe UI", Roboto, Arial, sans-serif; }
  .top { display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 40px; background: #fff; border-bottom: 1px solid #e6e6e6; color: #666; }
  .top b { color: #191919; }
  .wrap { width: 860px; margin: 16px 0 0 40px; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .tabs { display: flex; gap: 26px; margin-bottom: 12px; border-bottom: 1px solid #e3e3e3; color: #666; }
  .tabs span { padding-bottom: 9px; }
  .tabs .on { color: #191919; font-weight: 600; border-bottom: 3px solid #191919; }
  .order-item { margin-bottom: 10px; background: #fff; border-radius: 10px; }
  .order-item-header { display: flex; align-items: center; gap: 18px; padding: 9px 16px; border-bottom: 1px solid #f0f0f0; }
  .order-item-header-status-text { min-width: 140px; font-size: 15px; font-weight: 700; }
  .order-item-header-right-info { color: #666; font-size: 12.5px; line-height: 17px; }
  .details { margin-left: auto; color: #191919; font-size: 13px; text-decoration: none; }
  .order-item-content { display: flex; align-items: center; gap: 14px; padding: 10px 16px; }
  .thumb { display: grid; flex: none; place-items: center; width: 56px; height: 56px; border-radius: 8px; background: #f4f4f4; font-size: 28px; }
  .info { flex: 1; min-width: 0; }
  .store { color: #555; font-size: 12.5px; font-weight: 600; }
  .title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .variant { color: #888; font-size: 12.5px; }
  .order-item-content-opt { flex: none; min-width: 160px; text-align: right; }
  .order-item-content-opt-price-total { font-size: 15px; font-weight: 700; }
  .btn { display: inline-block; margin-top: 6px; padding: 4px 14px; border: 1px solid #d0d0d0; border-radius: 16px; color: #333; font-size: 12.5px; }
</style>
<script>
  localStorage.setItem('alifa.settings', ${JSON.stringify(JSON.stringify(settings))});
  sessionStorage.setItem('alifa.selection', ${JSON.stringify(JSON.stringify(selection))});
  ${batch ? `sessionStorage.setItem('alifa.batch', ${JSON.stringify(JSON.stringify(batch))});` : ''}
  window.chrome = window.chrome || {};
  window.chrome.runtime = { getManifest: () => ({ version: ${JSON.stringify(VERSION)} }) };
</script>
</head><body>
<div class="top">Account &rsaquo; <b>My orders</b></div>
<div class="wrap">
  <h1>My orders</h1>
  <div class="tabs"><span class="on">View all</span><span>To pay</span><span>To ship</span><span>Shipped</span><span>Processed</span></div>
  ${cards}
</div>
<script src="core.js"></script>
<script src="settings.js"></script>
<script src="i18n.js"></script>
<script src="orders.js"></script>
${batch ? "<script>setTimeout(() => { const p = document.getElementById('alifa-panel'); if (p) p.scrollTop = p.scrollHeight; }, 1500);</script>" : ''}
</body></html>`;
}

const PROMO = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body { display: flex; align-items: center; gap: 22px; padding: 0 30px; box-sizing: border-box;
    background: linear-gradient(135deg, #e62e04, #ff6a3d); color: #fff; font-family: "Segoe UI", Roboto, Arial, sans-serif; }
  img { width: 104px; height: 104px; flex: none; filter: drop-shadow(0 6px 14px rgba(0,0,0,.25)); }
  h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.05; font-weight: 800; }
  h2 { margin: 0 0 12px; font-size: 17px; font-weight: 600; opacity: .95; }
  p { margin: 0; font-size: 14px; line-height: 1.35; opacity: .95; }
</style></head><body>
  <img src="../icons/icon128.png" alt="">
  <div><h1>Combined Invoice</h1><h2>for AliExpress</h2><p>One invoice for one bank payment.<br>The total matches to the cent.</p></div>
</body></html>`;

const JOBS = [
  { name: 'screenshots/1-orders-en.png', file: '_shot-1.html', html: ordersPage(Object.assign({}, DEMO, { lang: 'en' })), size: '1280,800' },
  { name: 'screenshots/2-invoice-en.png', file: '_shot-2.html', html: page('invoice.html', Object.assign({}, DEMO, { lang: 'en' })), size: '1280,800' },
  { name: 'screenshots/3-invoice-de-allocated.png', file: '_shot-3.html', html: page('invoice.html', Object.assign({}, DEMO, { lang: 'de', invoiceLang: 'de', mode: 'allocated' })), size: '1280,800' },
  { name: 'screenshots/4-settings-en.png', file: '_shot-4.html', html: page('options.html', Object.assign({}, DEMO, { lang: 'en' })), size: '1280,800' },
  { name: 'screenshots/5-batch-en.png', file: '_shot-5.html', html: ordersPage(Object.assign({}, DEMO, { lang: 'en' }), ORDERS.map((o) => Object.assign({}, o, { pick: false })), null, BATCH_DEMO), size: '1280,800' },
  { name: 'promo-440x280.png', file: '_promo.html', html: PROMO, size: '440,280' },
];

/** Renders html (written as src/<file>, so relative paths work) to a PNG with headless Chrome. */
function shoot(html, file, size, outFile) {
  const tmp = path.join(SRC, file);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alifa-shot-'));
  fs.writeFileSync(tmp, html);
  try {
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      '--lang=en-GB', // date fields and other browser texts in English, whatever the system language
      `--user-data-dir=${profile}`, `--window-size=${size}`, '--virtual-time-budget=5000',
      `--screenshot=${outFile}`, 'file:///' + tmp.replace(/\\/g, '/'),
    ], { stdio: 'ignore', timeout: 60000 });
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (require.main === module) {
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  for (const job of JOBS) {
    shoot(job.html, job.file, job.size, path.join(OUT, job.name));
    console.log('store/' + job.name);
  }
}

module.exports = { DEMO, ORDERS, ordersPage, page, shoot };
