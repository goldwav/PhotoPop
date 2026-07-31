/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createId, createShapeLayer } from "../core/document";
import type {
  DocumentSnapshot,
  EditorCommand,
  Layer,
  MaskStroke,
  Point,
  Rect,
  ShapeLayer,
  ToolId,
  Transform,
} from "../types";

interface EditorCanvasProps {
  document: DocumentSnapshot;
  tool: ToolId;
  zoom: number;
  rotation: number;
  viewResetKey: number;
  brush: {
    size: number;
    hardness: number;
    opacity: number;
    mode: "hide" | "reveal";
  };
  onDispatch: (command: EditorCommand) => void;
  onZoomChange: (zoom: number) => void;
  onPreview: (dataUrl: string) => void;
  onSampleColor: (color: string) => void;
  onRequestText: (point: Point) => void;
}

interface GestureState {
  start: Point;
  current: Point;
  points: Point[];
  originalTransform?: Transform;
}

interface PanGestureState {
  start: Point;
  origin: Point;
}

const MAX_PREVIEW_EDGE = 2048;
const imageCache = new Map<string, HTMLImageElement>();

function getCachedImage(source: string, onLoad: () => void): HTMLImageElement | undefined {
  const existing = imageCache.get(source);
  if (existing) return existing.complete ? existing : undefined;
  const image = new Image();
  image.decoding = "async";
  image.onload = onLoad;
  image.src = source;
  imageCache.set(source, image);
  return undefined;
}

export function surfaceDimensionsForDocument(
  width: number,
  height: number,
  maxEdge = MAX_PREVIEW_EDGE,
): { width: number; height: number; scale: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
    scale,
  };
}

