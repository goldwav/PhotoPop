/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";

const WIDTH = 4096;
const HEIGHT = 4096;
const LAYER_COUNT = 30;
const DEFAULT_TIME_BUDGET_MS = 30_000;
const DEFAULT_MEMORY_BUDGET_BYTES = 3 * 1024 * 1024 * 1024;

const outputArgument = valueAfter("--output");
const shouldAssert = process.argv.includes("--assert");
const timeBudgetMs = numericEnvironment("PHOTOPOP_REFERENCE_TIME_BUDGET_MS", DEFAULT_TIME_BUDGET_MS);
const memoryBudgetBytes = numericEnvironment("PHOTOPOP_REFERENCE_MEMORY_BUDGET_BYTES", DEFAULT_MEMORY_BUDGET_BYTES);

sharp.cache({ memory: 512, files: 0, items: 256 });
sharp.concurrency(Math.max(1, Math.min(4, sharp.concurrency())));

let peakRssBytes = process.memoryUsage().rss;
const memorySampler = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
}, 25);

const startedAt = performance.now();
const { data, info } = await sharp({
  create: {
    width: WIDTH,
    height: HEIGHT,
    channels: 4,
    background: { r: 245, g: 240, b: 231, alpha: 1 },
  },
})
  .composite(Array.from({ length: LAYER_COUNT }, (_, index) => layerFixture(index)))
  .raw()
  .toBuffer({ resolveWithObject: true });
const durationMs = performance.now() - startedAt;
clearInterval(memorySampler);
peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);

const evidence = {
  schemaVersion: 1,
  scenario: {
    name: "4096x4096-30-layer-cpu-reference",
    width: WIDTH,
    height: HEIGHT,
    layers: LAYER_COUNT,
    pixels: WIDTH * HEIGHT,
    outputChannels: info.channels,
    outputBytes: data.byteLength,
  },
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    concurrency: sharp.concurrency(),
  },
  measurements: {
    durationMs: round(durationMs),
    megapixelsPerSecond: round((WIDTH * HEIGHT / 1_000_000) / (durationMs / 1000)),
    peakRssBytes,
    outputSha256: createHash("sha256").update(data).digest("hex"),
  },
  budgets: {
    durationMs: timeBudgetMs,
    peakRssBytes: memoryBudgetBytes,
  },
  results: {
    duration: durationMs <= timeBudgetMs ? "pass" : "fail",
    memory: peakRssBytes <= memoryBudgetBytes ? "pass" : "fail",
  },
  limitations: {
    viewportFps: "not measured by this CPU reference gate",
    brushInputP95Ms: "not measured by this CPU reference gate",
    note: "Installed-artifact E2E and reference-device profiling remain required release gates.",
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
process.stdout.write(serialized);

if (outputArgument) {
  const outputPath = path.resolve(outputArgument);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
}

if (
  shouldAssert
  && (evidence.results.duration === "fail" || evidence.results.memory === "fail")
) {
  process.exitCode = 1;
}

function layerFixture(index) {
  const hue = (index * 41) % 360;
  const x = (index * 337) % 3300 - 280;
  const y = (index * 521) % 3300 - 220;
  const width = 900 + (index % 5) * 210;
  const height = 760 + (index % 7) * 170;
  const rotation = (index * 13) % 47 - 23;
  const opacity = 0.18 + (index % 6) * 0.055;
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})">
        <rect width="${width}" height="${height}" rx="${36 + index * 2}"
          fill="hsl(${hue} 72% 54%)" fill-opacity="${opacity}"/>
        <ellipse cx="${width * 0.62}" cy="${height * 0.44}"
          rx="${width * 0.27}" ry="${height * 0.34}"
          fill="hsl(${(hue + 155) % 360} 60% 38%)" fill-opacity="${opacity * 0.75}"/>
      </g>
    </svg>`;
  return {
    input: Buffer.from(svg),
    blend: ["over", "multiply", "screen", "overlay"][index % 4],
  };
}

function valueAfter(argument) {
  const index = process.argv.indexOf(argument);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numericEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
