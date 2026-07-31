/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { surfaceDimensionsForDocument } from "../src/components/EditorCanvas";

describe("canvas preview geometry", () => {
  it("preserves non-square aspect ratios at native preview size", () => {
    expect(surfaceDimensionsForDocument(1600, 900)).toEqual({
      width: 1600,
      height: 900,
      scale: 1,
    });
  });

  it("scales large documents uniformly without stretching", () => {
    expect(surfaceDimensionsForDocument(4096, 2048)).toEqual({
      width: 2048,
      height: 1024,
      scale: 0.5,
    });
  });

  it("bounds invalid dimensions defensively", () => {
    expect(surfaceDimensionsForDocument(0, -4, 1024)).toEqual({
      width: 1,
      height: 1,
      scale: 1,
    });
  });
});
