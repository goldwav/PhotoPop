/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createDefaultMask, createId, validateDocument } from "./document";
import type {
  CompatibilityReport,
  DocumentSnapshot,
  ExportOptions,
  Layer,
  RasterLayer,
  ShapeLayer,
} from "../types";

const MIME_TYPES: Record<ExportOptions["format"], string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tiff: "image/tiff",
};

export async function serializeProject(
  document: DocumentSnapshot,
  previewDataUrl?: string,
): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({
    format: "photopop",
    schemaVersion: 1,
    applicationVersion: "0.1.0-alpha.1",
    documentId: document.id,
    createdAt: document.createdAt,
    savedAt: new Date().toISOString(),
  }, null, 2));
  zip.file("document.json", JSON.stringify(document, null, 2));
  if (previewDataUrl?.startsWith("data:image/png;base64,")) {
    zip.file("preview.png", previewDataUrl.split(",", 2)[1], { base64: true });
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export async function deserializeProject(bytes: Uint8Array): Promise<DocumentSnapshot> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const manifestText = await zip.file("manifest.json")?.async("text");
  const documentText = await zip.file("document.json")?.async("text");
  if (!manifestText || !documentText) {
    throw new Error("This file is missing the PhotoPop manifest or document.");
  }
  const manifest = JSON.parse(manifestText) as { format?: string; schemaVersion?: number };
  if (manifest.format !== "photopop" || manifest.schemaVersion !== 1) {
    throw new Error("This PhotoPop file uses an unsupported format version.");
  }
  const document = JSON.parse(documentText) as unknown;
  if (!validateDocument(document)) {
    throw new Error("The PhotoPop document graph is invalid.");
  }
  return document;
}

export async function saveProject(
  document: DocumentSnapshot,
  previewDataUrl: string,
  path?: string,
): Promise<string | undefined> {
  const bytes = await serializeProject(document, previewDataUrl);
  const suggestedName = `${safeFilename(document.name)}.photopop`;
  if (window.photoPop) {
    const result = await window.photoPop.saveProject({ bytes, suggestedName, path });
    return result.path;
  }
  const browserBytes = new Uint8Array(bytes.byteLength);
  browserBytes.set(bytes);
  downloadBlob(new Blob([browserBytes], { type: "application/x-photopop" }), suggestedName);
  return undefined;
}

export async function writeAutosave(
  document: DocumentSnapshot,
  previewDataUrl: string,
): Promise<void> {
  const bytes = await serializeProject(document, previewDataUrl);
  if (window.photoPop) {
    await window.photoPop.writeAutosave({ bytes, documentId: document.id });
    return;
  }
  localStorage.setItem(`photopop-autosave-${document.id}`, JSON.stringify(Array.from(bytes)));
  localStorage.setItem("photopop-last-autosave", document.id);
}

export async function readBrowserAutosave(): Promise<DocumentSnapshot | undefined> {
  const id = localStorage.getItem("photopop-last-autosave");
  if (!id) return undefined;
  const value = localStorage.getItem(`photopop-autosave-${id}`);
  if (!value) return undefined;
  return deserializeProject(Uint8Array.from(JSON.parse(value) as number[]));
}

export async function exportFlattened(
  dataUrl: string,
  documentName: string,
  options: ExportOptions,
): Promise<string | undefined> {
  const suggestedName = `${safeFilename(documentName)}.${options.format === "jpeg" ? "jpg" : options.format}`;
  if (window.photoPop) {
    const result = await window.photoPop.exportImage({
      dataUrl,
      format: options.format,
      suggestedName,
    });
    return result.path;
  }
  const response = await fetch(dataUrl);
  downloadBlob(await response.blob(), suggestedName);
  return undefined;
}

export async function openImageFile(file: File): Promise<{
  document: DocumentSnapshot;
  report?: CompatibilityReport;
}> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "photopop") {
    return { document: await deserializeProject(new Uint8Array(await file.arrayBuffer())) };
  }
  if (extension === "psd") {
    return importPsd(await file.arrayBuffer(), file.name);
  }
  const source = await fileToDataUrl(file);
  const dimensions = await imageDimensions(source);
  return {
    document: createImportedRasterDocument(source, file.name, dimensions.width, dimensions.height),
  };
}

