/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface DialogResponses {
  open?: string[];
  save?: string[];
}

export interface RunningPhotoPop {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

export async function launchPhotoPop({
  userDataDirectory,
  dialogs = {},
}: {
  userDataDirectory: string;
  dialogs?: DialogResponses;
}): Promise<RunningPhotoPop> {
  await mkdir(userDataDirectory, { recursive: true });
  const app = await electron.launch({
    args: [path.resolve("tests/e2e/electron-test-main.mjs")],
    env: {
      ...process.env,
      PHOTOPOP_E2E_USER_DATA_DIR: userDataDirectory,
      PHOTOPOP_E2E_DIALOG_RESPONSES: JSON.stringify({
        open: dialogs.open ?? [],
        save: dialogs.save ?? [],
      }),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("button", { name: "PhotoPop", exact: true })).toBeVisible();
  return {
    app,
    page,
    close: async () => {
      const process = app.process();
      if (process.exitCode !== null) return;
      const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
      await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (process.exitCode === null) await forceQuit(app).catch(() => undefined);
    },
  };
}

export async function chooseMenuAction(page: Page, menu: string, action: RegExp): Promise<void> {
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

export async function forceQuit(app: ElectronApplication): Promise<void> {
  const childProcess = app.process();
  if (childProcess.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => childProcess.once("exit", () => resolve()));
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/PID", String(childProcess.pid), "/T", "/F"], () => resolve());
    });
  } else {
    childProcess.kill();
  }
  await Promise.race([
    exited,
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error("Electron did not terminate within five seconds.")), 5_000)),
  ]);
}
