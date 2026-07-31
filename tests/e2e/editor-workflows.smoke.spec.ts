/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, test, type TestInfo } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  chooseMenuAction,
  forceQuit,
  launchPhotoPop,
  type RunningPhotoPop,
} from "./electron-harness";
import { pngFixture, projectBytes, projectDocument } from "./project-fixtures";

test("launches, edits, undoes, and exposes working keyboard shortcuts", async ({}, testInfo) => {
  const running = await launch(testInfo);
  try {
    const { page } = running;
    await expect(page.getByTestId("canvas-viewport")).toBeVisible();

    await page.keyboard.press("b");
    await expect(page.getByRole("button", { name: /Brush mask/ })).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Rectangle, shortcut/ }).click();
    const canvas = page.getByLabel(/Editing canvas for/);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.58, box!.y + box!.height * 0.58, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole("listitem").filter({ hasText: "Rectangle" })).toBeVisible();

    await page.keyboard.press("Control+z");
    await expect(page.getByRole("listitem").filter({ hasText: "Rectangle" })).toHaveCount(0);
    await page.keyboard.press("Control+Shift+z");
    await expect(page.getByRole("listitem").filter({ hasText: "Rectangle" })).toBeVisible();
  } finally {
    await running.close();
  }
});

test("contains modal focus, restores the opener, and preserves native Space activation", async ({}, testInfo) => {
  const running = await launch(testInfo);
  try {
    const { page } = running;
    const rectangleTool = page.getByRole("button", { name: /Rectangle, shortcut/ });
    await rectangleTool.focus();
    await page.keyboard.press("Space");
    await expect(rectangleTool).toHaveAttribute("aria-pressed", "true");

    const canvas = page.getByLabel(/Editing canvas for/);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.42, box!.y + box!.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.55, { steps: 4 });
    await page.mouse.up();

    const closeButton = page.getByRole("button", { name: /Close Editorial-Cover/ });
    await closeButton.click();
    const dialog = page.getByRole("dialog", { name: "Save changes before continuing?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    for (let index = 0; index < 8; index += 1) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(closeButton).toBeFocused();
  } finally {
    await running.close();
  }
});

test("intercepts a native window close while the document is dirty", async ({}, testInfo) => {
  const running = await launch(testInfo);
  try {
    const { page, app } = running;
    await page.getByRole("button", { name: /Rectangle, shortcut/ }).click();
    const canvas = page.getByLabel(/Editing canvas for/);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.52, box!.y + box!.height * 0.52, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator(".unsaved-dot")).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    const dialog = page.getByRole("dialog", { name: "Save changes before continuing?" });
    await expect(dialog).toContainText("quit PhotoPop");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  } finally {
    await running.close();
  }
});

test("keeps export open for cancellation and inline validation errors", async ({}, testInfo) => {
  const running = await launch(testInfo);
  try {
    const { page } = running;
    await chooseMenuAction(page, "File", /^Export/);
    const dialog = page.getByRole("dialog", { name: "Export image" });
    await dialog.getByRole("button", { name: /^Export$/ }).click();
    await expect(dialog).toBeVisible();
    await expect(page.locator(".toast")).toHaveCount(0);

    await dialog.getByLabel("Width").fill("0");
    await dialog.getByRole("button", { name: /^Export$/ }).click();
    await expect(dialog.getByRole("alert")).toContainText("between 1 and 32,768");
    await expect(dialog).toBeVisible();
  } finally {
    await running.close();
  }
});

test("disables document-only commands after closing the last document", async ({}, testInfo) => {
  const running = await launch(testInfo);
  try {
    const { page } = running;
    await page.getByRole("button", { name: /Close Editorial-Cover/ }).click();
    await expect(page.getByRole("heading", { name: "Start with an image" })).toBeVisible();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Save", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("option", { name: /Save/ })).toHaveCount(0);
  } finally {
    await running.close();
  }
});

test("opens a native project delivered through the Windows launch channel", async ({}, testInfo) => {
  const projectPath = testInfo.outputPath("launch-file.photopop");
  const bytes = await projectBytes(projectDocument({ name: "Launch File Project" }));
  await writeFile(projectPath, bytes);
  const running = await launchPhotoPop({
    userDataDirectory: testInfo.outputPath("launch-file-user-data"),
  });
  try {
    await running.app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("photopop:launch-file-requested", {
        name: payload.name,
        path: payload.path,
        data: Uint8Array.from(payload.bytes),
        mimeType: "application/x-photopop",
      });
    }, { name: path.basename(projectPath), path: projectPath, bytes: [...bytes] });
    await expect(running.page.locator(".document-tab")).toContainText("Launch File Project");
    await expect(running.page.getByLabel(/Editing canvas for Launch File Project/)).toBeVisible();
  } finally {
    await running.close();
  }
});

test("opens, saves safely, and reopens a native project", async ({}, testInfo) => {
  const sourcePath = testInfo.outputPath("source.photopop");
  const savedPath = testInfo.outputPath("saved.photopop");
  await writeFile(sourcePath, await projectBytes());

  const firstRun = await launch(testInfo, {
    open: [sourcePath],
    save: [savedPath],
  });
  try {
    await chooseMenuAction(firstRun.page, "File", /^Open/);
    await expect(firstRun.page.locator(".document-tab")).toContainText("E2E Project");
    await expect(firstRun.page.getByRole("listitem").filter({ hasText: "Missing font sample" })).toBeVisible();

    await firstRun.page.keyboard.press("Control+Shift+s");
    await expect(firstRun.page.locator(".toast")).toContainText(/saved safely/i);
    expect((await stat(savedPath)).size).toBeGreaterThan(100);
  } finally {
    await firstRun.close();
  }

  const secondRun = await launchPhotoPop({
    userDataDirectory: testInfo.outputPath("reopen-user-data"),
    dialogs: { open: [savedPath] },
  });
  try {
    await chooseMenuAction(secondRun.page, "File", /^Open/);
    await expect(secondRun.page.locator(".document-tab")).toContainText("E2E Project");
    await expect(secondRun.page.getByLabel(/Editing canvas for E2E Project/)).toBeVisible();
  } finally {
    await secondRun.close();
  }
});

