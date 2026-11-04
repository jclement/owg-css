// Build: src/owg.css -> dist/owg.css (readable) + dist/owg.min.css; plugins -> dist/plugins.
// Usage: node scripts/build.mjs [--quiet]
import { bundle, transform } from "lightningcss";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const quiet = process.argv.includes("--quiet");
mkdirSync(join(dist, "plugins"), { recursive: true });

const sizes = [];
const out = (name, code) => {
  writeFileSync(join(dist, name), code);
  sizes.push([name, code.length, gzipSync(code).length]);
};

function bundleCss(entry, name) {
  const opts = { filename: join(root, entry), errorRecovery: false };
  const pretty = bundle({ ...opts, minify: false });
  const min = bundle({ ...opts, minify: true });
  for (const w of [...pretty.warnings, ...min.warnings]) console.warn(`warn ${entry}: ${w.message}`);
  out(`${name}.css`, pretty.code);
  out(`${name}.min.css`, min.code);
}

bundleCss("src/owg.css", "owg");
// Optional self-hosted font faces (only if the core agent filled src/fonts.css).
if (/@font-face/.test(readFileSync(join(root, "src/fonts.css"), "utf8"))) bundleCss("src/fonts.css", "owg-fonts");

// Plugins: CSS is minified alongside a readable copy; JS is copied verbatim.
const pdir = join(root, "plugins");
if (existsSync(pdir)) {
  for (const f of readdirSync(pdir)) {
    const src = readFileSync(join(pdir, f));
    if (f.endsWith(".css")) {
      const { code, warnings } = transform({ filename: f, code: src, minify: true });
      for (const w of warnings) console.warn(`warn plugins/${f}: ${w.message}`);
      out(`plugins/${f}`, src);
      out(`plugins/${f.replace(/\.css$/, ".min.css")}`, code);
    } else if (f.endsWith(".js") || f.endsWith(".mjs")) {
      out(`plugins/${f}`, src);
    }
  }
}

if (!quiet) {
  for (const [n, raw, gz] of sizes) console.log(`${n.padEnd(34)} ${String(raw).padStart(7)} B  ${String(gz).padStart(6)} B gz`);
}
writeFileSync(join(dist, "sizes.json"), JSON.stringify(Object.fromEntries(sizes.map(([n, r, g]) => [n, { raw: r, gzip: g }])), null, 2) + "\n");
