// Contrast check for every theme x variant: text pairs >= 4.5:1, non-text pairs (control
// boundaries, focus indicators) >= 3:1. Loads dist/owg.css in headless Chromium and reads computed
// colours from real elements in real states (focused controls, current links, pressed buttons,
// ::placeholder, pseudo-elements), so color-mix() and translucent layers are resolved by the
// browser. Prints a per-category summary, then every failing pair; exits 1 on any failure.
// Usage: node scripts/contrast.mjs [--all]   (--all also prints the full matrix per category)
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
const TEXT = 4.5, NONTEXT = 3;
const THEMES = ["light", "dark"];
const VARIANTS = [null, "amber", "phosphor", "slate", "contrast", "doom", "hotdog"];
const PALETTE = ["blue", "green", "amber", "red", "purple", "pink", "cyan"];
const CALLOUTS = ["", "note", "tip", "important", "warning", "danger"];
const ALERTS = ["note", "tip", "important", "warning", "caution"];

// A full page skeleton (top bar, sidebar, TOC) so layout states are the real ones.
// Transitions and animations are off so nothing is measured mid-transition.
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(css).href}">
<style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body>
<header><a href="#">site<span>://</span>x</a><nav><a href="#" aria-current="page" data-k="topbar current link">cur</a><a href="#">link</a></nav></header>
<aside id="sidebar"><nav><h2>Group</h2><ul><li><a href="#" aria-current="page" data-k="sidebar current link">cur</a></li><li><a href="#" data-k="sidebar link">other</a></li></ul></nav></aside>
<main><article>
${["", ...PALETTE, "accent"].map((c) => `<span class="badge ${c}" data-k="badge ${c || "neutral"}">b</span>`).join("")}
${["", ...PALETTE, "accent"].map((c) => `<span class="badge solid ${c}" data-k="badge solid ${c || "neutral"}">b</span>`).join("")}
${CALLOUTS.map((c) => `<aside class="callout ${c}" data-k="callout ${c || "plain"}"><p class="callout-title">t</p><p>x</p></aside>`).join("")}
${ALERTS.map((c) => `<div class="markdown-alert markdown-alert-${c}" data-k="alert ${c}"><p class="markdown-alert-title">t</p><p>x</p></div>`).join("")}
<pre><code data-k="pre code">x</code></pre><p><code data-k="inline code">x</code></p>
<pre class="terminal" data-title="t"><span class="output" data-k="terminal output">x</span></pre>
<div class="card"><header data-k="card header">h</header><p><input data-k="input on surface" value="v"></p><footer data-k="card footer">f</footer></div>
<span data-tooltip="t" data-k="tooltip">x</span>
<p class="label" data-k="label">x</p>
<dl class="kv"><dt data-k="kv key">k</dt><dd>v</dd></dl>
<nav class="pagination"><a href="#" aria-current="page" data-k="pagination current">1</a></nav>
<pre class="mermaid" data-owg-error><strong class="mermaid-error" data-k="mermaid error">mermaid: x</strong>src</pre>
<table class="striped"><thead><tr><th data-k="table header">h</th></tr></thead>
<tbody><tr><td>a</td></tr><tr><td data-k="striped row">b</td></tr></tbody></table>
<p><mark data-k="mark">m</mark> <kbd data-k="kbd">k</kbd></p>
<p><input data-k="input" placeholder="placeholder"> <select data-k="select"><option>a</option></select>
<input type="checkbox" data-k="checkbox"> <input type="radio" data-k="radio"></p>
<textarea data-k="textarea"></textarea>
<p><button data-k="button">b</button> <button aria-pressed="true" data-k="button pressed">p</button>
<button class="secondary" aria-pressed="true" data-k="button secondary pressed">s</button></p>
</article>
<nav class="toc"><h2>On this page</h2><ul><li><a href="#" aria-current="true" data-k="toc current link">cur</a></li><li><a href="#">other</a></li></ul></nav>
</main></body></html>`;

const dir = mkdtempSync(join(tmpdir(), "owg-contrast-"));
const page = join(dir, "contrast.html");
writeFileSync(page, html);

// Shared in-page helpers (installed once per load): colour parsing and effective backgrounds.
// Colours are [r, g, b, a] with r/g/b 0-255 and a 0-1.
function install() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const parse = (s) => {
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
  };
  const over = (c, under) => [0, 1, 2].map((i) => c[i] * c[3] + under[i] * (1 - c[3])).concat(1);
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  const tok = (name) => { probe.style.color = `var(--owg-${name})`; return parse(getComputedStyle(probe).color); };
  // Effective background: composite translucent layers up to the first opaque one.
  const bgOf = (node) => {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let out = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : tok("bg");
    while (layers.length) out = over(layers.pop(), out);
    return out;
  };
  const el = (k) => document.querySelector(`[data-k="${k}"]`);
  window.__owg = { parse, over, tok, bgOf, el };
}

// Everything that does not need focus. Returns [{cat, pair, min, fg, bg}].
function measure({ PALETTE, CALLOUTS, ALERTS, TEXT, NONTEXT }) {
  const { parse, over, tok, bgOf, el } = window.__owg;
  const color = (n) => parse(getComputedStyle(n).color);
  const rows = [];
  const add = (cat, pair, fg, bg, min = TEXT) => rows.push({ cat, pair, min, fg, bg });
  const real = (cat, k, min) => { const n = el(k); if (n) add(cat, k, color(n), bgOf(n), min); };

  const grounds = ["bg", "surface", "surface-2"];
  for (const t of ["text", "text-strong", "muted", "accent", "link"])
    for (const g of grounds) add("text tokens", `${t} on ${g}`, tok(t), tok(g));
  add("text tokens", "accent on accent-soft", tok("accent"), tok("accent-soft"));
  add("text tokens", "text on accent-soft", tok("text"), tok("accent-soft"));
  add("text tokens", "accent-ink on accent", tok("accent-ink"), tok("accent"));
  // ::selection cannot be read back; use the pair reset.css paints (text-strong on selection).
  add("text tokens", "text-strong on selection", tok("text-strong"), over(tok("selection"), tok("bg")));
  for (const p of PALETTE) {
    for (const g of grounds) add("palette", `${p} on ${g}`, tok(p), tok(g));
    add("palette", `${p} on ${p}-soft`, tok(p), tok(`${p}-soft`));
  }

  // Top bar: may be translucent; composite over the page bg.
  const topbar = over(tok("topbar-bg"), tok("bg"));
  for (const t of ["topbar-text", "topbar-title", "topbar-accent"]) add("top bar", `${t} on topbar-bg`, tok(t), topbar);
  const header = document.querySelector("body > header");
  if (header && getComputedStyle(header).position === "fixed") {
    add("top bar", "title (rendered)", color(header.firstElementChild), bgOf(header));
    add("top bar", "link (rendered)", color(header.querySelector("nav a:not([aria-current])")), bgOf(header));
    real("top bar", "topbar current link");
  }

  add("code & syntax", "code-text on code-bg", tok("code-text"), tok("code-bg"));
  add("code & syntax", "code-inline-text on code-inline-bg", tok("code-inline-text"), tok("code-inline-bg"));
  for (const s of ["comment", "keyword", "string", "number", "function", "type", "tag", "attr", "variable", "punctuation", "inserted", "deleted"])
    add("code & syntax", `syn-${s} on code-bg`, tok(`syn-${s}`), tok("code-bg"));
  real("code & syntax", "pre code");
  real("code & syntax", "inline code");

  for (const c of ["neutral", ...PALETTE, "accent"]) { real("components", `badge ${c}`); real("components", `badge solid ${c}`); }
  const pseudo = (cat, pair, n, which) => {
    const s = getComputedStyle(n, which);
    if (s.content && s.content !== "none" && s.content !== "normal") add(cat, pair, parse(s.color), over(parse(s.backgroundColor), bgOf(n)));
  };
  for (const c of CALLOUTS) {
    const k = c || "plain", n = el(`callout ${k}`);
    add("components", `callout ${k} title`, color(n.firstElementChild), bgOf(n));
    add("components", `callout ${k} body`, color(n.lastElementChild), bgOf(n));
    pseudo("components", `callout ${k} glyph`, n.firstElementChild, "::before");
  }
  for (const c of ALERTS) {
    const n = el(`alert ${c}`);
    add("components", `alert ${c} title`, color(n.firstElementChild), bgOf(n));
  }
  for (const k of ["terminal output", "card header", "card footer", "label", "kv key", "pagination current", "mermaid error"]) real("components", k);
  pseudo("components", "tooltip", el("tooltip"), "::after");

  // Classless elements and their states.
  real("elements", "table header");
  real("elements", "striped row");
  real("elements", "mark");
  real("elements", "kbd");
  const input = el("input");
  const ph = getComputedStyle(input, "::placeholder");
  const phc = parse(ph.color);
  phc[3] *= Number(ph.opacity || 1);
  add("elements", "input ::placeholder", phc, bgOf(input));
  real("elements", "button");
  real("elements", "button pressed");
  real("elements", "button secondary pressed");

  // Navigation states.
  real("nav states", "sidebar current link");
  real("nav states", "sidebar link");
  real("nav states", "toc current link");

  // Non-text: a control's boundary against what surrounds it (WCAG 1.4.11).
  for (const k of ["input", "input on surface", "select", "textarea", "checkbox", "radio"]) {
    const n = el(k);
    add("control boundary (3:1)", `${k} border`, parse(getComputedStyle(n).borderTopColor), bgOf(n.parentElement), NONTEXT);
  }
  return rows;
}

// Focus indicator of a keyboard-focused element against what surrounds it: the outline if
// there is one, otherwise the box-shadow halo (or, failing that, the border).
function measureFocus({ k, NONTEXT }) {
  const { parse, over, bgOf, el } = window.__owg;
  const n = el(k);
  const s = getComputedStyle(n);
  const around = bgOf(n.parentElement);
  let ring, how;
  if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) {
    ring = parse(s.outlineColor); how = "outline";
  } else {
    const m = s.boxShadow.match(/(rgba?\([^)]*\)|color\([^)]*\))/);
    ring = m ? parse(m[1]) : parse(s.borderTopColor); how = m ? "halo" : "border";
  }
  return [{ cat: "focus (3:1)", pair: `${k} focus ${how}`, min: NONTEXT, fg: over(ring, around), bg: around }];
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
const results = new Map(); // "cat\0pair" -> {cat, pair, min, by: {combo: {r, fg, bg}}}
const combos = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
      await tab.evaluate(install);
      const rows = await tab.evaluate(measure, { PALETTE, CALLOUTS, ALERTS, TEXT, NONTEXT });
      // Keyboard modality first, so :focus-visible applies as it does for a keyboard user.
      for (const k of ["input", "button", "checkbox"]) {
        await tab.keyboard.press("Shift");
        await tab.focus(`[data-k="${k}"]`);
        rows.push(...(await tab.evaluate(measureFocus, { k, NONTEXT })));
      }
      for (const { cat, pair, min, fg, bg } of rows) {
        const key = `${cat}\0${pair}`;
        if (!results.has(key)) results.set(key, { cat, pair, min, by: {} });
        results.get(key).by[combo] = { r: ratio(fg, bg), fg: hex(fg), bg: hex(bg) };
      }
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

// Per-category summary: worst ratio anywhere in the category, and how many checks fail.
const cats = [...new Set([...results.values()].map((x) => x.cat))];
const failures = [];
const summary = [["category", "min", "pairs", "checks", "worst", "worst pair", "result"]];
for (const cat of cats) {
  const rows = [...results.values()].filter((x) => x.cat === cat);
  let worst = { r: Infinity };
  let checks = 0, fails = 0;
  for (const x of rows) for (const [combo, v] of Object.entries(x.by)) {
    checks++;
    if (v.r < worst.r) worst = { ...v, combo, pair: x.pair };
    if (v.r < x.min) { fails++; failures.push({ cat, pair: x.pair, min: x.min, combo, ...v }); }
  }
  summary.push([cat, `${rows[0].min}:1`, String(rows.length), String(checks), worst.r.toFixed(2),
    `${worst.pair} (${worst.combo})`, fails ? `${fails} FAIL` : "ok"]);
}
const widths = summary[0].map((_, i) => Math.max(...summary.map((r) => r[i].length)));
const line = (r) => r.map((c, i) => (i >= 1 && i <= 4 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ");
console.log(line(summary[0]));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of summary.slice(1)) console.log(line(r));

if (showAll) {
  const W = 38, C = 11;
  for (const cat of cats) {
    console.log(`\n${cat}\n` + "pair".padEnd(W) + combos.map((c) => c.padStart(C)).join(""));
    for (const x of [...results.values()].filter((y) => y.cat === cat))
      console.log(x.pair.padEnd(W) + combos.map((c) => {
        const v = x.by[c];
        return (v ? (v.r < x.min ? "!" : "") + v.r.toFixed(1) : "-").padStart(C);
      }).join(""));
  }
}

console.log(`\n${results.size} pairs x ${combos.length} theme/variant combinations (text ${TEXT}:1, non-text ${NONTEXT}:1)`);
if (failures.length) {
  console.log(`\nFAIL: ${failures.length} check(s) below their minimum`);
  for (const f of failures)
    console.log(`  ${f.combo.padEnd(12)} ${f.cat.padEnd(24)} ${f.pair.padEnd(30)} ${f.r.toFixed(2)} < ${f.min}  ${f.fg} on ${f.bg}`);
  process.exit(1);
}
console.log("contrast ok");
