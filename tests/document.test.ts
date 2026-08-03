/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import type { AdjustmentLayer } from "../src/types";
import {
  createBlankDocument,
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

    const movedToCanvas = reduceDocument(moved, {
      type: "layer/reorder-to",
      layerId: shape.id,
      targetLayerId: moved.layers[0].id,
    });
    expect(movedToCanvas.layers[0].id).toBe(shape.id);

    const duplicateId = createId("layer");
    const duplicated = reduceDocument(movedToCanvas, { type: "layer/duplicate", layerId: shape.id, newId: duplicateId });
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

  it("creates, configures, and paints a valid adjustment-layer mask", () => {
    const initial = createInitialDocument();
    const adjustment: AdjustmentLayer = {
      id: "adjustment-mask-command",
      type: "adjustment",
      name: "Masked levels",
      adjustment: "levels",
      values: { black: 0, gamma: 1, white: 220 },
      visible: true,
      locked: false,
      opacity: 0.8,
      blendMode: "normal",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    const added = reduceDocument(initial, { type: "layer/add", layer: adjustment });
    const ensured = reduceDocument(added, { type: "mask/ensure", layerId: adjustment.id });
    const configured = reduceDocument(ensured, {
      type: "mask/settings",
      layerId: adjustment.id,
      density: 0.55,
      feather: 6,
    });
    const painted = reduceDocument(configured, {
      type: "mask/stroke",
      layerId: adjustment.id,
      stroke: {
        id: "adjustment-stroke",
        points: [{ x: 12, y: 16 }, { x: 48, y: 52 }],
        size: 24,
        hardness: 0.75,
        opacity: 0.6,
        mode: "hide",
      },
    });
    const mask = painted.layers.find((layer) => layer.id === adjustment.id)?.mask;

    expect(mask).toMatchObject({ density: 0.55, feather: 6 });
    expect(mask?.strokes).toHaveLength(1);
    expect(validateDocument(painted)).toBe(true);
  });

  it("sizes a new document and its background from the same pixel geometry", () => {
    const document = createBlankDocument(1600, 900);
    const background = document.layers[0];
    expect(document.width).toBe(1600);
    expect(document.height).toBe(900);
    expect(background.type).toBe("shape");
    if (background.type === "shape") {
      expect(background.bounds).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
    }
  });

  it("enforces a locked layer for properties and masks while still allowing unlock", () => {
    const initial = createInitialDocument();
    const locked = initial.layers.find((layer) => layer.locked)!;
    const moved = reduceDocument(initial, {
      type: "layer/update",
      layerId: locked.id,
      changes: { transform: { ...locked.transform, x: 120 } },
    });
    const masked = reduceDocument(initial, { type: "mask/ensure", layerId: locked.id });
    expect(moved).toBe(initial);
    expect(masked).toBe(initial);

    const unlocked = reduceDocument(initial, {
      type: "layer/update",
      layerId: locked.id,
      changes: { locked: false },
    });
    expect(unlocked.layers.find((layer) => layer.id === locked.id)?.locked).toBe(false);
  });

  it("keeps a no-op undo clean", () => {
    const initial = createHistory();
    expect(dispatchHistory(initial, { type: "history/undo" })).toBe(initial);
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

  it("treats layer selection as workspace state instead of an undoable edit", () => {
    const initial = createHistory();
    const nextLayer = initial.present.layers.find((layer) => layer.id !== initial.present.selectedLayerId);
    expect(nextLayer).toBeDefined();

    const selected = dispatchHistory(initial, {
      type: "layer/select",
      layerId: nextLayer!.id,
    });

    expect(selected.present.selectedLayerId).toBe(nextLayer!.id);
    expect(selected.revision).toBe(initial.revision);
    expect(selected.past).toEqual(initial.past);
    expect(selected.future).toEqual(initial.future);
  });

  it("crops without producing invalid dimensions", () => {
    const initial = createInitialDocument();
    const cropped = reduceDocument(initial, {
      type: "document/crop",
      bounds: { x: 100, y: 200, width: 500, height: 400 },
    });
    expect(cropped.width).toBe(500);
    expect(cropped.height).toBe(400);
    expect(cropped.selection.kind).toBe("none");
    expect(validateDocument(cropped)).toBe(true);
  });
});
