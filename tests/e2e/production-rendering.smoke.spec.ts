/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { AdjustmentLayer, DocumentSnapshot, ShapeLayer } from "../../src/types";
import { chooseMenuAction, launchPhotoPop } from "./electron-harness";
import { projectBytes, projectDocument } from "./project-fixtures";

const WIDTH = 12;
const HEIGHT = 8;

test("matches the deterministic production-compositor PNG golden", async ({}, testInfo) => {
  const projectPath = testInfo.outputPath("production-golden.photopop");
  const outputPath = testInfo.outputPath("production-golden.png");
  await writeFile(projectPath, await projectBytes(goldenDocument()));

  const running = await launchPhotoPop({
    userDataDirectory: testInfo.outputPath("user-data"),
    dialogs: {
      open: [projectPath],
      save: [outputPath],
    },
  });

  try {
    await chooseMenuAction(running.page, "File", /^Open/);
    await expect(running.page.locator(".document-tab")).toContainText("Production Golden");
    await expect(running.page.getByLabel(/Editing canvas for Production Golden/)).toBeVisible();
    const adjustmentMaskControls = running.page.locator(".adjustment-mask-controls");
    await expect(adjustmentMaskControls.getByRole("heading", { name: "Layer mask" })).toBeVisible();
    await expect(adjustmentMaskControls.locator("input[type=\"range\"]").nth(0)).toHaveValue("0.5");
    await expect(adjustmentMaskControls.locator("input[type=\"range\"]").nth(1)).toHaveValue("0");

    await chooseMenuAction(running.page, "File", /^Export/);
    const dialog = running.page.getByRole("dialog", { name: "Export image" });
    await dialog.getByLabel("Format").selectOption("png");
    await dialog.getByLabel("Width").fill(String(WIDTH));
    await dialog.getByLabel("Height").fill(String(HEIGHT));
    await dialog.getByRole("button", { name: /^Export$/ }).click();
    await expect(running.page.locator(".toast")).toContainText(/PNG exported/i);
  } finally {
    await running.close();
  }

  const { data: actual, info } = await sharp(outputPath)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const expected = goldenPixels();

  expect(info.width).toBe(WIDTH);
  expect(info.height).toBe(HEIGHT);
  expect(info.channels).toBe(4);
  expect(actual.length).toBe(expected.length);

  let maximumChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const delta = Math.abs(actual[index] - expected[index]);
    maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    totalChannelDelta += delta;
  }
  const meanChannelDelta = totalChannelDelta / actual.length;
  const differenceSummary =
    `maximum RGBA channel delta was ${maximumChannelDelta}; `
    + `mean RGBA channel delta was ${meanChannelDelta}`;

  // Several premultiplied 8-bit Canvas blend, mask, and adjustment stages can
  // accumulate two rounding units across hardware and hosted software backends.
  // The peak gate catches localized defects while the mean gate prevents broad drift.
  expect(maximumChannelDelta, differenceSummary).toBeLessThanOrEqual(2);
  expect(meanChannelDelta, differenceSummary).toBeLessThanOrEqual(0.25);
});

function goldenDocument(): DocumentSnapshot {
  const background = shape("golden-background", "Ink blue", "#183048", {
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
  });
  const maskedCoral: ShapeLayer = {
    ...shape("golden-coral", "Masked coral", "#f05445", {
      x: 1,
      y: 1,
      width: 8,
      height: 5,
    }),
    opacity: 0.5,
    mask: {
      density: 0.5,
      feather: 0,
      strokes: [{
        id: "golden-hard-hide",
        points: [{ x: 4, y: -8 }, { x: 4, y: 16 }],
        size: 2,
        hardness: 1,
        opacity: 1,
        mode: "hide",
      }],
    },
  };
  const multiplyBlue: ShapeLayer = {
    ...shape("golden-blue", "Multiply blue", "#3f78c4", {
      x: 4,
      y: 2,
      width: 6,
      height: 5,
    }),
    opacity: 0.75,
    blendMode: "multiply",
  };
  const levels: AdjustmentLayer = {
    id: "golden-levels",
    type: "adjustment",
    name: "Deterministic levels",
    adjustment: "levels",
    values: { black: 16, white: 240, gamma: 1 },
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: identityTransform(),
    mask: {
      density: 0.5,
      feather: 0,
      strokes: [{
        id: "golden-adjustment-hide",
        points: [{ x: 8, y: -8 }, { x: 8, y: 16 }],
        size: 2,
        hardness: 1,
        opacity: 1,
        mode: "hide",
      }],
    },
  };

  return projectDocument({
    id: "document-production-golden",
    name: "Production Golden",
    width: WIDTH,
    height: HEIGHT,
    layers: [background, maskedCoral, multiplyBlue, levels],
    selectedLayerId: levels.id,
    foreground: "#f05445",
    background: "#183048",
  });
}

function shape(
  id: string,
  name: string,
  fill: string,
  bounds: ShapeLayer["bounds"],
): ShapeLayer {
  return {
    id,
    type: "shape",
    name,
    shape: "rectangle",
    bounds,
    fill,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: identityTransform(),
  };
}

function identityTransform(): ShapeLayer["transform"] {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}

function goldenPixels(): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let color: Rgb = [24, 48, 72];
      if (within(x, y, 1, 1, 8, 5)) {
        // The hard two-pixel hide stroke removes columns 3 and 4. At 50%
        // mask density those columns retain half of the layer's 50% opacity.
        const maskStrength = x === 3 || x === 4 ? 0.5 : 1;
        color = compositeOpaque(color, [240, 84, 69], 0.5 * maskStrength, "normal");
      }
      if (within(x, y, 4, 2, 6, 5)) {
        color = compositeOpaque(color, [63, 120, 196], 0.75, "multiply");
      }
      const adjusted = color.map(levelsChannel) as Rgb;
      // The levels mask uses the same hard-edge convention at x=8. Its 50%
      // density leaves half of the adjustment active in columns 7 and 8.
      const adjustmentStrength = x === 7 || x === 8 ? 0.5 : 1;
      color = color.map((channel, index) => Math.round(
        channel + adjustmentStrength * (adjusted[index] - channel),
      )) as Rgb;

      const offset = (y * WIDTH + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

type Rgb = [number, number, number];

function compositeOpaque(
  backdrop: Rgb,
  source: Rgb,
  opacity: number,
  blendMode: "normal" | "multiply",
): Rgb {
  return backdrop.map((channel, index) => {
    const blended = blendMode === "multiply"
      ? channel * source[index] / 255
      : source[index];
    return Math.round(channel * (1 - opacity) + blended * opacity);
  }) as Rgb;
}

function levelsChannel(channel: number): number {
  const normalized = Math.max(0, Math.min(1, (channel - 16) / (240 - 16)));
  return Math.round(255 * normalized);
}

function within(
  x: number,
  y: number,
  left: number,
  top: number,
  width: number,
  height: number,
): boolean {
  return x >= left && x < left + width && y >= top && y < top + height;
}
