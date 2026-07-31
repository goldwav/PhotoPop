/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Layer as PsdLayer, PixelData, Psd } from "ag-psd";
import { initializeCanvas, writePsd } from "ag-psd";
import { beforeAll, describe, expect, it } from "vitest";
import {
  importPsd,
  PsdCompatibilityError,
} from "../src/core/file-format";
import type { RasterLayer } from "../src/types";

class TestCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;

  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext(type: string) {
    if (type !== "2d") return null;
    return {
      putImageData: (imageData: PixelData) => {
        this.pixels = new Uint8ClampedArray(imageData.data);
      },
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.pixels),
      }),
      drawImage: () => undefined,
    };
  }

  toDataURL(): string {
    const payload = JSON.stringify({
      width: this.width,
      height: this.height,
      data: Array.from(this.pixels),
    });
    return `data:image/png;base64,${Buffer.from(payload).toString("base64")}`;
  }
}

beforeAll(() => {
  initializeCanvas(
    (width, height) => new TestCanvas(width, height) as unknown as HTMLCanvasElement,
    (width, height) => rgba(width, height, new Array(width * height * 4).fill(0)) as ImageData,
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (name: string) => {
        if (name !== "canvas") throw new Error(`Unexpected test element: ${name}`);
        return new TestCanvas();
      },
    },
  });
});

