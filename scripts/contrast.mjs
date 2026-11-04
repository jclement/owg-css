// Contrast check: every text/background pair that matters, in every theme x variant, >= 4.5:1.
// Loads dist/owg.css in headless Chromium, reads computed colours from real elements (so
// color-mix() and translucent backgrounds are resolved by the browser), prints a table and
// exits 1 on any failure.
// Usage: node scripts/contrast.mjs [--all]   (--all prints every row, not just rows with a failure)
import { chromium } from "playwright";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = join(root, "dist", "owg.css");
if (!existsSync(css)) {
  console.error("contrast: dist/owg.css not found; run `mise run build` first");
  process.exit(2);
}
const showAll = process.argv.includes("--all");
const MIN = 4.5;
const THEMES = ["light", "dark"];
const VARIANTS = [null, "amber", "phosphor", "slate", "contrast", "doom", "hotdog"];
const PALETTE = ["blue", "green", "amber", "red", "purple", "pink", "cyan"];
const CALLOUTS = ["note", "tip", "important", "warning", "danger"];
const ALERTS = ["note", "tip", "important", "warning", "caution"];

// The page: real components (so their computed colours are what users see) plus a probe.
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(css).href}"></head><body>
<header><a href="#">site<span>://</span>x</a><nav><a href="#">link</a></nav></header>
<main>
${["", ...PALETTE, "accent"].map((c) => `<span class="badge ${c}" data-k="badge ${c || "neutral"}">b</span>`).join("")}
${["", ...PALETTE, "accent"].map((c) => `<span class="badge solid ${c}" data-k="badge solid ${c || "neutral"}">b</span>`).join("")}
${CALLOUTS.map((c) => `<aside class="callout ${c}" data-k="callout ${c}"><p class="callout-title">t</p><p>x</p></aside>`).join("")}
${ALERTS.map((c) => `<div class="markdown-alert markdown-alert-${c}" data-k="alert ${c}"><p class="markdown-alert-title">t</p><p>x</p></div>`).join("")}
<pre><code data-k="pre code">x</code></pre><p><code data-k="inline code">x</code></p>
<pre class="terminal" data-title="t"><span class="output" data-k="terminal output">x</span></pre>
<div class="card"><header data-k="card header">h</header><footer data-k="card footer">f</footer></div>
<span data-tooltip="t" data-k="tooltip">x</span>
<p class="label" data-k="label">x</p>
<dl class="kv"><dt data-k="kv key">k</dt><dd>v</dd></dl>
<nav class="pagination"><a href="#" aria-current="page" data-k="pagination current">1</a></nav>
<div id="fg"></div><div id="bg"></div>
</main></body></html>`;

const dir = mkdtempSync(join(tmpdir(), "owg-contrast-"));
const page = join(dir, "contrast.html");
writeFileSync(page, html);

// Runs in the page: returns [{pair, fg, bg}] with colours as [r,g,b,a] (0-255, a 0-1).
function measure({ PALETTE, CALLOUTS, ALERTS }) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  function parse(s) {
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = s.match(/^color\(srgb ([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
    }
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = s;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const probe = document.getElementById("fg");
  const tok = (name) => {
    probe.style.color = `var(--owg-${name})`;
    return parse(getComputedStyle(probe).color);
  };
  const el = (k) => document.querySelector(`[data-k="${k}"]`);
  const color = (node) => parse(getComputedStyle(node).color);
  // Effective background: walk up until an opaque background, compositing translucent layers.
  const bgOf = (node) => {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let out = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : tok("bg");
    while (layers.length) {
      const c = layers.pop();
      out = [0, 1, 2].map((i) => c[i] * c[3] + out[i] * (1 - c[3])).concat(1);
    }
    return out;
  };

  const rows = [];
  const add = (pair, fg, bg) => rows.push({ pair, fg, bg });
  const grounds = ["bg", "surface", "surface-2"];
  for (const t of ["text", "text-strong", "muted", "accent", "link"])
    for (const g of grounds) add(`${t} on ${g}`, tok(t), tok(g));
  add("accent on accent-soft", tok("accent"), tok("accent-soft"));
  add("text on accent-soft", tok("text"), tok("accent-soft"));
  add("accent-ink on accent", tok("accent-ink"), tok("accent"));
  for (const p of PALETTE) {
    for (const g of grounds) add(`${p} on ${g}`, tok(p), tok(g));
    add(`${p} on ${p}-soft`, tok(p), tok(`${p}-soft`));
  }
  // Top bar: its background may be translucent; composite it over the page bg.
  const header = document.querySelector("body > header");
  const tbg = tok("topbar-bg");
  const pbg = tok("bg");
  const topbar = tbg[3] >= 1 ? tbg : [0, 1, 2].map((i) => tbg[i] * tbg[3] + pbg[i] * (1 - tbg[3])).concat(1);
  for (const t of ["topbar-text", "topbar-title", "topbar-accent"]) add(`${t} on topbar-bg`, tok(t), topbar);
  if (header && getComputedStyle(header).position === "fixed") {
    add("header title (rendered)", color(header.firstElementChild), bgOf(header));
    add("header link (rendered)", color(header.querySelector("nav a")), bgOf(header));
  }
  add("code-text on code-bg", tok("code-text"), tok("code-bg"));
  add("code-inline-text on code-inline-bg", tok("code-inline-text"), tok("code-inline-bg"));
  for (const s of ["comment", "keyword", "string", "number", "function", "type", "tag", "attr", "variable", "punctuation", "inserted", "deleted"])
    add(`syn-${s} on code-bg`, tok(`syn-${s}`), tok("code-bg"));

  // Real components.
  const real = (k, node = el(k)) => node && add(k, color(node), bgOf(node));
  for (const c of ["neutral", ...PALETTE, "accent"]) { real(`badge ${c}`); real(`badge solid ${c}`); }
  for (const c of CALLOUTS) {
    const n = el(`callout ${c}`);
    add(`callout ${c} title`, color(n.firstElementChild), bgOf(n));
    add(`callout ${c} body`, color(n.lastElementChild), bgOf(n));
  }
  for (const c of ALERTS) {
    const n = el(`alert ${c}`);
    add(`alert ${c} title`, color(n.firstElementChild), bgOf(n));
  }
  for (const k of ["pre code", "inline code", "terminal output", "card header", "card footer", "label", "kv key", "pagination current"]) real(k);
  // Tooltip bubble lives in ::after.
  const tip = el("tooltip");
  if (tip) {
    const s = getComputedStyle(tip, "::after");
    if (s.content && s.content !== "none") add("tooltip", parse(s.color), parse(s.backgroundColor));
  }
  return rows;
}

function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// Foreground may be translucent: composite over the background first.
function ratio(fg, bg) {
  const a = fg[3] ?? 1;
  const f = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  const [l1, l2] = [lum(f), lum(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const browser = await chromium.launch();
const results = new Map(); // pair -> {combo: {r, fg, bg}}
const combos = [];
try {
  const ctx = await browser.newContext();
  const tab = await ctx.newPage();
  for (const theme of THEMES) {
    await tab.emulateMedia({ colorScheme: theme });
    for (const variant of VARIANTS) {
      const combo = `${theme === "light" ? "L" : "D"}:${variant ?? "owg"}`;
      combos.push(combo);
      await tab.goto(pathToFileURL(page).href);
      await tab.evaluate(([t, v]) => {
        document.documentElement.dataset.theme = t;
        if (v) document.documentElement.dataset.variant = v;
      }, [theme, variant]);
      const rows = await tab.evaluate(measure, { PALETTE, CALLOUTS, ALERTS });
      for (const { pair, fg, bg } of rows) {
        if (!results.has(pair)) results.set(pair, {});
        results.get(pair)[combo] = { r: ratio(fg, bg), fg: hex(fg), bg: hex(bg) };
      }
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

// Table: one row per pair, one column per theme x variant. "!" marks a failure.
const W = 34, C = 11;
const head = "pair".padEnd(W) + combos.map((c) => c.padStart(C)).join("");
const lines = [head, "-".repeat(head.length)];
const failures = [];
for (const [pair, byCombo] of results) {
  const cells = combos.map((c) => {
    const x = byCombo[c];
    if (!x) return "-".padStart(C);
    const bad = x.r < MIN;
    if (bad) failures.push({ pair, combo: c, ...x });
    return ((bad ? "!" : "") + x.r.toFixed(1)).padStart(C);
  });
  if (showAll || cells.some((s) => s.includes("!"))) lines.push(pair.padEnd(W) + cells.join(""));
}
console.log(lines.join("\n"));
console.log(`\n${results.size} pairs x ${combos.length} theme/variant combinations, minimum ${MIN}:1`);
if (failures.length) {
  console.log(`\nFAIL: ${failures.length} pair(s) below ${MIN}:1`);
  for (const f of failures) console.log(`  ${f.combo.padEnd(12)} ${f.pair.padEnd(W)} ${f.r.toFixed(2)}  fg ${f.fg} on bg ${f.bg}`);
  process.exit(1);
}
console.log("contrast ok");
