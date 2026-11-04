// Dev: rebuild on change under src/ and plugins/, and serve the repo root statically.
// Usage: node scripts/dev.mjs [port]   (default 4173; PORT env also works)
import { createServer } from "node:http";
import { watch, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".md": "text/plain" };

const build = () => {
  try { execFileSync(process.execPath, [join(root, "scripts/build.mjs"), "--quiet"], { stdio: "inherit" }); console.log(`[${new Date().toLocaleTimeString()}] built`); }
  catch { console.log("build failed (see above)"); }
};
build();
let t;
for (const d of ["src", "plugins"]) watch(join(root, d), { recursive: true }, () => { clearTimeout(t); t = setTimeout(build, 80); });

createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let f = join(root, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(f));
}).listen(port, () => console.log(`owg-css dev: http://localhost:${port}/demo/  (watching src/, plugins/)`));
