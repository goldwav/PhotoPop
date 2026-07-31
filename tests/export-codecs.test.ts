/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const WIDTH = 17;
const HEIGHT = 11;

describe("release export codec contract", () => {
  it.each([
    { format: "png", alpha: true },
    { format: "jpeg", alpha: false },
    { format: "webp", alpha: true },
    { format: "tiff", alpha: true },
  ] as const)("encodes and reopens $format with the requested geometry", async ({ format, alpha }) => {
    const source = rgbaFixture(WIDTH, HEIGHT);
    let pipeline = sharp(source, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
      .withIccProfile("srgb");
    if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
    if (format === "jpeg") pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 91 });
    if (format === "webp") pipeline = pipeline.webp({ quality: 91, lossless: true });
    if (format === "tiff") pipeline = pipeline.tiff({ compression: "lzw" });

    const encoded = await pipeline.toBuffer();
    const decoded = sharp(encoded);
    const metadata = await decoded.metadata();
    expect(metadata.format).toBe(format);
    expect(metadata.width).toBe(WIDTH);
    expect(metadata.height).toBe(HEIGHT);
    expect(metadata.space).toBe("srgb");
    expect(metadata.hasAlpha).toBe(alpha);

    const { data, info } = await decoded.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(WIDTH);
    expect(info.height).toBe(HEIGHT);
    expect(data.byteLength).toBe(WIDTH * HEIGHT * 4);
    expect(new Set(data).size).toBeGreaterThan(8);
  });
});

function rgbaFixture(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      bytes[offset] = (x * 31 + y * 7) % 256;
      bytes[offset + 1] = (x * 11 + y * 29) % 256;
      bytes[offset + 2] = (x * 17 + y * 19) % 256;
      bytes[offset + 3] = (x + y) % 3 === 0 ? 96 : 255;
    }
  }
  return bytes;
}
