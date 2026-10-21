// Draws the app icon (a tunnel arch on a dark rounded square) and writes
// desktop/assets/icon.png and a multi-size desktop/assets/icon.ico.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'desktop', 'assets');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 4;

const BG = [15, 23, 42]; // slate-900
const ARCH = [255, 255, 255];
const LIGHT = [56, 189, 248]; // sky-400

// Colour of the point (x, y) in a unit square, or null for transparent.
function shade(x, y) {
  const r = 0.2;
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  if (dx * dx + dy * dy > r * r) return null;

  const cx = 0.5, cy = 0.5, outer = 0.32, inner = 0.19, base = 0.8;
  const dist = Math.hypot(x - cx, y - cy);
  const inArch = y <= cy ? dist <= outer && dist >= inner : y <= base && Math.abs(x - cx) <= outer && Math.abs(x - cx) >= inner;
  if (inArch) return ARCH;
  const inOpening = y <= cy ? dist < inner : y <= base && Math.abs(x - cx) < inner;
  if (inOpening && y > 0.52) return LIGHT;
  return BG;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const c = shade((pxl + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size);
          if (!c) continue;
          rr += c[0]; gg += c[1]; bb += c[2]; aa += 1;
        }
      }
      const i = (py * size + pxl) * 4;
      if (aa) {
        px[i] = Math.round(rr / aa);
        px[i + 1] = Math.round(gg / aa);
        px[i + 2] = Math.round(bb / aa);
      }
      px[i + 3] = Math.round((aa / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
    }
  }
  return encodePng(size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO files may embed PNG images directly (supported since Windows Vista).
function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((img) => img.png)]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const images = ICO_SIZES.map((size) => ({ size, png: render(size) }));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images.at(-1).png);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(images));
console.log(`Wrote icon.png and icon.ico to ${OUT_DIR}`);
