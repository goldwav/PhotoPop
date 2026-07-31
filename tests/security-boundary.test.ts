/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Electron security boundary", () => {
  it("keeps the renderer sandboxed and isolated", async () => {
    const source = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");
    expect(source).toContain("sandbox: true");
    expect(source).toContain("contextIsolation: true");
    expect(source).toContain("nodeIntegration: false");
    expect(source).toContain("webSecurity: true");
    expect(source).not.toContain("allowRunningInsecureContent: true");
  });

  it("exposes named capabilities rather than raw IPC", async () => {
    const source = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
    expect(source).toContain("contextBridge.exposeInMainWorld");
    expect(source).not.toContain("ipcRenderer.send(");
    const listenerChannels = [...source.matchAll(/ipcRenderer\.on\("([^"]+)"/g)]
      .map((match) => match[1]);
    expect(listenerChannels).toEqual([
      "photopop:launch-file-requested",
      "photopop:window-close-requested",
    ]);
    expect(source).toContain("onLaunchFileRequested: (callback)");
    expect(source).toContain('removeListener("photopop:window-close-requested"');
  });
});
