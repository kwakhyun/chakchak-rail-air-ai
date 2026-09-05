import { access, rename, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { staticCacheControl } from "../lib/http-security.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const root = resolve(import.meta.dirname, "..");
const shells = [
  ["dist/client/index.html", "dist/client/app-shell.html"],
  ["dist/client/presentation/index.html", "dist/client/presentation-shell.html"]
];

for (const [sourceName, targetName] of shells) {
  const source = resolve(root, sourceName);
  const target = resolve(root, targetName);
  if (await exists(source)) {
    await rename(source, target);
  } else if (!(await exists(target))) {
    throw new Error(`Sites HTML shell is missing: ${sourceName}`);
  }
}

console.log("Sites HTML shells will be served through the Worker security boundary.");
const entries = JSON.parse(await readFile(resolve(root, ".tmp/sites-assets.json"), "utf8"));
const shell = resolve(root, "dist/client/app-shell.html");
const html = (await readFile(shell, "utf8"))
  .replace(/\/src\/app\.js(?:\?[^"']*)?/g, entries["src/app.js"])
  .replace(/\/src\/styles\.css(?:\?[^"']*)?/g, entries["src/styles.css"]);
await writeFile(shell, html);

// Sites may serve assets before the Worker. Apply the same cache policy there.
const headersFile = resolve(root, "dist/client/_headers");
const marker = "# CHAK2 application asset caching";
const existingHeaders = await exists(headersFile) ? await readFile(headersFile, "utf8") : "";
const cacheRules = [
  `/assets/*\n  Cache-Control: ${staticCacheControl("/assets/image.webp")}`,
  ...Object.values(entries).map(path => `${path}\n  Cache-Control: ${staticCacheControl(path)}`)
];
await writeFile(headersFile, `${existingHeaders.split(marker)[0].trimEnd()}\n\n${marker}\n${cacheRules.join("\n\n")}\n`);
