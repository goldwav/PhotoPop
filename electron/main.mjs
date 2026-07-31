/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
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
import JSZip from "jszip";
import sharp from "sharp";

const APP_SCHEME = "photopop";
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_PROJECT_ENTRIES = 4_096;
const MAX_PROJECT_UNCOMPRESSED_BYTES = 768 * 1024 * 1024;
const MAX_PROJECT_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_PROJECT_JSON_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const MAX_IMAGE_PIXELS = 100_000_000;
const PROJECT_EXTENSION = ".photopop";
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".tif", ".tiff", ".psd", PROJECT_EXTENSION]);
const layerTypes = new Set(["raster", "group", "text", "shape", "adjustment"]);
const exportExtensions = {
  png: new Set([".png"]),
  jpeg: new Set([".jpg", ".jpeg"]),
  webp: new Set([".webp"]),
  tiff: new Set([".tif", ".tiff"]),
};
const windowCloseStates = new WeakMap();
const pendingLaunchFiles = [];
let primaryWindow;
let primaryWindowReady = false;
let launchFileWork = Promise.resolve();

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

export function installWindowCloseProtection(window) {
  const state = {
    confirmed: false,
    dirty: false,
  };
  windowCloseStates.set(window, state);
  window.on("close", (event) => {
    if (
      !state.dirty
      || state.confirmed
      || window.webContents.isDestroyed()
    ) return;
    event.preventDefault();
    window.webContents.send("photopop:window-close-requested");
  });
  window.on("closed", () => {
    windowCloseStates.delete(window);
  });
  window.webContents.on("render-process-gone", () => {
    state.confirmed = true;
  });
}

function windowCloseStateForEvent(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  const state = window ? windowCloseStates.get(window) : undefined;
  if (!window || !state) {
    throw new Error("The window close request did not come from a PhotoPop editor window.");
  }
  return { state, window };
}

export function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f2f1ee",
    show: false,
    autoHideMenuBar: true,
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

  primaryWindow = window;
  primaryWindowReady = false;
  installWindowCloseProtection(window);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("did-start-loading", () => {
    if (primaryWindow === window) primaryWindowReady = false;
  });
  window.webContents.on("did-finish-load", () => {
    if (primaryWindow !== window || window.webContents.isDestroyed()) return;
    primaryWindowReady = true;
    flushPendingLaunchFiles();
  });
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
  window.on("closed", () => {
    if (primaryWindow !== window) return;
    primaryWindow = undefined;
    primaryWindowReady = false;
  });
  return window;
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

export function launchProjectPathsFromArguments(arguments_) {
  if (!Array.isArray(arguments_)) return [];
  const paths = [];
  const seen = new Set();
  for (const argument of arguments_) {
    if (
      typeof argument !== "string"
      || !path.isAbsolute(argument)
      || path.extname(argument).toLowerCase() !== PROJECT_EXTENSION
    ) continue;
    const normalized = path.normalize(argument);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(normalized);
  }
  return paths;
}

export async function readLaunchProjectFile(filePath) {
  const target = validateAbsolutePath(filePath);
  if (path.extname(target).toLowerCase() !== PROJECT_EXTENSION) {
    throw new Error("PhotoPop projects must use the .photopop extension.");
  }
  await ensureUnderLimit(target);
  const bytes = await readFile(target);
  await validateProjectBytes(bytes);
  return {
    name: path.basename(target),
    path: target,
    data: new Uint8Array(bytes),
    mimeType: "application/x-photopop",
  };
}

function flushPendingLaunchFiles() {
  const window = primaryWindow;
  if (
    !window
    || window.isDestroyed()
    || window.webContents.isDestroyed()
    || !primaryWindowReady
  ) return;
  while (pendingLaunchFiles.length > 0) {
    window.webContents.send(
      "photopop:launch-file-requested",
      pendingLaunchFiles.shift(),
    );
  }
}

function deliverLaunchFile(payload) {
  const window = primaryWindow;
  if (
    !window
    || window.isDestroyed()
    || window.webContents.isDestroyed()
    || !primaryWindowReady
  ) {
    pendingLaunchFiles.push(payload);
    return;
  }
  window.webContents.send("photopop:launch-file-requested", payload);
}

export function queueLaunchProjectPath(filePath) {
  launchFileWork = launchFileWork
    .catch(() => undefined)
    .then(async () => {
      try {
        const payload = await readLaunchProjectFile(filePath);
        await addRecent(payload.path).catch(() => undefined);
        deliverLaunchFile(payload);
        return true;
      } catch {
        return false;
      }
    });
  return launchFileWork;
}

