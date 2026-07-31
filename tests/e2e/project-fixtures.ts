/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import JSZip from "jszip";
import sharp from "sharp";
import type { DocumentSnapshot } from "../../src/types";

export function projectDocument(overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  const backgroundId = "layer-e2e-background";
  const textId = "layer-e2e-text";
  return {
    schemaVersion: 1,
    id: "document-e2e-project",
    name: "E2E Project",
    width: 640,
    height: 480,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [
      {
        id: backgroundId,
        type: "shape",
        name: "Paper",
        shape: "rectangle",
        bounds: { x: 0, y: 0, width: 1000, height: 1000 },
        fill: "#f5f0e7",
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: "normal",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      },
      {
        id: textId,
        type: "text",
        name: "Missing font sample",
        text: "FONT FALLBACK",
        fontFamily: "'PhotoPop Font That Does Not Exist', serif",
        fontSize: 82,
        fontWeight: 700,
        color: "#171717",
        letterSpacing: 2,
        align: "left",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        transform: { x: 90, y: 410, scaleX: 1, scaleY: 1, rotation: 0 },
      },
    ],
    selectedLayerId: textId,
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#f5f0e7",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export async function projectBytes(document = projectDocument()): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    format: "photopop",
    schemaVersion: 1,
    applicationVersion: "0.1.0-alpha.1",
    documentId: document.id,
  }));
  zip.file("document.json", JSON.stringify(document));
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function pngFixture(): Promise<Buffer> {
  const width = 24;
  const height = 18;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = x * 10;
      pixels[offset + 1] = y * 13;
      pixels[offset + 2] = 190;
      pixels[offset + 3] = (x + y) % 4 === 0 ? 120 : 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
