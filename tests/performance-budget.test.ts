/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { createId, createInitialDocument, createShapeLayer, reduceDocument } from "../src/core/document";

describe("document command budget", () => {
  it("applies 1,000 metadata and layer commands in under 250 ms", () => {
    let document = createInitialDocument();
    const start = performance.now();
    for (let index = 0; index < 500; index += 1) {
      const layer = createShapeLayer(
        "rectangle",
        { x: index % 900, y: index % 800, width: 32, height: 24 },
        index % 2 ? "#111111" : "#f04f42",
      );
      layer.id = createId("budget");
      document = reduceDocument(document, { type: "layer/add", layer });
      document = reduceDocument(document, { type: "layer/toggle-visibility", layerId: layer.id });
    }
    expect(performance.now() - start).toBeLessThan(250);
    expect(document.layers).toHaveLength(505);
  });
});
