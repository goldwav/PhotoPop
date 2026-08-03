/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("desktop branding", () => {
  it("uses the PhotoPop icon and application identity in development and packaged builds", async () => {
    const main = await readFile(path.join(root, "electron", "main.mjs"), "utf8");
    const packageJson = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as {
      build: {
        appId: string;
        files: string[];
        win: { icon: string };
      };
    };

    expect(main).toContain(`const APP_USER_MODEL_ID = "${packageJson.build.appId}";`);
    expect(main).toContain("app.setAppUserModelId(APP_USER_MODEL_ID);");
    expect(main).toContain("icon: appIconPath(),");
    expect(packageJson.build.win.icon).toBe("build/icon.png");
    expect(packageJson.build.files).toContain("build/icon.png");
  });

  it("ships a high-resolution PhotoPop icon", async () => {
    const metadata = await sharp(path.join(root, "build", "icon.png")).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeGreaterThanOrEqual(256);
    expect(metadata.height).toBeGreaterThanOrEqual(256);
  });
});