function createSurface(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function mapBlendMode(mode: Layer["blendMode"]): GlobalCompositeOperation {
  const supported: Record<Layer["blendMode"], GlobalCompositeOperation> = {
    normal: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    "color-dodge": "color-dodge",
    "color-burn": "color-burn",
    "hard-light": "hard-light",
    "soft-light": "soft-light",
  };
  return supported[mode];
}

function renderMask(
  mask: NonNullable<Layer["mask"]>,
  width: number,
  height: number,
  scale: number,
): HTMLCanvasElement {
  const surface = createSurface(width, height);
  const context = surface.getContext("2d", { willReadFrequently: false });
  if (!context) return surface;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.scale(scale, scale);

  mask.strokes.forEach((stroke) => {
    context.save();
    context.globalAlpha = stroke.opacity;
    context.globalCompositeOperation = stroke.mode === "hide" ? "destination-out" : "source-over";
    context.strokeStyle = "#ffffff";
    context.fillStyle = "#ffffff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = stroke.size;
    context.shadowBlur = Math.max(0, (1 - stroke.hardness) * stroke.size * 0.45 + mask.feather);
    context.shadowColor = "#ffffff";
    const [first, ...rest] = stroke.points;
    if (first) {
      context.beginPath();
      context.moveTo(first.x, first.y);
      rest.forEach((point) => context.lineTo(point.x, point.y));
      if (rest.length === 0) {
        context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.stroke();
      }
    }
    context.restore();
  });
  return surface;
}

function drawLayerContent(
  context: CanvasRenderingContext2D,
  layer: Layer,
  scheduleRender: () => void,
): void {
  context.save();
  const transform = layer.transform;
  context.translate(transform.x, transform.y);
  context.rotate(transform.rotation * Math.PI / 180);
  context.scale(transform.scaleX, transform.scaleY);

  if (layer.type === "raster") {
    const image = getCachedImage(layer.source, scheduleRender);
    if (image) context.drawImage(image, 0, 0);
  }

  if (layer.type === "text") {
    context.fillStyle = layer.color;
    context.textAlign = layer.align;
    context.textBaseline = "top";
    context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
    const characters = [...layer.text];
    let x = 0;
    characters.forEach((character) => {
      context.fillText(character, x, 0);
      x += context.measureText(character).width + layer.letterSpacing;
    });
  }

  if (layer.type === "shape") {
    const { bounds } = layer;
    context.beginPath();
    if (layer.shape === "ellipse") {
      context.ellipse(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        Math.abs(bounds.width / 2),
        Math.abs(bounds.height / 2),
        0,
        0,
        Math.PI * 2,
      );
    } else if (layer.shape === "polygon" && layer.points?.length) {
      context.moveTo(layer.points[0].x, layer.points[0].y);
      layer.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.closePath();
    } else {
      context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
    if (layer.shape === "gradient") {
      const gradient = context.createLinearGradient(
        bounds.x,
        bounds.y,
        bounds.x + bounds.width,
        bounds.y + bounds.height,
      );
      gradient.addColorStop(0, layer.fill);
      gradient.addColorStop(1, layer.gradientEnd ?? "rgba(255,255,255,0)");
      context.fillStyle = gradient;
    } else {
      context.fillStyle = layer.fill;
    }
    context.fill();
    if (layer.stroke && layer.strokeWidth) {
      context.strokeStyle = layer.stroke;
      context.lineWidth = layer.strokeWidth;
      context.stroke();
    }
  }
  context.restore();
}

function layerBounds(layer: Layer, documentWidth: number, documentHeight: number): Rect | undefined {
  if (layer.type === "raster") {
    const image = imageCache.get(layer.source);
    return {
      x: 0,
      y: 0,
      width: image?.naturalWidth || documentWidth,
      height: image?.naturalHeight || documentHeight,
    };
  }
  if (layer.type === "shape") {
    if (layer.shape === "polygon" && layer.points?.length) {
      const xs = layer.points.map((point) => point.x);
      const ys = layer.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      };
    }
    return layer.bounds;
  }
  if (layer.type === "text") {
    return {
      x: 0,
      y: 0,
      width: Math.max(layer.fontSize, layer.text.length * layer.fontSize * 0.58),
      height: layer.fontSize * 1.18,
    };
  }
  return undefined;
}

export function applyPixelAdjustment(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  layer: Extract<Layer, { type: "adjustment" }>,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(pixels);
  if (layer.adjustment === "levels") {
    const black = Math.max(0, Math.min(254, layer.values.black ?? 0));
    const white = Math.max(black + 1, Math.min(255, layer.values.white ?? 255));
    const gamma = Math.max(0.1, Math.min(3, layer.values.gamma ?? 1));
    for (let index = 0; index < result.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const normalized = Math.max(0, Math.min(1, (result[index + channel] - black) / (white - black)));
        result[index + channel] = Math.round(255 * Math.pow(normalized, 1 / gamma));
      }
    }
  }
  if (layer.adjustment === "curves") {
    const shadows = Math.max(-100, Math.min(100, layer.values.shadows ?? 0));
    const midtones = Math.max(-100, Math.min(100, layer.values.midtones ?? 0));
    const highlights = Math.max(-100, Math.min(100, layer.values.highlights ?? 0));
    for (let index = 0; index < result.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = result[index + channel];
        const normalized = value / 255;
        const shadowWeight = Math.pow(1 - normalized, 2);
        const highlightWeight = Math.pow(normalized, 2);
        const midtoneWeight = 1 - Math.abs(normalized * 2 - 1);
        result[index + channel] = Math.max(0, Math.min(255, Math.round(
          value + 1.28 * (
            shadows * shadowWeight
            + midtones * midtoneWeight
            + highlights * highlightWeight
          ),
        )));
      }
    }
  }
  if (layer.adjustment === "sharpen") {
    const amount = Math.max(0, Math.min(2, (layer.values.amount ?? 50) / 100));
    const source = new Uint8ClampedArray(result);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const neighbors = source[index - width * 4 + channel]
            + source[index + width * 4 + channel]
            + source[index - 4 + channel]
            + source[index + 4 + channel];
          result[index + channel] = Math.max(0, Math.min(255, Math.round(
            source[index + channel] * (1 + amount * 4) - neighbors * amount,
          )));
        }
      }
    }
  }
  return result;
}

