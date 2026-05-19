/**
 * Dashboard build script — bundles the SPA using Bun's native bundler.
 * Outputs to dashboard/dist/assets/:
 *   - app.js     (bundled + minified dashboard SPA)
 *   - app.css    (copied from source)
 *   - vendor-uplot.css   (from uplot npm package)
 *   - vendor-hljs.css    (highlight.js github-dark theme)
 */

import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const outDir = join(root, "dist", "assets");

await mkdir(outDir, { recursive: true });

// 1. Bundle the dashboard SPA with Bun's built-in bundler
console.log("Bundling dashboard JS...");
const result = await Bun.build({
  entrypoints: [join(root, "app.js")],
  outdir: outDir,
  minify: true,
  target: "browser",
  format: "esm",
  sourcemap: "none",
  // Bundle all dependencies inline (no code splitting for simpler serving)
  splitting: false,
});

if (!result.success) {
  for (const msg of result.logs) {
    console.error(msg);
  }
  process.exit(1);
}
console.log(`  → ${outDir}/app.js`);

// 2. Copy dashboard CSS
await copyFile(join(root, "app.css"), join(outDir, "app.css"));
console.log(`  → ${outDir}/app.css`);

// 3. Copy vendor-uplot.css from uplot package
const uplotCssCandidates = [
  join(root, "node_modules", "uplot", "dist", "uPlot.min.css"),
  join(root, "node_modules", "uplot", "dist", "uplot.min.css"),
  join(root, "..", "node_modules", "uplot", "dist", "uPlot.min.css"),
  join(root, "..", "node_modules", "uplot", "dist", "uplot.min.css"),
];
const uplotCss = uplotCssCandidates.find(existsSync);
if (uplotCss) {
  await copyFile(uplotCss, join(outDir, "vendor-uplot.css"));
  console.log(`  → ${outDir}/vendor-uplot.css`);
} else {
  // Write an empty fallback so the HTML reference doesn't 404
  await writeFile(join(outDir, "vendor-uplot.css"), "/* uplot css not found */\n");
  console.warn("  Warning: uplot CSS not found, writing empty placeholder");
}

// 4. Copy vendor-hljs.css (github-dark theme) from highlight.js package
const hljsCssCandidates = [
  join(root, "node_modules", "highlight.js", "styles", "github-dark.min.css"),
  join(root, "node_modules", "highlight.js", "styles", "github-dark.css"),
  join(root, "..", "node_modules", "highlight.js", "styles", "github-dark.min.css"),
  join(root, "..", "node_modules", "highlight.js", "styles", "github-dark.css"),
];
const hljsCss = hljsCssCandidates.find(existsSync);
if (hljsCss) {
  await copyFile(hljsCss, join(outDir, "vendor-hljs.css"));
  console.log(`  → ${outDir}/vendor-hljs.css`);
} else {
  await writeFile(join(outDir, "vendor-hljs.css"), "/* highlight.js css not found */\n");
  console.warn("  Warning: highlight.js CSS not found, writing empty placeholder");
}

console.log("Dashboard build complete.");
