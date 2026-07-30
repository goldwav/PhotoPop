/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  nativeImage,
  protocol,
  session,
} from "electron";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const APP_SCHEME = "photopop";
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const PROJECT_EXTENSION = ".photopop";
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".tif", ".tiff", ".psd", PROJECT_EXTENSION]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

function appAssetRoot() {
  const electronDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(electronDirectory, "..", "dist", "client");
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const root = appAssetRoot();
    const target = path.resolve(root, `.${relative}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f2f1ee",
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const allowed = process.env.VITE_DEV_SERVER_URL
      ? targetUrl.startsWith(process.env.VITE_DEV_SERVER_URL)
      : targetUrl.startsWith(`${APP_SCHEME}://`);
    if (!allowed) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL?.startsWith("http://localhost:")) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadURL(`${APP_SCHEME}://app/index.html`);
  }
  window.once("ready-to-show", () => window.show());
}

async function ensureUnderLimit(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("The selected path is not a file.");
  if (fileStat.size > MAX_IMPORT_BYTES) {
    throw new Error("This alpha limits imported files to 512 MB.");
  }
}

function validateAbsolutePath(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("A valid absolute file path is required.");
  }
  return path.normalize(filePath);
}

function validateBytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("The document payload is invalid or too large.");
  }
  return value;
}

