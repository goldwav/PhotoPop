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
  brush: {
    size: number;
    hardness: number;
    opacity: number;
    mode: "hide" | "reveal";
  };
  onDispatch: (command: EditorCommand) => void;
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

const ARTBOARD_SIZE = 1000;
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

function createSurface(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ARTBOARD_SIZE;
  canvas.height = ARTBOARD_SIZE;
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

function renderMask(mask: NonNullable<Layer["mask"]>): HTMLCanvasElement {
  const surface = createSurface();
  const context = surface.getContext("2d", { willReadFrequently: false });
  if (!context) return surface;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, ARTBOARD_SIZE, ARTBOARD_SIZE);

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
    if (image) context.drawImage(image, 0, 0, ARTBOARD_SIZE, ARTBOARD_SIZE);
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

function applyAdjustment(
  target: HTMLCanvasElement,
  layer: Extract<Layer, { type: "adjustment" }>,
): void {
  const context = target.getContext("2d");
  if (!context) return;
  const snapshot = createSurface();
  snapshot.getContext("2d")?.drawImage(target, 0, 0);
  const brightness = layer.adjustment === "brightness-contrast"
    ? layer.values.brightness ?? 0
    : 0;
  const contrast = layer.adjustment === "brightness-contrast"
    ? layer.values.contrast ?? 0
    : 0;
  const saturation = layer.adjustment === "hue-saturation"
    ? layer.values.saturation ?? 0
    : 0;
  const hue = layer.adjustment === "hue-saturation"
    ? layer.values.hue ?? 0
    : 0;
  const blur = layer.adjustment === "blur" ? layer.values.radius ?? 2 : 0;
  context.save();
  context.clearRect(0, 0, ARTBOARD_SIZE, ARTBOARD_SIZE);
  context.globalAlpha = layer.opacity;
  context.filter = [
    `brightness(${100 + brightness}%)`,
    `contrast(${100 + contrast}%)`,
    `saturate(${100 + saturation}%)`,
    `hue-rotate(${hue}deg)`,
    `blur(${blur}px)`,
  ].join(" ");
  context.drawImage(snapshot, 0, 0);
  context.restore();
}

export function renderDocument(
  snapshot: DocumentSnapshot,
  scheduleRender: () => void,
): HTMLCanvasElement {
  const output = createSurface();
  const outputContext = output.getContext("2d");
  if (!outputContext) return output;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";

  const groups = new Map(
    snapshot.layers.filter((layer) => layer.type === "group").map((layer) => [layer.id, layer]),
  );

  snapshot.layers.forEach((layer) => {
    if (!layer.visible || (layer.parentId && groups.get(layer.parentId)?.visible === false)) return;
    if (layer.type === "group") return;
    if (layer.type === "adjustment") {
      applyAdjustment(output, layer);
      return;
    }

    const surface = createSurface();
    const context = surface.getContext("2d");
    if (!context) return;
    drawLayerContent(context, layer, scheduleRender);

    outputContext.save();
    outputContext.globalCompositeOperation = mapBlendMode(layer.blendMode);
    if (layer.mask && layer.mask.strokes.length) {
      const masked = createSurface();
      const maskedContext = masked.getContext("2d");
      if (maskedContext) {
        maskedContext.drawImage(surface, 0, 0);
        maskedContext.globalCompositeOperation = "destination-in";
        maskedContext.drawImage(renderMask(layer.mask), 0, 0);
        outputContext.globalAlpha = layer.opacity * (1 - layer.mask.density);
        outputContext.drawImage(surface, 0, 0);
        outputContext.globalAlpha = layer.opacity * layer.mask.density;
        outputContext.drawImage(masked, 0, 0);
      }
    } else {
      outputContext.globalAlpha = layer.opacity;
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
  brush,
  onDispatch,
  onPreview,
  onSampleColor,
  onRequestText,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<DOMMatrix>(new DOMMatrix());
  const artboardRef = useRef<HTMLCanvasElement>(createSurface());
  const [renderTick, setRenderTick] = useState(0);
  const [gesture, setGesture] = useState<GestureState>();
  const [cursor, setCursor] = useState<Point>();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const selectedLayer = snapshot.layers.find((layer) => layer.id === snapshot.selectedLayerId);

  const scheduleRender = useCallback(() => setRenderTick((value) => value + 1), []);

  const viewportToArtboard = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const point = new DOMPoint(event.clientX - rect.left, event.clientY - rect.top);
    const mapped = point.matrixTransform(matrixRef.current.inverse());
    return {
      x: Math.max(-500, Math.min(1500, mapped.x)),
      y: Math.max(-500, Math.min(1500, mapped.y)),
    };
  }, []);

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

    const artboard = renderDocument(snapshot, scheduleRender);
    artboardRef.current = artboard;
    const verticalPadding = height <= 600 ? 30 : 76;
    const fitScale = Math.max(0.1, Math.min(
      (width - 96) / ARTBOARD_SIZE,
      (height - verticalPadding) / ARTBOARD_SIZE,
    ));
    const scale = fitScale * (zoom / 0.5);
    const matrix = new DOMMatrix()
      .translate(width / 2 + pan.x, height / 2 + pan.y)
      .rotate(rotation)
      .scale(scale)
      .translate(-ARTBOARD_SIZE / 2, -ARTBOARD_SIZE / 2);
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
    context.drawImage(artboard, 0, 0);
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

    onPreview(artboard.toDataURL("image/png"));
  }, [
    brush.size,
    cursor,
    gesture,
    onPreview,
    pan.x,
    pan.y,
    renderTick,
    rotation,
    scheduleRender,
    snapshot,
    tool,
    zoom,
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

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = viewportToArtboard(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setCursor(point);

    if (tool === "eyedropper") {
      const pixel = artboardRef.current.getContext("2d")?.getImageData(
        Math.max(0, Math.min(999, Math.round(point.x))),
        Math.max(0, Math.min(999, Math.round(point.y))),
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
    if (tool === "fill" && selectedLayer && selectedLayer.type === "shape") {
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
    if (["brush", "eraser"].includes(tool) && selectedLayer) {
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

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (event.shiftKey) {
      setPan((value) => ({ ...value, x: value.x - event.deltaY * 0.5 }));
    } else if (!event.ctrlKey) {
      setPan((value) => ({ x: value.x - event.deltaX * 0.4, y: value.y - event.deltaY * 0.4 }));
    }
  };

  return (
    <div ref={containerRef} className="canvas-viewport" data-testid="canvas-viewport">
      <canvas
        ref={canvasRef}
        aria-label={`Editing canvas for ${snapshot.name}`}
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
