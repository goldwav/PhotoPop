/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The release verifier is intentionally plain JavaScript for CI portability.
import { assertReleaseTag, expectedWindowsArtifacts, verifyArtifactSet } from "../scripts/verify-windows-release.mjs";

function manifest(version = "0.1.0-alpha.1") {
  return {
    version,
    build: {
      productName: "PhotoPop",
      artifactName: "${productName}-${version}-${arch}.${ext}",
      nsis: {
        artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
      },
      portable: {
        artifactName: "${productName}-Portable-${version}-${arch}.${ext}",
      },
    },
  };
}

describe("Windows release evidence", () => {
  it("pins the installer, portable executable, and portable ZIP names", () => {
    expect(expectedWindowsArtifacts(manifest())).toEqual([
      "PhotoPop-Setup-0.1.0-alpha.1-x64.exe",
      "PhotoPop-Portable-0.1.0-alpha.1-x64.exe",
      "PhotoPop-0.1.0-alpha.1-x64.zip",
    ]);
  });

  it("requires a release tag to match the package version", () => {
    expect(() => assertReleaseTag(manifest(), {
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: "v0.1.0-alpha.1",
    })).not.toThrow();
    expect(() => assertReleaseTag(manifest(), {
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: "v0.1.0-alpha.2",
    })).toThrow(/does not match package version/i);
  });

  it("rejects missing or additional executable and ZIP artifacts", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "photopop-release-test-"));
    try {
      const expected = expectedWindowsArtifacts(manifest());
      for (const name of expected) {
        await writeFile(path.join(releaseDirectory, name), Buffer.alloc(2_048, 1));
      }
      await expect(verifyArtifactSet(releaseDirectory, expected)).resolves.toHaveLength(3);
      await writeFile(path.join(releaseDirectory, "unexpected.exe"), Buffer.alloc(2_048, 1));
      await expect(verifyArtifactSet(releaseDirectory, expected)).rejects.toThrow(
        /do not match the release contract/i,
      );
    } finally {
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });
});
