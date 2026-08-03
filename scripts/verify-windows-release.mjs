/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const MIN_ARTIFACT_BYTES = 1_024;
const MIN_NOTICE_BYTES = 128;
const MAX_CHROMIUM_LICENSE_BYTES = 32 * 1_024 * 1_024;
const GNU_V3_VERSION_HEADING = "Version 3, 29 June 2007";
const RELEASE_EVIDENCE_NAMES = ["SHA256SUMS.txt", "PROVENANCE.json"];
// Update only with an approved build/icon.png change and freshly reviewed Windows artifacts.
const EXPECTED_WINDOWS_ICON_SHA256 = "44704a4688d54965b3cc0d2146152a09c4fda18a4c029ca1097a53ea121d0993";
const REQUIRED_PACKAGED_PUBLIC_FILES = [
  "LICENSE",
  "README.md",
  "ASSETS.md",
];

export function expectedWindowsArtifacts(manifest) {
  const { productName, artifactName } = manifest.build ?? {};
  const version = manifest.version;
  if (productName !== "PhotoPop" || typeof version !== "string" || version.length === 0) {
    throw new Error("package.json must define the PhotoPop product name and version.");
  }
  if (artifactName !== "${productName}-${version}-${arch}.${ext}") {
    throw new Error("The generic Windows artifact naming contract changed unexpectedly.");
  }
  if (manifest.build?.nsis?.artifactName !== "${productName}-Setup-${version}-${arch}.${ext}") {
    throw new Error("The NSIS artifact naming contract changed unexpectedly.");
  }
  if (manifest.build?.portable?.artifactName !== "${productName}-Portable-${version}-${arch}.${ext}") {
    throw new Error("The portable artifact naming contract changed unexpectedly.");
  }
  return [
    `PhotoPop-Setup-${version}-x64.exe`,
    `PhotoPop-Portable-${version}-x64.exe`,
    `PhotoPop-${version}-x64.zip`,
  ];
}

export function assertReleaseTag(manifest, environment = process.env) {
  const tag = environment.GITHUB_REF_TYPE === "tag"
    ? environment.GITHUB_REF_NAME
    : environment.GITHUB_REF?.startsWith("refs/tags/")
      ? environment.GITHUB_REF.slice("refs/tags/".length)
      : undefined;
  if (!tag) return;
  const expected = `v${manifest.version}`;
  if (tag !== expected) {
    throw new Error(`Release tag '${tag}' does not match package version '${expected}'.`);
  }
}

export async function verifyArtifactSet(releaseDirectory, expectedNames) {
  const directoryEntries = await readdir(releaseDirectory, { withFileTypes: true });
  const actualNames = directoryEntries
    .filter((entry) => entry.isFile() && /\.(exe|zip)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const expectedSorted = [...expectedNames].sort();
  if (
    actualNames.length !== expectedSorted.length
    || actualNames.some((name, index) => name !== expectedSorted[index])
  ) {
    throw new Error(
      `Windows artifacts do not match the release contract.\n`
      + `Expected: ${expectedSorted.join(", ")}\n`
      + `Actual: ${actualNames.join(", ")}`,
    );
  }

  return Promise.all(expectedNames.map(async (name) => {
    const filePath = path.join(releaseDirectory, name);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size < MIN_ARTIFACT_BYTES) {
      throw new Error(`Release artifact '${name}' is missing or unexpectedly small.`);
    }
    await assertArtifactHeader(filePath, name);
    return {
      name,
      bytes: fileStat.size,
      sha256: await sha256File(filePath),
    };
  }));
}

