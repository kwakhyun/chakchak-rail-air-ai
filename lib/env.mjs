import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separator = trimmed.indexOf("=");
  if (separator < 1) return null;

  const key = trimmed.slice(0, separator).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) return null;

  let value = trimmed.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export async function loadLocalEnv(rootDirectory) {
  const loadedFiles = [];

  for (const filename of [".env.local", ".env"]) {
    try {
      const contents = await readFile(resolve(rootDirectory, filename), "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const entry = parseEnvLine(line);
        if (!entry) continue;
        const [key, value] = entry;
        if (process.env[key] === undefined) process.env[key] = value;
      }
      loadedFiles.push(filename);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return loadedFiles;
}
