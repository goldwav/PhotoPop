/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("application header branding", () => {
  it("keeps the PhotoPop wordmark readable and separate from File without a divider", async () => {
    const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const brandRule = styles.match(/\.brand\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(brandRule).toContain("min-width: 100px");
    expect(brandRule).toContain("white-space: nowrap");
    expect(brandRule).not.toContain("border-right");
  });
});
