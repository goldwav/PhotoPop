/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EditorCommand, Point, Rect } from "../types";

export const TILE_SIZE = 512;
export const MAX_UNDO_BYTES = 2 * 1024 * 1024 * 1024;

export interface TileAddress {
  column: number;
  row: number;
}

export function computeUndoByteLimit(availableSystemBytes: number): number {
  if (!Number.isFinite(availableSystemBytes) || availableSystemBytes <= 0) {
    return 512 * 1024 * 1024;
  }
  return Math.min(MAX_UNDO_BYTES, Math.floor(availableSystemBytes * 0.25));
}

export function tilesForBounds(
  bounds: Rect,
  canvasWidth: number,
  canvasHeight: number,
): TileAddress[] {
  const left = clamp(Math.floor(bounds.x / TILE_SIZE), 0, Math.max(0, Math.ceil(canvasWidth / TILE_SIZE) - 1));
  const top = clamp(Math.floor(bounds.y / TILE_SIZE), 0, Math.max(0, Math.ceil(canvasHeight / TILE_SIZE) - 1));
  const right = clamp(
    Math.floor((bounds.x + Math.max(0, bounds.width) - Number.EPSILON) / TILE_SIZE),
    left,
    Math.max(left, Math.ceil(canvasWidth / TILE_SIZE) - 1),
  );
  const bottom = clamp(
    Math.floor((bounds.y + Math.max(0, bounds.height) - Number.EPSILON) / TILE_SIZE),
    top,
    Math.max(top, Math.ceil(canvasHeight / TILE_SIZE) - 1),
  );
  const addresses: TileAddress[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      addresses.push({ column, row });
    }
  }
  return addresses;
}

export function dirtyTilesForCommand(
  command: EditorCommand,
  canvasWidth: number,
  canvasHeight: number,
): TileAddress[] {
  if (command.type === "mask/stroke") {
    const radius = command.stroke.size / 2;
    return tilesForBounds(expandedPointBounds(command.stroke.points, radius), canvasWidth, canvasHeight);
  }
  if (
    command.type === "layer/add"
    || command.type === "layer/remove"
    || command.type === "layer/duplicate"
    || command.type === "layer/reorder"
    || command.type === "layer/toggle-visibility"
    || command.type === "layer/update"
    || command.type === "mask/settings"
    || command.type === "document/crop"
  ) {
    return tilesForBounds({ x: 0, y: 0, width: canvasWidth, height: canvasHeight }, canvasWidth, canvasHeight);
  }
  return [];
}

function expandedPointBounds(points: Point[], radius: number): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs) - radius;
  const top = Math.min(...ys) - radius;
  const right = Math.max(...xs) + radius;
  const bottom = Math.max(...ys) + radius;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
