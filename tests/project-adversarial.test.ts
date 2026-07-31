/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createInitialDocument } from "../src/core/document";
import { deserializeProject, serializeProject } from "../src/core/file-format";

describe(".photopop adversarial inputs", () => {
  it("rejects a truncated ZIP package", async () => {
    const complete = await serializeProject(createInitialDocument());
    const truncated = complete.slice(0, Math.max(8, Math.floor(complete.byteLength / 3)));
    await expect(deserializeProject(truncated)).rejects.toThrow();
  });

  it("rejects invalid JSON without exposing parser internals as a valid document", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "photopop", schemaVersion: 1 }));
    zip.file("document.json", "{\"schemaVersion\":1,");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(deserializeProject(bytes)).rejects.toThrow();
  });

  it("rejects a graph with impossible dimensions", async () => {
    const invalid = {
      ...createInitialDocument(),
      width: -1,
      height: Number.POSITIVE_INFINITY,
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "photopop", schemaVersion: 1 }));
    zip.file("document.json", JSON.stringify(invalid));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(deserializeProject(bytes)).rejects.toThrow(/invalid/i);
  });

  it("rejects an entry whose expanded size exceeds the project budget", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ format: "photopop", schemaVersion: 1 }));
    const document = {
      ...createInitialDocument(),
      adversarialPadding: "A".repeat(17 * 1024 * 1024),
    };
    zip.file("document.json", JSON.stringify(document));
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    expect(bytes.byteLength).toBeLessThan(128 * 1024);
    await expect(deserializeProject(bytes)).rejects.toThrow(/limit|large|size/i);
  }, 20_000);
});
