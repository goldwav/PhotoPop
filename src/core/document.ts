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

export function createBlankDocument(
  width = 1600,
  height = 1200,
  name = "Untitled",
): DocumentSnapshot {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const now = new Date().toISOString();
  const background: ShapeLayer = {
    ...baseLayer("Background"),
    type: "shape",
    shape: "rectangle",
    bounds: { x: 0, y: 0, width: safeWidth, height: safeHeight },
    fill: "#ffffff",
  };
  return {
    schemaVersion: 1,
    id: createId("document"),
    name,
    width: safeWidth,
    height: safeHeight,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [background],
    selectedLayerId: background.id,
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#ffffff",
    createdAt: now,
    updatedAt: now,
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
    width: 1000,
    height: 1000,
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
  let changed = false;
  const layers = document.layers.map((layer) => {
    if (layer.id !== layerId) return layer;
    const next = updater(layer);
    if (next !== layer) changed = true;
    return next;
  });
  return changed ? touch({ ...document, layers }) : document;
}

export function reduceDocument(
  document: DocumentSnapshot,
  command: EditorCommand,
): DocumentSnapshot {
  switch (command.type) {
    case "layer/select":
      return command.layerId !== document.selectedLayerId
        && document.layers.some((layer) => layer.id === command.layerId)
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
    case "layer/reorder-to": {
      const sourceIndex = document.layers.findIndex((layer) => layer.id === command.layerId);
      const targetIndex = document.layers.findIndex((layer) => layer.id === command.targetLayerId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return document;
      const layers = [...document.layers];
      const [moved] = layers.splice(sourceIndex, 1);
      layers.splice(targetIndex, 0, moved);
      return touch({ ...document, layers });
    }
    case "layer/toggle-visibility":
      return updateLayer(document, command.layerId, (layer) => ({
        ...layer,
        visible: !layer.visible,
      }));
    case "layer/update":
      return updateLayer(document, command.layerId, (layer) => {
        const changeKeys = Object.keys(command.changes);
        const unlockOnly = changeKeys.length === 1 && changeKeys[0] === "locked" && command.changes.locked === false;
        if (layer.locked && !unlockOnly) return layer;
        return {
          ...layer,
          ...command.changes,
          transform: command.changes.transform
            ? { ...layer.transform, ...command.changes.transform }
            : layer.transform,
        } as Layer;
      });
    case "mask/ensure":
      return updateLayer(document, command.layerId, (layer) => layer.locked || layer.mask
        ? layer
        : { ...layer, mask: createDefaultMask() });
    case "mask/settings":
      return updateLayer(document, command.layerId, (layer) => layer.locked
        ? layer
        : {
            ...layer,
            mask: {
              ...(layer.mask ?? createDefaultMask()),
              density: command.density ?? layer.mask?.density ?? 1,
              feather: command.feather ?? layer.mask?.feather ?? 0,
            },
          });
    case "mask/stroke":
      return updateLayer(document, command.layerId, (layer) => layer.locked
        ? layer
        : {
            ...layer,
            mask: {
              ...(layer.mask ?? createDefaultMask()),
              strokes: [...(layer.mask?.strokes ?? []), command.stroke],
            },
          });
    case "selection/set":
      return { ...document, selection: command.selection };
    case "selection/clear":
      return document.selection.kind === "none" && document.selection.feather === 0
        ? document
        : { ...document, selection: { kind: "none", feather: 0 } };
    case "document/rename":
      return touch({ ...document, name: command.name.trim() || document.name });
    case "document/crop": {
      const layers = document.layers.map((layer) => ({
        ...layer,
        transform: {
          ...layer.transform,
          x: layer.transform.x - command.bounds.x,
          y: layer.transform.y - command.bounds.y,
        },
      }));
      return touch({
        ...document,
        width: Math.max(1, Math.round(command.bounds.width)),
        height: Math.max(1, Math.round(command.bounds.height)),
        layers,
        selection: { kind: "none", feather: 0 },
      });
    }
    case "colors/set": {
      const foreground = command.foreground ?? document.foreground;
      const background = command.background ?? document.background;
      return foreground === document.foreground && background === document.background
        ? document
        : { ...document, foreground, background };
    }
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
  if (command.type === "layer/select") {
    return {
      ...state,
      present: next,
    };
  }
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

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validTransform(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const transform = value as Partial<BaseLayer["transform"]>;
  return finiteNumber(transform.x)
    && finiteNumber(transform.y)
    && finiteNumber(transform.scaleX)
    && finiteNumber(transform.scaleY)
    && finiteNumber(transform.rotation)
    && Math.abs(transform.scaleX) <= 1_000
    && Math.abs(transform.scaleY) <= 1_000;
}

function validMask(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const mask = value as Partial<LayerMask>;
  return finiteNumber(mask.density)
    && mask.density >= 0
    && mask.density <= 1
    && finiteNumber(mask.feather)
    && mask.feather >= 0
    && mask.feather <= 10_000
    && Array.isArray(mask.strokes)
    && mask.strokes.length <= 100_000
    && mask.strokes.every((stroke) => Boolean(stroke)
      && typeof stroke.id === "string"
      && stroke.id.length > 0
      && Array.isArray(stroke.points)
      && stroke.points.length <= 1_000_000
      && stroke.points.every((point) => finiteNumber(point?.x) && finiteNumber(point?.y))
      && finiteNumber(stroke.size)
      && stroke.size > 0
      && stroke.size <= 100_000
      && finiteNumber(stroke.hardness)
      && stroke.hardness >= 0
      && stroke.hardness <= 1
      && finiteNumber(stroke.opacity)
      && stroke.opacity >= 0
      && stroke.opacity <= 1
      && (stroke.mode === "hide" || stroke.mode === "reveal"));
}

function validLayer(value: unknown): value is Layer {
  if (!value || typeof value !== "object") return false;
  const layer = value as Partial<Layer>;
  if (typeof layer.id !== "string" || !layer.id || layer.id.length > 200
    || typeof layer.name !== "string" || layer.name.length > 10_000
    || typeof layer.visible !== "boolean"
    || typeof layer.locked !== "boolean"
    || !finiteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
    || !validTransform(layer.transform)
    || !validMask(layer.mask)) return false;
  if (layer.parentId !== undefined && typeof layer.parentId !== "string") return false;
  if (![
    "normal", "multiply", "screen", "overlay", "darken", "lighten",
    "color-dodge", "color-burn", "hard-light", "soft-light",
  ].includes(String(layer.blendMode))) return false;

  if (layer.type === "raster") return typeof layer.source === "string" && layer.source.length <= 512 * 1024 * 1024;
  if (layer.type === "group") return true;
  if (layer.type === "text") {
    return typeof layer.text === "string"
      && layer.text.length <= 1_000_000
      && typeof layer.fontFamily === "string"
      && finiteNumber(layer.fontSize) && layer.fontSize > 0 && layer.fontSize <= 100_000
      && finiteNumber(layer.fontWeight)
      && typeof layer.color === "string"
      && finiteNumber(layer.letterSpacing)
      && ["left", "right", "center", "start", "end"].includes(String(layer.align));
  }
  if (layer.type === "shape") {
    return Boolean(layer.bounds)
      && finiteNumber(layer.bounds?.x)
      && finiteNumber(layer.bounds?.y)
      && finiteNumber(layer.bounds?.width)
      && finiteNumber(layer.bounds?.height)
      && typeof layer.fill === "string"
      && ["rectangle", "ellipse", "polygon", "gradient"].includes(String(layer.shape));
  }
  if (layer.type === "adjustment") {
    return ["brightness-contrast", "hue-saturation", "levels", "curves", "blur", "sharpen"].includes(String(layer.adjustment))
      && Boolean(layer.values)
      && Object.keys(layer.values ?? {}).length <= 100
      && Object.values(layer.values ?? {}).every(finiteNumber);
  }
  return false;
}

export function validateDocument(value: unknown): value is DocumentSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DocumentSnapshot>;
  if (candidate.schemaVersion !== 1
    || typeof candidate.id !== "string" || !candidate.id
    || typeof candidate.name !== "string" || candidate.name.length > 10_000
    || !finiteNumber(candidate.width) || candidate.width < 1 || candidate.width > 100_000
    || !finiteNumber(candidate.height) || candidate.height < 1 || candidate.height > 100_000
    || candidate.colorSpace !== "srgb"
    || candidate.bitDepth !== 8
    || !Array.isArray(candidate.layers)
    || candidate.layers.length < 1
    || candidate.layers.length > 100_000
    || !candidate.layers.every(validLayer)
    || typeof candidate.selectedLayerId !== "string") return false;

  const ids = new Set(candidate.layers.map((layer) => layer.id));
  if (ids.size !== candidate.layers.length || !ids.has(candidate.selectedLayerId)) return false;
  const groups = new Set(candidate.layers.filter((layer) => layer.type === "group").map((layer) => layer.id));
  if (candidate.layers.some((layer) => layer.parentId && (!groups.has(layer.parentId) || layer.parentId === layer.id))) return false;

  const selection = candidate.selection;
  return Boolean(selection)
    && ["none", "rect", "lasso"].includes(String(selection?.kind))
    && finiteNumber(selection?.feather)
    && selection!.feather >= 0
    && typeof candidate.foreground === "string"
    && typeof candidate.background === "string"
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string";
}