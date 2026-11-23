// MapLibre v6 loads its worker relative to its own module URL, which breaks once bundled.
// Copy the (self-contained) worker into public/ so the app can setWorkerUrl() to it.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const { version } = JSON.parse(readFileSync(path.join(dist, "..", "package.json"), "utf8"));
mkdirSync("public/maplibre", { recursive: true });
copyFileSync(path.join(dist, "maplibre-gl-worker.mjs"), `public/maplibre/worker-${version}.mjs`);
console.log(`copied maplibre worker ${version}`);
