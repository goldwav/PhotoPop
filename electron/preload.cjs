/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("photoPop", Object.freeze({
  isDesktop: true,
  openProject: () => ipcRenderer.invoke("photopop:project-open"),
  openImage: () => ipcRenderer.invoke("photopop:image-open"),
  saveProject: (request) => ipcRenderer.invoke("photopop:project-save", request),
  exportImage: (request) => ipcRenderer.invoke("photopop:image-export", request),
  writeAutosave: (request) => ipcRenderer.invoke("photopop:autosave-write", request),
  readAutosave: () => ipcRenderer.invoke("photopop:autosave-read"),
  recentFiles: () => ipcRenderer.invoke("photopop:recent-files"),
  listFonts: () => ipcRenderer.invoke("photopop:fonts"),
  readClipboardImage: () => ipcRenderer.invoke("photopop:clipboard-read"),
  writeClipboardImage: (dataUrl) => ipcRenderer.invoke("photopop:clipboard-write", dataUrl),
  readPreferences: () => ipcRenderer.invoke("photopop:preferences-read"),
  writePreferences: (preferences) => ipcRenderer.invoke("photopop:preferences-write", preferences),
}));
