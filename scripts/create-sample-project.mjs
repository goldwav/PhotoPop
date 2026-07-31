/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const portraitPath = path.join(repositoryRoot, "public", "assets", "portrait-layer.png");
const previewPath = path.join(repositoryRoot, "public", "assets", "editorial-cover.png");
const outputPath = path.join(repositoryRoot, "samples", "editorial-mask.photopop");

const projectTimestamp = "2026-07-30T12:00:00.000Z";
// JSZip serializes local date fields into the ZIP directory. Constructing this
// as local time keeps the archive bytes stable across host time zones.
const zipEntryDate = new Date(2026, 6, 30, 12, 0, 0);

const identityTransform = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
});

function baseLayer(id, name) {
  return {
    id,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { ...identityTransform },
  };
}

function pngDataUrl(bytes) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function createDocument(portraitBytes) {
  return {
    schemaVersion: 1,
    id: "sample-document-editorial-mask-v1",
    name: "Editorial Mask Sample",
    width: 1000,
    height: 1000,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [
      {
        ...baseLayer("sample-layer-canvas", "Canvas"),
        type: "shape",
        shape: "rectangle",
        bounds: { x: 0, y: 0, width: 1000, height: 1000 },
        fill: "#f5f0e7",
        locked: true,
      },
      {
        ...baseLayer("sample-layer-portrait", "Portrait — Edit This Mask"),
        type: "raster",
        source: pngDataUrl(portraitBytes),
        mask: {
          density: 1,
          feather: 0,
          strokes: [],
        },
      },
      {
        ...baseLayer("sample-layer-paper", "Paper Shapes"),
        type: "shape",
        shape: "polygon",
        bounds: { x: 0, y: 560, width: 760, height: 440 },
        points: [
          { x: 0, y: 610 },
          { x: 245, y: 575 },
          { x: 405, y: 720 },
          { x: 540, y: 658 },
          { x: 710, y: 1000 },
          { x: 0, y: 1000 },
        ],
        fill: "#f3eee4",
        stroke: "#e8e0d4",
        strokeWidth: 3,
      },
      {
        ...baseLayer("sample-layer-coral", "Coral Form"),
        type: "shape",
        shape: "polygon",
        bounds: { x: 612, y: 430, width: 470, height: 650 },
        points: [
          { x: 735, y: 1000 },
          { x: 1000, y: 1000 },
          { x: 1000, y: 382 },
          { x: 864, y: 520 },
          { x: 782, y: 690 },
          { x: 656, y: 840 },
        ],
        fill: "#f05445",
      },
      {
        ...baseLayer("sample-layer-masthead", "Masthead"),
        type: "text",
        text: "MOMENT",
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 154,
        fontWeight: 500,
        color: "#171717",
        letterSpacing: -8,
        align: "left",
        transform: {
          ...identityTransform,
          x: 30,
          y: 34,
        },
      },
    ],
    selectedLayerId: "sample-layer-portrait",
    selection: {
      kind: "none",
      feather: 0,
    },
    foreground: "#111111",
    background: "#f5f0e7",
    createdAt: projectTimestamp,
    updatedAt: projectTimestamp,
  };
}

function addZipEntry(zip, name, data, options = {}) {
  zip.file(name, data, {
    createFolders: false,
    date: zipEntryDate,
    ...options,
  });
}

async function generateProject(portraitBytes, previewBytes) {
  const document = createDocument(portraitBytes);
  const manifest = {
    format: "photopop",
    schemaVersion: 1,
    applicationVersion: "0.1.0-alpha.1",
    documentId: document.id,
    createdAt: document.createdAt,
    savedAt: projectTimestamp,
  };

  const zip = new JSZip();
  addZipEntry(zip, "manifest.json", JSON.stringify(manifest, null, 2));
  addZipEntry(zip, "document.json", JSON.stringify(document, null, 2));
  addZipEntry(zip, "preview.png", previewBytes);

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "DOS",
    streamFiles: false,
  });
}

async function validateProject(projectBytes, portraitBytes, previewBytes) {
  const zip = await JSZip.loadAsync(projectBytes);
  assert.deepEqual(
    Object.keys(zip.files).sort(),
    ["document.json", "manifest.json", "preview.png"],
    "The sample must contain exactly the current required package entries.",
  );

  const manifestText = await zip.file("manifest.json")?.async("string");
  const documentText = await zip.file("document.json")?.async("string");
  const packagedPreview = await zip.file("preview.png")?.async("nodebuffer");
  assert.ok(manifestText, "manifest.json must be readable.");
  assert.ok(documentText, "document.json must be readable.");
  assert.ok(packagedPreview, "preview.png must be readable.");

  const manifest = JSON.parse(manifestText);
  const document = JSON.parse(documentText);
  assert.equal(manifest.format, "photopop");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.documentId, document.id);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.colorSpace, "srgb");
  assert.equal(document.bitDepth, 8);
  assert.ok(document.layers.some((layer) => layer.id === document.selectedLayerId));

  const portrait = document.layers.find((layer) => layer.id === "sample-layer-portrait");
  assert.equal(portrait?.type, "raster");
  assert.ok(
    portrait.source.startsWith("data:image/png;base64,"),
    "The portrait must be stored as an embedded PNG data URL.",
  );
  assert.ok(portrait.mask, "The portrait must include an editable layer mask.");
  assert.equal(
    Buffer.from(portrait.source.split(",", 2)[1], "base64").compare(portraitBytes),
    0,
    "The embedded portrait must match the source raster.",
  );
  assert.equal(
    packagedPreview.compare(previewBytes),
    0,
    "The packaged preview must match the reference preview.",
  );
  assert.equal(
    documentText.includes("/assets/"),
    false,
    "The saved document must not reference application asset paths.",
  );
}

const portraitBytes = await readFile(portraitPath);
const previewBytes = await readFile(previewPath);
const firstBuild = await generateProject(portraitBytes, previewBytes);
const secondBuild = await generateProject(portraitBytes, previewBytes);

assert.equal(
  firstBuild.compare(secondBuild),
  0,
  "Repeated sample generation must produce byte-identical output.",
);
await validateProject(firstBuild, portraitBytes, previewBytes);
await writeFile(outputPath, firstBuild);

const checksum = createHash("sha256").update(firstBuild).digest("hex");
process.stdout.write(`${JSON.stringify({
  output: path.relative(repositoryRoot, outputPath).replaceAll("\\", "/"),
  bytes: firstBuild.length,
  sha256: checksum,
}, null, 2)}\n`);