export async function importPsd(
  buffer: ArrayBuffer,
  sourceName: string,
): Promise<{ document: DocumentSnapshot; report: CompatibilityReport }> {
  const report: CompatibilityReport = {
    sourceName,
    imported: [],
    rasterized: [],
    flattened: [],
    substituted: [],
    unsupported: [],
  };

  let psd;
  try {
    const { readPsd } = await import("ag-psd");
    psd = readPsd(buffer, {
      useImageData: true,
      useRawThumbnail: true,
      skipThumbnail: false,
    });
  } catch (error) {
    throw new Error(`PhotoPop could not read this PSD: ${error instanceof Error ? error.message : "unknown parser error"}`);
  }

  if (psd.bitsPerChannel !== 8) {
    report.unsupported.push({
      feature: `${psd.bitsPerChannel}-bit channels`,
      detail: "The alpha supports 8-bit RGB PSD documents only.",
    });
  }

  const importedLayers: Layer[] = [];
  const scaleX = 1000 / Math.max(1, psd.width);
  const scaleY = 1000 / Math.max(1, psd.height);

  const visit = (children: typeof psd.children, parentId?: string) => {
    if (!children) return;
    [...children].reverse().forEach((child) => {
      const groupId = child.children ? createId("group") : undefined;
      if (child.children && groupId) {
        importedLayers.push({
          id: groupId,
          type: "group",
          name: child.name || "Group",
          visible: !child.hidden,
          locked: false,
          opacity: (child.opacity ?? 255) / 255,
          blendMode: "normal",
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          parentId,
        });
        report.imported.push({ feature: "Layer group", detail: child.name || "Unnamed group" });
        visit(child.children, groupId);
        return;
      }

      const childCanvas = child.canvas as HTMLCanvasElement | undefined;
      const imageData = child.imageData as ImageData | undefined;
      let source: string | undefined;
      if (childCanvas?.toDataURL) {
        source = childCanvas.toDataURL("image/png");
      } else if (imageData) {
        source = imageDataToDataUrl(imageData);
      }
      if (!source) {
        report.unsupported.push({
          feature: child.name || "Layer",
          detail: "No raster preview was available for this PSD layer.",
        });
        return;
      }

      const layer: RasterLayer = {
        id: createId("layer"),
        type: "raster",
        name: child.name || "PSD layer",
        visible: !child.hidden,
        locked: false,
        opacity: (child.opacity ?? 255) / 255,
        blendMode: "normal",
        transform: {
          x: (child.left ?? 0) * scaleX,
          y: (child.top ?? 0) * scaleY,
          scaleX,
          scaleY,
          rotation: 0,
        },
        parentId,
        source,
        mask: child.mask ? createDefaultMask() : undefined,
      };
      importedLayers.push(layer);
      if (child.text || child.vectorFill || child.placedLayer) {
        report.rasterized.push({
          feature: child.name || "PSD layer",
          detail: child.text
            ? "Text was preserved visually as a raster layer."
            : "Vector or placed content was preserved visually as a raster layer.",
        });
      } else {
        report.imported.push({ feature: "Raster layer", detail: layer.name });
      }
    });
  };
  visit(psd.children);

  if (importedLayers.length === 0) {
    const canvas = psd.canvas as HTMLCanvasElement | undefined;
    const imageData = psd.imageData as ImageData | undefined;
    const source = canvas?.toDataURL
      ? canvas.toDataURL("image/png")
      : imageData
        ? imageDataToDataUrl(imageData)
        : undefined;
    if (!source) {
      throw new Error("This PSD did not contain a readable composite image.");
    }
    importedLayers.push(createRasterLayer(source, "PSD composite"));
    report.flattened.push({
      feature: "Document composite",
      detail: "No editable layer previews were available, so PhotoPop opened the embedded composite.",
    });
  }

  const background: ShapeLayer = {
    id: createId("layer"),
    type: "shape",
    name: "Canvas",
    visible: true,
    locked: true,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    shape: "rectangle",
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    fill: "#ffffff",
  };
  const now = new Date().toISOString();
  const document: DocumentSnapshot = {
    schemaVersion: 1,
    id: createId("document"),
    name: sourceName.replace(/\.psd$/i, ""),
    width: psd.width,
    height: psd.height,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [background, ...importedLayers],
    selectedLayerId: importedLayers.at(-1)?.id ?? background.id,
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#ffffff",
    createdAt: now,
    updatedAt: now,
  };

  return { document, report };
}

export function createImportedRasterDocument(
  source: string,
  sourceName: string,
  width: number,
  height: number,
): DocumentSnapshot {
  const now = new Date().toISOString();
  const background: ShapeLayer = {
    id: createId("layer"),
    type: "shape",
    name: "Canvas",
    visible: true,
    locked: true,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    shape: "rectangle",
    bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    fill: "#ffffff",
  };
  const raster = createRasterLayer(source, sourceName.replace(/\.[^.]+$/, "") || "Image");
  return {
    schemaVersion: 1,
    id: createId("document"),
    name: raster.name,
    width,
    height,
    colorSpace: "srgb",
    bitDepth: 8,
    layers: [background, raster],
    selectedLayerId: raster.id,
    selection: { kind: "none", feather: 0 },
    foreground: "#111111",
    background: "#ffffff",
    createdAt: now,
    updatedAt: now,
  };
}

function createRasterLayer(source: string, name: string): RasterLayer {
  return {
    id: createId("layer"),
    type: "raster",
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    source,
    mask: createDefaultMask(),
  };
}

function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d")?.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function imageDimensions(source: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = source;
  });
}

function safeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "Untitled";
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mimeTypeFor(format: ExportOptions["format"]): string {
  return MIME_TYPES[format];
}
