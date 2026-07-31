/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, argument?: Record<string, unknown>) => Promise<unknown> | unknown;

const electronHarness = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  saveTarget: "",
  userData: "",
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronHarness.userData),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  },
  BrowserWindow: class BrowserWindow {},
  clipboard: {},
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: electronHarness.saveTarget })),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronHarness.handlers.set(channel, handler);
    }),
  },
  Menu: { setApplicationMenu: vi.fn() },
  net: {},
  nativeImage: {},
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {},
}));

beforeAll(async () => {
  electronHarness.userData = await mkdtemp(path.join(tmpdir(), "photopop-desktop-export-"));
  // @ts-expect-error The Electron main-process module is intentionally JavaScript.
  const desktop = await import("../electron/main.mjs");
  desktop.installIpcHandlers();
});

afterAll(async () => {
  const target = path.resolve(electronHarness.userData);
  if (path.basename(target).startsWith("photopop-desktop-export-")) {
    await rm(target, { recursive: true, force: true });
  }
});

describe("desktop image export", () => {
  it("transcodes and verifies each advertised format with requested dimensions", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: 240, g: 80, b: 65, alpha: 0.5 },
      },
    }).png().toBuffer();
    const dataUrl = `data:image/png;base64,${source.toString("base64")}`;
    const exportImage = electronHarness.handlers.get("photopop:image-export");
    expect(exportImage).toBeTypeOf("function");

    const cases = [
      { format: "png", extension: "png" },
      { format: "jpeg", extension: "jpg" },
      { format: "webp", extension: "webp" },
      { format: "tiff", extension: "tiff" },
    ];
    for (const item of cases) {
      electronHarness.saveTarget = path.join(electronHarness.userData, `verified.${item.extension}`);
      await expect(exportImage?.({}, {
        dataUrl,
        format: item.format,
        suggestedName: `verified.${item.extension}`,
        quality: 82,
        width: 8,
        height: 6,
        preserveTransparency: item.format !== "jpeg",
        metadata: "strip",
        colorProfile: "srgb",
      })).resolves.toEqual({ canceled: false, path: electronHarness.saveTarget });

      const metadata = await sharp(await readFile(electronHarness.saveTarget)).metadata();
      expect(metadata.format).toBe(item.format);
      expect(metadata.width).toBe(8);
      expect(metadata.height).toBe(6);
    }
  });

  it("rejects a target extension that disagrees with the selected format", async () => {
    const source = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#ffffff" },
    }).png().toBuffer();
    electronHarness.saveTarget = path.join(electronHarness.userData, "mismatch.png");
    const exportImage = electronHarness.handlers.get("photopop:image-export");
    await expect(exportImage?.({}, {
      dataUrl: `data:image/png;base64,${source.toString("base64")}`,
      format: "jpeg",
      suggestedName: "mismatch.jpg",
    })).rejects.toThrow(/extension does not match/i);
  });
});
