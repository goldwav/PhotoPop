/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { applyPixelAdjustment } from "../src/components/EditorCanvas";
import type { AdjustmentLayer } from "../src/types";

describe("pixel adjustment reference", () => {
  it("maps levels black, gamma, and white points deterministically", () => {
    const pixels = new Uint8ClampedArray([32, 128, 224, 255]);
    const adjusted = applyPixelAdjustment(pixels, 1, 1, layer("levels", {
      black: 32,
      gamma: 1,
      white: 224,
    }));
    expect([...adjusted]).toEqual([0, 128, 255, 255]);
  });

  it("applies tonal curve controls without changing alpha", () => {
    const pixels = new Uint8ClampedArray([
      24, 24, 24, 90,
      128, 128, 128, 180,
      232, 232, 232, 255,
    ]);
    const adjusted = applyPixelAdjustment(pixels, 3, 1, layer("curves", {
      shadows: -20,
      midtones: 30,
      highlights: 15,
    }));
    expect(adjusted[0]).toBeLessThan(24);
    expect(adjusted[4]).toBeGreaterThan(128);
    expect(adjusted[8]).toBeGreaterThan(232);
    expect([adjusted[3], adjusted[7], adjusted[11]]).toEqual([90, 180, 255]);
  });

  it("sharpens interior edges while preserving the alpha channel", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 100, 100, 100, 140, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]);
    const adjusted = applyPixelAdjustment(pixels, 3, 3, layer("sharpen", { amount: 50 }));
    expect(adjusted[16]).toBeGreaterThan(100);
    expect(adjusted[19]).toBe(140);
  });
});

function layer(
  adjustment: AdjustmentLayer["adjustment"],
  values: Record<string, number>,
): AdjustmentLayer {
  return {
    id: `adjustment-${adjustment}`,
    type: "adjustment",
    name: adjustment,
    adjustment,
    values,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}