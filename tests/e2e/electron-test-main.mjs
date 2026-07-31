/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { app, dialog } from "electron";

const userDataDirectory = process.env.PHOTOPOP_E2E_USER_DATA_DIR;
if (!userDataDirectory) {
  throw new Error("PHOTOPOP_E2E_USER_DATA_DIR is required for the Electron test harness.");
}
app.setPath("userData", userDataDirectory);

const responses = parseResponses(process.env.PHOTOPOP_E2E_DIALOG_RESPONSES);
let openIndex = 0;
let saveIndex = 0;

dialog.showOpenDialog = async () => {
  const filePath = responses.open[openIndex];
  openIndex += 1;
  return filePath
    ? { canceled: false, filePaths: [filePath] }
    : { canceled: true, filePaths: [] };
};

dialog.showSaveDialog = async () => {
  const filePath = responses.save[saveIndex];
  saveIndex += 1;
  return filePath
    ? { canceled: false, filePath }
    : { canceled: true };
};

await import("../../electron/main.mjs");

function parseResponses(value) {
  if (!value) return { open: [], save: [] };
  const parsed = JSON.parse(value);
  return {
    open: Array.isArray(parsed.open) ? parsed.open : [],
    save: Array.isArray(parsed.save) ? parsed.save : [],
  };
}