async function assertArtifactHeader(filePath, name) {
  const expected = name.toLowerCase().endsWith(".exe")
    ? Buffer.from([0x4d, 0x5a])
    : Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const handle = await open(filePath, "r");
  try {
    const actual = Buffer.alloc(expected.length);
    const { bytesRead } = await handle.read(actual, 0, actual.length, 0);
    if (bytesRead !== expected.length || !actual.equals(expected)) {
      const kind = name.toLowerCase().endsWith(".zip") ? "ZIP" : "Windows executable";
      throw new Error(`Release artifact '${name}' does not begin with the expected ${kind} header.`);
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function releaseEvidencePaths(releaseDirectory) {
  const resolvedDirectory = path.resolve(releaseDirectory);
  return RELEASE_EVIDENCE_NAMES.map((name) => path.join(resolvedDirectory, name));
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function bestEffortUnlink(filePaths) {
  await Promise.allSettled(filePaths.map((filePath) => unlink(filePath)));
}

export async function invalidateReleaseEvidence(releaseDirectory) {
  await Promise.all(releaseEvidencePaths(releaseDirectory).map(unlinkIfPresent));
}

export async function writeReleaseEvidenceAtomically(
  releaseDirectory,
  checksumText,
  provenanceText,
) {
  const [checksumPath, provenancePath] = releaseEvidencePaths(releaseDirectory);
  const targetPaths = [checksumPath, provenancePath];
  const temporaryPaths = targetPaths.map((targetPath) => path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  ));
  try {
    await Promise.all([
      writeFile(temporaryPaths[0], checksumText, { encoding: "utf8", flag: "wx" }),
      writeFile(temporaryPaths[1], provenanceText, { encoding: "utf8", flag: "wx" }),
    ]);
    try {
      await rename(temporaryPaths[0], checksumPath);
      await rename(temporaryPaths[1], provenancePath);
    } catch (error) {
      await bestEffortUnlink(targetPaths);
      throw error;
    }
  } finally {
    await bestEffortUnlink(temporaryPaths);
  }
}

export function assertPortableZipEntries(entries) {
  const normalized = entries
    .map((entry) => entry.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("The portable ZIP does not contain any files.");
  }
  for (const entry of normalized) {
    if (entry.startsWith("/") || /^[a-z]:\//i.test(entry) || entry.split("/").includes("..")) {
      throw new Error(`The portable ZIP contains an unsafe path '${entry}'.`);
    }
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("The portable ZIP contains duplicate paths.");
  }
  const required = [
    "PhotoPop.exe",
    "resources/app.asar",
    "resources/THIRD_PARTY_NOTICES.md",
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
  ];
  const missing = required.filter((entry) => !normalized.includes(entry));
  if (missing.length > 0) {
    throw new Error(`The portable ZIP is missing required files: ${missing.join(", ")}.`);
  }
  if (normalized.some((entry) => entry.toLowerCase() === "electron.exe")) {
    throw new Error("The portable ZIP exposes Electron's default executable identity.");
  }
  return normalized;
}

async function verifyPortableZip(releaseDirectory, expectedNames) {
  const zipName = expectedNames.find((name) => name.toLowerCase().endsWith(".zip"));
  if (!zipName) throw new Error("The Windows release contract does not define a portable ZIP.");
  const output = await commandOutput("tar", ["-tf", path.join(releaseDirectory, zipName)]);
  const entries = assertPortableZipEntries(output.split(/\r?\n/));
  return {
    artifact: zipName,
    entries: entries.length,
    rootExecutable: "PhotoPop.exe",
  };
}

export function assertPackagedApplicationEvidence(evidence, manifest) {
  if (evidence.isPackaged !== true) {
    throw new Error("The unpacked application did not identify itself as a packaged Electron app.");
  }
  if (evidence.name !== manifest.name || evidence.version !== manifest.version) {
    throw new Error(
      `The packaged runtime identity '${evidence.name}@${evidence.version}' does not match '${manifest.name}@${manifest.version}'.`,
    );
  }
  if (evidence.executableName !== "PhotoPop.exe") {
    throw new Error(`The packaged runtime used unexpected executable '${evidence.executableName}'.`);
  }
  if (!evidence.appPath.replaceAll("\\", "/").endsWith("/resources/app.asar")) {
    throw new Error("The packaged runtime did not load from resources/app.asar.");
  }
  for (const fileName of REQUIRED_PACKAGED_PUBLIC_FILES) {
    const packagedFile = evidence.publicFiles.find((file) => file.name === fileName);
    if (!packagedFile || packagedFile.bytes < MIN_NOTICE_BYTES) {
      throw new Error(`The packaged application is missing a readable ${fileName}.`);
    }
  }
}

export function assertCiReleaseProvenance(git, environment = process.env) {
  const releaseTag = environment.GITHUB_REF_TYPE === "tag"
    || environment.GITHUB_REF?.startsWith("refs/tags/");
  if ((environment.GITHUB_ACTIONS === "true" || releaseTag) && git.dirty) {
    throw new Error(
      `GitHub release builds and tag publication require a clean checkout. Unexpected changes:\n${git.status.join("\n")}`,
    );
  }
}

export function assertWindowsExecutableIdentities(identities, manifest, expectedNames) {
  const expectedCompany = typeof manifest.author === "string"
    ? manifest.author
    : manifest.author?.name;
  const expected = [
    ...expectedNames
      .filter((name) => name.toLowerCase().endsWith(".exe"))
      .map((name) => ({
        name,
        description: manifest.description,
        productVersion: manifest.version,
      })),
    {
      name: "PhotoPop.exe",
      description: manifest.build.productName,
      productVersion: undefined,
    },
  ];
  for (const contract of expected) {
    const identity = identities.find((candidate) => candidate.name === contract.name);
    if (!identity) throw new Error(`Windows identity metadata is missing for '${contract.name}'.`);
    const icon = identity.icon;
    if (
      icon?.width !== 32
      || icon?.height !== 32
      || icon?.sha256 !== EXPECTED_WINDOWS_ICON_SHA256
      || icon.coralPixels < 100
      || icon.coralPixels <= icon.bluePixels
    ) {
      throw new Error(
        `Windows icon evidence for '${contract.name}' does not match the approved PhotoPop P-dot mark.`,
      );
    }
    if (
      identity.productName !== manifest.build.productName
      || identity.fileDescription !== contract.description
      || identity.fileVersion !== manifest.version
      || identity.companyName !== expectedCompany
      || (contract.productVersion && identity.productVersion !== contract.productVersion)
    ) {
      throw new Error(`Windows identity metadata for '${contract.name}' does not match the PhotoPop release contract.`);
    }
  }
}

async function syntaxCheckPackagedEntries() {
  for (const entry of ["electron/main.mjs", "electron/preload.cjs"]) {
    await execFileAsync(process.execPath, ["--check", path.resolve(entry)], {
      windowsHide: true,
    });
  }
}

async function smokePackagedApp(releaseDirectory, manifest) {
  const executablePath = path.resolve(releaseDirectory, "win-unpacked", "PhotoPop.exe");
  const executableStat = await stat(executablePath);
  if (!executableStat.isFile() || executableStat.size < MIN_ARTIFACT_BYTES) {
    throw new Error("The unpacked PhotoPop executable is missing.");
  }

  const userDataDirectory = await mkdtemp(path.join(tmpdir(), "photopop-release-smoke-"));
  const { _electron: electron } = await import("@playwright/test");
  let application;
  const rendererErrors = [];
  try {
    application = await electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDirectory}`],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
      },
      timeout: 30_000,
    });
    const page = await application.firstWindow({ timeout: 30_000 });
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#root > *").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(750);

    const result = await page.evaluate(() => ({
      protocol: window.location.protocol,
      rootChildren: document.querySelector("#root")?.childElementCount ?? 0,
      title: document.title,
    }));
    const applicationEvidence = await application.evaluate(({ app }, publicFileNames) => {
      const fs = process.getBuiltinModule("node:fs");
      const nodePath = process.getBuiltinModule("node:path");
      const appPath = app.getAppPath();
      return {
        appPath,
        executableName: nodePath.basename(app.getPath("exe")),
        isPackaged: app.isPackaged,
        name: app.getName(),
        publicFiles: publicFileNames.map((name) => ({
          name,
          bytes: fs.statSync(nodePath.join(appPath, name)).size,
        })),
        version: app.getVersion(),
      };
    }, REQUIRED_PACKAGED_PUBLIC_FILES);
    assertPackagedApplicationEvidence(applicationEvidence, manifest);
    if (result.title !== "PhotoPop") {
      throw new Error(`The packaged renderer opened with unexpected title '${result.title}'.`);
    }
    if (result.protocol !== "photopop:" || result.rootChildren < 1) {
      throw new Error("The packaged renderer did not load through PhotoPop's production protocol.");
    }
    if (rendererErrors.length > 0) {
      throw new Error(`The packaged renderer reported errors:\n${rendererErrors.join("\n")}`);
    }
    return {
      executable: "win-unpacked/PhotoPop.exe",
      protocol: result.protocol,
      rendererReady: true,
      title: result.title,
      runtime: {
        applicationArchive: "resources/app.asar",
        executableName: applicationEvidence.executableName,
        isPackaged: applicationEvidence.isPackaged,
        name: applicationEvidence.name,
        version: applicationEvidence.version,
      },
      publicFiles: applicationEvidence.publicFiles,
    };
  } finally {
    await application?.close().catch(() => undefined);
    await rm(userDataDirectory, { recursive: true, force: true });
  }
}

async function commandOutput(command, arguments_) {
  const { stdout } = await execFileAsync(command, arguments_, {
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout.trim();
}

function containsVersionedGnuHeading(content, heading) {
  let headingIndex = content.indexOf(heading);
  while (headingIndex >= 0) {
    const versionIndex = content.indexOf(GNU_V3_VERSION_HEADING, headingIndex + heading.length);
    if (versionIndex >= 0 && versionIndex - headingIndex <= 256) return true;
    headingIndex = content.indexOf(heading, headingIndex + heading.length);
  }
  return false;
}

export async function verifyUnpackedPublicFiles(releaseDirectory) {
  const chromiumNoticesPath = "win-unpacked/LICENSES.chromium.html";
  const sharpBundleRoot = "win-unpacked/resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64";
  const required = [
    { relativePath: "win-unpacked/LICENSE.electron.txt", minimumBytes: MIN_NOTICE_BYTES },
    { relativePath: chromiumNoticesPath, minimumBytes: MIN_ARTIFACT_BYTES },
    {
      relativePath: "win-unpacked/resources/THIRD_PARTY_NOTICES.md",
      minimumBytes: MIN_NOTICE_BYTES,
    },
    { relativePath: `${sharpBundleRoot}/LICENSE`, minimumBytes: MIN_ARTIFACT_BYTES },
    { relativePath: `${sharpBundleRoot}/versions.json`, minimumBytes: 256 },
    { relativePath: `${sharpBundleRoot}/lib/libvips-42.dll`, minimumBytes: 1_000_000 },
  ];
  const resolvedFiles = new Map();
  for (const file of required) {
    const filePath = path.join(releaseDirectory, ...file.relativePath.split("/"));
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size < file.minimumBytes) {
      throw new Error(`The unpacked application is missing a readable ${file.relativePath}.`);
    }
    resolvedFiles.set(file.relativePath, { filePath, bytes: fileStat.size });
  }

  const chromiumNoticesFile = resolvedFiles.get(chromiumNoticesPath);
  if (chromiumNoticesFile.bytes > MAX_CHROMIUM_LICENSE_BYTES) {
    throw new Error(`The packaged ${chromiumNoticesPath} exceeds the bounded validation limit.`);
  }
  const chromiumNotices = await readFile(chromiumNoticesFile.filePath, "utf8");
  const containsLgplV3 = containsVersionedGnuHeading(
    chromiumNotices,
    "GNU LESSER GENERAL PUBLIC LICENSE",
  );
  const containsGplV3 = containsVersionedGnuHeading(
    chromiumNotices,
    "GNU GENERAL PUBLIC LICENSE",
  );
  if (!containsLgplV3) {
    throw new Error(`The packaged ${chromiumNoticesPath} is missing the GNU Lesser GPL v3 heading and version.`);
  }
  if (!containsGplV3) {
    throw new Error(`The packaged ${chromiumNoticesPath} is missing the GNU GPL v3 heading and version.`);
  }

  const sharpLicensePath = `${sharpBundleRoot}/LICENSE`;
  const sharpLicense = await readFile(resolvedFiles.get(sharpLicensePath).filePath, "utf8");
  if (!sharpLicense.startsWith("Apache License")) {
    throw new Error(`The packaged ${sharpLicensePath} is not the expected Sharp platform license.`);
  }
  const versionsPath = `${sharpBundleRoot}/versions.json`;
  let versions;
  try {
    versions = JSON.parse(await readFile(resolvedFiles.get(versionsPath).filePath, "utf8"));
  } catch {
    throw new Error(`The packaged ${versionsPath} is not valid JSON.`);
  }
  if (typeof versions.vips !== "string" || versions.vips.length === 0) {
    throw new Error(`The packaged ${versionsPath} does not identify the bundled libvips version.`);
  }

  return {
    files: required.map((file) => file.relativePath.replace(/^win-unpacked\//, "")),
    licenseEvidence: {
      chromiumNotices: {
        path: chromiumNoticesPath.replace(/^win-unpacked\//, ""),
        bytes: chromiumNoticesFile.bytes,
        sha256: await sha256File(chromiumNoticesFile.filePath),
        containsLgplV3,
        containsGplV3,
      },
    },
  };
}

export async function readWindowsExecutableIdentities(releaseDirectory, expectedNames) {
  if (process.platform !== "win32") {
    throw new Error("Windows executable identity verification must run on Windows.");
  }
  const executablePaths = [
    ...expectedNames
      .filter((name) => name.toLowerCase().endsWith(".exe"))
      .map((name) => path.join(releaseDirectory, name)),
    path.join(releaseDirectory, "win-unpacked", "PhotoPop.exe"),
  ];
  const powershell = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Drawing",
    "$paths = ConvertFrom-Json -InputObject $env:PHOTOPOP_VERIFY_EXECUTABLES",
    "$items = @($paths | ForEach-Object {",
    "  $file = Get-Item -LiteralPath $_",
    "  $info = $file.VersionInfo",
    "  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($file.FullName)",
    "  if ($null -eq $icon) { throw 'The executable has no associated icon.' }",
    "  $bitmap = $icon.ToBitmap()",
    "  try {",
    "    $iconWidth = $bitmap.Width",
    "    $iconHeight = $bitmap.Height",
    "    $coralPixels = 0",
    "    $bluePixels = 0",
    "    for ($x = 0; $x -lt $bitmap.Width; $x++) {",
    "      for ($y = 0; $y -lt $bitmap.Height; $y++) {",
    "        $pixel = $bitmap.GetPixel($x, $y)",
    "        if ($pixel.A -gt 100 -and $pixel.R -gt 170 -and $pixel.R -gt ($pixel.G + 40) -and $pixel.R -gt ($pixel.B + 40)) { $coralPixels++ }",
    "        if ($pixel.A -gt 100 -and $pixel.B -gt 150 -and $pixel.B -gt ($pixel.R + 30)) { $bluePixels++ }",
    "      }",
    "    }",
    "    $stream = New-Object System.IO.MemoryStream",
    "    $sha = [System.Security.Cryptography.SHA256]::Create()",
    "    try {",
    "      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)",
    "      $iconSha256 = -join ($sha.ComputeHash($stream.ToArray()) | ForEach-Object { $_.ToString('x2') })",
    "    } finally {",
    "      $sha.Dispose()",
    "      $stream.Dispose()",
    "    }",
    "  } finally {",
    "    $bitmap.Dispose()",
    "    $icon.Dispose()",
    "  }",
    "  [ordered]@{ name = $file.Name; fileDescription = $info.FileDescription; productName = $info.ProductName; productVersion = $info.ProductVersion; fileVersion = $info.FileVersion; companyName = $info.CompanyName; icon = [ordered]@{ width = $iconWidth; height = $iconHeight; sha256 = $iconSha256; coralPixels = $coralPixels; bluePixels = $bluePixels } }",
    "})",
    "ConvertTo-Json -InputObject $items -Depth 4 -Compress",
  ].join("\n");
  const { stdout } = await execFileAsync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PHOTOPOP_VERIFY_EXECUTABLES: JSON.stringify(executablePaths),
      },
      windowsHide: true,
    },
  );
  const identities = JSON.parse(stdout.trim());
  return Array.isArray(identities) ? identities : [identities];
}

async function gitProvenance() {
  const sha = await commandOutput("git", ["rev-parse", "HEAD"]);
  const status = await commandOutput("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (process.env.GITHUB_SHA && sha.toLowerCase() !== process.env.GITHUB_SHA.toLowerCase()) {
    throw new Error(`Checked-out git SHA '${sha}' does not match GITHUB_SHA '${process.env.GITHUB_SHA}'.`);
  }
  return {
    sha,
    dirty: status.length > 0,
    status: status.length > 0 ? status.split(/\r?\n/) : [],
  };
}

export async function main() {
  const releaseDirectory = path.resolve(process.env.PHOTOPOP_RELEASE_DIR ?? "release");
  await invalidateReleaseEvidence(releaseDirectory);
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assertReleaseTag(manifest);
  const git = await gitProvenance();
  assertCiReleaseProvenance(git);
  const publicGitProvenance = {
    sha: git.sha,
    dirty: git.dirty,
    changedFileCount: git.status.length,
  };
  const expectedNames = expectedWindowsArtifacts(manifest);
  await syntaxCheckPackagedEntries();
  const artifacts = await verifyArtifactSet(releaseDirectory, expectedNames);
  const portableArtifact = await verifyPortableZip(releaseDirectory, expectedNames);
  const distributionEvidence = await verifyUnpackedPublicFiles(releaseDirectory);
  const distributionPublicFiles = distributionEvidence.files;
  const windowsExecutableIdentities = await readWindowsExecutableIdentities(releaseDirectory, expectedNames);
  assertWindowsExecutableIdentities(windowsExecutableIdentities, manifest, expectedNames);
  const packagedAppSmoke = await smokePackagedApp(releaseDirectory, manifest);
  const pnpm = process.platform === "win32"
    ? await commandOutput(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm --version"])
    : await commandOutput("pnpm", ["--version"]);
  const provenance = {
    schemaVersion: 1,
    product: "PhotoPop",
    version: manifest.version,
    unsignedWindowsAlpha: true,
    git: publicGitProvenance,
    runtime: {
      node: process.version,
      pnpm,
    },
    build: {
      architecture: "x64",
      operatingSystem: process.platform,
      github: {
        repository: process.env.GITHUB_REPOSITORY ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        ref: process.env.GITHUB_REF ?? null,
        workflow: process.env.GITHUB_WORKFLOW ?? null,
      },
    },
    artifacts,
    distributionPublicFiles,
    packagedLicenseEvidence: distributionEvidence.licenseEvidence,
    portableArtifact,
    windowsExecutableIdentities,
    packagedAppSmoke,
  };
  const checksumText = `${artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
    .join("\n")}\n`;
  const provenanceText = `${JSON.stringify(provenance, null, 2)}\n`;
  await writeReleaseEvidenceAtomically(releaseDirectory, checksumText, provenanceText);
  process.stdout.write(
    `Verified ${artifacts.length} unsigned Windows artifacts and packaged startup.\n`
    + `Git ${provenance.git.sha}; dirty=${provenance.git.dirty}; `
    + `Node ${provenance.runtime.node}; pnpm ${provenance.runtime.pnpm}.\n`,
  );
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
