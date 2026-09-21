import { build } from "vite";
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const serverUrl = process.env.SLOPMOP_SERVER_URL ?? "http://localhost:8787";
// Developer-only vote collector (`npm run collect`); empty = not built in, no permission requested.
const collectorUrl = process.env.SLOPMOP_COLLECTOR_URL ?? "";
const define = { __SERVER_URL__: JSON.stringify(serverUrl), __COLLECTOR_URL__: JSON.stringify(collectorUrl) };

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Content scripts can't use static ES imports, so each script gets its own self-contained bundle.
const script = (entry, name, format) =>
  build({
    root, configFile: false, define, logLevel: "warn",
    build: {
      outDir: dist, emptyOutDir: false, minify: false, target: "es2022",
      lib: { entry: resolve(root, entry), name, formats: [format], fileName: () => `${name}.js` },
    },
  });
await script("src/content/index.ts", "content", "iife");
await script("src/background/index.ts", "background", "es");

await build({
  root, configFile: false, define, base: "./", logLevel: "warn",
  build: { outDir: dist, emptyOutDir: false, minify: false, target: "es2022",
    // Vite adds <link rel="modulepreload" crossorigin> for shared chunks; in an extension page Chrome logs "preload ... not used
    // because it is a cross-world extension resource mismatch". The module graph loads fine without it.
    modulePreload: false,
    rollupOptions: { input: { popup: resolve(root, "popup.html"), onboarding: resolve(root, "onboarding.html"), options: resolve(root, "options.html") } } },
});

// ---- icons: the design system's mop mark (ink on transparent), rasterised from its geometry so there is no image toolchain dependency ----
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r)), dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r;
};
const inHead = (x, y) => y >= 13.6 && y <= 21.8 && x >= 5.2 + ((y - 13.6) / 8.2) * 1.6 && x <= 18.8 - ((y - 13.6) / 8.2) * 1.6;
const inBristle = (x, y) => [8.6, 12, 15.4].some((bx) => { const cy = Math.min(21.2, Math.max(16.6, y)); return (x - bx) ** 2 + (y - cy) ** 2 <= 0.575 ** 2; });
const markAt = (x, y) => (inRoundRect(x, y, 10.6, 2, 13.4, 14, 1.4) || inHead(x, y)) && !inBristle(x, y);
function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4, scale = 24 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let hit = 0, tile = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const ux = (x + (sx + 0.5) / SS) * scale, uy = (y + (sy + 0.5) / SS) * scale;
      if (inRoundRect(ux, uy, 0, 0, 24, 24, 5)) tile++;
      if (markAt(ux, uy)) hit++;
    }
    const i = (y * size + x) * 4, n = SS * SS, ink = hit / Math.max(tile, 1); // ink over a white tile
    const c = (ink0, white) => Math.round(ink0 * ink + white * (1 - ink));
    px[i] = c(0x16, 255); px[i + 1] = c(0x18, 255); px[i + 2] = c(0x1a, 255); px[i + 3] = Math.round((tile / n) * 255);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
mkdirSync(resolve(dist, "icons"), { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(resolve(dist, `icons/${s}.png`), png(s));

const origin = new URL(serverUrl).origin + "/*";
writeFileSync(resolve(dist, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "Slop Mop",
  version: "0.1.0",
  description: "Mop the slop out of your LinkedIn feed. Folds or highlights low-value posts and shows why. Not an AI detector.",
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  action: { default_title: "Slop Mop", default_popup: "popup.html", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  background: { service_worker: "background.js", type: "module" },
  content_scripts: [{ matches: ["https://www.linkedin.com/*"], js: ["content.js"], run_at: "document_idle" }],
  options_ui: { page: "options.html", open_in_tab: true },
  permissions: ["storage"],
  host_permissions: [origin, ...(collectorUrl ? [new URL(collectorUrl).origin + "/*"] : [])],
}, null, 2));
console.log(`built to ${dist} (server: ${serverUrl}, label collector: ${collectorUrl || "off"})`);
