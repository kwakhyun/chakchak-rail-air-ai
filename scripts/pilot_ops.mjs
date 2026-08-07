import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "../lib/env.mjs";
import { P2ValidationStore, loadOrCreateP2ValidationSecret } from "../lib/p2-validation-store.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
await loadLocalEnv(root);
const configuredSecret = process.env.CHAKCHAK_VALIDATION_SECRET;
const secret = configuredSecret || await loadOrCreateP2ValidationSecret(resolve(root, "runtime/validation/token-secret"));
const store = new P2ValidationStore({
  filePath: resolve(root, process.env.CHAKCHAK_VALIDATION_STORE || "runtime/validation/journeys.json"),
  secret,
  secretMode: configuredSecret ? "environment" : "local-generated",
  pilotInviteRequired: true
});

const [command = "status", ...args] = process.argv.slice(2);

if (command === "status") {
  console.log(JSON.stringify(await store.pilotStatus({ includePrivate: true }), null, 2));
} else if (command === "issue") {
  const count = Number(args[0] || 1);
  const validityDays = Number(args[1] || 14);
  console.log(JSON.stringify(await store.issuePilotInvites({ count, validityDays }), null, 2));
} else if (command === "phase") {
  const [phase, ...reasonParts] = args;
  console.log(JSON.stringify(await store.transitionPilotPhase(phase, reasonParts.join(" ")), null, 2));
} else if (command === "export") {
  const artifact = await store.exportInstitutionMatch();
  const defaultPath = resolve(root, `runtime/validation/exports/chakchak-institution-match-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const outputPath = args[0] ? resolve(root, args[0]) : defaultPath;
  const allowedRoot = resolve(root, "runtime/validation/exports");
  if (!outputPath.startsWith(`${allowedRoot}/`)) throw new Error("내보내기 경로는 runtime/validation/exports 안이어야 합니다.");
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ outputPath, recordCount: artifact.manifest.recordCount, digest: artifact.integrity.digest }, null, 2));
} else {
  console.error("사용법: node scripts/pilot_ops.mjs status | issue [개수] [유효일] | phase READY|ENROLLING|PAUSED|CLOSED [사유] | export [runtime/validation/exports/파일.json]");
  process.exitCode = 1;
}
