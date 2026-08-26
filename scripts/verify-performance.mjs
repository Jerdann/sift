import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rendererAssets = path.join(
  root,
  ".vite",
  "renderer",
  "main_window",
  "assets",
);
const limits = [
  {
    label: "renderer JavaScript",
    files: readdirSync(rendererAssets)
      .filter((file) => file.endsWith(".js"))
      .map((file) => path.join(rendererAssets, file)),
    maxBytes: 400 * 1024,
  },
  {
    label: "renderer CSS",
    files: readdirSync(rendererAssets)
      .filter((file) => file.endsWith(".css"))
      .map((file) => path.join(rendererAssets, file)),
    maxBytes: 60 * 1024,
  },
  {
    label: "preload JavaScript",
    files: [path.join(root, ".vite", "build", "preload.js")],
    maxBytes: 120 * 1024,
  },
  {
    label: "main-process JavaScript",
    files: [path.join(root, ".vite", "build", "main.js")],
    maxBytes: 550 * 1024,
  },
];

const failures = [];
for (const limit of limits) {
  const bytes = limit.files.reduce((sum, file) => sum + statSync(file).size, 0);
  const kib = (bytes / 1024).toFixed(1);
  const maxKib = (limit.maxBytes / 1024).toFixed(0);
  if (bytes > limit.maxBytes) {
    failures.push(`${limit.label}: ${kib} KiB exceeds ${maxKib} KiB`);
  } else {
    console.log(`${limit.label}: ${kib} KiB / ${maxKib} KiB`);
  }
}

if (failures.length) {
  console.error("Performance budget failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production bundle performance budgets passed.");
