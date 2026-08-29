import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "public/index.html",
  "public/manifest.webmanifest",
  "server.mjs",
  "src/app.js",
  "src/styles.css",
  "worker/index.ts"
];

for (const file of requiredFiles) {
  await access(file);
}

const index = await readFile("public/index.html", "utf8");
if (!index.includes('lang="ko"') || !index.includes("/src/app.js")) {
  throw new Error("index.html metadata or entry module is missing");
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:m?js)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

const syntaxFiles = (await Promise.all([
  sourceFiles("lib"),
  sourceFiles("scripts"),
  sourceFiles("src")
])).flat();
const checks = syntaxFiles.map((file) => ["--check", file]);
checks.push(["--check", "server.mjs"], ["--test"]);

for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("CHAK² verification passed.");
