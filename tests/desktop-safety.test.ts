/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: { sender?: object }, argument?: unknown) => Promise<unknown> | unknown;
type EventHandler = (...arguments_: unknown[]) => void;

const electronHarness = vi.hoisted(() => ({
  allWindows: [] as Array<Record<string, unknown>>,
  appListeners: new Map<string, EventHandler>(),
  handlers: new Map<string, IpcHandler>(),
  windowsBySender: new Map<object, Record<string, unknown>>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "C:\\PhotoPop-Test"),
    on: vi.fn((event: string, handler: EventHandler) => electronHarness.appListeners.set(event, handler)),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAppUserModelId: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  },
  BrowserWindow: class BrowserWindow {
    static fromWebContents(sender: object) {
      return electronHarness.windowsBySender.get(sender);
    }

    static getAllWindows() {
      return electronHarness.allWindows;
    }
  },
  clipboard: {},
  dialog: {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => electronHarness.handlers.set(channel, handler)),
  },
  Menu: { setApplicationMenu: vi.fn() },
  net: {},
  nativeImage: {},
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {},
}));

let validateProjectBytes: (bytes: Uint8Array) => Promise<{ documentId: string }>;
let validateExportImageBytes: (bytes: Uint8Array, format: string) => Promise<void>;
let installWindowCloseProtection: (window: Record<string, unknown>) => void;

beforeAll(async () => {
  // @ts-expect-error The Electron main-process module is intentionally JavaScript.
  const desktop = await import("../electron/main.mjs");
  validateProjectBytes = desktop.validateProjectBytes;
  validateExportImageBytes = desktop.validateExportImageBytes;
  installWindowCloseProtection = desktop.installWindowCloseProtection;
  desktop.installIpcHandlers();
});

function documentGraph(documentId = "document-12345678") {
  return {
    schemaVersion: 1,
    id: documentId,
    name: "Safety fixture",
    width: 64,
    height: 64,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [{
      id: "layer-12345678",
      type: "raster",
      name: "Layer",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      source: "data:image/png;base64,iVBORw0KGgo=",
    }],
    selectedLayerId: "layer-12345678",
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#ffffff",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

async function projectPackage(options?: {
  documentId?: string;
  manifestDocumentId?: string;
  includeDocument?: boolean;
  bomb?: boolean;
}) {
  const documentId = options?.documentId ?? "document-12345678";
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    format: "photopop",
    schemaVersion: 1,
    documentId: options?.manifestDocumentId ?? documentId,
  }));
  if (options?.includeDocument !== false) {
    zip.file("document.json", JSON.stringify(documentGraph(documentId)));
  }
  if (options?.bomb) zip.file("assets/repetition.txt", "0".repeat(2 * 1024 * 1024));
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

describe("desktop project verification", () => {
  it("accepts a bounded package with a matching manifest and document graph", async () => {
    await expect(validateProjectBytes(await projectPackage())).resolves.toEqual({
      documentId: "document-12345678",
    });
  });

  it("rejects missing required entries and mismatched identities", async () => {
    await expect(validateProjectBytes(await projectPackage({ includeDocument: false })))
      .rejects.toThrow(/missing required entries/i);
    await expect(validateProjectBytes(await projectPackage({ manifestDocumentId: "document-87654321" })))
      .rejects.toThrow(/document graph is invalid/i);
  });

  it("rejects an archive with an excessive decompression ratio before reading entries", async () => {
    await expect(validateProjectBytes(await projectPackage({ bomb: true })))
      .rejects.toThrow(/decompression limits/i);
  });
});

