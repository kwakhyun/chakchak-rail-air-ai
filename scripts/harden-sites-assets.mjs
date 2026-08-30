import { access, rename } from "node:fs/promises";
import { resolve } from "node:path";

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
