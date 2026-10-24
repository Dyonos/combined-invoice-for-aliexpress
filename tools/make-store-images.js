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
  { name: 'screenshots/1-invoice-en.png', file: '_shot-1.html', html: page('invoice.html', Object.assign({}, DEMO, { lang: 'en' })), size: '1280,800' },
  { name: 'screenshots/2-invoice-de-allocated.png', file: '_shot-2.html', html: page('invoice.html', Object.assign({}, DEMO, { lang: 'de', mode: 'allocated' })), size: '1280,800' },
  { name: 'screenshots/3-settings-en.png', file: '_shot-3.html', html: page('options.html', Object.assign({}, DEMO, { lang: 'en' })), size: '1280,800' },
  { name: 'promo-440x280.png', file: '_promo.html', html: PROMO, size: '440,280' },
];

fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
for (const job of JOBS) {
  const tmp = path.join(SRC, job.file);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alifa-shot-'));
  fs.writeFileSync(tmp, job.html);
  try {
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      `--user-data-dir=${profile}`, `--window-size=${job.size}`, '--virtual-time-budget=5000',
      `--screenshot=${path.join(OUT, job.name)}`, 'file:///' + tmp.replace(/\\/g, '/'),
    ], { stdio: 'ignore', timeout: 60000 });
    console.log('store/' + job.name);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
