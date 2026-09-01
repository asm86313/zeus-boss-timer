// Generates the PWA icon PNGs with zero dependencies (hand-rolled PNG
// encoder using Node's built-in zlib). Simple design: navy background,
// centered gold circle — swap these files for a real logo anytime.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const NAVY = [15, 18, 32]; // #0f1220
const GOLD = [227, 181, 61]; // #e3b53d

function makePng(size, { radiusRatio }) {
  const width = size, height = size;
  const cx = width / 2, cy = height / 2;
  const r = size * radiusRatio;
  const raw = Buffer.alloc(height * (1 + width * 4)); // filter byte + RGBA per row

  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const inCircle = dx * dx + dy * dy <= r * r;
      const [rr, gg, bb] = inCircle ? GOLD : NAVY;
      raw[pos++] = rr;
      raw[pos++] = gg;
      raw[pos++] = bb;
      raw[pos++] = 255;
    }
  }

  const idatData = deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeData) >>> 0, 0);
    return Buffer.concat([len, typeData, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

writeFileSync(join(outDir, "icon-192.png"), makePng(192, { radiusRatio: 0.36 }));
writeFileSync(join(outDir, "icon-512.png"), makePng(512, { radiusRatio: 0.36 }));
// maskable needs extra safe-zone padding (content within the inner ~80%)
writeFileSync(join(outDir, "icon-maskable-512.png"), makePng(512, { radiusRatio: 0.3 }));

console.log("icons written to", outDir);
