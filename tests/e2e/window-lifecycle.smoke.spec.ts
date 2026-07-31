/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, test, type Page } from "@playwright/test";
import { stat } from "node:fs/promises";
import { launchPhotoPop } from "./electron-harness";

test("title-bar close offers Cancel and requires explicit Discard", async ({}, testInfo) => {
  const running = await launchPhotoPop({
    userDataDirectory: testInfo.outputPath("close-cancel-discard-user-data"),
  });
  let closed = false;
  try {
    await editRectangle(running.page);
    await running.page.evaluate(async () => window.photoPop?.setDocumentDirty(true));

    await requestNativeClose(running);
    const prompt = running.page.getByRole("dialog", { name: "Save changes before continuing?" });
    await expect(prompt).toContainText("quit PhotoPop");
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toHaveCount(0);
    await expect(running.page.getByLabel(/Editing canvas for/)).toBeVisible();

    const appClosed = new Promise<void>((resolve) => running.app.once("close", () => resolve()));
    await requestNativeClose(running);
    await running.page
      .getByRole("dialog", { name: "Save changes before continuing?" })
      .getByRole("button", { name: "Discard changes" })
      .click();
    await appClosed;
    closed = true;
  } finally {
    if (!closed) await running.close();
  }
});

test("title-bar close waits for a verified project save", async ({}, testInfo) => {
  const projectPath = testInfo.outputPath("saved-before-close.photopop");
  const running = await launchPhotoPop({
    userDataDirectory: testInfo.outputPath("close-save-user-data"),
    dialogs: { save: [projectPath] },
  });
  let closed = false;
  try {
    await editRectangle(running.page);
    await running.page.evaluate(async () => window.photoPop?.setDocumentDirty(true));

    const appClosed = new Promise<void>((resolve) => running.app.once("close", () => resolve()));
    await requestNativeClose(running);
    await running.page
      .getByRole("dialog", { name: "Save changes before continuing?" })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await appClosed;
    closed = true;
    expect((await stat(projectPath)).size).toBeGreaterThan(100);
  } finally {
    if (!closed) await running.close();
  }
});

async function requestNativeClose(running: Awaited<ReturnType<typeof launchPhotoPop>>): Promise<void> {
  await running.app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
}

async function editRectangle(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Rectangle, shortcut/ }).click();
  const canvas = page.getByLabel(/Editing canvas for/);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The editor canvas did not have measurable bounds.");
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.48, bounds.y + bounds.height * 0.48, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".unsaved-dot")).toBeVisible();
}
