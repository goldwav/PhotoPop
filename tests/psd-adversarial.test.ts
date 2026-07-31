/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { importPsd } from "../src/core/file-format";

describe("PSD adversarial inputs", () => {
  it("rejects random bytes with a bounded compatibility error", async () => {
    const bytes = Uint8Array.from({ length: 512 }, (_, index) => (index * 47) % 256);
    await expect(importPsd(asArrayBuffer(bytes), "random.psd"))
      .rejects.toThrow(/^PhotoPop could not read this PSD:/);
  });

  it("rejects a valid header with truncated image sections", async () => {
    const bytes = psdHeader({ width: 2048, height: 2048, channels: 4 });
    await expect(importPsd(asArrayBuffer(bytes), "truncated.psd"))
      .rejects.toThrow(/^PhotoPop could not read this PSD:/);
  });

  it("rejects malicious dimensions before allocating their declared image", async () => {
    const bytes = psdHeader({ width: 300_000, height: 300_000, channels: 4 });
    const startedAt = performance.now();
    await expect(importPsd(asArrayBuffer(bytes), "oversized.psd"))
      .rejects.toThrow(/^PhotoPop could not read this PSD:/);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

function psdHeader({
  width,
  height,
  channels,
}: {
  width: number;
  height: number;
  channels: number;
}): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("8BPS"), 0);
  view.setUint16(4, 1, false);
  view.setUint16(12, channels, false);
  view.setUint32(14, height, false);
  view.setUint32(18, width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

