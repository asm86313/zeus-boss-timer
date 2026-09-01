// Generates the PWA icon PNGs from a source photo/art file.
// Usage: node scripts/make-icons-from-photo.mjs <source-image> [cropX] [cropY]
//   cropX/cropY: top-left offset (px, in source-image coordinates) of the
//   square crop window. Defaults to a centered crop.
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const src = process.argv[2];
if (!src) {
  console.error("Usage: node scripts/make-icons-from-photo.mjs <source-image> [cropX] [cropY]");
  process.exit(1);
}

const NAVY = { r: 15, g: 18, b: 32, alpha: 1 };

async function main() {
  const img = sharp(src);
  const meta = await img.metadata();
  const side = Math.min(meta.width, meta.height);
  const defaultX = Math.round((meta.width - side) / 2);
  const defaultY = Math.round((meta.height - side) / 2);
  const cropX = process.argv[3] !== undefined ? Number(process.argv[3]) : defaultX;
  const cropY = process.argv[4] !== undefined ? Number(process.argv[4]) : defaultY;

  const squareBuf = await sharp(src)
    .extract({ left: cropX, top: cropY, width: side, height: side })
    .toBuffer();

  await sharp(squareBuf).resize(512, 512).png().toFile(join(outDir, "icon-512.png"));
  await sharp(squareBuf).resize(192, 192).png().toFile(join(outDir, "icon-192.png"));

  // Maskable: keep content within the ~80% safe zone on a solid backdrop,
  // since OS icon masks (circle, squircle, ...) can crop right to the edge.
  const inset = Math.round(512 * 0.8);
  const insetImg = await sharp(squareBuf).resize(inset, inset).toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: NAVY } })
    .composite([{ input: insetImg, gravity: "center" }])
    .png()
    .toFile(join(outDir, "icon-maskable-512.png"));

  console.log(`아이콘 생성 완료 (crop ${side}x${side} at ${cropX},${cropY}) ->`, outDir);
}

main();
