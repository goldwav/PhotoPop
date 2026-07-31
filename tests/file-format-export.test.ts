/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { exportFlattened } from "../src/core/file-format";
import type { ExportOptions, PhotoPopDesktopApi } from "../src/types";

const OPTIONS: ExportOptions = {
  format: "png",
  width: 1200,
  height: 800,
  quality: 0.92,
  preserveTransparency: true,
  metadata: "strip",
  colorProfile: "srgb",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("flattened export result contract", () => {
  it("reports a canceled native save explicitly", async () => {
    const exportImage = vi.fn<PhotoPopDesktopApi["exportImage"]>()
      .mockResolvedValue({ canceled: true });
    vi.stubGlobal("window", { photoPop: { exportImage } });

    await expect(exportFlattened("data:image/png;base64,AA==", "Portrait", OPTIONS))
      .resolves.toEqual({ status: "canceled" });
    expect(exportImage).toHaveBeenCalledOnce();
  });

  it("reports a saved native export and preserves its path", async () => {
    const exportImage = vi.fn<PhotoPopDesktopApi["exportImage"]>()
      .mockResolvedValue({ canceled: false, path: "D:\\Exports\\Portrait.png" });
    vi.stubGlobal("window", { photoPop: { exportImage } });

    await expect(exportFlattened("data:image/png;base64,AA==", "Portrait", OPTIONS))
      .resolves.toEqual({
        status: "saved",
        path: "D:\\Exports\\Portrait.png",
      });
  });

  it("reports a browser download as saved", async () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => "blob:photopop-export");
    const revokeObjectURL = vi.fn();
    const fetchMock = vi.fn(async () => new Response(new Blob(["png"])));
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ href: "", download: "", click })),
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("setTimeout", vi.fn());

    await expect(exportFlattened("data:image/png;base64,AA==", "Portrait", OPTIONS))
      .resolves.toEqual({ status: "saved" });
    expect(fetchMock).toHaveBeenCalledWith("data:image/png;base64,AA==");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});