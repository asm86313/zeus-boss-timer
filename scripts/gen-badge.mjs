// Generates a monochrome (white-on-transparent) skull-silhouette badge icon
// for push notifications. Android renders the notification "badge" (small
// status-bar icon) using ONLY the alpha channel — any full-color opaque
// image (like our character portrait) just becomes a solid white square.
// This needs real transparency so only the skull shape shows.
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const svg = `
<svg width="192" height="192" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" fill="#ffffff" d="
    M48 4
    C70.7 4 89 21.3 89 43
    C89 58.5 80.2 71.8 67.3 78.4
    L67.3 86
    C67.3 89.9 64.1 93 60.3 93
    C56.9 93 54.1 90.6 53.4 87.4
    C52.2 88 50.7 88.3 49.2 88.3
    L46.8 88.3
    C45.3 88.3 43.8 88 42.6 87.4
    C41.9 90.6 39.1 93 35.7 93
    C31.9 93 28.7 89.9 28.7 86
    L28.7 78.4
    C15.8 71.8 7 58.5 7 43
    C7 21.3 25.3 4 48 4
    Z
    M32 36
    C25.9 36 21 40.9 21 47
    C21 53.1 25.9 58 32 58
    C38.1 58 43 53.1 43 47
    C43 40.9 38.1 36 32 36
    Z
    M64 36
    C57.9 36 53 40.9 53 47
    C53 53.1 57.9 58 64 58
    C70.1 58 75 53.1 75 47
    C75 40.9 70.1 36 64 36
    Z
  "/>
  <path fill="#ffffff" d="M44 62 L52 62 L52 68 C52 71 49.8 73 47 73 C44.7 73 44 71 44 68 Z"/>
</svg>
`;

await sharp(Buffer.from(svg)).resize(192, 192).png().toFile(join(outDir, "badge-mono.png"));
await sharp(Buffer.from(svg)).resize(96, 96).png().toFile(join(outDir, "badge-mono-96.png"));

console.log("배지 아이콘 생성 완료 ->", outDir);
