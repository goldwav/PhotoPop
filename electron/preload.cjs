/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const { contextBridge, ipcRenderer } = require("electron");

const launchFileCallbacks = new Set();
const pendingLaunchFileRequests = [];

ipcRenderer.on("photopop:launch-file-requested", (_event, payload) => {
  if (launchFileCallbacks.size === 0) {
    pendingLaunchFileRequests.push(payload);
    return;
  }
  for (const callback of launchFileCallbacks) callback(payload);
});

contextBridge.exposeInMainWorld("photoPop", Object.freeze({
  isDesktop: true,
  openProject: () => ipcRenderer.invoke("photopop:project-open"),
  openImage: () => ipcRenderer.invoke("photopop:image-open"),
  saveProject: (request) => ipcRenderer.invoke("photopop:project-save", request),
  exportImage: (request) => ipcRenderer.invoke("photopop:image-export", request),
  writeAutosave: (request) => ipcRenderer.invoke("photopop:autosave-write", request),
  readAutosave: () => ipcRenderer.invoke("photopop:autosave-read"),
  clearAutosave: (documentId) => ipcRenderer.invoke("photopop:autosave-clear", documentId),
  recentFiles: () => ipcRenderer.invoke("photopop:recent-files"),
  listFonts: () => ipcRenderer.invoke("photopop:fonts"),
  readClipboardImage: () => ipcRenderer.invoke("photopop:clipboard-read"),
  writeClipboardImage: (dataUrl) => ipcRenderer.invoke("photopop:clipboard-write", dataUrl),
  readPreferences: () => ipcRenderer.invoke("photopop:preferences-read"),
  writePreferences: (preferences) => ipcRenderer.invoke("photopop:preferences-write", preferences),
  setDocumentDirty: (dirty) => ipcRenderer.invoke("photopop:document-dirty-set", dirty),
  onLaunchFileRequested: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("Launch file callback must be a function.");
    }
    launchFileCallbacks.add(callback);
    while (pendingLaunchFileRequests.length > 0) {
      callback(pendingLaunchFileRequests.shift());
    }
    return () => launchFileCallbacks.delete(callback);
  },
  onWindowCloseRequested: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("Window close callback must be a function.");
    }
    const listener = () => callback();
    ipcRenderer.on("photopop:window-close-requested", listener);
    return () => ipcRenderer.removeListener("photopop:window-close-requested", listener);
  },
  confirmWindowClose: () => ipcRenderer.invoke("photopop:window-close-confirm"),
}));
