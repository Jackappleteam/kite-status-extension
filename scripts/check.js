// Dependency-free checks for the extension. Run: node scripts/check.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const errors = [];
const fail = (msg) => errors.push(msg);
const exists = (rel) => fs.existsSync(path.join(root, rel));

// 1. manifest.json is valid and looks like an MV3 extension
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")); }
catch (e) { fail("manifest.json is not valid JSON: " + e.message); }
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
for (const k of ["name", "version", "description"]) if (!manifest[k]) fail(`manifest.json is missing "${k}"`);
if (manifest.version && !/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`Bad version "${manifest.version}" (use 1.2.3)`);

// 2. every file the manifest points to exists
const refs = [
  manifest.action && manifest.action.default_popup,
  manifest.options_page,
  manifest.background && manifest.background.service_worker,
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ...Object.values(manifest.icons || {}),
].filter(Boolean);
refs.forEach((r) => { if (!exists(r)) fail(`manifest.json references a missing file: ${r}`); });

// 3. local script/style references in HTML pages exist
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.name === "node_modules" || d.name.startsWith(".") ? [] : d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const files = walk(root);
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(f, "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(https?:|chrome|data:)/.test(m[1])) continue;
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) fail(`${path.relative(root, f)} references a missing file: ${m[1]}`);
  }
}

// 4. JavaScript syntax
for (const f of files.filter((f) => f.endsWith(".js") && !f.includes(`${path.sep}scripts${path.sep}`))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { fail(`Syntax error in ${path.relative(root, f)}:\n${e.stderr.toString().trim()}`); }
}

// 5. chrome.* APIs that need a permission are declared in the manifest
const needs = { storage: "storage", alarms: "alarms", notifications: "notifications" };
const declared = new Set(manifest.permissions || []);
const used = new Set();
for (const f of files.filter((f) => f.endsWith(".js") && f.includes(`${path.sep}src${path.sep}`))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/chrome\.(\w+)\./g)) used.add(m[1]);
}
for (const api of used) if (needs[api] && !declared.has(needs[api])) fail(`chrome.${api} is used but "${needs[api]}" is not in permissions`);

// 6. README exists
if (!exists("README.md")) fail("README.md is missing");

if (errors.length) {
  console.error("Checks failed:\n\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`OK: manifest, ${refs.length} manifest files, HTML references, JS syntax, permissions, README.`);
