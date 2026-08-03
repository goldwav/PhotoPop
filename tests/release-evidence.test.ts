/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The release verifier is intentionally plain JavaScript for CI portability.
import { assertCiReleaseProvenance, assertPackagedApplicationEvidence, assertPortableZipEntries, assertReleaseTag, assertWindowsExecutableIdentities, expectedWindowsArtifacts, invalidateReleaseEvidence, verifyArtifactSet, verifyUnpackedPublicFiles, writeReleaseEvidenceAtomically } from "../scripts/verify-windows-release.mjs";

function manifest(version = "0.1.0-alpha.1") {
  return {
    name: "photopop",
    version,
    description: "A local-first, open-source desktop image editor for design professionals.",
    author: "PhotoPop Contributors",
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

function artifactBytes(name: string) {
  const bytes = Buffer.alloc(2_048, 1);
  if (name.endsWith(".exe")) {
    bytes.set([0x4d, 0x5a]);
  } else {
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
  }
  return bytes;
}

function packagedEvidence() {
  return {
    appPath: "C:\\release\\win-unpacked\\resources\\app.asar",
    executableName: "PhotoPop.exe",
    isPackaged: true,
    name: "photopop",
    version: "0.1.0-alpha.1",
    publicFiles: ["LICENSE", "README.md", "ASSETS.md"]
      .map((name) => ({ name, bytes: 2_048 })),
  };
}

function photoPopIconEvidence() {
  return {
    width: 32,
    height: 32,
    sha256: "44704a4688d54965b3cc0d2146152a09c4fda18a4c029ca1097a53ea121d0993",
    coralPixels: 258,
    bluePixels: 0,
  };
}

function executableIdentities() {
  return [
    "PhotoPop-Setup-0.1.0-alpha.1-x64.exe",
    "PhotoPop-Portable-0.1.0-alpha.1-x64.exe",
  ].map((name) => ({
    name,
    fileDescription: "A local-first, open-source desktop image editor for design professionals.",
    productName: "PhotoPop",
    productVersion: "0.1.0-alpha.1",
    fileVersion: "0.1.0-alpha.1",
    companyName: "PhotoPop Contributors",
    icon: photoPopIconEvidence(),
  })).concat({
    name: "PhotoPop.exe",
    fileDescription: "PhotoPop",
    productName: "PhotoPop",
    productVersion: "0.1.0.0",
    fileVersion: "0.1.0-alpha.1",
    companyName: "PhotoPop Contributors",
    icon: photoPopIconEvidence(),
  });
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

  it("hashes artifacts and rejects invalid headers or an unexpected set", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "photopop-release-test-"));
    try {
      const expected = expectedWindowsArtifacts(manifest());
      for (const name of expected) {
        await writeFile(path.join(releaseDirectory, name), artifactBytes(name));
      }
      const evidence = await verifyArtifactSet(releaseDirectory, expected);
      expect(evidence).toHaveLength(3);
      expect(evidence[0].sha256).toBe(
        createHash("sha256").update(artifactBytes(expected[0])).digest("hex"),
      );

      await writeFile(path.join(releaseDirectory, expected[0]), Buffer.alloc(2_048, 1));
      await expect(verifyArtifactSet(releaseDirectory, expected)).rejects.toThrow(
        /expected Windows executable header/i,
      );
      await writeFile(path.join(releaseDirectory, expected[0]), artifactBytes(expected[0]));

      await writeFile(path.join(releaseDirectory, "unexpected.exe"), artifactBytes("unexpected.exe"));
      await expect(verifyArtifactSet(releaseDirectory, expected)).rejects.toThrow(
        /do not match the release contract/i,
      );
    } finally {
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });

  it("invalidates only the two stale release evidence files before checks", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "photopop-evidence-invalidate-"));
    try {
      await Promise.all([
        writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), "stale checksums"),
        writeFile(path.join(releaseDirectory, "PROVENANCE.json"), "stale provenance"),
        writeFile(path.join(releaseDirectory, "SHA256SUMS.txt.bak"), "keep"),
        writeFile(path.join(releaseDirectory, "PROVENANCE.json.tmp"), "keep"),
        writeFile(path.join(releaseDirectory, "PhotoPop.exe"), "keep"),
      ]);

      await invalidateReleaseEvidence(releaseDirectory);

      expect((await readdir(releaseDirectory)).sort()).toEqual([
        "PROVENANCE.json.tmp",
        "PhotoPop.exe",
        "SHA256SUMS.txt.bak",
      ]);
    } finally {
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });

  it("publishes both evidence files through sibling temporary files", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "photopop-evidence-atomic-"));
    try {
      await writeReleaseEvidenceAtomically(
        releaseDirectory,
        "abc123  PhotoPop.exe\n",
        "{\n  \"schemaVersion\": 1\n}\n",
      );

      await expect(readFile(path.join(releaseDirectory, "SHA256SUMS.txt"), "utf8"))
        .resolves.toBe("abc123  PhotoPop.exe\n");
      await expect(readFile(path.join(releaseDirectory, "PROVENANCE.json"), "utf8"))
        .resolves.toContain("schemaVersion");
      expect((await readdir(releaseDirectory)).sort()).toEqual([
        "PROVENANCE.json",
        "SHA256SUMS.txt",
      ]);
    } finally {
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });

  it("removes partial evidence and sibling temporary files when publication fails", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "photopop-evidence-failure-"));
    try {
      const blockedProvenancePath = path.join(releaseDirectory, "PROVENANCE.json");
      await mkdir(blockedProvenancePath);

      await expect(writeReleaseEvidenceAtomically(
        releaseDirectory,
        "abc123  PhotoPop.exe\n",
        "{}\n",
      )).rejects.toThrow();

      expect((await stat(blockedProvenancePath)).isDirectory()).toBe(true);
      expect(await readdir(releaseDirectory)).toEqual(["PROVENANCE.json"]);
    } finally {
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });

  it("requires the exact physical Sharp license, manifest, and libvips payload", async () => {
    const releaseDirectory = await mkdtemp(path.join(tmpdir(), "photopop-sharp-evidence-"));
    const sharpRoot = "win-unpacked/resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64";
    const gnuV3Notices = [
      "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007",
      "Lesser license text ".repeat(80),
      "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007",
      "General license text ".repeat(80),
    ].join("\n");
    const writeDistributionFile = async (relativePath: string, contents: string | Buffer) => {
      const filePath = path.join(releaseDirectory, ...relativePath.split("/"));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
      return filePath;
    };
    try {
      await Promise.all([
        writeDistributionFile("win-unpacked/LICENSE.electron.txt", Buffer.alloc(128, 1)),
        writeDistributionFile("win-unpacked/LICENSES.chromium.html", gnuV3Notices),
        writeDistributionFile(
          "win-unpacked/resources/THIRD_PARTY_NOTICES.md",
          Buffer.alloc(128, 1),
        ),
        writeDistributionFile(
          `${sharpRoot}/LICENSE`,
          `Apache License\n${"terms\n".repeat(200)}`,
        ),
        writeDistributionFile(
          `${sharpRoot}/versions.json`,
          JSON.stringify({ vips: "8.18.3", components: "x".repeat(300) }),
        ),
        writeDistributionFile(`${sharpRoot}/lib/libvips-42.dll`, Buffer.alloc(1_000_001, 1)),
      ]);

      const evidence = await verifyUnpackedPublicFiles(releaseDirectory);
      expect(evidence.files).toEqual(expect.arrayContaining([
        "resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/LICENSE",
        "resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/versions.json",
        "resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/libvips-42.dll",
      ]));
      expect(evidence.licenseEvidence.chromiumNotices).toMatchObject({
        path: "LICENSES.chromium.html",
        containsLgplV3: true,
        containsGplV3: true,
      });
      expect(evidence.licenseEvidence.chromiumNotices.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(evidence.licenseEvidence.chromiumNotices).not.toHaveProperty("content");

      const chromiumNoticesPath = path.join(
        releaseDirectory,
        "win-unpacked",
        "LICENSES.chromium.html",
      );
      await rm(chromiumNoticesPath);
      await expect(verifyUnpackedPublicFiles(releaseDirectory))
        .rejects.toThrow(/LICENSES.chromium.html/i);

      await writeFile(chromiumNoticesPath, Buffer.alloc(2_048, 1));
      await expect(verifyUnpackedPublicFiles(releaseDirectory))
        .rejects.toThrow(/GNU Lesser GPL v3/i);

      await writeFile(
        chromiumNoticesPath,
        [
          "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007",
          "Lesser license text ".repeat(120),
        ].join("\n"),
      );
      await expect(verifyUnpackedPublicFiles(releaseDirectory))
        .rejects.toThrow(/GNU GPL v3/i);
      await writeFile(chromiumNoticesPath, gnuV3Notices);

      const licensePath = path.join(releaseDirectory, ...`${sharpRoot}/LICENSE`.split("/"));
      await writeFile(licensePath, Buffer.alloc(2_048, 1));
      await expect(verifyUnpackedPublicFiles(releaseDirectory))
        .rejects.toThrow(/expected Sharp platform license/i);

      await writeFile(licensePath, `Apache License\n${"terms\n".repeat(200)}`);
      const versionsPath = path.join(
        releaseDirectory,
        ...`${sharpRoot}/versions.json`.split("/"),
      );
      await writeFile(versionsPath, `{${" ".repeat(300)}`);
      await expect(verifyUnpackedPublicFiles(releaseDirectory))
        .rejects.toThrow(/not valid JSON/i);

      await writeFile(
        versionsPath,
        JSON.stringify({ vips: "8.18.3", components: "x".repeat(300) }),
      );
      const libvipsPath = path.join(
        releaseDirectory,
        ...`${sharpRoot}/lib/libvips-42.dll`.split("/"),
      );
      await writeFile(libvipsPath, Buffer.alloc(16, 1));
      await expect(verifyUnpackedPublicFiles(releaseDirectory))
        .rejects.toThrow(/libvips-42.dll/i);
    } finally {
      await rm(releaseDirectory, { recursive: true, force: true });
    }
  });

  it("requires a safe, branded portable ZIP root", () => {
    const entries = [
      "PhotoPop.exe",
      "resources/app.asar",
      "resources/THIRD_PARTY_NOTICES.md",
      "LICENSE.electron.txt",
      "LICENSES.chromium.html",
    ];
    expect(assertPortableZipEntries(entries)).toEqual(entries);
    expect(() => assertPortableZipEntries(
      entries.filter((entry) => entry !== "resources/THIRD_PARTY_NOTICES.md"),
    )).toThrow(/THIRD_PARTY_NOTICES/i);
    expect(() => assertPortableZipEntries([...entries, "../escape.txt"]))
      .toThrow(/unsafe path/i);
    expect(() => assertPortableZipEntries([...entries, "electron.exe"]))
      .toThrow(/default executable identity/i);
  });

  it("checks the packaged runtime and public files inside app.asar", () => {
    expect(() => assertPackagedApplicationEvidence(packagedEvidence(), manifest())).not.toThrow();
    expect(() => assertPackagedApplicationEvidence({
      ...packagedEvidence(),
      publicFiles: packagedEvidence().publicFiles.filter(
        (file) => file.name !== "ASSETS.md",
      ),
    }, manifest())).toThrow(/ASSETS.md/i);
    expect(() => assertPackagedApplicationEvidence({
      ...packagedEvidence(),
      executableName: "electron.exe",
    }, manifest())).toThrow(/unexpected executable/i);
  });

  it("permits local dirty evidence but rejects a dirty GitHub release checkout", () => {
    const dirty = { sha: "abc123", dirty: true, status: [" M src/App.tsx"] };
    expect(() => assertCiReleaseProvenance(dirty, {})).not.toThrow();
    expect(() => assertCiReleaseProvenance(dirty, { GITHUB_ACTIONS: "true" }))
      .toThrow(/clean checkout/i);
    expect(() => assertCiReleaseProvenance(dirty, {
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: "v0.1.0-alpha.1",
    })).toThrow(/tag publication/i);
    expect(() => assertCiReleaseProvenance({ ...dirty, dirty: false, status: [] }, {
      GITHUB_ACTIONS: "true",
    })).not.toThrow();
  });

  it("pins Windows version resources to PhotoPop identity", () => {
    const currentManifest = manifest();
    const expectedNames = expectedWindowsArtifacts(currentManifest);
    expect(() => assertWindowsExecutableIdentities(
      executableIdentities(),
      currentManifest,
      expectedNames,
    )).not.toThrow();
    expect(() => assertWindowsExecutableIdentities(
      executableIdentities().map((identity, index) => index === 0
        ? { ...identity, productName: "Electron" }
        : identity),
      currentManifest,
      expectedNames,
    )).toThrow(/does not match/i);
    expect(() => assertWindowsExecutableIdentities(
      executableIdentities().map((identity, index) => index === 0
        ? {
            ...identity,
            icon: {
              ...identity.icon,
              sha256: "0".repeat(64),
              coralPixels: 0,
              bluePixels: 105,
            },
          }
        : identity),
      currentManifest,
      expectedNames,
    )).toThrow(/icon evidence/i);
  });
});