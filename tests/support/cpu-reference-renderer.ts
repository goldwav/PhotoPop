/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BlendMode, DocumentSnapshot, Layer, ShapeLayer } from "../../src/types";

const ARTBOARD_SIZE = 1000;

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
 * shape layers only so results do not depend on fonts, browser rasterization,
 * GPU drivers, or image decoders.
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
  for (const layer of snapshot.layers) {
    if (!layer.visible || layer.type === "group") continue;
    if (layer.type !== "shape") {
      throw new Error(`The CPU reference fixture does not support ${layer.type} layers.`);
    }
    compositeShape(pixels, width, height, layer);
  }
  return pixels;
}

function compositeShape(
  pixels: Uint8Array,
  width: number,
  height: number,
  layer: ShapeLayer,
): void {
  const sourceColor = parseColor(layer.fill);
  sourceColor.alpha *= clamp(layer.opacity);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const artboardPoint = {
        x: (x + 0.5) * ARTBOARD_SIZE / width,
        y: (y + 0.5) * ARTBOARD_SIZE / height,
      };
      const local = inverseTransform(artboardPoint, layer);
      if (!shapeContains(layer, local.x, local.y)) continue;

      const offset = (y * width + x) * 4;
      const backdrop: Rgba = {
        red: pixels[offset] / 255,
        green: pixels[offset + 1] / 255,
        blue: pixels[offset + 2] / 255,
        alpha: pixels[offset + 3] / 255,
      };
      const result = composite(backdrop, sourceColor, layer.blendMode);
      pixels[offset] = toByte(result.red);
      pixels[offset + 1] = toByte(result.green);
      pixels[offset + 2] = toByte(result.blue);
      pixels[offset + 3] = toByte(result.alpha);
    }
  }
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
