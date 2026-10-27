/** Recursively run Node's parser check over backend JavaScript modules. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");
const scanRoots = [path.join(backendRoot, "src"), path.join(backendRoot, "scripts")];
const ignoredDirs = new Set(["node_modules", "dist", ".git"]);
const files = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(fullPath);
    } else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
}

for (const root of scanRoots) walk(root);
if (files.length === 0) {
  console.error("No JavaScript files found under backend/src or backend/scripts.");
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status === 0) continue;
  failed += 1;
  console.error(`FAIL  ${path.relative(backendRoot, file)}`);
  if (result.stderr) console.error(result.stderr.trim());
}

if (failed > 0) {
  console.error(`\nSyntax check failed for ${failed} of ${files.length} files.`);
  process.exit(1);
}
console.log(`PASS  Node syntax check passed for all ${files.length} backend JavaScript files.`);
