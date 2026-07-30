/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  BaseLayer,
  DocumentSnapshot,
  EditorCommand,
  HistoryState,
  Layer,
  LayerMask,
  Point,
  ShapeLayer,
  TextLayer,
} from "../types";

const identityTransform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
} as const;

export function createId(prefix = "item"): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function baseLayer(name: string): BaseLayer {
  return {
    id: createId("layer"),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { ...identityTransform },
  };
}

export function createDefaultMask(): LayerMask {
  return {
    density: 1,
    feather: 0,
    strokes: [],
  };
}

export function createInitialDocument(): DocumentSnapshot {
  const now = new Date().toISOString();

  const canvas: ShapeLayer = {
    ...baseLayer("Canvas"),
    type: "shape",
    shape: "rectangle",
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    fill: "#f5f0e7",
    locked: true,
  };

  const coral: ShapeLayer = {
    ...baseLayer("Coral Form"),
    type: "shape",
    shape: "polygon",
    bounds: { x: 612, y: 430, width: 470, height: 650 },
    points: [
      { x: 735, y: 1000 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 382 },
      { x: 864, y: 520 },
      { x: 782, y: 690 },
      { x: 656, y: 840 },
    ],
    fill: "#f05445",
  };

  const portrait: Layer = {
    ...baseLayer("Portrait"),
    type: "raster",
    source: "/assets/portrait-layer.png",
    mask: createDefaultMask(),
  };

  const paperShapes: ShapeLayer = {
    ...baseLayer("Paper Shapes"),
    type: "shape",
    shape: "polygon",
    bounds: { x: 0, y: 560, width: 760, height: 440 },
    points: [
      { x: 0, y: 610 },
      { x: 245, y: 575 },
      { x: 405, y: 720 },
      { x: 540, y: 658 },
      { x: 710, y: 1000 },
      { x: 0, y: 1000 },
    ],
    fill: "#f3eee4",
    stroke: "#e8e0d4",
    strokeWidth: 3,
  };

  const masthead: TextLayer = {
    ...baseLayer("Masthead"),
    type: "text",
    text: "MOMENT",
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: 154,
    fontWeight: 500,
    color: "#171717",
    letterSpacing: -8,
    align: "left",
    transform: {
      ...identityTransform,
      x: 30,
      y: 34,
    },
  };

  return {
    schemaVersion: 1,
    id: createId("document"),
    name: "Editorial-Cover",
    width: 3000,
    height: 3000,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [canvas, portrait, paperShapes, coral, masthead],
    selectedLayerId: portrait.id,
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#f5f0e7",
    createdAt: now,
    updatedAt: now,
  };
}

function touch(document: DocumentSnapshot): DocumentSnapshot {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
  };
}

function updateLayer(
  document: DocumentSnapshot,
  layerId: string,
  updater: (layer: Layer) => Layer,
): DocumentSnapshot {
  let found = false;
  const layers = document.layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    found = true;
    return updater(layer);
  });
  return found ? touch({ ...document, layers }) : document;
}

