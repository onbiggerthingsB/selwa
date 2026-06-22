// Generates the PWA icons (white medical cross on navy) with zero dependencies.
// Run: node scripts/generate-icons.mjs   → writes public/icon-192x192.png, icon-512x512.png, apple-touch-icon.png
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x0f, 0x17, 0x2a, 0xff]; // navy
const FG = [0xff, 0xff, 0xff, 0xff]; // white

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const arm = Math.round(size * 0.22); // half-thickness of the cross arm
  const reach = Math.round(size * 0.32); // how far the cross extends from center
  const cx = size / 2;
  const cy = size / 2;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const inVert = Math.abs(x - cx) <= arm && Math.abs(y - cy) <= reach;
      const inHorz = Math.abs(y - cy) <= arm && Math.abs(x - cx) <= reach;
      const px = inVert || inHorz ? FG : BG;
      raw[p++] = px[0];
      raw[p++] = px[1];
      raw[p++] = px[2];
      raw[p++] = px[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192x192.png', makePng(192));
writeFileSync('public/icon-512x512.png', makePng(512));
writeFileSync('public/apple-touch-icon.png', makePng(180));
console.log('wrote public/icon-192x192.png, public/icon-512x512.png, public/apple-touch-icon.png');