export function queueLaunchFilesFromArguments(arguments_) {
  let queued = Promise.resolve();
  for (const filePath of launchProjectPathsFromArguments(arguments_)) {
    queued = queueLaunchProjectPath(filePath);
  }
  return queued.then(() => undefined);
}

function focusPrimaryWindow() {
  const window = primaryWindow && !primaryWindow.isDestroyed()
    ? primaryWindow
    : BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
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
    await validate(written);
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkedZip64Integer(buffer, offset, label) {
  if (offset < 0 || offset + 8 > buffer.byteLength) {
    throw new Error(`The PhotoPop package has a truncated ${label}.`);
  }
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The PhotoPop package ${label} is too large.`);
  }
  return Number(value);
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.byteLength - 65_557);
  for (let offset = buffer.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.byteLength) return offset;
  }
  throw new Error("The PhotoPop package is not a complete ZIP archive.");
}

function readZip64Extra(buffer, start, length, needs) {
  const end = start + length;
  let cursor = start;
  while (cursor + 4 <= end) {
    const fieldId = buffer.readUInt16LE(cursor);
    const fieldLength = buffer.readUInt16LE(cursor + 2);
    const fieldStart = cursor + 4;
    const fieldEnd = fieldStart + fieldLength;
    if (fieldEnd > end) throw new Error("The PhotoPop package has malformed ZIP metadata.");
    if (fieldId === 0x0001) {
      let valueOffset = fieldStart;
      const values = {};
      for (const key of ["uncompressedSize", "compressedSize", "localHeaderOffset", "diskNumber"]) {
        if (!needs[key]) continue;
        const byteLength = key === "diskNumber" ? 4 : 8;
        if (valueOffset + byteLength > fieldEnd) {
          throw new Error("The PhotoPop package has incomplete ZIP64 metadata.");
        }
        values[key] = key === "diskNumber"
          ? buffer.readUInt32LE(valueOffset)
          : checkedZip64Integer(buffer, valueOffset, key);
        valueOffset += byteLength;
      }
      return values;
    }
    cursor = fieldEnd;
  }
  throw new Error("The PhotoPop package is missing required ZIP64 metadata.");
}

function validateZipEntryName(name) {
  if (
    !name
    || name.includes("\\")
    || name.startsWith("/")
    || /^[a-z]:/i.test(name)
    || name.split("/").some((part, index, parts) => (
      part === "."
      || part === ".."
      || (part === "" && index !== parts.length - 1)
    ))
  ) {
    throw new Error("The PhotoPop package contains an unsafe entry name.");
  }
}

function inspectZipDirectory(bytes) {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.byteLength < 22) {
    throw new Error("The generated PhotoPop package failed verification.");
  }
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  let entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  let entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralSize = buffer.readUInt32LE(eocdOffset + 12);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let centralBoundary = eocdOffset;

  const usesZip64 = entriesOnDisk === 0xffff
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff;
  if (usesZip64) {
    const locatorOffset = eocdOffset - 20;
    if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== 0x07064b50) {
      throw new Error("The PhotoPop package has incomplete ZIP64 metadata.");
    }
    if (buffer.readUInt32LE(locatorOffset + 4) !== 0 || buffer.readUInt32LE(locatorOffset + 16) !== 1) {
      throw new Error("Split PhotoPop packages are not supported.");
    }
    const zip64Offset = checkedZip64Integer(buffer, locatorOffset + 8, "ZIP64 directory offset");
    if (zip64Offset + 56 > locatorOffset || buffer.readUInt32LE(zip64Offset) !== 0x06064b50) {
      throw new Error("The PhotoPop package has an invalid ZIP64 directory.");
    }
    const zip64RecordSize = checkedZip64Integer(buffer, zip64Offset + 4, "ZIP64 record size");
    if (zip64Offset + 12 + zip64RecordSize > locatorOffset) {
      throw new Error("The PhotoPop package has a truncated ZIP64 directory.");
    }
    if (buffer.readUInt32LE(zip64Offset + 16) !== 0 || buffer.readUInt32LE(zip64Offset + 20) !== 0) {
      throw new Error("Split PhotoPop packages are not supported.");
    }
    entriesOnDisk = checkedZip64Integer(buffer, zip64Offset + 24, "entry count");
    entryCount = checkedZip64Integer(buffer, zip64Offset + 32, "entry count");
    centralSize = checkedZip64Integer(buffer, zip64Offset + 40, "central directory size");
    centralOffset = checkedZip64Integer(buffer, zip64Offset + 48, "central directory offset");
    centralBoundary = zip64Offset;
  } else if (diskNumber !== 0 || centralDisk !== 0) {
    throw new Error("Split PhotoPop packages are not supported.");
  }

  if (entriesOnDisk !== entryCount || entryCount < 1 || entryCount > MAX_PROJECT_ENTRIES) {
    throw new Error("The PhotoPop package has an invalid entry count.");
  }
  const centralEnd = centralOffset + centralSize;
  if (
    !Number.isSafeInteger(centralEnd)
    || centralOffset < 0
    || centralSize < 0
    || centralEnd > centralBoundary
  ) {
    throw new Error("The PhotoPop package has an invalid central directory.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralEnd || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("The PhotoPop package has malformed ZIP entries.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    let compressedSize = buffer.readUInt32LE(cursor + 20);
    let uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    let entryDisk = buffer.readUInt16LE(cursor + 34);
    let localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralEnd || nameLength === 0) {
      throw new Error("The PhotoPop package has truncated ZIP entries.");
    }
    if ((flags & 0x1) !== 0 || ![0, 8].includes(compressionMethod)) {
      throw new Error("The PhotoPop package uses unsupported ZIP features.");
    }

    const needs = {
      uncompressedSize: uncompressedSize === 0xffffffff,
      compressedSize: compressedSize === 0xffffffff,
      localHeaderOffset: localHeaderOffset === 0xffffffff,
      diskNumber: entryDisk === 0xffff,
    };
    if (Object.values(needs).some(Boolean)) {
      const values = readZip64Extra(buffer, cursor + 46 + nameLength, extraLength, needs);
      if (needs.uncompressedSize) uncompressedSize = values.uncompressedSize;
      if (needs.compressedSize) compressedSize = values.compressedSize;
      if (needs.localHeaderOffset) localHeaderOffset = values.localHeaderOffset;
      if (needs.diskNumber) entryDisk = values.diskNumber;
    }
    if (entryDisk !== 0 || localHeaderOffset >= centralOffset) {
      throw new Error("The PhotoPop package has invalid entry locations.");
    }

    let name;
    try {
      name = decoder.decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    } catch {
      throw new Error("The PhotoPop package contains an invalid entry name.");
    }
    validateZipEntryName(name);
    if (entries.has(name)) throw new Error("The PhotoPop package contains duplicate entries.");
    if (
      uncompressedSize > MAX_PROJECT_ENTRY_BYTES
      || (
        uncompressedSize > 1024 * 1024
        && uncompressedSize > Math.max(1, compressedSize) * MAX_COMPRESSION_RATIO
      )
    ) {
      throw new Error("The PhotoPop package exceeds safe decompression limits.");
    }
    totalUncompressed += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_PROJECT_UNCOMPRESSED_BYTES) {
      throw new Error("The PhotoPop package exceeds safe decompression limits.");
    }
    entries.set(name, { compressedSize, uncompressedSize });
    cursor = entryEnd;
  }
  if (cursor !== centralEnd) {
    throw new Error("The PhotoPop package central directory is inconsistent.");
  }
  return entries;
}

function decodeJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`The PhotoPop ${label} is not valid JSON.`);
  }
}

function validateDocumentGraph(document, documentId) {
  if (
    !isPlainObject(document)
    || document.schemaVersion !== 1
    || document.id !== documentId
    || typeof document.name !== "string"
    || document.name.length === 0
    || document.name.length > 1_000
    || !Number.isInteger(document.width)
    || !Number.isInteger(document.height)
    || document.width < 1
    || document.height < 1
    || document.width * document.height > MAX_IMAGE_PIXELS
    || document.colorSpace !== "srgb"
    || document.bitDepth !== 8
    || !Array.isArray(document.layers)
    || document.layers.length === 0
    || document.layers.length > 100_000
  ) {
    throw new Error("The PhotoPop document graph is invalid.");
  }
  const layerIds = new Set();
  for (const layer of document.layers) {
    if (
      !isPlainObject(layer)
      || typeof layer.id !== "string"
      || layer.id.length === 0
      || layer.id.length > 200
      || layerIds.has(layer.id)
      || !layerTypes.has(layer.type)
      || typeof layer.name !== "string"
      || typeof layer.visible !== "boolean"
      || typeof layer.locked !== "boolean"
      || !Number.isFinite(layer.opacity)
      || layer.opacity < 0
      || layer.opacity > 1
      || !isPlainObject(layer.transform)
    ) {
      throw new Error("The PhotoPop document graph contains an invalid layer.");
    }
    layerIds.add(layer.id);
  }
  if (typeof document.selectedLayerId !== "string" || !layerIds.has(document.selectedLayerId)) {
    throw new Error("The PhotoPop document graph has an invalid selected layer.");
  }
}

async function readBoundedZipEntry(zip, entries, name, maximumBytes) {
  const metadata = entries.get(name);
  const entry = zip.file(name);
  if (!metadata || !entry || entry.dir || metadata.uncompressedSize > maximumBytes) {
    throw new Error(`The PhotoPop package has an invalid ${name} entry.`);
  }
  const bytes = await entry.async("uint8array");
  if (bytes.byteLength !== metadata.uncompressedSize || bytes.byteLength > maximumBytes) {
    throw new Error(`The PhotoPop package ${name} entry failed verification.`);
  }
  return bytes;
}

export async function validateProjectBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("The PhotoPop package is invalid or too large.");
  }
  const entries = inspectZipDirectory(bytes);
  if (!entries.has("manifest.json") || !entries.has("document.json")) {
    throw new Error("The PhotoPop package is missing required entries.");
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch {
    throw new Error("The PhotoPop package could not be opened.");
  }
  const manifest = decodeJson(
    await readBoundedZipEntry(zip, entries, "manifest.json", MAX_MANIFEST_BYTES),
    "manifest",
  );
  if (
    !isPlainObject(manifest)
    || manifest.format !== "photopop"
    || manifest.schemaVersion !== 1
    || typeof manifest.documentId !== "string"
  ) {
    throw new Error("The PhotoPop package has an unsupported manifest.");
  }
  const documentId = safeDocumentId(manifest.documentId);
  const document = decodeJson(
    await readBoundedZipEntry(zip, entries, "document.json", MAX_PROJECT_JSON_BYTES),
    "document",
  );
  validateDocumentGraph(document, documentId);
  return { documentId };
}

function imageSignatureMatches(bytes, format) {
  if (format === "png") {
    return bytes.byteLength >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (format === "jpeg") {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (format === "webp") {
    return bytes.byteLength >= 12
      && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
      && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  }
  return bytes.byteLength >= 4 && (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  );
}

export async function validateExportImageBytes(bytes, format) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("The exported image failed verification.");
  }
  if (!imageSignatureMatches(bytes, format)) {
    throw new Error(`The exported image does not contain ${format.toUpperCase()} data.`);
  }
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw new Error("The exported image could not be decoded.");
  }
  if (
    metadata.format !== format
    || !metadata.width
    || !metadata.height
    || metadata.width * metadata.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(`The exported image does not contain valid ${format.toUpperCase()} pixels.`);
  }
}

function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("The image export payload is invalid.");
  }
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("The image export payload is not base64 encoded.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("The export exceeds the 512 MB alpha limit.");
  }
  return bytes;
}

function safeDocumentId(documentId) {
  if (typeof documentId !== "string" || !/^[a-z0-9-]{8,100}$/i.test(documentId)) {
    throw new Error("The recovery document identifier is invalid.");
  }
  return documentId;
}

function validateSuggestedName(value, fallback) {
  if (value === undefined) return fallback;
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 255
    || path.basename(value) !== value
    || /[\u0000-\u001f]/.test(value)
  ) {
    throw new Error("The suggested filename is invalid.");
  }
  return value;
}

function validateExportOptions(request) {
  if (!isPlainObject(request) || !Object.hasOwn(exportExtensions, request.format)) {
    throw new Error("Unsupported export format.");
  }
  const requestedQuality = request.quality === undefined ? 0.9 : request.quality;
  const quality = Number.isFinite(requestedQuality) && requestedQuality > 0 && requestedQuality <= 1
    ? Math.round(requestedQuality * 100)
    : requestedQuality;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("Export quality must be between 0 and 1, or 1 and 100 percent.");
  }
  const hasWidth = request.width !== undefined;
  const hasHeight = request.height !== undefined;
  if (hasWidth !== hasHeight) throw new Error("Export dimensions must include both width and height.");
  if (
    hasWidth
    && (
      !Number.isInteger(request.width)
      || !Number.isInteger(request.height)
      || request.width < 1
      || request.height < 1
      || request.width * request.height > MAX_IMAGE_PIXELS
    )
  ) {
    throw new Error("The requested export dimensions are invalid or too large.");
  }
  if (request.preserveTransparency !== undefined && typeof request.preserveTransparency !== "boolean") {
    throw new Error("The export transparency option is invalid.");
  }
  if (request.metadata !== undefined && !["preserve", "strip"].includes(request.metadata)) {
    throw new Error("The export metadata option is invalid.");
  }
  if (request.colorProfile !== undefined && request.colorProfile !== "srgb") {
    throw new Error("Only sRGB export is supported in this alpha.");
  }
  return {
    format: request.format,
    quality,
    width: request.width,
    height: request.height,
    preserveTransparency: request.preserveTransparency ?? true,
    metadata: request.metadata ?? "strip",
  };
}

function exportTargetPath(filePath, format) {
  const target = validateAbsolutePath(filePath);
  const extension = path.extname(target).toLowerCase();
  if (!extension) {
    return `${target}.${format === "jpeg" ? "jpg" : format}`;
  }
  if (!exportExtensions[format].has(extension)) {
    throw new Error(`The export filename extension does not match the ${format.toUpperCase()} format.`);
  }
  return target;
}

async function encodeExportImage(sourceBytes, options) {
  let pipeline = sharp(sourceBytes, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: "error",
    sequentialRead: true,
  }).toColourspace("srgb");
  if (options.width && options.height) {
    pipeline = pipeline.resize(options.width, options.height, { fit: "fill" });
  }
  if (!options.preserveTransparency || options.format === "jpeg") {
    pipeline = pipeline.flatten({ background: "#ffffff" });
  }
  if (options.metadata === "preserve") pipeline = pipeline.keepMetadata();

  if (options.format === "png") return pipeline.png({ compressionLevel: 9 }).toBuffer();
  if (options.format === "jpeg") return pipeline.jpeg({ quality: options.quality, mozjpeg: true }).toBuffer();
  if (options.format === "webp") return pipeline.webp({ quality: options.quality }).toBuffer();
  return pipeline.tiff({ compression: "lzw" }).toBuffer();
}

function recoveryPaths() {
  const directory = path.join(app.getPath("userData"), "Recovery");
  return {
    directory,
    pointerPath: path.join(directory, "latest.json"),
  };
}

function validateRecoveryPointer(pointer, directory) {
  if (!isPlainObject(pointer)) throw new Error("The recovery pointer is invalid.");
  const documentId = safeDocumentId(pointer.documentId);
  const target = path.join(directory, `${documentId}.photopop`);
  const pointerTarget = pointer.path === undefined ? target : validateAbsolutePath(pointer.path);
  const pathsMatch = process.platform === "win32"
    ? pointerTarget.toLowerCase() === target.toLowerCase()
    : pointerTarget === target;
  if (
    !pathsMatch
  ) {
    throw new Error("The recovery pointer path is invalid.");
  }
  return { documentId, target };
}

async function readRecoveryPointer(pointerPath, directory) {
  const pointerStat = await stat(pointerPath);
  if (!pointerStat.isFile() || pointerStat.size < 2 || pointerStat.size > 4_096) {
    throw new Error("The recovery pointer is invalid.");
  }
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  return validateRecoveryPointer(pointer, directory);
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

export function installIpcHandlers() {
  ipcMain.handle("photopop:document-dirty-set", (event, dirty) => {
    if (typeof dirty !== "boolean") {
      throw new Error("Document dirty state must be a boolean.");
    }
    const { state } = windowCloseStateForEvent(event);
    state.dirty = dirty;
  });

  ipcMain.handle("photopop:window-close-confirm", (event) => {
    const { state, window } = windowCloseStateForEvent(event);
    state.confirmed = true;
    setTimeout(() => {
      if (!window.isDestroyed()) window.close();
    }, 0);
  });

  ipcMain.handle("photopop:project-open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "PhotoPop project", extensions: ["photopop"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const opened = await readLaunchProjectFile(result.filePaths[0]);
    await addRecent(opened.path);
    return {
      canceled: false,
      ...opened,
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
    const filePath = validateAbsolutePath(result.filePaths[0]);
    await ensureUnderLimit(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (!imageExtensions.has(extension)) throw new Error("That file type is not supported.");
    let data = await readFile(filePath);
    let mimeType = extension === ".psd"
      ? "image/vnd.adobe.photoshop"
      : extension === PROJECT_EXTENSION
        ? "application/x-photopop"
        : `image/${extension.replace(".", "").replace("jpg", "jpeg")}`;
    if (extension === PROJECT_EXTENSION) {
      await validateProjectBytes(data);
    } else if (extension === ".tif" || extension === ".tiff") {
      data = await sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }).png().toBuffer();
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
    if (!isPlainObject(request)) throw new Error("The project save request is invalid.");
    const bytes = validateBytes(request.bytes);
    const suggestedName = validateSuggestedName(request.suggestedName, "Untitled.photopop");
    let target = request.path === undefined ? undefined : validateAbsolutePath(request.path);
    if (!target) {
      const result = await dialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: "PhotoPop project", extensions: ["photopop"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const selected = validateAbsolutePath(result.filePath);
      target = path.extname(selected).toLowerCase() === PROJECT_EXTENSION
        ? selected
        : `${selected}${PROJECT_EXTENSION}`;
    }
    if (path.extname(target).toLowerCase() !== PROJECT_EXTENSION) {
      throw new Error("PhotoPop projects must use the .photopop extension.");
    }
    await atomicWrite(target, bytes, validateProjectBytes);
    await addRecent(target);
    return { canceled: false, path: target };
  });

  ipcMain.handle("photopop:image-export", async (_event, request) => {
    const options = validateExportOptions(request);
    const defaultExtension = options.format === "jpeg" ? "jpg" : options.format;
    const suggestedName = validateSuggestedName(request.suggestedName, `Untitled.${defaultExtension}`);
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: [{
        name: options.format.toUpperCase(),
        extensions: [...exportExtensions[options.format]].map((extension) => extension.slice(1)),
      }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const target = exportTargetPath(result.filePath, options.format);
    const bytes = await encodeExportImage(decodeDataUrl(request.dataUrl), options);
    await atomicWrite(target, bytes, (written) => validateExportImageBytes(written, options.format));
    return { canceled: false, path: target };
  });

  ipcMain.handle("photopop:autosave-write", async (_event, request) => {
    if (!isPlainObject(request)) throw new Error("The autosave request is invalid.");
    const documentId = safeDocumentId(request.documentId);
    const bytes = validateBytes(request.bytes);
    const { directory, pointerPath } = recoveryPaths();
    const target = path.join(directory, `${documentId}.photopop`);
    await atomicWrite(target, bytes, async (written) => {
      const verified = await validateProjectBytes(written);
      if (verified.documentId !== documentId) {
        throw new Error("The recovery document identifier does not match its package.");
      }
    });
    await atomicWrite(pointerPath, Buffer.from(JSON.stringify({ documentId, path: target })), () => undefined);
    return { path: target };
  });

  ipcMain.handle("photopop:autosave-read", async () => {
    const { directory, pointerPath } = recoveryPaths();
    try {
      const { documentId, target } = await readRecoveryPointer(pointerPath, directory);
      await ensureUnderLimit(target);
      const data = await readFile(target);
      const verified = await validateProjectBytes(data);
      if (verified.documentId !== documentId) throw new Error("The recovery package does not match its pointer.");
      return {
        canceled: false,
        name: path.basename(target),
        path: target,
        data: new Uint8Array(data),
        mimeType: "application/x-photopop",
      };
    } catch {
      return { canceled: true };
    }
  });

  ipcMain.handle("photopop:autosave-clear", async (_event, requestedDocumentId) => {
    const expectedDocumentId = requestedDocumentId === undefined
      ? undefined
      : safeDocumentId(requestedDocumentId);
    const { directory, pointerPath } = recoveryPaths();
    let recovery;
    try {
      recovery = await readRecoveryPointer(pointerPath, directory);
    } catch {
      await rm(pointerPath, { force: true });
      return;
    }
    if (expectedDocumentId && recovery.documentId !== expectedDocumentId) return;
    await rm(pointerPath, { force: true });
    await rm(recovery.target, { force: true });
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  void queueLaunchFilesFromArguments(process.argv);

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    void queueLaunchProjectPath(filePath);
    focusPrimaryWindow();
  });

  app.on("second-instance", (_event, commandLine) => {
    void queueLaunchFilesFromArguments(commandLine);
    focusPrimaryWindow();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
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
}