export function reduceDocument(
  document: DocumentSnapshot,
  command: EditorCommand,
): DocumentSnapshot {
  switch (command.type) {
    case "layer/select":
      return document.layers.some((layer) => layer.id === command.layerId)
        ? { ...document, selectedLayerId: command.layerId }
        : document;
    case "layer/add": {
      const index = command.index ?? document.layers.length;
      const layers = [...document.layers];
      layers.splice(Math.max(0, Math.min(index, layers.length)), 0, command.layer);
      return touch({ ...document, layers, selectedLayerId: command.layer.id });
    }
    case "layer/remove": {
      const layer = document.layers.find((candidate) => candidate.id === command.layerId);
      if (!layer || layer.locked || document.layers.length === 1) return document;
      const layers = document.layers.filter((candidate) => candidate.id !== command.layerId);
      return touch({
        ...document,
        layers,
        selectedLayerId: document.selectedLayerId === command.layerId
          ? layers.at(-1)?.id ?? layers[0].id
          : document.selectedLayerId,
      });
    }
    case "layer/duplicate": {
      const index = document.layers.findIndex((layer) => layer.id === command.layerId);
      if (index < 0) return document;
      const source = document.layers[index];
      const duplicate = structuredClone(source);
      duplicate.id = command.newId;
      duplicate.name = `${source.name} copy`;
      duplicate.transform = {
        ...source.transform,
        x: source.transform.x + 24,
        y: source.transform.y + 24,
      };
      const layers = [...document.layers];
      layers.splice(index + 1, 0, duplicate);
      return touch({ ...document, layers, selectedLayerId: duplicate.id });
    }
    case "layer/reorder": {
      const index = document.layers.findIndex((layer) => layer.id === command.layerId);
      if (index < 0) return document;
      const target = command.direction === "up" ? index + 1 : index - 1;
      if (target < 0 || target >= document.layers.length) return document;
      const layers = [...document.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return touch({ ...document, layers });
    }
    case "layer/toggle-visibility":
      return updateLayer(document, command.layerId, (layer) => ({
        ...layer,
        visible: !layer.visible,
      }));
    case "layer/update":
      return updateLayer(document, command.layerId, (layer) => ({
        ...layer,
        ...command.changes,
        transform: command.changes.transform
          ? { ...layer.transform, ...command.changes.transform }
          : layer.transform,
      }) as Layer);
    case "mask/ensure":
      return updateLayer(document, command.layerId, (layer) => ({
        ...layer,
        mask: layer.mask ?? createDefaultMask(),
      }));
    case "mask/settings":
      return updateLayer(document, command.layerId, (layer) => ({
        ...layer,
        mask: {
          ...(layer.mask ?? createDefaultMask()),
          density: command.density ?? layer.mask?.density ?? 1,
          feather: command.feather ?? layer.mask?.feather ?? 0,
        },
      }));
    case "mask/stroke":
      return updateLayer(document, command.layerId, (layer) => ({
        ...layer,
        mask: {
          ...(layer.mask ?? createDefaultMask()),
          strokes: [...(layer.mask?.strokes ?? []), command.stroke],
        },
      }));
    case "selection/set":
      return { ...document, selection: command.selection };
    case "selection/clear":
      return { ...document, selection: { kind: "none", feather: 0 } };
    case "document/rename":
      return touch({ ...document, name: command.name.trim() || document.name });
    case "document/crop": {
      const widthRatio = 1000 / Math.max(1, command.bounds.width);
      const heightRatio = 1000 / Math.max(1, command.bounds.height);
      const layers = document.layers.map((layer) => ({
        ...layer,
        transform: {
          ...layer.transform,
          x: (layer.transform.x - command.bounds.x) * widthRatio,
          y: (layer.transform.y - command.bounds.y) * heightRatio,
          scaleX: layer.transform.scaleX * widthRatio,
          scaleY: layer.transform.scaleY * heightRatio,
        },
      }));
      return touch({
        ...document,
        width: Math.max(1, Math.round(document.width * command.bounds.width / 1000)),
        height: Math.max(1, Math.round(document.height * command.bounds.height / 1000)),
        layers,
        selection: { kind: "none", feather: 0 },
      });
    }
    case "colors/set":
      return {
        ...document,
        foreground: command.foreground ?? document.foreground,
        background: command.background ?? document.background,
      };
  }
}

export function createHistory(document = createInitialDocument()): HistoryState {
  return {
    past: [],
    present: document,
    future: [],
    revision: 0,
  };
}

export function dispatchHistory(
  state: HistoryState,
  command: EditorCommand | { type: "history/undo" } | { type: "history/redo" },
  limit = 100,
): HistoryState {
  if (command.type === "history/undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      revision: state.revision + 1,
    };
  }
  if (command.type === "history/redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      past: [...state.past, state.present].slice(-limit),
      present: next,
      future: state.future.slice(1),
      revision: state.revision + 1,
    };
  }

  const next = reduceDocument(state.present, command);
  if (next === state.present) return state;
  return {
    past: [...state.past, state.present].slice(-limit),
    present: next,
    future: [],
    revision: state.revision + 1,
  };
}

export function createTextLayer(text: string, point: Point, color: string): TextLayer {
  return {
    ...baseLayer(text.slice(0, 28) || "Text"),
    type: "text",
    text: text || "New text",
    fontFamily: "Inter, sans-serif",
    fontSize: 58,
    fontWeight: 600,
    color,
    letterSpacing: 0,
    align: "left",
    transform: {
      ...identityTransform,
      x: point.x,
      y: point.y,
    },
  };
}

export function createShapeLayer(
  shape: ShapeLayer["shape"],
  bounds: ShapeLayer["bounds"],
  fill: string,
  gradientEnd?: string,
): ShapeLayer {
  return {
    ...baseLayer(shape === "ellipse" ? "Ellipse" : shape === "gradient" ? "Gradient" : "Rectangle"),
    type: "shape",
    shape,
    bounds,
    fill,
    gradientEnd,
  };
}

export function validateDocument(value: unknown): value is DocumentSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DocumentSnapshot>;
  return candidate.schemaVersion === 1
    && typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.width === "number"
    && typeof candidate.height === "number"
    && candidate.colorSpace === "srgb"
    && candidate.bitDepth === 8
    && Array.isArray(candidate.layers)
    && candidate.layers.length > 0
    && typeof candidate.selectedLayerId === "string";
}
