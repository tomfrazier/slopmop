// Bundles scripts/tune-cli.ts with vite (so the shared TS runs as-is) and runs it on a labels export.
import { build } from "vite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = mkdtempSync(resolve(tmpdir(), "slopmop-tune-"));
await build({
  root, configFile: false, logLevel: "error",
  build: { outDir: out, emptyOutDir: true, minify: false, target: "node22", ssr: resolve(root, "scripts/tune-cli.ts"), rollupOptions: { output: { entryFileNames: "cli.mjs", format: "es" } } },
});
await import(pathToFileURL(resolve(out, "cli.mjs")).href);
