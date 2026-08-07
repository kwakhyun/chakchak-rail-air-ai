import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "public/index.html",
  "public/manifest.webmanifest",
  "scripts/train_chakchak_model.mjs",
  "scripts/audit_chakchak_model.mjs",
  "scripts/audit_real_world_validation.mjs",
  "scripts/pilot_ops.mjs",
  "lib/p2-validation-store.mjs",
  "server.mjs",
  "src/app.js",
  "src/chakchak-ai.js",
  "src/chakchak-features.js",
  "src/chakchak-model-data.js",
  "src/data.js",
  "src/engine.js",
  "src/journey-decision.js",
  "src/live-journey.js",
  "src/real-world-validation.js",
  "src/styles.css"
];

for (const file of requiredFiles) {
  await access(file);
}

const index = await readFile("public/index.html", "utf8");
if (!index.includes('lang="ko"') || !index.includes("/src/app.js")) {
  throw new Error("index.html metadata or entry module is missing");
}

const checks = [
  ["--check", "server.mjs"],
  ["--check", "scripts/train_chakchak_model.mjs"],
  ["--check", "scripts/audit_chakchak_model.mjs"],
  ["--check", "scripts/audit_real_world_validation.mjs"],
  ["--check", "scripts/pilot_ops.mjs"],
  ["--check", "lib/p2-validation-store.mjs"],
  ["--check", "src/app.js"],
  ["--check", "src/chakchak-ai.js"],
  ["--check", "src/chakchak-features.js"],
  ["--check", "src/chakchak-model-data.js"],
  ["--check", "src/data.js"],
  ["--check", "src/engine.js"],
  ["--check", "src/journey-decision.js"],
  ["--check", "src/live-journey.js"],
  ["--check", "src/real-world-validation.js"],
  ["--test"]
];

for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("CHAK² verification passed.");
