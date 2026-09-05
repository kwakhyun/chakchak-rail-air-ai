import { cp, readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "portfolio/chakchak-rail-air-ai");
const check = process.argv.includes("--check");
try { await readFile(join(target, "package.json")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("Standalone checkout: no portfolio mirror to synchronize.");
  process.exit(0);
}

// Only maintained application files. Never copy secrets, runtime data, Git state or dependencies.
const roots = ["src", "lib", "worker", "tests", "server.mjs", "package.json", "package-lock.json", "tsconfig.json", "playwright.config.ts", "vite.config.ts", "build",
  "scripts/verify.mjs", "scripts/prepare-sites.mjs", "scripts/harden-sites-assets.mjs", "scripts/sync-portfolio.mjs",
  "docs/improvements-2026-09-05.md", "public/index.html", "public/assets/illustrations/rail-air-journey.webp", "public/assets/illustrations/rail-air-journey-3d.webp"];

async function files(path) {
  try {
    const entries = await readdir(join(root, path), { withFileTypes: true });
    return (await Promise.all(entries.map(entry => files(join(path, entry.name))))).flat();
  } catch (error) {
    if (error.code === "ENOTDIR") return [path];
    throw error;
  }
}

const paths = (await Promise.all(roots.map(files))).flat();
const differences = [];
for (const path of paths) {
  const source = await readFile(join(root, path));
  let destination;
  try { destination = await readFile(join(target, path)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (destination?.equals(source)) continue;
  differences.push(path);
  if (!check) {
    await mkdir(resolve(target, path, ".."), { recursive: true });
    await cp(join(root, path), join(target, path));
  }
}
if (check && differences.length) {
  console.error(`Portfolio differs from canonical root:\n${differences.join("\n")}`);
  process.exitCode = 1;
} else console.log(check ? "Application copies match." : `Synchronized ${differences.length} application files.`);