describe("desktop export verification", () => {
  it("accepts decoded pixels only when their signature and requested format agree", async () => {
    const input = {
      create: {
        width: 4,
        height: 4,
        channels: 4 as const,
        background: { r: 240, g: 80, b: 65, alpha: 0.75 },
      },
    };
    const png = await sharp(input).png().toBuffer();
    const jpeg = await sharp(input).jpeg().toBuffer();
    const webp = await sharp(input).webp().toBuffer();
    const tiff = await sharp(input).tiff().toBuffer();

    await expect(validateExportImageBytes(png, "png")).resolves.toBeUndefined();
    await expect(validateExportImageBytes(jpeg, "jpeg")).resolves.toBeUndefined();
    await expect(validateExportImageBytes(webp, "webp")).resolves.toBeUndefined();
    await expect(validateExportImageBytes(tiff, "tiff")).resolves.toBeUndefined();
    await expect(validateExportImageBytes(png, "jpeg")).rejects.toThrow(/does not contain JPEG data/i);
  });
});

describe("desktop recovery surface", () => {
  it("exposes one named clear capability with no raw IPC surface", async () => {
    const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
    const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
    expect(preload).toContain("clearAutosave: (documentId)");
    expect(preload).toContain("photopop:autosave-clear");
    expect(main).toContain('ipcMain.handle("photopop:autosave-clear"');
    expect(preload).not.toContain("ipcRenderer.send(");
  });
});

describe("desktop window lifecycle", () => {
  it("blocks a dirty window close until the originating renderer confirms", async () => {
    const sender = {};
    const windowListeners = new Map<string, EventHandler>();
    const webContentsListeners = new Map<string, EventHandler>();
    const webContents = {
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: EventHandler) => webContentsListeners.set(event, handler)),
      send: vi.fn(),
    };
    const editorWindow = {
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: EventHandler) => windowListeners.set(event, handler)),
      webContents,
    };
    electronHarness.windowsBySender.set(sender, editorWindow);
    installWindowCloseProtection(editorWindow);

    const setDirty = electronHarness.handlers.get("photopop:document-dirty-set");
    const confirmClose = electronHarness.handlers.get("photopop:window-close-confirm");
    expect(setDirty).toBeTypeOf("function");
    expect(confirmClose).toBeTypeOf("function");
    await setDirty?.({ sender }, true);

    const firstClose = { preventDefault: vi.fn() };
    windowListeners.get("close")?.(firstClose);
    expect(firstClose.preventDefault).toHaveBeenCalledOnce();
    expect(webContents.send).toHaveBeenCalledWith("photopop:window-close-requested");
    expect(editorWindow.close).not.toHaveBeenCalled();

    await confirmClose?.({ sender });
    await vi.waitFor(() => expect(editorWindow.close).toHaveBeenCalledOnce());
    const confirmedClose = { preventDefault: vi.fn() };
    windowListeners.get("close")?.(confirmedClose);
    expect(confirmedClose.preventDefault).not.toHaveBeenCalled();
  });

  it("rejects invalid dirty state and focuses the existing window on a second launch", () => {
    const setDirty = electronHarness.handlers.get("photopop:document-dirty-set");
    expect(() => setDirty?.({ sender: {} }, "dirty")).toThrow(/must be a boolean/i);

    const primaryWindow = {
      focus: vi.fn(),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
    };
    electronHarness.allWindows = [primaryWindow];
    electronHarness.appListeners.get("second-instance")?.();
    expect(primaryWindow.restore).toHaveBeenCalledOnce();
    expect(primaryWindow.show).toHaveBeenCalledOnce();
    expect(primaryWindow.focus).toHaveBeenCalledOnce();
  });

  it("keeps the close bridge narrow and removes the default Electron menu", async () => {
    const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
    const main = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
    expect(preload).toContain("setDocumentDirty: (dirty)");
    expect(preload).toContain("onWindowCloseRequested: (callback)");
    expect(preload).toContain('removeListener("photopop:window-close-requested"');
    expect(preload).toContain("confirmWindowClose: ()");
    expect(main).toContain("Menu.setApplicationMenu(null)");
    expect(main).toContain("autoHideMenuBar: true");
    expect(main).toContain("requestSingleInstanceLock()");
  });
});
