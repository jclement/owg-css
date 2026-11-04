// Screenshots: render the demo pages with Playwright into docs/screenshots/*.png.
// Usage: node scripts/screenshots.mjs [--out dir] [name ...]   (mise run screenshots)
// Run `mise run build` first: the demo loads ../dist/. CDN scripts (highlight.js, mermaid)
// are used when the network allows; shots are still taken without them.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : join(root, "docs/screenshots");
const only = new Set(args);
mkdirSync(out, { recursive: true });

const VARIANTS = ["default", "amber", "phosphor", "slate", "contrast", "doom", "hotdog"];
const url = (page, hash = "") => pathToFileURL(join(root, "demo", page)).href + hash;

const browser = await chromium.launch();

// Open a page in a given theme/variant, wait for fonts, highlighting and diagrams to settle.
async function open({ page = "index.html", hash = "", theme = "light", variant = "default", width = 1440, height = 900, scale = 1 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme, reducedMotion: "reduce" });
  // owg-theme.js picks the choice up from localStorage before paint; pages without it
  // (plain.html) get the attributes set right after load.
  await ctx.addInitScript(([t, v]) => {
    try { localStorage.setItem("owg-theme", t); localStorage.setItem("owg-variant", v); } catch (e) {}
  }, [theme, variant]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.warn(`warn ${page}: ${e.message}`));
  await p.goto(url(page, hash), { waitUntil: "load", timeout: 30000 }).catch((e) => console.warn(`warn ${page}: ${e.message}`));
  await p.evaluate(([t, v]) => {
    const el = document.documentElement;
    if (el.getAttribute("data-theme") !== t) el.setAttribute("data-theme", t);
    if (v === "default") el.removeAttribute("data-variant"); else if (el.getAttribute("data-variant") !== v) el.setAttribute("data-variant", v);
  }, [theme, variant]);
  await p.evaluate(() => document.fonts.ready);
  // Mermaid renders async; give it a moment if the page has diagrams and mermaid loaded.
  await p.waitForFunction(() => !document.querySelector(".mermaid") || document.querySelector(".mermaid svg"), null, { timeout: 15000 }).catch(() => console.warn(`warn ${page}: mermaid did not render (offline?)`));
  await p.waitForTimeout(300);
  return { p, ctx };
}

async function shot(name, opts, { fullPage = false } = {}) {
  if (only.size && !only.has(name) && !only.has(name.split("-")[0])) return null;
  const { p, ctx } = await open(opts);
  const file = join(out, `${name}.png`);
  await p.screenshot({ path: file, fullPage });
  await ctx.close();
  console.log(`shot ${file}`);
  return file;
}

await shot("index-light", { theme: "light" });
await shot("index-dark", { theme: "dark" });
await shot("docs-light", { page: "docs.html", theme: "light" });
await shot("docs-dark", { page: "docs.html", theme: "dark" });
await shot("plain-light", { page: "plain.html", theme: "light", width: 1100, height: 800 });
await shot("hotdog", { theme: "light", variant: "hotdog" });
await shot("hotdog-dark", { theme: "dark", variant: "hotdog" });

const phone = { width: 390, height: 844, scale: 2 };
await shot("phone-light", { ...phone, theme: "light" });
await shot("phone-dark", { ...phone, theme: "dark" });
await shot("phone-drawer", { ...phone, theme: "dark", hash: "#sidebar" });

// Variant grid: the same crop of the kitchen sink in every variant, light and dark side by side.
if (!only.size || only.has("variants")) {
  const tiles = [];
  for (const v of VARIANTS) {
    for (const t of ["light", "dark"]) {
      const { p, ctx } = await open({ theme: t, variant: v, width: 1100, height: 660 });
      tiles.push({ v, t, png: (await p.screenshot()).toString("base64") });
      await ctx.close();
    }
  }
  const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(join(root, "dist/owg-fonts.css")).href}">
<link rel="stylesheet" href="${pathToFileURL(join(root, "dist/owg.css")).href}">
<style>body{margin:0;padding:24px;background:var(--owg-bg)}
.g{display:grid;grid-template-columns:1fr 1fr;gap:20px 16px}
figure{margin:0}img{display:block;width:100%;border:1px solid var(--owg-border-strong);border-radius:var(--owg-radius)}
figcaption{font-size:var(--owg-text-sm);color:var(--owg-muted);padding:0 0 6px}figcaption b{color:var(--owg-accent)}</style>
</head><body><div class="g">${tiles.map((x) => `<figure><figcaption><b>//</b> ${x.v} · ${x.t}</figcaption><img src="data:image/png;base64,${x.png}"></figure>`).join("")}</div></body></html>`;
  const tmp = join(tmpdir(), `owg-variants-${process.pid}.html`);
  writeFileSync(tmp, html);
  const ctx = await browser.newContext({ viewport: { width: 1140, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(out, "variants.png"), fullPage: true });
  await ctx.close();
  rmSync(tmp, { force: true });
  console.log(`shot ${join(out, "variants.png")}`);
}

await browser.close();
