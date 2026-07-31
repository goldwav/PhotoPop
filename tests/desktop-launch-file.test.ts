/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type EventHandler = (...arguments_: unknown[]) => void;

const electronHarness = vi.hoisted(() => ({
  appListeners: new Map<string, EventHandler>(),
  createdWindow: undefined as undefined | Record<string, unknown>,
  userData: "",
  windows: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronHarness.userData),
    on: vi.fn((event: string, handler: EventHandler) => electronHarness.appListeners.set(event, handler)),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  },
  BrowserWindow: class BrowserWindow {
    static fromWebContents() {
      return undefined;
    }

    static getAllWindows() {
      return electronHarness.windows;
    }

    isDestroyed = vi.fn(() => false);
    isMinimized = vi.fn(() => false);
    loadURL = vi.fn(async () => undefined);
    focus = vi.fn();
    restore = vi.fn();
    show = vi.fn();
    windowListeners = new Map<string, EventHandler>();
    webContentsListeners = new Map<string, EventHandler>();
    webContents = {
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: EventHandler) => this.webContentsListeners.set(event, handler)),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };

    constructor(public options: unknown) {
      electronHarness.createdWindow = this as unknown as Record<string, unknown>;
      electronHarness.windows = [this as unknown as Record<string, unknown>];
    }

    close = vi.fn();
    on = vi.fn((event: string, handler: EventHandler) => this.windowListeners.set(event, handler));
    once = vi.fn((event: string, handler: EventHandler) => this.windowListeners.set(event, handler));
  },
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn() },
  Menu: { setApplicationMenu: vi.fn() },
  net: {},
  nativeImage: {},
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {},
}));

interface LaunchPayload {
  name: string;
  path: string;
  data: Uint8Array;
  mimeType: "application/x-photopop";
}

let temporaryDirectory: string;
let validProjectPath: string;
let secondProjectPath: string;
let validProjectBytes: Uint8Array;
let createWindow: () => Record<string, unknown>;
let launchProjectPathsFromArguments: (arguments_: unknown[]) => string[];
let queueLaunchProjectPath: (filePath: string) => Promise<boolean>;
let readLaunchProjectFile: (filePath: string) => Promise<LaunchPayload>;

