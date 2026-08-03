/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createInitialDocument } from "../src/core/document";
import type { AdjustmentLayer } from "../src/types";
import { deserializeProject, serializeProject } from "../src/core/file-format";

describe(".photopop format", () => {
  it("round-trips the complete document graph", async () => {
    const document = createInitialDocument();
    const bytes = await serializeProject(document);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const restored = await deserializeProject(bytes);
    expect(restored).toEqual(document);
  });

  it("round-trips adjustment-layer mask settings and strokes", async () => {
    const document = createInitialDocument();
    const adjustment: AdjustmentLayer = {
      id: "adjustment-mask-roundtrip",
      type: "adjustment",
      name: "Masked curves",
      adjustment: "curves",
      values: { shadows: -10, midtones: 20, highlights: 5 },
      visible: true,
      locked: false,
      opacity: 0.75,
      blendMode: "soft-light",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      mask: {
        density: 0.6,
        feather: 4,
        strokes: [{
          id: "roundtrip-adjustment-stroke",
          points: [{ x: 20, y: 30 }, { x: 80, y: 90 }],
          size: 32,
          hardness: 0.8,
          opacity: 0.7,
          mode: "hide",
        }],
      },
    };
    const project = {
      ...document,
      layers: [...document.layers, adjustment],
      selectedLayerId: adjustment.id,
    };

    const restored = await deserializeProject(await serializeProject(project));
    expect(restored.layers.find((layer) => layer.id === adjustment.id)).toEqual(adjustment);
  });

  it("contains a versioned manifest and document payload", async () => {
    const bytes = await serializeProject(createInitialDocument());
    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("text"));
    expect(manifest.format).toBe("photopop");
    expect(manifest.schemaVersion).toBe(1);
    expect(zip.file("document.json")).not.toBeNull();
  });

  it("rejects a package with missing required entries", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "photopop", schemaVersion: 1 }));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(deserializeProject(bytes)).rejects.toThrow(/missing/i);
  });

  it("rejects an unknown major schema version", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "photopop", schemaVersion: 99 }));
    zip.file("document.json", JSON.stringify(createInitialDocument()));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(deserializeProject(bytes)).rejects.toThrow(/unsupported/i);
  });
});
