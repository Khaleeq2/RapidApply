import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = path.join(extensionRoot, ".output", "chrome-mv3");
const manifest = JSON.parse(await readFile(path.join(outputRoot, "manifest.json"), "utf8"));

if ((manifest.permissions ?? []).includes("activeTab")) {
  throw new Error("Production helper must not declare the activeTab screenshot permission.");
}

if (!(manifest.permissions ?? []).includes("downloads")) {
  throw new Error("Production helper must declare the downloads permission for its managed resume workflow.");
}

const forbiddenCaptureTokens = [
  "captureVisibleTab",
  "rapidapply.recording-capture-current",
  "capture_requires_activation",
];

// A packed helper must never contain a Vite/WXT development client. Aside
// from being unnecessary in production, an orphaned development client can
// keep polling a content-script runtime after Chrome invalidates it and flood
// the page with chrome-extension://invalid/ errors.
const forbiddenDevelopmentRuntimeTokens = [
  "import.meta.hot",
  "@vite/client",
  "vite:beforeUpdate",
  "chrome-extension://invalid",
];

for (const file of await listFiles(outputRoot)) {
  if (!file.endsWith(".js")) continue;
  const source = await readFile(file, "utf8");
  const token = forbiddenCaptureTokens.find((candidate) => source.includes(candidate));
  if (token) {
    throw new Error(`Production helper still packages development capture code (${token}) in ${path.relative(extensionRoot, file)}.`);
  }
  const developmentToken = forbiddenDevelopmentRuntimeTokens.find((candidate) => source.includes(candidate));
  if (developmentToken) {
    throw new Error(`Production helper still packages a development runtime (${developmentToken}) in ${path.relative(extensionRoot, file)}.`);
  }
}

console.log("Production helper package verified: managed resume downloads are available, no screenshot capture is present, and no development runtime is packaged.");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(resolved));
    else files.push(resolved);
  }
  return files;
}
