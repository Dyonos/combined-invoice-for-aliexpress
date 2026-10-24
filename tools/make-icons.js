// Generates the extension icons (PNG) without external libraries: node tools/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RED = [230, 46, 4];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Returns the colour of a point in unit coordinates 0..1, or null (transparent).
function shade(u, v) {
  if (!inRoundRect(u, v, 0, 0, 1, 1, 0.22)) return null;
  if (inRoundRect(u, v, 0.26, 0.15, 0.74, 0.85, 0.06)) {
    const bars = [[0.33, 0.66], [0.46, 0.66], [0.59, 0.56]];
    for (const [y, xEnd] of bars) {
      if (inRoundRect(u, v, 0.34, y - 0.035, xEnd, y + 0.035, 0.035)) return RED;
    }
    if (inRoundRect(u, v, 0.34, 0.70, 0.50, 0.76, 0.03)) return RED;
    return WHITE;
  }
  return RED;
}

function render(size, inset = 0) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const inner = size - 2 * inset;
          const c = shade((x - inset + (sx + 0.5) / ss) / inner, (y - inset + (sy + 0.5) / ss) / inner);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, out);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), render(size));
  console.log('icons/icon' + size + '.png');
}

// Chrome Web Store icon: 128 x 128, 96 x 96 artwork with a 16 px transparent margin
const storeDir = path.join(__dirname, '..', 'store');
fs.mkdirSync(storeDir, { recursive: true });
fs.writeFileSync(path.join(storeDir, 'icon-store-128.png'), render(128, 16));
console.log('store/icon-store-128.png');
