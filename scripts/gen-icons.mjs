// One-off: render PWA PNG icons from public/icons/icon.svg (node scripts/gen-icons.mjs).
import sharp from "sharp";
const src = "public/icons/icon.svg";
for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["maskable-512.png", 512, 56], ["apple-touch-icon.png", 180, 0]]) {
  const inner = size - pad * 2;
  const img = await sharp(src).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: "#4f46e5" } })
    .composite([{ input: img, left: pad, top: pad }])
    .png()
    .toFile(`public/icons/${name}`);
}
console.log("icons written");
