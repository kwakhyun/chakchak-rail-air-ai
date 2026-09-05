import { mkdir, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const target = resolve(root, "public/src");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/app.js", "src/styles.css"],
  outdir: "public/src",
  bundle: true,
  minify: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  entryNames: "[name]-[hash]",
  chunkNames: "chunks/[name]-[hash]",
  external: ["/assets/*"],
  metafile: true
});
const entries = Object.fromEntries(Object.entries(result.metafile.outputs)
  .filter(([, info]) => info.entryPoint)
  .map(([path, info]) => [info.entryPoint, `/${path.replace(/^public\//, "")}`]));
await mkdir(resolve(root, ".tmp"), { recursive: true });
await writeFile(resolve(root, ".tmp/sites-assets.json"), JSON.stringify(entries));