function documentGraph(documentId: string) {
  return {
    schemaVersion: 1,
    id: documentId,
    name: "Launch fixture",
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

async function projectPackage(documentId: string) {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    format: "photopop",
    schemaVersion: 1,
    documentId,
  }));
  zip.file("document.json", JSON.stringify(documentGraph(documentId)));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "photopop-launch-"));
  electronHarness.userData = path.join(temporaryDirectory, "user-data");
  await mkdir(electronHarness.userData, { recursive: true });
  validProjectBytes = await projectPackage("launch-12345678");
  validProjectPath = path.join(temporaryDirectory, "Editorial Cover.photopop");
  secondProjectPath = path.join(temporaryDirectory, "Second Project.photopop");
  await writeFile(validProjectPath, validProjectBytes);
  await writeFile(secondProjectPath, await projectPackage("launch-87654321"));

  // @ts-expect-error The Electron main-process module is intentionally JavaScript.
  const desktop = await import("../electron/main.mjs");
  createWindow = desktop.createWindow;
  launchProjectPathsFromArguments = desktop.launchProjectPathsFromArguments;
  queueLaunchProjectPath = desktop.queueLaunchProjectPath;
  readLaunchProjectFile = desktop.readLaunchProjectFile;
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("desktop launch-file integration", () => {
  it("loads only a validated regular .photopop file into the narrow payload", async () => {
    const payload = await readLaunchProjectFile(validProjectPath);

    expect(payload).toMatchObject({
      name: "Editorial Cover.photopop",
      path: path.normalize(validProjectPath),
      mimeType: "application/x-photopop",
    });
    expect(Buffer.from(payload.data)).toEqual(Buffer.from(validProjectBytes));

    const wrongExtension = path.join(temporaryDirectory, "Editorial Cover.zip");
    const malformedProject = path.join(temporaryDirectory, "Malformed.photopop");
    const directoryProject = path.join(temporaryDirectory, "Folder.photopop");
    await writeFile(wrongExtension, validProjectBytes);
    await writeFile(malformedProject, "not a PhotoPop package");
    await mkdir(directoryProject);

    await expect(readLaunchProjectFile(wrongExtension)).rejects.toThrow(/\.photopop extension/i);
    await expect(readLaunchProjectFile(malformedProject)).rejects.toThrow(/package/i);
    await expect(readLaunchProjectFile(directoryProject)).rejects.toThrow(/not a file/i);
    await expect(readLaunchProjectFile("relative.photopop")).rejects.toThrow(/absolute file path/i);
    await expect(readLaunchProjectFile(path.join(temporaryDirectory, "Missing.photopop"))).rejects.toThrow();
  });

  it("buffers launch delivery until a renderer subscriber exists and supports clean unsubscribe", async () => {
    const preloadSource = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
    const ipcListeners = new Map<string, EventHandler>();
    let bridge: {
      onLaunchFileRequested: (callback: (payload: LaunchPayload) => void) => () => void;
    } | undefined;
    runInNewContext(preloadSource, {
      require: (specifier: string) => {
        if (specifier !== "electron") throw new Error(`Unexpected preload import: ${specifier}`);
        return {
          contextBridge: {
            exposeInMainWorld: (name: string, api: typeof bridge) => {
              if (name !== "photoPop") throw new Error(`Unexpected bridge name: ${name}`);
              bridge = api;
            },
          },
          ipcRenderer: {
            invoke: vi.fn(),
            on: (channel: string, listener: EventHandler) => ipcListeners.set(channel, listener),
            removeListener: vi.fn(),
          },
        };
      },
    });

    const payload: LaunchPayload = {
      name: "Editorial Cover.photopop",
      path: validProjectPath,
      data: validProjectBytes,
      mimeType: "application/x-photopop",
    };
    ipcListeners.get("photopop:launch-file-requested")?.({}, payload);
    const firstCallback = vi.fn();
    const unsubscribe = bridge?.onLaunchFileRequested(firstCallback);
    expect(firstCallback).toHaveBeenCalledOnce();
    expect(firstCallback).toHaveBeenCalledWith(payload);

    unsubscribe?.();
    ipcListeners.get("photopop:launch-file-requested")?.({}, payload);
    expect(firstCallback).toHaveBeenCalledOnce();
    const secondCallback = vi.fn();
    bridge?.onLaunchFileRequested(secondCallback);
    expect(secondCallback).toHaveBeenCalledOnce();
    expect(secondCallback).toHaveBeenCalledWith(payload);
  });

  it("extracts absolute project arguments once and rejects missing candidates during validation", async () => {
    expect(launchProjectPathsFromArguments([
      "PhotoPop.exe",
      "relative.photopop",
      validProjectPath,
      validProjectPath,
      "--safe-mode",
    ])).toEqual([path.normalize(validProjectPath)]);

    await expect(queueLaunchProjectPath(path.join(temporaryDirectory, "Missing.photopop")))
      .resolves.toBe(false);
  });

  it("queues a launch until the renderer is loaded, then forwards later launches immediately", async () => {
    const window = createWindow() as unknown as {
      focus: ReturnType<typeof vi.fn>;
      webContents: { send: ReturnType<typeof vi.fn> };
      webContentsListeners: Map<string, EventHandler>;
    };

    await expect(queueLaunchProjectPath(validProjectPath)).resolves.toBe(true);
    expect(window.webContents.send).not.toHaveBeenCalled();

    window.webContentsListeners.get("did-finish-load")?.();
    expect(window.webContents.send).toHaveBeenCalledWith(
      "photopop:launch-file-requested",
      expect.objectContaining({ path: path.normalize(validProjectPath) }),
    );

    electronHarness.appListeners.get("second-instance")?.({}, ["PhotoPop.exe", secondProjectPath], temporaryDirectory);
    await vi.waitFor(() => {
      expect(window.webContents.send).toHaveBeenCalledWith(
        "photopop:launch-file-requested",
        expect.objectContaining({ path: path.normalize(secondProjectPath) }),
      );
    });
    expect(window.focus).toHaveBeenCalled();
  });

  it("registers the native project association without moving runtime packages into production", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.build.fileAssociations).toEqual([{
      ext: "photopop",
      name: "PhotoPop Project",
      description: "PhotoPop layered image project",
      mimeType: "application/x-photopop",
      role: "Editor",
    }]);
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["jszip", "sharp"]);
  });
});