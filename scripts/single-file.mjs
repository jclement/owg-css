// Single-file demo: inline every ../dist/ stylesheet, script and font of a demo page.
// Usage: node scripts/single-file.mjs [page.html]   (mise run single; default index.html)
// Writes dist/demo-single.html (or dist/<page>-single.html). Run `mise run build` first.
// CDN scripts (highlight.js from cdnjs, mermaid from jsDelivr) stay as pinned <script src>.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = process.argv[2] || "index.html";
const demo = join(root, "demo");
const site = "https://jclement.github.io/owg-css/";
let html = readFileSync(join(demo, page), "utf8");

// Prefer the minified sibling of a dist file when there is one.
const pick = (rel) => {
  const abs = resolve(demo, rel);
  const min = abs.replace(/(?<!\.min)\.(css|js)$/, ".min.$1");
  return existsSync(min) ? min : abs;
};

// Fonts: url(...) relative to the stylesheet becomes a data: URI.
const inlineUrls = (css, from) =>
  css.replace(/url\((["']?)([^"')]+\.woff2)\1\)/g, (_, _q, u) => {
    const f = resolve(dirname(from), u);
    if (!existsSync(f)) { console.warn(`warn: missing font ${u}`); return `url("${u}")`; }
    return `url("data:font/woff2;base64,${readFileSync(f).toString("base64")}")`;
  });

const missing = [];
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="(\.\.\/dist\/[^"]+)"[^>]*>/g, (tag, href) => {
  const f = pick(href);
  if (!existsSync(f)) { missing.push(href); return /owg-fonts/.test(href) ? tag : ""; }
  const css = inlineUrls(readFileSync(f, "utf8"), f).replace(/<\/style/gi, "<\\/style");
  return `<style data-from="${href}">\n${css}\n</style>`;
});

html = html.replace(/<script\b[^>]*src="(\.\.\/dist\/[^"]+)"[^>]*><\/script>/g, (tag, src) => {
  const f = resolve(demo, src);
  if (!existsSync(f)) { missing.push(src); return ""; }
  return `<script data-from="${src}">\n${readFileSync(f, "utf8").replace(/<\/script/gi, "<\\/script")}\n</script>`;
});

// Sibling demo pages live on GitHub Pages once this file stands alone.
html = html.replace(/href="(\.\/|(?:index|docs|plain)\.html)((?:#[^"]*)?)"/g, (_, p, hash) => `href="${site}${p === "./" ? "" : p}${hash}"`);

const name = page === "index.html" ? "demo-single.html" : page.replace(/\.html$/, "-single.html");
writeFileSync(join(root, "dist", name), html);
if (missing.length) console.warn(`warn: not found, run mise run build? ${missing.join(", ")}`);
console.log(`wrote dist/${name} (${(html.length / 1024).toFixed(1)} KB)`);
