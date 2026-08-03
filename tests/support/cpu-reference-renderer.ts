/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  AdjustmentLayer,
  BlendMode,
  DocumentSnapshot,
  Layer,
  ShapeLayer,
} from "../../src/types";

interface Rgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/**
 * A deliberately small, deterministic CPU compositor for rendering fixtures.
 *
 * This is not the interactive renderer. It is an independent reference used
 * to catch visual drift in the accelerated renderer. Reference fixtures use
 * hard-edged shape layers and byte-based adjustments only so results do not
 * depend on fonts, browser rasterization, GPU drivers, or image decoders.
 */
export function renderShapeReference(
  snapshot: DocumentSnapshot,
  width: number,
  height: number,
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Reference dimensions must be positive integers.");
  }

  const pixels = new Uint8Array(width * height * 4);
  const groups = new Map(
    snapshot.layers.filter((layer) => layer.type === "group").map((layer) => [layer.id, layer]),
  );

  for (const layer of snapshot.layers) {
    if (layer.type === "group") continue;
    const hierarchy = hierarchyState(layer, groups);
    if (!layer.visible || !hierarchy.visible) continue;
    if (layer.type === "shape") {
      compositeShape(
        pixels,
        width,
        height,
        snapshot.width,
        snapshot.height,
        layer,
        hierarchy.opacity,
      );
      continue;
    }
    if (layer.type === "adjustment") {
      applyAdjustmentReference(
        pixels,
        width,
        height,
        snapshot.width,
        snapshot.height,
        layer,
        hierarchy.opacity,
      );
      continue;
    }
    throw new Error(`The CPU reference fixture does not support ${layer.type} layers.`);
  }
  return pixels;
}

function hierarchyState(
  layer: Layer,
  groups: Map<string, Extract<Layer, { type: "group" }>>,
): { visible: boolean; opacity: number } {
  let visible = true;
  let opacity = 1;
  let parentId = layer.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const group = groups.get(parentId);
    if (!group) break;
    visible = visible && group.visible;
    opacity *= clamp(group.opacity);
    parentId = group.parentId;
  }
  return { visible, opacity };
}

function compositeShape(
  pixels: Uint8Array,
  width: number,
  height: number,
  documentWidth: number,
  documentHeight: number,
  layer: ShapeLayer,
  hierarchyOpacity: number,
): void {
  validateShapeFixture(layer);
  const sourceColor = parseColor(layer.fill);
  sourceColor.alpha *= clamp(layer.opacity) * hierarchyOpacity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const artboardPoint = {
        x: (x + 0.5) * documentWidth / width,
        y: (y + 0.5) * documentHeight / height,
      };
      const local = inverseTransform(artboardPoint, layer);
      if (!shapeContains(layer, local.x, local.y)) continue;

      const maskedSource = { ...sourceColor };
      if (layer.mask?.strokes.length) {
        const maskAlpha = hardMaskAlphaAt(layer.mask, artboardPoint.x, artboardPoint.y);
        const density = clamp(layer.mask.density);
        maskedSource.alpha *= (1 - density) + density * maskAlpha;
      }

      const offset = (y * width + x) * 4;
      const backdrop: Rgba = {
        red: pixels[offset] / 255,
        green: pixels[offset + 1] / 255,
        blue: pixels[offset + 2] / 255,
        alpha: pixels[offset + 3] / 255,
      };
      const result = composite(backdrop, maskedSource, layer.blendMode);
      pixels[offset] = toByte(result.red);
      pixels[offset + 1] = toByte(result.green);
      pixels[offset + 2] = toByte(result.blue);
      pixels[offset + 3] = toByte(result.alpha);
    }
  }
}

function validateShapeFixture(layer: ShapeLayer): void {
  if (layer.shape === "gradient") {
    throw new Error("The CPU reference fixture does not support browser-rasterized gradient shapes.");
  }
  if (layer.stroke && (layer.strokeWidth ?? 0) > 0) {
    throw new Error("The CPU reference fixture does not support antialiased shape strokes.");
  }
  validateHardMask(layer.mask);
}

function validateHardMask(mask: Layer["mask"]): void {
  if (!mask?.strokes.length) return;
  if (mask.feather !== 0 || mask.strokes.some((stroke) => stroke.hardness !== 1)) {
    throw new Error("The CPU reference fixture supports hard masks only (100% hardness and 0px feather).");
  }
}

