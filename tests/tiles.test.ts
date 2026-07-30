/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  MAX_UNDO_BYTES,
  computeUndoByteLimit,
  dirtyTilesForCommand,
  tilesForBounds,
} from "../src/core/tiles";

describe("tile addressing", () => {
  it("addresses only intersecting 512px tiles", () => {
    expect(tilesForBounds({ x: 500, y: 500, width: 40, height: 40 }, 2048, 2048)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ]);
  });

  it("bounds a mask stroke to dirty tiles", () => {
    expect(dirtyTilesForCommand({
      type: "mask/stroke",
      layerId: "portrait",
      stroke: {
        id: "stroke",
        points: [{ x: 700, y: 700 }, { x: 760, y: 760 }],
        size: 64,
        hardness: 0.5,
        opacity: 1,
        mode: "hide",
      },
    }, 2048, 2048)).toEqual([{ column: 1, row: 1 }]);
  });
});

describe("undo storage budget", () => {
  it("uses 25 percent of available memory below the 2 GB ceiling", () => {
    expect(computeUndoByteLimit(4 * 1024 ** 3)).toBe(1024 ** 3);
    expect(computeUndoByteLimit(32 * 1024 ** 3)).toBe(MAX_UNDO_BYTES);
  });
});