async function atomicWrite(targetPath, bytes, validate) {
  const target = validateAbsolutePath(targetPath);
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${target}.bak`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    const written = await readFile(temporary);
    validate(written);
    let targetExists = false;
    try {
      await access(target);
      targetExists = true;
    } catch {
      targetExists = false;
    }
    if (targetExists) {
      await rm(backup, { force: true });
      await rename(target, backup);
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      if (targetExists) await rename(backup, target).catch(() => undefined);
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

function validateProjectBytes(bytes) {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("The generated PhotoPop package failed verification.");
  }
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("The image export payload is invalid.");
  }
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("The image export payload is not base64 encoded.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("The export exceeds the 512 MB alpha limit.");
  return bytes;
}

function safeDocumentId(documentId) {
  if (typeof documentId !== "string" || !/^[a-z0-9-]{8,100}$/i.test(documentId)) {
    throw new Error("The recovery document identifier is invalid.");
  }
  return documentId;
}

async function readPreferences() {
  const preferencesPath = path.join(app.getPath("userData"), "preferences.json");
  try {
    return JSON.parse(await readFile(preferencesPath, "utf8"));
  } catch {
    return {};
  }
}

async function writePreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    throw new Error("Preferences must be an object.");
  }
  const preferencesPath = path.join(app.getPath("userData"), "preferences.json");
  await atomicWrite(preferencesPath, Buffer.from(JSON.stringify(preferences, null, 2)), () => undefined);
}

async function addRecent(filePath) {
  const preferences = await readPreferences();
  const existing = Array.isArray(preferences.recentFiles) ? preferences.recentFiles.filter((item) => typeof item === "string") : [];
  preferences.recentFiles = [filePath, ...existing.filter((item) => item !== filePath)].slice(0, 10);
  await writePreferences(preferences);
}

function installIpcHandlers() {
  ipcMain.handle("photopop:project-open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "PhotoPop project", extensions: ["photopop"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    await ensureUnderLimit(filePath);
    await addRecent(filePath);
    return {
      canceled: false,
      name: path.basename(filePath),
      path: filePath,
      data: new Uint8Array(await readFile(filePath)),
      mimeType: "application/x-photopop",
    };
  });

  ipcMain.handle("photopop:image-open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Supported images", extensions: ["photopop", "psd", "png", "jpg", "jpeg", "webp", "svg", "tif", "tiff"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    await ensureUnderLimit(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error("That file type is not supported.");
    let data = await readFile(filePath);
    let mimeType = extension === ".psd"
      ? "image/vnd.adobe.photoshop"
      : extension === PROJECT_EXTENSION
        ? "application/x-photopop"
        : `image/${extension.replace(".", "").replace("jpg", "jpeg")}`;
    if (extension === ".tif" || extension === ".tiff") {
      data = await sharp(data, { limitInputPixels: 100_000_000 }).png().toBuffer();
      mimeType = "image/png";
    }
    await addRecent(filePath);
    return {
      canceled: false,
      name: path.basename(filePath),
      path: filePath,
      data: new Uint8Array(data),
      mimeType,
    };
  });

  ipcMain.handle("photopop:project-save", async (_event, request) => {
    const bytes = validateBytes(request?.bytes);
    let target = request?.path ? validateAbsolutePath(request.path) : undefined;
    if (!target) {
      const result = await dialog.showSaveDialog({
        defaultPath: request?.suggestedName || "Untitled.photopop",
        filters: [{ name: "PhotoPop project", extensions: ["photopop"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      target = result.filePath.endsWith(PROJECT_EXTENSION) ? result.filePath : `${result.filePath}${PROJECT_EXTENSION}`;
    }
    if (path.extname(target).toLowerCase() !== PROJECT_EXTENSION) {
      throw new Error("PhotoPop projects must use the .photopop extension.");
    }
    await atomicWrite(target, bytes, validateProjectBytes);
    await addRecent(target);
    return { canceled: false, path: target };
  });

  ipcMain.handle("photopop:image-export", async (_event, request) => {
    const format = request?.format;
    if (!["png", "jpeg", "webp", "tiff"].includes(format)) throw new Error("Unsupported export format.");
    const result = await dialog.showSaveDialog({
      defaultPath: request?.suggestedName || `Untitled.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format === "jpeg" ? "jpg" : format] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    let bytes = decodeDataUrl(request.dataUrl);
    if (format === "tiff") bytes = await sharp(bytes).tiff({ compression: "lzw" }).toBuffer();
    await atomicWrite(result.filePath, bytes, (written) => {
      if (written.byteLength < 8) throw new Error("The exported image failed verification.");
    });
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle("photopop:autosave-write", async (_event, request) => {
    const documentId = safeDocumentId(request?.documentId);
    const bytes = validateBytes(request?.bytes);
    const recoveryDirectory = path.join(app.getPath("userData"), "Recovery");
    const target = path.join(recoveryDirectory, `${documentId}.photopop`);
    await atomicWrite(target, bytes, validateProjectBytes);
    const pointerPath = path.join(recoveryDirectory, "latest.json");
    await atomicWrite(pointerPath, Buffer.from(JSON.stringify({ documentId, path: target })), () => undefined);
    return { path: target };
  });

  ipcMain.handle("photopop:autosave-read", async () => {
    const pointerPath = path.join(app.getPath("userData"), "Recovery", "latest.json");
    try {
      const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
      const target = validateAbsolutePath(pointer.path);
      await ensureUnderLimit(target);
      return {
        canceled: false,
        name: path.basename(target),
        path: target,
        data: new Uint8Array(await readFile(target)),
        mimeType: "application/x-photopop",
      };
    } catch {
      return { canceled: true };
    }
  });

  ipcMain.handle("photopop:recent-files", async () => {
    const preferences = await readPreferences();
    return Array.isArray(preferences.recentFiles) ? preferences.recentFiles : [];
  });

  ipcMain.handle("photopop:fonts", async () => {
    const fontsDirectory = process.platform === "win32"
      ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts")
      : "/usr/share/fonts";
    try {
      const files = await readdir(fontsDirectory);
      return files
        .filter((file) => /\.(ttf|otf|ttc)$/i.test(file))
        .map((file) => path.basename(file, path.extname(file)))
        .slice(0, 500);
    } catch {
      return ["Inter", "Arial", "Georgia"];
    }
  });

  ipcMain.handle("photopop:clipboard-read", () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return undefined;
    const bytes = image.toPNG();
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      throw new Error("The clipboard image exceeds the 512 MB alpha limit.");
    }
    return `data:image/png;base64,${bytes.toString("base64")}`;
  });

  ipcMain.handle("photopop:clipboard-write", (_event, dataUrl) => {
    const bytes = decodeDataUrl(dataUrl);
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error("The clipboard image payload is invalid.");
    clipboard.writeImage(image);
  });

  ipcMain.handle("photopop:preferences-read", readPreferences);
  ipcMain.handle("photopop:preferences-write", (_event, preferences) => writePreferences(preferences));
}

app.whenReady().then(() => {
  registerAppProtocol();
  installIpcHandlers();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
