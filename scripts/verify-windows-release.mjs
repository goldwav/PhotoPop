/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const MIN_ARTIFACT_BYTES = 1_024;

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
    const bytes = await readFile(filePath);
    return {
      name,
      bytes: fileStat.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
}

async function syntaxCheckPackagedEntries() {
  for (const entry of ["electron/main.mjs", "electron/preload.cjs"]) {
    await execFileAsync(process.execPath, ["--check", path.resolve(entry)], {
      windowsHide: true,
    });
  }
}

async function smokePackagedApp(releaseDirectory) {
  const executablePath = path.resolve(releaseDirectory, "win-unpacked", "PhotoPop.exe");
  const executableStat = await stat(executablePath);
  if (!executableStat.isFile() || executableStat.size < MIN_ARTIFACT_BYTES) {
    throw new Error("The unpacked PhotoPop executable is missing.");
  }

  const userDataDirectory = await mkdtemp(path.join(tmpdir(), "photopop-release-smoke-"));
  const { _electron: electron } = await import("@playwright/test");
  let application;
  const rendererErrors = [];
  const startedAt = Date.now();
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
      durationMs: Date.now() - startedAt,
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
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assertReleaseTag(manifest);
  const releaseDirectory = path.resolve(process.env.PHOTOPOP_RELEASE_DIR ?? "release");
  const expectedNames = expectedWindowsArtifacts(manifest);
  await syntaxCheckPackagedEntries();
  const artifacts = await verifyArtifactSet(releaseDirectory, expectedNames);
  const packagedAppSmoke = await smokePackagedApp(releaseDirectory);
  const pnpm = process.platform === "win32"
    ? await commandOutput(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm --version"])
    : await commandOutput("pnpm", ["--version"]);
  const provenance = {
    schemaVersion: 1,
    product: "PhotoPop",
    version: manifest.version,
    unsignedWindowsAlpha: true,
    git: await gitProvenance(),
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
    packagedAppSmoke,
  };
  const checksumText = `${artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
    .join("\n")}\n`;
  await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), checksumText, "utf8");
  await writeFile(
    path.join(releaseDirectory, "PROVENANCE.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8",
  );
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
