// Chrome Web Store package: node tools/build-store.js
// -> dist/combined-invoice-for-aliexpress-<version>.zip (manifest, _locales, icons, src; no tests or tools)
//
// Before packaging it checks that:
//  - the default settings contain no company,
//  - no file contains a string from the denylist (the author's personal data). The list is outside
//    the repository: the path in ALIFA_DENYLIST, otherwise ../ali-faktura-denylist.txt next to the extension folder.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['manifest.json', '_locales', 'icons', 'src'];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const out = path.join(ROOT, 'dist', `combined-invoice-for-aliexpress-${manifest.version}.zip`);

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).sort().flatMap((name) => walk(path.posix.join(rel, name)));
  }
  return [rel];
}

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

// ---------------------------------------------------------------- checks

const files = INCLUDE.flatMap(walk);

const S = require('../src/settings.js');
for (const p of S.DEFAULTS.profiles) {
  for (const [k, v] of Object.entries(p)) if (k !== 'id' && v) fail(`the default company has a value in the field ${k}`);
}

const denyPath = process.env.ALIFA_DENYLIST || path.join(ROOT, '..', 'ali-faktura-denylist.txt');
if (fs.existsSync(denyPath)) {
  const deny = fs.readFileSync(denyPath, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'latin1') + fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const d of deny) if (text.includes(d)) fail(`${f} contains a denylisted string (${d.length} characters, line ${deny.indexOf(d) + 1} of the list)`);
  }
  console.log(`personal data check: ${files.length} files, ${deny.length} denylisted strings, OK`);
} else {
  console.warn('WARNING: denylist not found (' + denyPath + '), personal data check skipped');
}

for (const key of ['name', 'description']) {
  const m = String(manifest[key]).match(/^__MSG_(\w+)__$/);
  if (m && !fs.existsSync(path.join(ROOT, '_locales', manifest.default_locale, 'messages.json'))) fail('missing _locales for ' + key);
}

// ---------------------------------------------------------------- ZIP (deflate, UTF-8 names, "/" separators)

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// fixed time in the ZIP (2026-01-01 00:00), so the same files always give the same package
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const f of files) {
  const data = fs.readFileSync(path.join(ROOT, f));
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, comp);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + comp.length;
}
const cdSize = centrals.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${path.relative(ROOT, out)}: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(1)} kB`);
