/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  createHistory,
  createId,
  createInitialDocument,
  createShapeLayer,
  dispatchHistory,
  reduceDocument,
  validateDocument,
} from "../src/core/document";

describe("document commands", () => {
  it("creates a valid professional sample document", () => {
    const document = createInitialDocument();
    expect(validateDocument(document)).toBe(true);
    expect(document.layers.map((layer) => layer.name)).toEqual([
      "Canvas",
      "Portrait",
      "Paper Shapes",
      "Coral Form",
      "Masthead",
    ]);
    expect(document.layers.find((layer) => layer.name === "Portrait")?.mask).toBeDefined();
  });

  it("adds, reorders, duplicates, and removes an unlocked layer", () => {
    const initial = createInitialDocument();
    const shape = createShapeLayer("rectangle", { x: 20, y: 30, width: 120, height: 80 }, "#f04f42");
    const added = reduceDocument(initial, { type: "layer/add", layer: shape });
    expect(added.layers.at(-1)?.id).toBe(shape.id);

    const moved = reduceDocument(added, { type: "layer/reorder", layerId: shape.id, direction: "down" });
    expect(moved.layers.at(-2)?.id).toBe(shape.id);

    const duplicateId = createId("layer");
    const duplicated = reduceDocument(moved, { type: "layer/duplicate", layerId: shape.id, newId: duplicateId });
    expect(duplicated.layers.some((layer) => layer.id === duplicateId)).toBe(true);

    const removed = reduceDocument(duplicated, { type: "layer/remove", layerId: duplicateId });
    expect(removed.layers.some((layer) => layer.id === duplicateId)).toBe(false);
  });

  it("never removes the locked canvas layer", () => {
    const initial = createInitialDocument();
    const canvas = initial.layers[0];
    const result = reduceDocument(initial, { type: "layer/remove", layerId: canvas.id });
    expect(result).toBe(initial);
  });

  it("applies mask settings and serializable strokes", () => {
    const initial = createInitialDocument();
    const layerId = initial.selectedLayerId;
    const configured = reduceDocument(initial, {
      type: "mask/settings",
      layerId,
      density: 0.65,
      feather: 8,
    });
    const painted = reduceDocument(configured, {
      type: "mask/stroke",
      layerId,
      stroke: {
        id: "stroke-1",
        points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
        size: 50,
        hardness: 0.5,
        opacity: 0.8,
        mode: "hide",
      },
    });
    const mask = painted.layers.find((layer) => layer.id === layerId)?.mask;
    expect(mask?.density).toBe(0.65);
    expect(mask?.feather).toBe(8);
    expect(mask?.strokes).toHaveLength(1);
    expect(() => JSON.stringify(painted)).not.toThrow();
  });

  it("keeps undo and redo deterministic", () => {
    const initial = createHistory();
    const renamed = dispatchHistory(initial, { type: "document/rename", name: "Campaign" });
    const recolored = dispatchHistory(renamed, { type: "colors/set", foreground: "#ff0000" });
    const undone = dispatchHistory(recolored, { type: "history/undo" });
    expect(undone.present.name).toBe("Campaign");
    expect(undone.present.foreground).not.toBe("#ff0000");
    const redone = dispatchHistory(undone, { type: "history/redo" });
    expect(redone.present.foreground).toBe("#ff0000");
  });

  it("crops without producing invalid dimensions", () => {
    const initial = createInitialDocument();
    const cropped = reduceDocument(initial, {
      type: "document/crop",
      bounds: { x: 100, y: 200, width: 500, height: 400 },
    });
    expect(cropped.width).toBe(1500);
    expect(cropped.height).toBe(1200);
    expect(cropped.selection.kind).toBe("none");
    expect(validateDocument(cropped)).toBe(true);
  });
});