test("exports PNG, JPEG, WebP, and TIFF files that reopen correctly", async ({}, testInfo) => {
  const outputs = [
    testInfo.outputPath("export.png"),
    testInfo.outputPath("export.jpg"),
    testInfo.outputPath("export.webp"),
    testInfo.outputPath("export.tiff"),
  ];
  const running = await launch(testInfo, { save: outputs });
  try {
    for (const [index, format] of ["png", "jpeg", "webp", "tiff"].entries()) {
      await chooseMenuAction(running.page, "File", /^Export/);
      const dialog = running.page.getByRole("dialog", { name: "Export image" });
      await dialog.getByLabel("Format").selectOption(format);
      await dialog.getByLabel("Width").fill("96");
      await dialog.getByLabel("Height").fill("64");
      await dialog.getByRole("button", { name: /^Export$/ }).click();
      await expect(running.page.locator(".toast")).toContainText(new RegExp(`${format} exported`, "i"));

      const metadata = await sharp(outputs[index]).metadata();
      expect(metadata.format).toBe(format);
      expect(metadata.width).toBe(96);
      expect(metadata.height).toBe(64);
    }
  } finally {
    await running.close();
  }
});

test("supports clipboard image transfer and drag-and-drop import", async ({}, testInfo) => {
  const running = await launch(testInfo);
  try {
    const png = await pngFixture();
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    await running.page.evaluate(async (value) => {
      await window.photoPop?.writeClipboardImage(value);
    }, dataUrl);
    await running.page.keyboard.press("Control+v");
    await expect(running.page.getByRole("listitem").filter({ hasText: "Clipboard image" })).toBeVisible();

    await running.page.keyboard.press("Control+c");
    await expect(running.page.locator(".toast")).toContainText(/merged image copied/i);

    const dataTransfer = await running.page.evaluateHandle((bytes) => {
      const file = new File([Uint8Array.from(bytes)], "dropped-image.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      return transfer;
    }, [...png]);
    await running.page.locator("main").dispatchEvent("dragover", { dataTransfer });
    await running.page.locator("main").dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
    const prompt = running.page.getByRole("dialog", { name: "Save changes before opening this file?" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Discard changes" }).click();
    await expect(running.page.locator(".document-tab")).toContainText("dropped-image");
  } finally {
    await running.close();
  }
});

test("recovers the most recent project after a forced process termination", async ({}, testInfo) => {
  const userDataDirectory = testInfo.outputPath("recovery-user-data");
  const bytes = await projectBytes(projectDocument({
    id: "document-e2e-recovery",
    name: "Recovered Work",
  }));
  const firstRun = await launchPhotoPop({ userDataDirectory });
  await firstRun.page.evaluate(async (serialized) => {
    await window.photoPop?.writeAutosave({
      bytes: Uint8Array.from(serialized),
      documentId: "document-e2e-recovery",
    });
  }, [...bytes]);
  await forceQuit(firstRun.app);
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const secondRun = await launchPhotoPop({ userDataDirectory });
  try {
    const banner = secondRun.page.locator(".recovery-banner");
    await expect(banner).toContainText("Recovered Work");
    await banner.getByRole("button", { name: "Recover", exact: true }).click();
    await expect(secondRun.page.locator(".document-tab")).toContainText("Recovered Work");
  } finally {
    await secondRun.close();
  }
});

test("falls back safely for a missing font", async ({}, testInfo) => {
  const projectPath = testInfo.outputPath("missing-font.photopop");
  await writeFile(projectPath, await projectBytes());
  const running = await launch(testInfo, { open: [projectPath] });
  try {
    await chooseMenuAction(running.page, "File", /^Open/);
    await expect(running.page.getByRole("listitem").filter({ hasText: "Missing font sample" })).toBeVisible();
    const fonts = await running.page.evaluate(() => window.photoPop?.listFonts());
    expect(fonts?.length).toBeGreaterThan(0);
    const sample = await running.page.getByLabel(/Editing canvas for E2E Project/).screenshot();
    expect(sample.byteLength).toBeGreaterThan(1_000);
  } finally {
    await running.close();
  }
});

test("reports a write failure without leaving a partial project", async ({}, testInfo) => {
  const blocker = testInfo.outputPath("not-a-directory");
  await mkdir(path.dirname(blocker), { recursive: true });
  await writeFile(blocker, "directory blocker", "utf8");
  const impossiblePath = path.join(blocker, "low-disk.photopop");
  const running = await launch(testInfo, { save: [impossiblePath] });
  try {
    await running.page.getByLabel(/Editing canvas for/).screenshot();
    await running.page.keyboard.press("Control+Shift+s");
    await expect(running.page.locator(".toast")).toContainText(/directory|failed|access|eno/i);
    await expect(readFile(impossiblePath)).rejects.toThrow();
  } finally {
    await running.close();
  }
});

async function launch(
  testInfo: TestInfo,
  dialogs: { open?: string[]; save?: string[] } = {},
): Promise<RunningPhotoPop> {
  return launchPhotoPop({
    userDataDirectory: testInfo.outputPath("user-data"),
    dialogs,
  });
}
