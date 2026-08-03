/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  blendAdjustmentPixels,
  drawDensityMixedMask,
} from "../src/components/EditorCanvas";
import type {
  AdjustmentLayer,
  BlendMode,
  DocumentSnapshot,
  GroupLayer,
  ShapeLayer,
} from "../src/types";
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

  it.each(blendModes)("locks partial-alpha %s compositing on a transparent artboard", (blendMode) => {
    const document = fixtureDocument([
      shape("Backdrop", "#3f78c480", "normal", { x: 0, y: 0, width: 1, height: 1 }),
      shape("Source", "#e85b3780", blendMode, { x: 0, y: 0, width: 1, height: 1 }, 0.7),
    ], 1, 1);
    const pixels = renderShapeReference(document, 1, 1);
    expect([...pixels]).toEqual(PARTIAL_ALPHA_BLEND_GOLDENS[blendMode]);
  });

  it("maps translation, rotation, nonuniform scale, and mirrored scale explicitly", () => {
    const mirrored = {
      ...shape("Mirrored coral", "#f05445", "normal", { x: 0, y: 0, width: 2, height: 1 }),
      transform: { x: 3, y: 0, scaleX: -1, scaleY: 2, rotation: 0 },
    };
    const rotated = {
      ...shape("Rotated blue", "#3f78c4", "normal", { x: 0, y: 0, width: 2, height: 1 }),
      transform: { x: 7, y: 1, scaleX: 1, scaleY: 1, rotation: 90 },
    };
    const pixels = renderShapeReference(fixtureDocument([mirrored, rotated], 8, 4), 8, 4);

    expect(pixelAt(pixels, 8, 1, 0)).toEqual([240, 84, 69, 255]);
    expect(pixelAt(pixels, 8, 2, 1)).toEqual([240, 84, 69, 255]);
    expect(pixelAt(pixels, 8, 6, 1)).toEqual([63, 120, 196, 255]);
    expect(pixelAt(pixels, 8, 6, 2)).toEqual([63, 120, 196, 255]);
    expect(pixelAt(pixels, 8, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(pixels, 8, 7, 2)).toEqual([0, 0, 0, 0]);
  });

  it("locks hard mask edges, density, and hide-then-reveal stroke order", () => {
    const masked = {
      ...shape("Masked coral", "#f0544580", "normal", { x: 0, y: 0, width: 5, height: 1 }),
      mask: {
        density: 1,
        feather: 0,
        strokes: [{
          id: "hide-center",
          points: [{ x: 1.5, y: 0.5 }, { x: 3.5, y: 0.5 }],
          size: 0.8,
          hardness: 1,
          opacity: 1,
          mode: "hide" as const,
        }],
      },
    };
    const hidden = renderShapeReference(fixtureDocument([masked], 5, 1), 5, 1);
    expect(pixelAt(hidden, 5, 0, 0)).toEqual([240, 84, 69, 128]);
    expect(pixelAt(hidden, 5, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(hidden, 5, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(hidden, 5, 4, 0)).toEqual([240, 84, 69, 128]);

    const halfDensity = renderShapeReference(fixtureDocument([{
      ...masked,
      mask: { ...masked.mask, density: 0.5 },
    }], 5, 1), 5, 1);
    expect(pixelAt(halfDensity, 5, 2, 0)).toEqual([240, 84, 69, 64]);

    const revealed = renderShapeReference(fixtureDocument([{
      ...masked,
      mask: {
        ...masked.mask,
        strokes: [
          ...masked.mask.strokes,
          {
            ...masked.mask.strokes[0],
            id: "reveal-center",
            opacity: 0.25,
            mode: "reveal" as const,
          },
        ],
      },
    }], 5, 1), 5, 1);
    expect(pixelAt(revealed, 5, 2, 0)).toEqual([240, 84, 69, 32]);
  });

  it("applies adjustment masks and density to effect strength without changing layer alpha", () => {
    const maskedLevels = {
      ...adjustment("levels", { black: 0, gamma: 1, white: 128 }),
      mask: {
        density: 0.5,
        feather: 0,
        strokes: [{
          id: "hide-adjustment-center",
          points: [{ x: 1.5, y: 0.5 }, { x: 3.5, y: 0.5 }],
          size: 0.8,
          hardness: 1,
          opacity: 1,
          mode: "hide" as const,
        }],
      },
    };
    const pixels = renderShapeReference(fixtureDocument([
      shape("Translucent gray", "#80808080", "normal", { x: 0, y: 0, width: 5, height: 1 }),
      maskedLevels,
    ], 5, 1), 5, 1);

    expect(pixelAt(pixels, 5, 0, 0)).toEqual([255, 255, 255, 128]);
    expect(pixelAt(pixels, 5, 2, 0)).toEqual([192, 192, 192, 128]);
    expect(pixelAt(pixels, 5, 4, 0)).toEqual([255, 255, 255, 128]);
  });

  it("combines group opacity, adjustment opacity, and mask density exactly once", () => {
    const group: GroupLayer = {
      id: "adjustment-group",
      type: "group",
      name: "Adjustment group",
      visible: true,
      locked: false,
      opacity: 0.5,
      blendMode: "normal",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const groupedLevels = {
      ...adjustment("levels", { black: 0, gamma: 1, white: 128 }),
      opacity: 0.8,
      parentId: group.id,
      mask: {
        density: 0.5,
        feather: 0,
        strokes: [{
          id: "hide-grouped-adjustment",
          points: [{ x: 1.5, y: 0.5 }, { x: 3.5, y: 0.5 }],
          size: 0.8,
          hardness: 1,
          opacity: 1,
          mode: "hide" as const,
        }],
      },
    };
    const pixels = renderShapeReference(fixtureDocument([
      shape("Translucent gray", "#80808080", "normal", { x: 0, y: 0, width: 5, height: 1 }),
      group,
      groupedLevels,
    ], 5, 1), 5, 1);

    expect(pixelAt(pixels, 5, 0, 0)).toEqual([179, 179, 179, 128]);
    expect(pixelAt(pixels, 5, 2, 0)).toEqual([153, 153, 153, 128]);
    expect(pixelAt(pixels, 5, 4, 0)).toEqual([179, 179, 179, 128]);
  });

  it("mixes adjustment strength without inflating translucent pixel alpha", () => {
    const backdrop = new Uint8ClampedArray([64, 128, 192, 128]);
    const adjusted = new Uint8ClampedArray([192, 64, 32, 128]);

    expect([...blendAdjustmentPixels(backdrop, adjusted, 0.5, "normal")])
      .toEqual([128, 96, 112, 128]);
    expect([...blendAdjustmentPixels(backdrop, adjusted, 1, "multiply")])
      .toEqual([120, 48, 28, 128]);

    const transparentEdge = new Uint8ClampedArray([0, 0, 0, 0]);
    const blurredEdge = new Uint8ClampedArray([200, 100, 50, 128]);
    expect([...blendAdjustmentPixels(transparentEdge, blurredEdge, 0.5, "normal")])
      .toEqual([200, 100, 50, 64]);
    expect([...blendAdjustmentPixels(transparentEdge, blurredEdge, 1, "multiply")])
      .toEqual([200, 100, 50, 128]);

    const halfStrengthMask = new Uint8ClampedArray([255, 255, 255, 128]);
    expect([...blendAdjustmentPixels(
      backdrop,
      adjusted,
      1,
      "normal",
      halfStrengthMask,
    )]).toEqual([128, 96, 112, 128]);
  });

  it("interpolates mask density additively before the layer reaches the artboard", () => {
    const events: Array<{
      source: object;
      alpha: number;
      operation: GlobalCompositeOperation;
    }> = [];
    const context = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      drawImage(source: object) {
        events.push({
          source,
          alpha: this.globalAlpha,
          operation: this.globalCompositeOperation,
        });
      },
    };
    const unmasked = {};
    const masked = {};

    drawDensityMixedMask(
      context as unknown as Parameters<typeof drawDensityMixedMask>[0],
      unmasked as CanvasImageSource,
      masked as CanvasImageSource,
      0.5,
    );

    expect(events).toEqual([
      { source: unmasked, alpha: 0.5, operation: "source-over" },
      { source: masked, alpha: 0.5, operation: "lighter" },
    ]);
    expect(events[0].alpha + events[1].alpha).toBe(1);
  });

  it("applies levels to transparent pixels without changing their alpha", () => {
    const document = fixtureDocument([
      shape("Dark", "#2020205a", "normal", { x: 0, y: 0, width: 1, height: 1 }),
      shape("Mid", "#808080b4", "normal", { x: 1, y: 0, width: 1, height: 1 }),
      shape("Light", "#e0e0e0ff", "normal", { x: 2, y: 0, width: 1, height: 1 }),
      adjustment("levels", { black: 32, gamma: 1, white: 224 }),
    ], 3, 1);
    const pixels = renderShapeReference(document, 3, 1);

    expect([...pixels]).toEqual([
      0, 0, 0, 90,
      128, 128, 128, 180,
      255, 255, 255, 255,
    ]);
  });

  it("locks curve output while preserving each source alpha value", () => {
    const document = fixtureDocument([
      shape("Shadows", "#1818185a", "normal", { x: 0, y: 0, width: 1, height: 1 }),
      shape("Midtones", "#808080b4", "normal", { x: 1, y: 0, width: 1, height: 1 }),
      shape("Highlights", "#e8e8e8ff", "normal", { x: 2, y: 0, width: 1, height: 1 }),
      adjustment("curves", { shadows: -20, midtones: 30, highlights: 15 }),
    ], 3, 1);
    const pixels = renderShapeReference(document, 3, 1);

    expect([...pixels]).toEqual(CURVES_GOLDEN);
    expect([pixels[3], pixels[7], pixels[11]]).toEqual([90, 180, 255]);
  });

  it("sharpens an interior edge without changing transparency", () => {
    const layers = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        const center = x === 1 && y === 1;
        layers.push(shape(
          `Pixel ${x},${y}`,
          center ? "#6464648c" : "#00000040",
          "normal",
          { x, y, width: 1, height: 1 },
        ));
      }
    }
    layers.push(adjustment("sharpen", { amount: 50 }));
    const pixels = renderShapeReference(fixtureDocument(layers, 3, 3), 3, 3);

    expect(pixelAt(pixels, 3, 1, 1)).toEqual([255, 255, 255, 140]);
    expect(Array.from({ length: 9 }, (_, index) => pixels[index * 4 + 3]))
      .toEqual([64, 64, 64, 64, 140, 64, 64, 64, 64]);
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

const PARTIAL_ALPHA_BLEND_GOLDENS: Record<BlendMode, number[]> = {
  normal: [151, 105, 123, 173],
  multiply: [105, 92, 119, 173],
  screen: [152, 125, 163, 173],
  overlay: [120, 104, 151, 173],
  darken: [107, 105, 123, 173],
  lighten: [151, 113, 160, 173],
  "color-dodge": [157, 130, 174, 173],
  "color-burn": [102, 81, 108, 173],
  "hard-light": [148, 104, 131, 173],
  "soft-light": [120, 108, 153, 173],
};

const CURVES_GOLDEN = [
  10, 10, 10, 90,
  165, 165, 165, 180,
  255, 255, 255, 255,
];

function adjustment(
  adjustmentType: AdjustmentLayer["adjustment"],
  values: Record<string, number>,
): AdjustmentLayer {
  return {
    id: `adjustment-${adjustmentType}`,
    type: "adjustment",
    name: adjustmentType,
    adjustment: adjustmentType,
    values,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

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

function fixtureDocument(
  layers: DocumentSnapshot["layers"],
  width = 1000,
  height = 1000,
): DocumentSnapshot {
  return {
    schemaVersion: 1,
    id: "document-render-reference",
    name: "Render reference",
    width,
    height,
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