describe("PSD import compatibility", () => {
  it("preserves supported blend modes and reports unsupported substitutions", async () => {
    const buffer = generatedPsd([
      {
        name: "Multiply layer",
        blendMode: "multiply",
        imageData: solidPixels(2, 1, [255, 0, 0, 255]),
      },
      {
        name: "Difference layer",
        blendMode: "difference",
        imageData: solidPixels(2, 1, [0, 255, 0, 255]),
      },
    ]);

    const result = await importPsd(buffer, "blends.psd");
    expect(result.document.layers.find((layer) => layer.name === "Multiply layer")?.blendMode).toBe("multiply");
    expect(result.document.layers.find((layer) => layer.name === "Difference layer")?.blendMode).toBe("normal");
    expect(result.report.imported).toContainEqual(expect.objectContaining({
      feature: "Blend mode",
      detail: expect.stringContaining("multiply -> multiply"),
    }));
    expect(result.report.substituted).toContainEqual(expect.objectContaining({
      feature: "Blend mode",
      detail: expect.stringContaining("difference"),
    }));
    expect(result.comparison?.embeddedCompositeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.comparison?.editableLayerCount).toBe(2);
    expect(result.comparison?.fidelityRisks.join(" ")).toContain("difference");
  });

  it("bakes a real PSD pixel mask into raster alpha instead of creating an empty editable mask", async () => {
    const buffer = generatedPsd([
      {
        name: "Masked layer",
        imageData: solidPixels(2, 1, [230, 80, 60, 255]),
        mask: {
          top: 0,
          left: 0,
          bottom: 1,
          right: 2,
          defaultColor: 0,
          userMaskDensity: 1,
          imageData: rgba(2, 1, [
            255, 255, 255, 255,
            0, 0, 0, 255,
          ]),
        },
      },
    ]);

    const result = await importPsd(buffer, "mask.psd");
    const layer = result.document.layers.find((candidate) => candidate.name === "Masked layer") as RasterLayer;
    const decoded = decodeTestDataUrl(layer.source);

    expect(layer.mask).toBeUndefined();
    expect(decoded.data[3]).toBe(255);
    expect(decoded.data[7]).toBe(0);
    expect(result.report.rasterized).toContainEqual(expect.objectContaining({
      feature: "Pixel layer mask",
      detail: expect.stringContaining("baked into layer transparency"),
    }));
    expect(result.comparison?.fidelityRisks.join(" ")).toContain("no longer independently editable");
  });

  it("reports cached text, vector, and placed content as rasterized and effects as unsupported", async () => {
    const specialLayer: PsdLayer = {
      name: "Editorial title",
      imageData: solidPixels(2, 1, [40, 50, 60, 255]),
      text: {
        text: "PhotoPop",
        transform: [1, 0, 0, 1, 0, 0],
        style: {
          font: { name: "ArialMT" },
          fontSize: 18,
          fillColor: { r: 255, g: 255, b: 255 },
        },
      },
      vectorFill: { type: "color", color: { r: 40, g: 50, b: 60 } },
      placedLayer: {
        id: "20953ddb-9391-11ec-b4f1-c15674f50bc4",
        type: "raster",
        transform: [0, 0, 2, 0, 2, 1, 0, 1],
        width: 2,
        height: 1,
      },
      effects: {
        dropShadow: [{
          enabled: true,
          size: { units: "Pixels", value: 2 },
          distance: { units: "Pixels", value: 1 },
          color: { r: 0, g: 0, b: 0 },
          blendMode: "multiply",
          opacity: 0.5,
        }],
      },
    };

    const result = await importPsd(generatedPsd([specialLayer]), "special.psd");
    expect(result.report.rasterized.map((item) => item.feature)).toEqual(expect.arrayContaining([
      "Text layer",
      "Vector content",
      "Placed layer",
    ]));
    expect(result.report.unsupported).toContainEqual(expect.objectContaining({ feature: "Layer effects" }));
    expect(result.comparison?.fidelityRisks.join(" ")).toContain("enabled layer effects");
  });

  it("rejects non-8-bit and non-RGB PSDs with a machine-readable compatibility report", async () => {
    const sixteenBit = generatedPsd([]);
    new DataView(sixteenBit).setUint16(22, 16, false);
    const cmyk = generatedPsd([]);
    new DataView(cmyk).setUint16(24, 4, false);

    const bitDepthError = await captureCompatibilityError(sixteenBit, "16-bit.psd");
    expect(bitDepthError.report.unsupported).toContainEqual(expect.objectContaining({ feature: "Bit depth" }));
    expect(bitDepthError.message).toContain("Only 8-bit channels are supported");

    const colorModeError = await captureCompatibilityError(cmyk, "cmyk.psd");
    expect(colorModeError.report.unsupported).toContainEqual(expect.objectContaining({
      feature: "Color mode",
      detail: expect.stringContaining("CMYK"),
    }));
    expect(colorModeError.message).toContain("Only RGB PSD documents are supported");
  });

  it("rejects PSB before parsing bitmap sections and identifies the unsupported feature", async () => {
    const psb = generatedPsd([]);
    new DataView(psb).setUint16(4, 2, false);
    const error = await captureCompatibilityError(psb, "large.psb");
    expect(error.report.unsupported).toContainEqual(expect.objectContaining({ feature: "PSB document" }));
  });
});

function generatedPsd(children: PsdLayer[]): ArrayBuffer {
  const composite = solidPixels(2, 1, [245, 245, 245, 255]);
  const psd: Psd = {
    width: 2,
    height: 1,
    imageData: composite,
    children,
  };
  return writePsd(psd, {
    generateThumbnail: false,
    noBackground: true,
    trimImageData: false,
  });
}

function solidPixels(width: number, height: number, color: [number, number, number, number]): PixelData {
  const data: number[] = [];
  for (let index = 0; index < width * height; index += 1) data.push(...color);
  return rgba(width, height, data);
}

function rgba(width: number, height: number, data: number[]): PixelData {
  return { width, height, data: new Uint8ClampedArray(data) };
}

function decodeTestDataUrl(source: string): { width: number; height: number; data: number[] } {
  const encoded = source.split(",", 2)[1];
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    width: number;
    height: number;
    data: number[];
  };
}

async function captureCompatibilityError(buffer: ArrayBuffer, name: string): Promise<PsdCompatibilityError> {
  try {
    await importPsd(buffer, name);
  } catch (error) {
    expect(error).toBeInstanceOf(PsdCompatibilityError);
    return error as PsdCompatibilityError;
  }
  throw new Error("Expected PSD import to fail.");
}
