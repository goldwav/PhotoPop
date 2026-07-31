/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BlendMode, DocumentSnapshot, ShapeLayer } from "../src/types";
import { renderShapeReference } from "./support/cpu-reference-renderer";

const blendModes: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
];

describe("deterministic CPU rendering reference", () => {
  it("locks the visual result of overlapping transformed shapes", () => {
    const document = fixtureDocument([
      shape("Paper", "#f5f0e7", "normal", { x: 0, y: 0, width: 1000, height: 1000 }),
      shape("Coral", "#f05445", "multiply", { x: 120, y: 160, width: 620, height: 540 }, 0.82),
      {
        ...shape("Ink", "#242629", "screen", { x: 290, y: 190, width: 570, height: 640 }, 0.55),
        shape: "ellipse",
        transform: { x: 38, y: -24, scaleX: 0.92, scaleY: 1.08, rotation: 11 },
      },
      {
        ...shape("Cut paper", "#fffaf1", "soft-light", { x: 80, y: 610, width: 850, height: 310 }, 0.76),
        shape: "polygon",
        points: [
          { x: 80, y: 810 },
          { x: 280, y: 610 },
          { x: 520, y: 760 },
          { x: 720, y: 625 },
          { x: 930, y: 900 },
        ],
      },
    ]);

    const pixels = renderShapeReference(document, 64, 64);
    expect(createHash("sha256").update(pixels).digest("hex"))
      .toBe("7c0a5c07869abb2252a4e68841db8de5f4fb937e90941291a8db3e113c8b8b82");
    expect(pixelAt(pixels, 64, 2, 2)).toEqual([245, 240, 231, 255]);
    expect(pixelAt(pixels, 64, 32, 32)).toEqual([235, 120, 107, 255]);
    expect(pixelAt(pixels, 64, 50, 50)).toEqual([249, 245, 239, 255]);
  });

  it.each(blendModes)("defines a stable %s blend-mode reference", (blendMode) => {
    const document = fixtureDocument([
      shape("Backdrop", "#3f78c4", "normal", { x: 0, y: 0, width: 1000, height: 1000 }),
      shape("Source", "#e85b37", blendMode, { x: 0, y: 0, width: 1000, height: 1000 }, 0.7),
    ]);
    const pixels = renderShapeReference(document, 1, 1);
    expect([...pixels]).toEqual(BLEND_GOLDENS[blendMode]);
  });

  it("rejects non-deterministic fixture inputs instead of silently flattening them", () => {
    const document = fixtureDocument([
      {
        id: "raster-unsupported",
        type: "raster",
        name: "Raster",
        source: "data:image/png;base64,",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      },
    ]);
    expect(() => renderShapeReference(document, 8, 8)).toThrow(/does not support raster/i);
  });
});

const BLEND_GOLDENS: Record<BlendMode, number[]> = {
  normal: [181, 100, 97, 255],
  multiply: [59, 66, 88, 255],
  screen: [185, 154, 205, 255],
  overlay: [99, 96, 173, 255],
  darken: [63, 100, 97, 255],
  lighten: [181, 120, 196, 255],
  "color-dodge": [197, 167, 234, 255],
  "color-burn": [50, 36, 59, 255],
  "hard-light": [173, 96, 118, 255],
  "soft-light": [100, 107, 178, 255],
};

function shape(
  name: string,
  fill: string,
  blendMode: BlendMode,
  bounds: ShapeLayer["bounds"],
  opacity = 1,
): ShapeLayer {
  return {
    id: `shape-${name.toLowerCase().replace(/\s+/g, "-")}`,
    type: "shape",
    name,
    shape: "rectangle",
    bounds,
    fill,
    visible: true,
    locked: false,
    opacity,
    blendMode,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

function fixtureDocument(layers: DocumentSnapshot["layers"]): DocumentSnapshot {
  return {
    schemaVersion: 1,
    id: "document-render-reference",
    name: "Render reference",
    width: 1000,
    height: 1000,
    colorSpace: "srgb",
    bitDepth: 8,
    layers,
    selectedLayerId: layers.at(-1)?.id ?? "",
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#ffffff",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function pixelAt(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): number[] {
  const offset = (y * width + x) * 4;
  return [...pixels.slice(offset, offset + 4)];
}
