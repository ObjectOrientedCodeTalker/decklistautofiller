// Packages the extension into a zip for the Chrome Web Store.
//
// Usage:
//   node tools/package.mjs
//
// Writes dist/decklist-auto-filler-<version>.zip containing only what the extension needs:
// manifest.json, content/, popup/ and icons/. tools/, dist/ and anything else in the
// folder are left out. Before zipping it checks that every file manifest.json and the popup
// refer to exists and that every script parses, and stops with an error if not.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INCLUDE = ["manifest.json", "content", "popup", "icons"];
const problems = [];

// ---- collect files ---------------------------------------------------------

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    problems.push(`missing: ${rel}`);
    return [];
  }
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs)
    .filter((name) => !name.startsWith(".")) // .DS_Store and similar
    .flatMap((name) => walk(path.posix.join(rel, name)));
}

const files = INCLUDE.flatMap(walk).sort();
const fileSet = new Set(files);

// ---- checks ----------------------------------------------------------------

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
} catch (e) {
  console.error(`manifest.json isn't valid JSON: ${e.message}`);
  process.exit(1);
}

const referenced = new Set();
const ref = (p) => p && referenced.add(path.posix.normalize(p));
ref(manifest.action && manifest.action.default_popup);
Object.values(manifest.icons || {}).forEach(ref);
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(ref);
(manifest.content_scripts || []).forEach((cs) => [...(cs.js || []), ...(cs.css || [])].forEach(ref));
(manifest.web_accessible_resources || []).forEach((w) => (w.resources || []).forEach(ref));
if (manifest.background && manifest.background.service_worker) ref(manifest.background.service_worker);

// Files the popup page loads (<script src>, <link href>, <img src>), relative to the page.
const popup = manifest.action && manifest.action.default_popup;
if (popup && fileSet.has(popup)) {
  const html = readFileSync(path.join(ROOT, popup), "utf8");
  for (const [, url] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (!/^[a-z]+:/i.test(url)) ref(path.posix.join(path.posix.dirname(popup), url));
  }
}

for (const p of referenced) if (!fileSet.has(p)) problems.push(`referenced but not in the package: ${p}`);

for (const f of files.filter((f) => /\.(m?js)$/.test(f))) {
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, f)], { stdio: "pipe" });
  } catch (e) {
    problems.push(`syntax error in ${f}:\n${String(e.stderr || e.message).trim()}`);
  }
}

for (const f of files.filter((f) => /\.(js|css|html|json)$/.test(f))) {
  const text = readFileSync(path.join(ROOT, f), "utf8");
  if (/[\x00-\x08\x0e-\x1f\x7f]/.test(text)) problems.push(`raw control characters in ${f}`);
}

if (problems.length) {
  console.error("Not packaged:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}

// ---- zip (stored as deflate, no dependencies) ------------------------------

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const locals = [];
const centrals = [];
let offset = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const data = readFileSync(abs);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const name = Buffer.from(rel, "utf8");
  const crc = crc32(data);
  const { time, day } = dosTime(statSync(abs).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + body.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(ROOT, "dist");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `decklist-auto-filler-${manifest.version}.zip`);
const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(outFile, zip);

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`Packaged ${manifest.name} v${manifest.version}: ${files.length} files, ${kb(zip.length)}`);
console.log(`  ${path.relative(ROOT, outFile)}`);
for (const f of files) console.log(`    ${f}`);