function applyAdjustment(
  target: HTMLCanvasElement,
  layer: Extract<Layer, { type: "adjustment" }>,
  renderScale: number,
): void {
  const context = target.getContext("2d");
  if (!context) return;
  const width = target.width;
  const height = target.height;
  const snapshot = createSurface(width, height);
  snapshot.getContext("2d")?.drawImage(target, 0, 0);
  const filtered = createSurface(width, height);
  const filteredContext = filtered.getContext("2d");
  if (!filteredContext) return;

  if (["levels", "curves", "sharpen"].includes(layer.adjustment)) {
    filteredContext.drawImage(snapshot, 0, 0);
    const imageData = filteredContext.getImageData(0, 0, width, height);
    const adjusted = applyPixelAdjustment(imageData.data, width, height, layer);
    const adjustedImage = filteredContext.createImageData(width, height);
    adjustedImage.data.set(adjusted);
    filteredContext.putImageData(adjustedImage, 0, 0);
  } else {
    const brightness = layer.adjustment === "brightness-contrast" ? layer.values.brightness ?? 0 : 0;
    const contrast = layer.adjustment === "brightness-contrast" ? layer.values.contrast ?? 0 : 0;
    const saturation = layer.adjustment === "hue-saturation" ? layer.values.saturation ?? 0 : 0;
    const hue = layer.adjustment === "hue-saturation" ? layer.values.hue ?? 0 : 0;
    const blur = layer.adjustment === "blur" ? (layer.values.radius ?? 2) * renderScale : 0;
    filteredContext.filter = [
      `brightness(${Math.max(0, 100 + brightness)}%)`,
      `contrast(${Math.max(0, 100 + contrast)}%)`,
      `saturate(${Math.max(0, 100 + saturation)}%)`,
      `hue-rotate(${hue}deg)`,
      `blur(${Math.max(0, blur)}px)`,
    ].join(" ");
    filteredContext.drawImage(snapshot, 0, 0);
  }

  context.save();
  context.clearRect(0, 0, width, height);
  context.drawImage(snapshot, 0, 0);
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = mapBlendMode(layer.blendMode);
  context.drawImage(filtered, 0, 0);
  context.restore();
}

export function renderDocument(
  snapshot: DocumentSnapshot,
  scheduleRender: () => void,
): HTMLCanvasElement {
  const dimensions = surfaceDimensionsForDocument(snapshot.width, snapshot.height);
  const output = createSurface(dimensions.width, dimensions.height);
  const outputContext = output.getContext("2d");
  if (!outputContext) return output;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";

  const groups = new Map(
    snapshot.layers.filter((layer) => layer.type === "group").map((layer) => [layer.id, layer]),
  );
  const hierarchyState = (layer: Layer) => {
    let visible = true;
    let opacity = 1;
    let parentId = layer.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const group = groups.get(parentId);
      if (!group) break;
      visible = visible && group.visible;
      opacity *= group.opacity;
      parentId = group.parentId;
    }
    return { visible, opacity };
  };

  snapshot.layers.forEach((layer) => {
    const hierarchy = hierarchyState(layer);
    if (!layer.visible || !hierarchy.visible) return;
    if (layer.type === "group") return;
    if (layer.type === "adjustment") {
      applyAdjustment(output, { ...layer, opacity: layer.opacity * hierarchy.opacity }, dimensions.scale);
      return;
    }

    const surface = createSurface(dimensions.width, dimensions.height);
    const context = surface.getContext("2d");
    if (!context) return;
    context.scale(dimensions.scale, dimensions.scale);
    drawLayerContent(context, layer, scheduleRender);

    outputContext.save();
    outputContext.globalCompositeOperation = mapBlendMode(layer.blendMode);
    const opacity = layer.opacity * hierarchy.opacity;
    if (layer.mask && layer.mask.strokes.length) {
      const masked = createSurface(dimensions.width, dimensions.height);
      const maskedContext = masked.getContext("2d");
      if (maskedContext) {
        maskedContext.drawImage(surface, 0, 0);
        maskedContext.globalCompositeOperation = "destination-in";
        maskedContext.drawImage(renderMask(layer.mask, dimensions.width, dimensions.height, dimensions.scale), 0, 0);
        outputContext.globalAlpha = opacity * (1 - layer.mask.density);
        outputContext.drawImage(surface, 0, 0);
        outputContext.globalAlpha = opacity * layer.mask.density;
        outputContext.drawImage(masked, 0, 0);
      }
    } else {
      outputContext.globalAlpha = opacity;
      outputContext.drawImage(surface, 0, 0);
    }
    outputContext.restore();
  });
  return output;
}