function hardMaskAlphaAt(
  mask: NonNullable<Layer["mask"]>,
  x: number,
  y: number,
): number {
  let alpha = 1;
  for (const stroke of mask.strokes) {
    if (!strokeContains(stroke.points, Math.max(0, stroke.size) / 2, x, y)) continue;
    const opacity = clamp(stroke.opacity);
    alpha = stroke.mode === "hide"
      ? alpha * (1 - opacity)
      : opacity + alpha * (1 - opacity);
  }
  return alpha;
}

function strokeContains(
  points: Array<{ x: number; y: number }>,
  radius: number,
  x: number,
  y: number,
): boolean {
  const first = points[0];
  if (!first) return false;
  if (points.length === 1) return squaredDistance(first.x, first.y, x, y) <= radius * radius;
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegmentSquared(x, y, points[index - 1], points[index]) <= radius * radius) {
      return true;
    }
  }
  return false;
}

function squaredDistance(x1: number, y1: number, x2: number, y2: number): number {
  const xDistance = x2 - x1;
  const yDistance = y2 - y1;
  return xDistance * xDistance + yDistance * yDistance;
}

function distanceToSegmentSquared(
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return squaredDistance(start.x, start.y, x, y);
  const projection = clamp(((x - start.x) * segmentX + (y - start.y) * segmentY) / lengthSquared);
  return squaredDistance(start.x + projection * segmentX, start.y + projection * segmentY, x, y);
}

function applyAdjustmentReference(
  pixels: Uint8Array,
  width: number,
  height: number,
  documentWidth: number,
  documentHeight: number,
  layer: AdjustmentLayer,
  hierarchyOpacity: number,
): void {
  if (["brightness-contrast", "hue-saturation", "blur"].includes(layer.adjustment)) {
    throw new Error(`The CPU reference fixture does not support browser-filtered ${layer.adjustment} adjustments.`);
  }
  validateHardMask(layer.mask);

  const original = new Uint8Array(pixels);
  const adjusted = adjustPixels(original, width, height, layer);
  const layerOpacity = clamp(layer.opacity) * hierarchyOpacity;
  for (let index = 0; index < pixels.length; index += 4) {
    const pixelIndex = index / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    let strength = layerOpacity;
    if (layer.mask?.strokes.length) {
      const artboardX = (x + 0.5) * documentWidth / width;
      const artboardY = (y + 0.5) * documentHeight / height;
      const maskAlpha = hardMaskAlphaAt(layer.mask, artboardX, artboardY);
      const density = clamp(layer.mask.density);
      strength *= (1 - density) + density * maskAlpha;
    }

    const backdropAlpha = original[index + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const backdrop = original[index + channel] / 255;
      const source = adjusted[index + channel] / 255;
      const blended = blendChannel(backdrop, source, layer.blendMode);
      const overlapAware = source + backdropAlpha * (blended - source);
      pixels[index + channel] = toByte(backdrop + strength * (overlapAware - backdrop));
    }
    pixels[index + 3] = original[index + 3];
  }
}

function adjustPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  layer: AdjustmentLayer,
): Uint8Array {
  const result = new Uint8Array(pixels);
  if (layer.adjustment === "levels") {
    const black = Math.max(0, Math.min(254, layer.values.black ?? 0));
    const white = Math.max(black + 1, Math.min(255, layer.values.white ?? 255));
    const gamma = Math.max(0.1, Math.min(3, layer.values.gamma ?? 1));
    forEachColorChannel(result, (value) => {
      const normalized = clamp((value - black) / (white - black));
      return 255 * Math.pow(normalized, 1 / gamma);
    });
  }
  if (layer.adjustment === "curves") {
    const shadows = Math.max(-100, Math.min(100, layer.values.shadows ?? 0));
    const midtones = Math.max(-100, Math.min(100, layer.values.midtones ?? 0));
    const highlights = Math.max(-100, Math.min(100, layer.values.highlights ?? 0));
    forEachColorChannel(result, (value) => {
      const normalized = value / 255;
      const shadowWeight = Math.pow(1 - normalized, 2);
      const highlightWeight = Math.pow(normalized, 2);
      const midtoneWeight = 1 - Math.abs(normalized * 2 - 1);
      return value + 1.28 * (
        shadows * shadowWeight
        + midtones * midtoneWeight
        + highlights * highlightWeight
      );
    });
  }
  if (layer.adjustment === "sharpen") {
    const amount = Math.max(0, Math.min(2, (layer.values.amount ?? 50) / 100));
    const source = new Uint8Array(result);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const neighbors = source[index - width * 4 + channel]
            + source[index + width * 4 + channel]
            + source[index - 4 + channel]
            + source[index + 4 + channel];
          result[index + channel] = toByteFromByteRange(
            source[index + channel] * (1 + amount * 4) - neighbors * amount,
          );
        }
      }
    }
  }
  return result;
}

