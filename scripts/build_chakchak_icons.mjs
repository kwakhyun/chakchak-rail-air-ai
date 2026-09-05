import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const phosphor = join(root, "node_modules", "@phosphor-icons", "core", "assets");
const output = join(root, "public", "assets", "icons", "chakchak");

const colors = {
  rail: "#075FAE",
  air: "#008696",
  travel: "#18845D",
  field: "#7A5B9E",
  neutral: "#4E697D",
  warm: "#A45E00"
};

const icons = [
  ["nav-move-outline", "regular", "suitcase-rolling", colors.neutral],
  ["nav-move-active", "fill", "suitcase-rolling", colors.rail],
  ["nav-train-outline", "regular", "train-simple", colors.neutral],
  ["nav-train-active", "fill", "train-simple", colors.rail],
  ["nav-travel-outline", "regular", "map-trifold", colors.neutral],
  ["nav-travel-active", "fill", "map-trifold", colors.travel],
  ["nav-record-outline", "regular", "clipboard-text", colors.neutral],
  ["nav-record-active", "fill", "clipboard-text", colors.field],
  ["signal-flight", "regular", "airplane-in-flight", colors.air],
  ["signal-immigration", "regular", "identification-card", colors.rail],
  ["signal-weather", "regular", "cloud-rain", colors.air],
  ["signal-airport-rail", "regular", "train-regional", colors.rail],
  ["model-reconciliation", "regular", "checks", colors.travel],
  ["reason-success", "regular", "shield-check", colors.travel],
  ["reason-buffer", "regular", "hourglass-medium", colors.warm],
  ["reason-destination", "regular", "map-pin-area", colors.rail],
  ["reason-mobility", "regular", "person-simple-walk", colors.air],
  ["timeline-airport", "regular", "radio", colors.air],
  ["timeline-transfer", "regular", "arrows-left-right", colors.rail],
  ["timeline-destination", "regular", "signpost", colors.travel],
  ["travel-food", "regular", "bowl-food", colors.warm],
  ["travel-culture", "regular", "buildings", colors.rail],
  ["travel-experience", "regular", "ticket", colors.air],
  ["travel-stay", "regular", "bed", colors.field],
  ["travel-fallback", "regular", "map-pin-plus", colors.travel],
  ["travel-preview", "regular", "camera", colors.rail],
  ["travel-arrival", "regular", "map-pin-line", colors.rail],
  ["travel-time", "regular", "clock", colors.air],
  ["travel-first-place", "regular", "navigation-arrow", colors.travel],
  ["journey-confirmed", "regular", "check-circle", colors.travel],
  ["journey-live", "regular", "pulse", colors.air],
  ["journey-model", "regular", "brain", colors.rail],
  ["route-airport", "regular", "airplane-landing", colors.air],
  ["route-arex", "regular", "subway", colors.air],
  ["route-ktx", "regular", "train", colors.rail],
  ["route-destination", "regular", "flag-checkered", colors.travel],
  ["stage-origin", "regular", "airplane-takeoff", colors.air],
  ["stage-airport", "regular", "airplane-taxiing", colors.air],
  ["stage-arex", "regular", "tram", colors.air],
  ["stage-seoul", "regular", "building-office", colors.rail],
  ["stage-ktx", "regular", "train-regional", colors.rail],
  ["stage-destination", "regular", "map-pin-simple-area", colors.travel],
  ["decision-platform", "regular", "path", colors.air],
  ["decision-arex", "regular", "train-simple", colors.air],
  ["decision-ktx", "regular", "train", colors.rail],
  ["decision-destination", "regular", "map-trifold", colors.travel],
  ["route-heading", "regular", "compass", colors.rail],
  ["travel-recheck", "regular", "arrows-clockwise", colors.rail],
  ["field-step-save", "regular", "clipboard", colors.field],
  ["field-step-platform", "regular", "footprints", colors.air],
  ["field-step-train", "regular", "train-simple", colors.rail],
  ["field-step-results", "regular", "chart-line-up", colors.travel],
  ["field-private", "regular", "shield-check", colors.field],
  ["field-participate", "regular", "user-check", colors.air],
  ["field-record", "regular", "notebook", colors.rail],
  ["field-results", "regular", "chart-bar", colors.travel],
  ["field-gate", "regular", "chart-donut", colors.warm],
  ["field-quality", "regular", "check-square-offset", colors.travel],
  ["field-access", "regular", "wheelchair-motion", colors.field],
  ["field-disruption", "regular", "cloud-warning", colors.warm],
  ["field-ops", "regular", "gear", colors.rail],
  ["field-honest", "regular", "seal-check", colors.travel],
  ["field-pending", "regular", "hourglass", colors.warm],
  ["about-data", "regular", "database", colors.rail],
  ["guide-move", "regular", "airplane-landing", colors.air],
  ["guide-train", "regular", "train", colors.rail],
  ["guide-travel", "regular", "calendar-dots", colors.travel],
  ["service-info", "regular", "info", colors.rail],
  ["promise-safety", "regular", "shield-star", colors.travel],
  ["promise-source", "regular", "file-magnifying-glass", colors.rail],
  ["promise-privacy", "regular", "lock-key", colors.field],
  ["promise-official", "regular", "arrow-square-out", colors.air]
];

await mkdir(output, { recursive: true });

const inlineIcons = {};
for (const [filename, weight, sourceName, color] of icons) {
  const sourceFile = join(phosphor, weight, `${sourceName}${weight === "fill" ? "-fill" : ""}.svg`);
  const svg = await readFile(sourceFile, "utf8");
  const branded = svg
    .replace("currentColor", color)
    .replace("<svg ", `<svg data-chakchak-icon="${filename}" `);
  await writeFile(join(output, `${filename}.svg`), branded);
  inlineIcons[filename] = `data:image/svg+xml;base64,${Buffer.from(branded).toString("base64")}`;
}

await writeFile(join(root, "src/icons.js"), `// Generated by npm run build:icons from the branded SVG assets.
// Small interface icons ship with the app to avoid separate network requests.
const icons = ${JSON.stringify(inlineIcons, null, 2)};
export const iconAsset = name => icons[name];
`);

console.log(`Built ${icons.length} CHAK² icons in ${output}`);