export function EditorCanvas({
  document: snapshot,
  tool,
  zoom,
  rotation,
  viewResetKey,
  brush,
  onDispatch,
  onZoomChange,
  onPreview,
  onSampleColor,
  onRequestText,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<DOMMatrix>(new DOMMatrix());
  const artboardRef = useRef<HTMLCanvasElement | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [gesture, setGesture] = useState<GestureState>();
  const [cursor, setCursor] = useState<Point>();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spacePan, setSpacePan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panGestureRef = useRef<PanGestureState | undefined>(undefined);
  const selectedLayer = snapshot.layers.find((layer) => layer.id === snapshot.selectedLayerId);

  const scheduleRender = useCallback(() => setRenderTick((value) => value + 1), []);
  const artboard = useMemo(
    () => renderDocument(snapshot, scheduleRender),
    [renderTick, scheduleRender, snapshot],
  );

  useLayoutEffect(() => {
    artboardRef.current = artboard;
    onPreview(artboard.toDataURL("image/png"));
  }, [artboard, onPreview]);

  useEffect(() => {
    const activeSources = new Set(
      snapshot.layers.flatMap((layer) => layer.type === "raster" ? [layer.source] : []),
    );
    imageCache.forEach((_image, source) => {
      if (!activeSources.has(source)) imageCache.delete(source);
    });
  }, [snapshot.id, snapshot.layers]);

  const viewportToArtboard = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const point = new DOMPoint(event.clientX - rect.left, event.clientY - rect.top);
    const mapped = point.matrixTransform(matrixRef.current.inverse());
    const horizontalMargin = Math.max(500, snapshot.width / 2);
    const verticalMargin = Math.max(500, snapshot.height / 2);
    return {
      x: Math.max(-horizontalMargin, Math.min(snapshot.width + horizontalMargin, mapped.x)),
      y: Math.max(-verticalMargin, Math.min(snapshot.height + verticalMargin, mapped.y)),
    };
  }, [snapshot.height, snapshot.width]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#303234";
    context.fillRect(0, 0, width, height);

    const verticalPadding = height <= 600 ? 30 : 76;
    const fitScale = Math.max(0.01, Math.min(
      (width - 96) / snapshot.width,
      (height - verticalPadding) / snapshot.height,
    ));
    const scale = fitScale * (zoom / 0.5);
    const matrix = new DOMMatrix()
      .translate(width / 2 + pan.x, height / 2 + pan.y)
      .rotate(rotation)
      .scale(scale)
      .translate(-snapshot.width / 2, -snapshot.height / 2);
    matrixRef.current = matrix;

    context.save();
    context.setTransform(
      matrix.a * dpr,
      matrix.b * dpr,
      matrix.c * dpr,
      matrix.d * dpr,
      matrix.e * dpr,
      matrix.f * dpr,
    );
    context.shadowColor = "rgba(0,0,0,.28)";
    context.shadowBlur = 18 / scale;
    context.shadowOffsetY = 5 / scale;
    context.drawImage(artboard, 0, 0, snapshot.width, snapshot.height);
    context.restore();

    context.save();
    context.setTransform(
      matrix.a * dpr,
      matrix.b * dpr,
      matrix.c * dpr,
      matrix.d * dpr,
      matrix.e * dpr,
      matrix.f * dpr,
    );
    context.shadowColor = "transparent";

    if (tool === "move" && selectedLayer && selectedLayer.visible) {
      const bounds = layerBounds(selectedLayer, snapshot.width, snapshot.height);
      if (bounds) {
        context.save();
        context.translate(selectedLayer.transform.x, selectedLayer.transform.y);
        context.rotate(selectedLayer.transform.rotation * Math.PI / 180);
        context.scale(selectedLayer.transform.scaleX, selectedLayer.transform.scaleY);
        const handleSize = 12 / scale;
        context.strokeStyle = "#f04f42";
        context.lineWidth = 1.7 / scale;
        context.setLineDash([]);
        context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        context.fillStyle = "#ffffff";
        context.strokeStyle = "#f04f42";
        [
          [bounds.x, bounds.y],
          [bounds.x + bounds.width, bounds.y],
          [bounds.x, bounds.y + bounds.height],
          [bounds.x + bounds.width, bounds.y + bounds.height],
        ].forEach(([x, y]) => {
          context.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
          context.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        });
        context.restore();
      }
    }

    if (snapshot.selection.kind !== "none") {
      context.save();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1 / scale;
      context.setLineDash([6 / scale, 4 / scale]);
      context.lineDashOffset = renderTick % 10;
      if (snapshot.selection.bounds) {
        const bounds = snapshot.selection.bounds;
        context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      }
      if (snapshot.selection.points?.length) {
        context.beginPath();
        context.moveTo(snapshot.selection.points[0].x, snapshot.selection.points[0].y);
        snapshot.selection.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.closePath();
        context.stroke();
      }
      context.restore();
    }

    if (gesture && ["marquee", "crop", "rectangle", "ellipse", "gradient"].includes(tool)) {
      const bounds = normalizedRect(gesture.start, gesture.current);
      context.save();
      context.strokeStyle = "#f04f42";
      context.fillStyle = "rgba(240,79,66,.1)";
      context.lineWidth = 2 / scale;
      context.setLineDash([8 / scale, 5 / scale]);
      if (tool === "ellipse") {
        context.beginPath();
        context.ellipse(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
          bounds.width / 2,
          bounds.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.stroke();
      } else {
        context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      }
      context.restore();
    }

    if (gesture && tool === "lasso" && gesture.points.length) {
      context.save();
      context.strokeStyle = "#f04f42";
      context.lineWidth = 2 / scale;
      context.beginPath();
      context.moveTo(gesture.points[0].x, gesture.points[0].y);
      gesture.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
      context.restore();
    }

    if (gesture && ["brush", "eraser"].includes(tool) && gesture.points.length) {
      context.save();
      context.strokeStyle = tool === "brush" ? "rgba(240,79,66,.65)" : "rgba(255,255,255,.7)";
      context.lineWidth = brush.size;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(gesture.points[0].x, gesture.points[0].y);
      gesture.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
      context.restore();
    }

    if (cursor && ["brush", "eraser"].includes(tool)) {
      context.save();
      context.strokeStyle = "#1f1f1f";
      context.lineWidth = 1.2 / scale;
      context.beginPath();
      context.arc(cursor.x, cursor.y, brush.size / 2, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 0.7 / scale;
      context.beginPath();
      context.arc(cursor.x, cursor.y, brush.size / 2 + 1.5 / scale, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    context.restore();

  }, [
    brush.size,
    cursor,
    gesture,
    pan.x,
    pan.y,
    rotation,
    snapshot,
    artboard,
    tool,
    zoom,
    selectedLayer,
  ]);

  useLayoutEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [viewResetKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "Space" || target?.closest("button, a, summary, input, textarea, select, [contenteditable=true], [role=button]")) return;
      event.preventDefault();
      setSpacePan(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePan(false);
    };
    const onBlur = () => {
      setSpacePan(false);
      setIsPanning(false);
      panGestureRef.current = undefined;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (spacePan || event.button === 1) {
      event.preventDefault();
      panGestureRef.current = {
        start: { x: event.clientX, y: event.clientY },
        origin: pan,
      };
      setIsPanning(true);
      return;
    }
    const point = viewportToArtboard(event);
    setCursor(point);

    if (tool === "eyedropper") {
      const rendered = artboardRef.current;
      const pixel = rendered?.getContext("2d")?.getImageData(
        Math.max(0, Math.min((rendered?.width ?? 1) - 1, Math.round(point.x * (rendered?.width ?? 1) / snapshot.width))),
        Math.max(0, Math.min((rendered?.height ?? 1) - 1, Math.round(point.y * (rendered?.height ?? 1) / snapshot.height))),
        1,
        1,
      ).data;
      if (pixel) onSampleColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
      return;
    }
    if (tool === "text") {
      onRequestText(point);
      return;
    }
    if (tool === "fill" && selectedLayer && !selectedLayer.locked && selectedLayer.type === "shape") {
      onDispatch({
        type: "layer/update",
        layerId: selectedLayer.id,
        changes: { fill: snapshot.foreground } as Partial<Layer>,
      });
      return;
    }

    setGesture({
      start: point,
      current: point,
      points: [point],
      originalTransform: selectedLayer ? { ...selectedLayer.transform } : undefined,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const panGesture = panGestureRef.current;
    if (panGesture) {
      setPan({
        x: panGesture.origin.x + event.clientX - panGesture.start.x,
        y: panGesture.origin.y + event.clientY - panGesture.start.y,
      });
      return;
    }
    const point = viewportToArtboard(event);
    setCursor(point);
    if (!gesture) return;
    setGesture({
      ...gesture,
      current: point,
      points: ["brush", "eraser", "lasso"].includes(tool)
        ? [...gesture.points, point]
        : gesture.points,
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panGestureRef.current) {
      panGestureRef.current = undefined;
      setIsPanning(false);
      return;
    }
    if (!gesture) return;
    const point = viewportToArtboard(event);
    const complete = { ...gesture, current: point };
    const bounds = normalizedRect(complete.start, complete.current);

    if (tool === "move" && selectedLayer && !selectedLayer.locked && complete.originalTransform) {
      onDispatch({
        type: "layer/update",
        layerId: selectedLayer.id,
        changes: {
          transform: {
            ...complete.originalTransform,
            x: complete.originalTransform.x + point.x - complete.start.x,
            y: complete.originalTransform.y + point.y - complete.start.y,
          },
        },
      });
    }
    if (["brush", "eraser"].includes(tool) && selectedLayer && !selectedLayer.locked) {
      const stroke: MaskStroke = {
        id: createId("stroke"),
        points: [...complete.points, point],
        size: brush.size,
        hardness: brush.hardness,
        opacity: brush.opacity,
        mode: tool === "eraser" ? "reveal" : brush.mode,
      };
      onDispatch({ type: "mask/stroke", layerId: selectedLayer.id, stroke });
    }
    if (tool === "marquee" || tool === "crop") {
      onDispatch({
        type: "selection/set",
        selection: { kind: "rect", bounds, feather: snapshot.selection.feather },
      });
    }
    if (tool === "lasso") {
      onDispatch({
        type: "selection/set",
        selection: { kind: "lasso", points: [...complete.points, point], feather: snapshot.selection.feather },
      });
    }
    if (tool === "rectangle" || tool === "ellipse") {
      const layer = createShapeLayer(tool, bounds, snapshot.foreground);
      onDispatch({ type: "layer/add", layer });
    }
    if (tool === "gradient") {
      const layer = createShapeLayer("gradient", bounds, snapshot.foreground, snapshot.background);
      onDispatch({ type: "layer/add", layer });
    }
    setGesture(undefined);
  };

  const onCanvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const deltas: Partial<Record<string, Point>> = {
      ArrowLeft: { x: 24, y: 0 },
      ArrowRight: { x: -24, y: 0 },
      ArrowUp: { x: 0, y: 24 },
      ArrowDown: { x: 0, y: -24 },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    setPan((value) => ({ x: value.x + delta.x, y: value.y + delta.y }));
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const nextZoom = Math.max(0.1, Math.min(4, zoom * Math.exp(-event.deltaY * 0.002)));
      const ratio = nextZoom / zoom;
      const rect = event.currentTarget.getBoundingClientRect();
      const local = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      setPan((value) => ({
        x: local.x - ratio * (local.x - value.x),
        y: local.y - ratio * (local.y - value.y),
      }));
      onZoomChange(nextZoom);
      return;
    }
    if (event.shiftKey) {
      setPan((value) => ({ ...value, x: value.x - event.deltaY * 0.5 }));
    } else {
      setPan((value) => ({ x: value.x - event.deltaX * 0.4, y: value.y - event.deltaY * 0.4 }));
    }
  };

  return (
    <div
      ref={containerRef}
      className={[
        "canvas-viewport",
        spacePan ? "space-pan" : "",
        isPanning ? "is-panning" : "",
      ].filter(Boolean).join(" ")}
      data-testid="canvas-viewport"
    >
      <canvas
        ref={canvasRef}
        aria-label={`Editing canvas for ${snapshot.name}. Use arrow keys to pan, Control plus scroll to zoom, or hold Space while dragging.`}
        title="Scroll to pan · Ctrl+scroll to zoom · Hold Space to pan"
        tabIndex={0}
        onKeyDown={onCanvasKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setCursor(undefined)}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
    </div>
  );
}

function normalizedRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
