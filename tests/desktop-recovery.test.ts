/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, argument?: unknown) => Promise<unknown> | unknown;

const electronHarness = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  userData: "",
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronHarness.userData),
    requestSingleInstanceLock: vi.fn(() => true),
    setAppUserModelId: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
  },
  BrowserWindow: class BrowserWindow {},
  clipboard: {},
  dialog: {},
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
  electronHarness.userData = await mkdtemp(path.join(tmpdir(), "photopop-desktop-recovery-"));
  // @ts-expect-error The Electron main-process module is intentionally JavaScript.
  const desktop = await import("../electron/main.mjs");
  desktop.installIpcHandlers();
});

afterAll(async () => {
  const target = path.resolve(electronHarness.userData);
  if (path.basename(target).startsWith("photopop-desktop-recovery-")) {
    await rm(target, { recursive: true, force: true });
  }
});

describe("desktop recovery lifecycle", () => {
  it("clears only the recovery package named by the current matching pointer", async () => {
    const documentId = "document-12345678";
    const directory = path.join(electronHarness.userData, "Recovery");
    const target = path.join(directory, `${documentId}.photopop`);
    const pointerPath = path.join(directory, "latest.json");
    await mkdir(directory, { recursive: true });
    await writeFile(target, "recovery fixture");
    await writeFile(pointerPath, JSON.stringify({ documentId, path: target }));

    const clear = electronHarness.handlers.get("photopop:autosave-clear");
    expect(clear).toBeTypeOf("function");
    await clear?.({}, "document-87654321");
    await expect(access(target)).resolves.toBeUndefined();
    await expect(access(pointerPath)).resolves.toBeUndefined();

    await clear?.({}, documentId);
    await expect(access(target)).rejects.toThrow();
    await expect(access(pointerPath)).rejects.toThrow();
  });

  it("refuses a recovery pointer that names a path outside its derived document location", async () => {
    const documentId = "document-12345678";
    const directory = path.join(electronHarness.userData, "Recovery");
    const pointerPath = path.join(directory, "latest.json");
    await mkdir(directory, { recursive: true });
    await writeFile(pointerPath, JSON.stringify({
      documentId,
      path: path.join(electronHarness.userData, "outside.photopop"),
    }));

    const read = electronHarness.handlers.get("photopop:autosave-read");
    expect(read).toBeTypeOf("function");
    await expect(read?.({})).resolves.toEqual({ canceled: true });
  });
});
