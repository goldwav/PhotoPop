/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("third-party redistribution notices", () => {
  it("ships the notice as a directly readable application resource", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const extraResources = packageJson.build.extraResources as Array<{ from: string; to: string }>;

    expect(extraResources).toContainEqual({
      from: "THIRD_PARTY_NOTICES.md",
      to: "THIRD_PARTY_NOTICES.md",
    });
  });

  it("documents the exact primary packages bundled into the alpha", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const notice = await readFile(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");

    const expectedPackages = [
      ["Sharp", packageJson.dependencies.sharp, "Apache-2.0"],
      ["JSZip", packageJson.dependencies.jszip, "MIT or GPL-3.0-or-later"],
      ["Inter", packageJson.devDependencies["@fontsource/inter"], "SIL Open Font License 1.1"],
      ["Tabler Icons", packageJson.devDependencies["@tabler/icons-react"], "MIT"],
      ["ag-psd", packageJson.devDependencies["ag-psd"], "MIT"],
      ["Electron", packageJson.devDependencies.electron, "MIT"],
      ["React", packageJson.devDependencies.react, "MIT"],
    ] as const;

    for (const [name, version, license] of expectedPackages) {
      expect(notice).toContain(name);
      expect(notice).toContain(version);
      expect(notice).toContain(license);
    }

    expect(notice).toContain("@img/sharp-win32-x64");
    expect(notice).toContain("Apache-2.0 and LGPL-3.0-or-later");
    expect(notice).toContain("resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/");
    expect(notice).toContain("resources/app.asar.unpacked/node_modules/sharp/");
    expect(notice).toContain("resources/app.asar.unpacked/node_modules/jszip/");
    expect(notice).toContain("pako and the");
    expect(notice).toContain("remaining pure-JavaScript support packages stay physically inside app.asar");
    expect(notice).toContain("libvips | 8.18.3 | LGPLv3");
    expect(notice).toContain("pako | 1.0.11 and 2.1.0 | MIT and zlib");
    expect(notice).toContain("LICENSE.electron.txt");
    expect(notice).toContain("LICENSES.chromium.html");
    expect(notice).toContain("full LGPLv3 and GPLv3 license texts for offline review");
  });

  it("links public project documentation to the shipped notice", async () => {
    const assets = await readFile(path.join(root, "ASSETS.md"), "utf8");
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    expect(assets).toContain("[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)");
    expect(readme).toContain("[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)");
  });
});