function forEachColorChannel(pixels: Uint8Array, adjust: (value: number) => number): void {
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[index + channel] = toByteFromByteRange(adjust(pixels[index + channel]));
    }
  }
}

function toByteFromByteRange(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function inverseTransform(
  point: { x: number; y: number },
  layer: Layer,
): { x: number; y: number } {
  const radians = -layer.transform.rotation * Math.PI / 180;
  const translatedX = point.x - layer.transform.x;
  const translatedY = point.y - layer.transform.y;
  const rotatedX = translatedX * Math.cos(radians) - translatedY * Math.sin(radians);
  const rotatedY = translatedX * Math.sin(radians) + translatedY * Math.cos(radians);
  return {
    x: rotatedX / nonZeroScale(layer.transform.scaleX),
    y: rotatedY / nonZeroScale(layer.transform.scaleY),
  };
}

function shapeContains(layer: ShapeLayer, x: number, y: number): boolean {
  const { bounds } = layer;
  if (layer.shape === "ellipse") {
    const radiusX = Math.abs(bounds.width / 2);
    const radiusY = Math.abs(bounds.height / 2);
    if (radiusX === 0 || radiusY === 0) return false;
    const normalizedX = (x - bounds.x - bounds.width / 2) / radiusX;
    const normalizedY = (y - bounds.y - bounds.height / 2) / radiusY;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }
  if (layer.shape === "polygon" && layer.points?.length) {
    return pointInPolygon(x, y, layer.points);
  }
  return x >= bounds.x
    && x < bounds.x + bounds.width
    && y >= bounds.y
    && y < bounds.y + bounds.height;
}

function pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const intersects = (currentPoint.y > y) !== (previousPoint.y > y)
      && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function composite(backdrop: Rgba, source: Rgba, mode: BlendMode): Rgba {
  const outputAlpha = source.alpha + backdrop.alpha * (1 - source.alpha);
  if (outputAlpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };

  return {
    red: compositeChannel(backdrop.red, source.red, backdrop.alpha, source.alpha, outputAlpha, mode),
    green: compositeChannel(backdrop.green, source.green, backdrop.alpha, source.alpha, outputAlpha, mode),
    blue: compositeChannel(backdrop.blue, source.blue, backdrop.alpha, source.alpha, outputAlpha, mode),
    alpha: outputAlpha,
  };
}

function compositeChannel(
  backdrop: number,
  source: number,
  backdropAlpha: number,
  sourceAlpha: number,
  outputAlpha: number,
  mode: BlendMode,
): number {
  const blended = blendChannel(backdrop, source, mode);
  const premultiplied = (1 - sourceAlpha) * backdrop * backdropAlpha
    + (1 - backdropAlpha) * source * sourceAlpha
    + sourceAlpha * backdropAlpha * blended;
  return clamp(premultiplied / outputAlpha);
}

function blendChannel(backdrop: number, source: number, mode: BlendMode): number {
  switch (mode) {
    case "normal":
      return source;
    case "multiply":
      return backdrop * source;
    case "screen":
      return backdrop + source - backdrop * source;
    case "overlay":
      return overlay(backdrop, source);
    case "darken":
      return Math.min(backdrop, source);
    case "lighten":
      return Math.max(backdrop, source);
    case "color-dodge":
      return source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
    case "color-burn":
      return source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source);
    case "hard-light":
      return overlay(source, backdrop);
    case "soft-light": {
      if (source <= 0.5) {
        return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
      }
      const curve = backdrop <= 0.25
        ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
        : Math.sqrt(backdrop);
      return backdrop + (2 * source - 1) * (curve - backdrop);
    }
  }
}

function overlay(backdrop: number, source: number): number {
  return backdrop <= 0.5
    ? 2 * backdrop * source
    : 1 - 2 * (1 - backdrop) * (1 - source);
}

function parseColor(value: string): Rgba {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (!match) throw new Error(`Reference colors must use six- or eight-digit hex: ${value}`);
  const hex = match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16) / 255,
    green: Number.parseInt(hex.slice(2, 4), 16) / 255,
    blue: Number.parseInt(hex.slice(4, 6), 16) / 255,
    alpha: match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
  };
}

function nonZeroScale(value: number): number {
  return Math.abs(value) < Number.EPSILON ? Number.EPSILON : value;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toByte(value: number): number {
  return Math.round(clamp(value) * 255);
}
