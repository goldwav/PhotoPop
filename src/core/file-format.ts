/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createDefaultMask, createId, validateDocument } from "./document";
import type {
  BlendMode as PsdBlendMode,
  Layer as PsdLayer,
  LayerMaskData as PsdLayerMask,
  PixelData,
  Psd,
} from "ag-psd";
import type {
  BlendMode,
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
const PSD_COLOR_MODES: Record<number, string> = {
  0: "Bitmap",
  1: "Grayscale",
  2: "Indexed",
  3: "RGB",
  4: "CMYK",
  7: "Multichannel",
  8: "Duotone",
  9: "Lab",
};

const PSD_LIMITS = {
  fileBytes: 512 * 1024 * 1024,
  dimension: 30_000,
  layerDimension: 30_000,
  layers: 500,
  decodedBytes: 2 * 1024 * 1024 * 1024,
} as const;

const PSD_BLEND_MODES: Partial<Record<PsdBlendMode, BlendMode>> = {
  normal: "normal",
  darken: "darken",
  multiply: "multiply",
  lighten: "lighten",
  screen: "screen",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  overlay: "overlay",
  "soft light": "soft-light",
  "hard light": "hard-light",
};

export interface PsdCompositeEvidence {
  embeddedCompositeDataUrl: string;
  width: number;
  height: number;
  editableLayerCount: number;
  fidelityRisks: string[];
}

export interface PsdImportResult {
  document: DocumentSnapshot;
  report: CompatibilityReport;
  comparison?: PsdCompositeEvidence;
}

export type ExportFlattenedResult =
  | { status: "saved"; path?: string }
  | { status: "canceled" };

export interface OpenImageResult {
  document: DocumentSnapshot;
  report?: CompatibilityReport;
  comparison?: PsdCompositeEvidence;
}

export class PsdCompatibilityError extends Error {
  readonly report: CompatibilityReport;

  constructor(message: string, report: CompatibilityReport) {
    super(message);
    this.name = "PsdCompatibilityError";
    this.report = report;
  }
}


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

const PROJECT_PACKAGE_LIMITS = {
  packageBytes: 512 * 1024 * 1024,
  entries: 100_000,
  manifestBytes: 64 * 1024,
  documentBytes: 16 * 1024 * 1024,
} as const;

function zipEntrySize(entry: unknown): number | undefined {
  const internal = entry as { _data?: { uncompressedSize?: unknown } };
  const size = internal?._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) ? size : undefined;
}

export async function deserializeProject(bytes: Uint8Array): Promise<DocumentSnapshot> {
  if (bytes.byteLength < 4 || bytes.byteLength > PROJECT_PACKAGE_LIMITS.packageBytes) {
    throw new Error("This PhotoPop package is empty or exceeds the 512 MB alpha limit.");
  }
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  } catch {
    throw new Error("This PhotoPop package is truncated or corrupt.");
  }
  if (Object.keys(zip.files).length > PROJECT_PACKAGE_LIMITS.entries) {
    throw new Error("This PhotoPop package contains too many entries.");
  }
  const manifestEntry = zip.file("manifest.json");
  const documentEntry = zip.file("document.json");
  if (!manifestEntry || !documentEntry) {
    throw new Error("This file is missing the PhotoPop manifest or document.");
  }
  const manifestSize = zipEntrySize(manifestEntry);
  const documentSize = zipEntrySize(documentEntry);
  if (manifestSize === undefined || manifestSize > PROJECT_PACKAGE_LIMITS.manifestBytes) {
    throw new Error("The PhotoPop manifest exceeds its safe expanded-size limit.");
  }
  if (documentSize === undefined || documentSize > PROJECT_PACKAGE_LIMITS.documentBytes) {
    throw new Error("The PhotoPop document exceeds its safe expanded-size limit.");
  }
  const manifestText = await manifestEntry.async("text");
  const documentText = await documentEntry.async("text");
  let manifest: { format?: string; schemaVersion?: number };
  let document: unknown;
  try {
    manifest = JSON.parse(manifestText) as { format?: string; schemaVersion?: number };
    document = JSON.parse(documentText) as unknown;
  } catch {
    throw new Error("The PhotoPop manifest or document contains invalid JSON.");
  }
  if (manifest.format !== "photopop" || manifest.schemaVersion !== 1) {
    throw new Error("This PhotoPop file uses an unsupported format version.");
  }
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

export function clearBrowserAutosave(documentId?: string): void {
  const currentId = localStorage.getItem("photopop-last-autosave");
  if (documentId && currentId && currentId !== documentId) return;
  const targetId = documentId ?? currentId;
  if (targetId) localStorage.removeItem(`photopop-autosave-${targetId}`);
  if (!documentId || currentId === documentId) {
    localStorage.removeItem("photopop-last-autosave");
  }
}

export async function exportFlattened(
  dataUrl: string,
  documentName: string,
  options: ExportOptions,
): Promise<ExportFlattenedResult> {
  const suggestedName = `${safeFilename(documentName)}.${options.format === "jpeg" ? "jpg" : options.format}`;
  if (window.photoPop) {
    const result = await window.photoPop.exportImage({
      dataUrl,
      format: options.format,
      suggestedName,
      quality: Math.max(1, Math.min(100, Math.round(options.quality * 100))),
      width: options.width,
      height: options.height,
      preserveTransparency: options.preserveTransparency,
      metadata: options.metadata,
      colorProfile: options.colorProfile,
    });
    return result.canceled
      ? { status: "canceled" }
      : { status: "saved", path: result.path };
  }
  const response = await fetch(dataUrl);
  downloadBlob(await response.blob(), suggestedName);
  return { status: "saved" };
}

export async function openImageFile(file: File): Promise<OpenImageResult> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "photopop") {
    return { document: await deserializeProject(new Uint8Array(await file.arrayBuffer())) };
  }
  if (extension === "psd" || extension === "psb") {
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
): Promise<PsdImportResult> {
  const report = createCompatibilityReport(sourceName);
  assertPsdHeader(buffer, report);

  if (buffer.byteLength > PSD_LIMITS.fileBytes) {
    addCompatibility(report, "unsupported", "PSD file size", `The file is ${formatBytes(buffer.byteLength)}; the alpha limit is ${formatBytes(PSD_LIMITS.fileBytes)}.`);
    throw new PsdCompatibilityError("This PSD exceeds PhotoPop's safe import size limit.", report);
  }

  const { readPsd } = await import("ag-psd");
  let structure: Psd;
  try {
    structure = readPsd(buffer, {
      useRawData: true,
      useRawThumbnail: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
    });
  } catch (error) {
    addCompatibility(report, "unsupported", "PSD structure", `The parser rejected this file: ${errorDetail(error)}.`);
    throw new PsdCompatibilityError(`PhotoPop could not read this PSD: ${errorDetail(error)}`, report);
  }

  const structuralIssues = inspectPsdStructure(structure, report);
  if (structuralIssues.length > 0) {
    throw new PsdCompatibilityError(`PhotoPop cannot safely import this PSD: ${structuralIssues.join(" ")}`, report);
  }

  let psd: Psd;
  try {
    psd = readPsd(buffer, {
      useImageData: true,
      useRawThumbnail: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: PSD_LIMITS.decodedBytes,
    });
  } catch (error) {
    addCompatibility(report, "unsupported", "PSD bitmap data", `Layer or composite pixels could not be decoded: ${errorDetail(error)}.`);
    throw new PsdCompatibilityError(`PhotoPop could not decode this PSD safely: ${errorDetail(error)}`, report);
  }

  const fidelityRisks: string[] = [];
  const importedLayers: Layer[] = [];

  const visit = (children: PsdLayer[] | undefined, parentId?: string) => {
    if (!children) return;
    [...children].reverse().forEach((child) => {
      const layerName = child.name || (child.children ? "Group" : "PSD layer");
      const blendMode = resolvePsdBlendMode(child.blendMode, layerName, report, fidelityRisks);

      if (child.children) {
        const groupId = createId("group");
        importedLayers.push({
          id: groupId,
          type: "group",
          name: layerName,
          visible: !child.hidden,
          locked: false,
          opacity: (child.opacity ?? 255) / 255,
          blendMode,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          parentId,
        });
        addCompatibility(report, "imported", "Layer group", layerName);
        if (child.mask || child.realMask || child.vectorMask) {
          addCompatibility(report, "unsupported", "Group mask", `${layerName}: group masks cannot be applied by the current flat group compositor.`);
          pushRisk(fidelityRisks, `${layerName} has a group mask that is not represented in the editable import.`);
        }
        recordSpecialLayerFeatures(child, layerName, false, report, fidelityRisks);
        visit(child.children, groupId);
        return;
      }

      let layerPixels = bitmapPixelData(child);
      let bakedMask = false;
      const masks: Array<{ mask?: PsdLayerMask; label: string }> = [
        { mask: child.mask, label: child.mask?.fromVectorData ? "Rasterized vector mask" : "Pixel layer mask" },
        { mask: child.realMask, label: "Real user mask" },
      ];

      for (const { mask, label } of masks) {
        if (!mask) continue;
        if (mask.disabled) {
          addCompatibility(report, "substituted", label, `${layerName}: the source mask was disabled, so it remains visually inactive and its editable metadata was not imported.`);
          continue;
        }
        const maskPixels = bitmapPixelData(mask);
        if (!layerPixels || !maskPixels) {
          addCompatibility(report, "unsupported", label, `${layerName}: cached mask pixels were unavailable, so PhotoPop could not safely represent the mask.`);
          pushRisk(fidelityRisks, `${layerName} has a mask without a readable raster channel.`);
          continue;
        }
        layerPixels = applyPsdRasterMask(layerPixels, child, mask, maskPixels);
        bakedMask = true;
        addCompatibility(report, "rasterized", label, `${layerName}: mask pixels were baked into layer transparency because PhotoPop's editable masks are stroke-based.`);
        const feather = mask.fromVectorData
          ? (mask.vectorMaskFeather ?? mask.userMaskFeather ?? 0)
          : (mask.userMaskFeather ?? 0);
        if (feather > 0) {
          addCompatibility(report, "substituted", "Mask feather", `${layerName}: ${feather}px PSD mask feather metadata is not reproduced by the pixel-mask baker.`);
          pushRisk(fidelityRisks, `${layerName} uses PSD mask feathering that can differ from the editable import.`);
        }
      }

      let source: string | undefined;
      if (layerPixels) {
        source = imageDataToDataUrl(layerPixels);
      } else if (child.canvas?.toDataURL) {
        source = child.canvas.toDataURL("image/png");
      }

      const specialContent = recordSpecialLayerFeatures(child, layerName, Boolean(source), report, fidelityRisks);
      if (!source) {
        addCompatibility(report, "unsupported", layerName, "No cached raster preview was available for this PSD layer.");
        pushRisk(fidelityRisks, `${layerName} has no readable layer preview.`);
        return;
      }

      const layer: RasterLayer = {
        id: createId("layer"),
        type: "raster",
        name: layerName,
        visible: !child.hidden,
        locked: false,
        opacity: (child.opacity ?? 255) / 255,
        blendMode,
        transform: {
          x: child.left ?? 0,
          y: child.top ?? 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
        },
        parentId,
        source,
      };
      importedLayers.push(layer);
      if (!specialContent) {
        addCompatibility(report, "imported", "Raster layer", layer.name);
      }
      if (bakedMask) {
        pushRisk(fidelityRisks, `${layerName}'s mask is visually baked and is no longer independently editable.`);
      }
    });
  };
  visit(psd.children);

  const compositePixels = bitmapPixelData(psd);
  const embeddedCompositeDataUrl = compositePixels
    ? imageDataToDataUrl(compositePixels)
    : psd.canvas?.toDataURL
      ? psd.canvas.toDataURL("image/png")
      : undefined;
  const openedCompositeOnly = importedLayers.length === 0;

  if (openedCompositeOnly) {
    if (!embeddedCompositeDataUrl) {
      throw new PsdCompatibilityError("This PSD did not contain a readable composite image.", report);
    }
    importedLayers.push(createRasterLayer(embeddedCompositeDataUrl, "PSD composite"));
    addCompatibility(report, "flattened", "Document composite", "No editable layer previews were available, so PhotoPop opened the embedded composite.");
  } else if (!embeddedCompositeDataUrl) {
    addCompatibility(report, "unsupported", "Embedded composite", "The PSD did not provide a readable composite for visual comparison.");
    pushRisk(fidelityRisks, "The editable import cannot be checked against an embedded PSD composite.");
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
    bounds: { x: 0, y: 0, width: psd.width, height: psd.height },
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

  const comparison = !openedCompositeOnly && embeddedCompositeDataUrl
    ? {
        embeddedCompositeDataUrl,
        width: psd.width,
        height: psd.height,
        editableLayerCount: importedLayers.filter((layer) => layer.type !== "group").length,
        fidelityRisks: [...fidelityRisks],
      }
    : undefined;

  return { document, report, comparison };
}
type CompatibilitySection = keyof Omit<CompatibilityReport, "sourceName">;

function createCompatibilityReport(sourceName: string): CompatibilityReport {
  return {
    sourceName,
    imported: [],
    rasterized: [],
    flattened: [],
    substituted: [],
    unsupported: [],
  };
}

function addCompatibility(
  report: CompatibilityReport,
  section: CompatibilitySection,
  feature: string,
  detail: string,
): void {
  if (!report[section].some((item) => item.feature === feature && item.detail === detail)) {
    report[section].push({ feature, detail });
  }
}

function assertPsdHeader(buffer: ArrayBuffer, report: CompatibilityReport): void {
  if (buffer.byteLength < 6) {
    addCompatibility(report, "unsupported", "PSD structure", "The file is too short to contain a PSD header.");
    throw new PsdCompatibilityError("PhotoPop could not read this PSD: the file is too short to contain a complete header.", report);
  }
  const signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const header = new DataView(buffer);
  const version = header.getUint16(4, false);
  if (signature !== "8BPS") {
    addCompatibility(report, "unsupported", "PSD structure", "The required 8BPS signature is missing.");
    throw new PsdCompatibilityError("PhotoPop could not read this PSD: invalid PSD signature.", report);
  }
  if (version === 2) {
    addCompatibility(report, "unsupported", "PSB document", "Large-document PSB files are not supported in the alpha.");
    throw new PsdCompatibilityError("PhotoPop does not support PSB documents in this alpha.", report);
  }
  if (version !== 1) {
    addCompatibility(report, "unsupported", "PSD version", `PSD header version ${version} is not supported.`);
    throw new PsdCompatibilityError(`PhotoPop does not support PSD header version ${version}.`, report);
  }
  if (buffer.byteLength >= 26) {
    const bitsPerChannel = header.getUint16(22, false);
    const colorMode = header.getUint16(24, false);
    if (bitsPerChannel !== 8) {
      addCompatibility(report, "unsupported", "Bit depth", `${bitsPerChannel}-bit channels are not supported; PhotoPop did not silently convert them.`);
      throw new PsdCompatibilityError(`PhotoPop cannot safely import this PSD: Only 8-bit channels are supported, not ${bitsPerChannel}-bit.`, report);
    }
    if (colorMode !== 3) {
      const colorModeName = PSD_COLOR_MODES[colorMode] ?? `Unknown (${colorMode})`;
      addCompatibility(report, "unsupported", "Color mode", `${colorModeName} PSD documents are not supported; PhotoPop did not silently reinterpret them as sRGB.`);
      throw new PsdCompatibilityError(`PhotoPop cannot safely import this PSD: Only RGB PSD documents are supported, not ${colorModeName}.`, report);
    }
  }
}
function inspectPsdStructure(psd: Psd, report: CompatibilityReport): string[] {
  const issues: string[] = [];
  const bitsPerChannel = psd.bitsPerChannel ?? 8;
  const colorMode = psd.colorMode ?? 3;
  const colorModeName = PSD_COLOR_MODES[colorMode] ?? `Unknown (${colorMode})`;

  if (bitsPerChannel === 8) {
    addCompatibility(report, "imported", "Bit depth", "8-bit channels");
  } else {
    addCompatibility(report, "unsupported", "Bit depth", `${bitsPerChannel}-bit channels are not supported; PhotoPop did not silently convert them.`);
    issues.push(`Only 8-bit channels are supported, not ${bitsPerChannel}-bit.`);
  }
  if (colorMode === 3) {
    addCompatibility(report, "imported", "Color mode", "RGB source interpreted in the alpha's sRGB workspace.");
  } else {
    addCompatibility(report, "unsupported", "Color mode", `${colorModeName} PSD documents are not supported; PhotoPop did not silently reinterpret them as sRGB.`);
    issues.push(`Only RGB PSD documents are supported, not ${colorModeName}.`);
  }

  if (psd.width < 1 || psd.height < 1 || psd.width > PSD_LIMITS.dimension || psd.height > PSD_LIMITS.dimension) {
    addCompatibility(report, "unsupported", "Canvas dimensions", `${psd.width}x${psd.height}px exceeds the supported 1-${PSD_LIMITS.dimension}px range.`);
    issues.push("The PSD canvas dimensions exceed the safe import range.");
  }

  let layerCount = 0;
  let decodedPixels = Math.max(0, psd.width) * Math.max(0, psd.height);
  let oversizedLayer = false;
  const visit = (layers: PsdLayer[] | undefined) => {
    layers?.forEach((layer) => {
      layerCount += 1;
      const layerWidth = Math.max(0, (layer.right ?? 0) - (layer.left ?? 0));
      const layerHeight = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0));
      decodedPixels += layerWidth * layerHeight;
      if (layerWidth > PSD_LIMITS.layerDimension || layerHeight > PSD_LIMITS.layerDimension) {
        oversizedLayer = true;
      }
      for (const mask of [layer.mask, layer.realMask]) {
        if (!mask) continue;
        const maskWidth = Math.max(0, (mask.right ?? 0) - (mask.left ?? 0));
        const maskHeight = Math.max(0, (mask.bottom ?? 0) - (mask.top ?? 0));
        decodedPixels += maskWidth * maskHeight;
        if (maskWidth > PSD_LIMITS.layerDimension || maskHeight > PSD_LIMITS.layerDimension) {
          oversizedLayer = true;
        }
      }
      visit(layer.children);
    });
  };
  visit(psd.children);

  if (layerCount > PSD_LIMITS.layers) {
    addCompatibility(report, "unsupported", "Layer count", `${layerCount} layers exceeds the alpha limit of ${PSD_LIMITS.layers}.`);
    issues.push("The PSD has too many layers for safe alpha import.");
  }
  if (oversizedLayer) {
    addCompatibility(report, "unsupported", "Layer dimensions", `At least one layer or mask exceeds ${PSD_LIMITS.layerDimension}px on an axis.`);
    issues.push("A layer or mask exceeds the safe bitmap dimensions.");
  }
  if (decodedPixels * 4 > PSD_LIMITS.decodedBytes) {
    addCompatibility(report, "unsupported", "Decoded bitmap budget", `Estimated RGBA data exceeds ${formatBytes(PSD_LIMITS.decodedBytes)}.`);
    issues.push("The decoded bitmap estimate exceeds the safe memory budget.");
  }
  return issues;
}

function resolvePsdBlendMode(
  sourceMode: PsdBlendMode | undefined,
  layerName: string,
  report: CompatibilityReport,
  fidelityRisks: string[],
): BlendMode {
  const mode = sourceMode ?? "normal";
  const mapped = PSD_BLEND_MODES[mode];
  if (mapped) {
    if (mode !== "normal") {
      addCompatibility(report, "imported", "Blend mode", `${layerName}: ${mode} -> ${mapped}`);
    }
    return mapped;
  }
  addCompatibility(report, "substituted", "Blend mode", `${layerName}: PSD "${mode}" is not supported and was replaced with Normal.`);
  pushRisk(fidelityRisks, `${layerName} uses the unsupported "${mode}" blend mode.`);
  return "normal";
}

function bitmapPixelData(bitmap: { imageData?: PixelData; canvas?: HTMLCanvasElement }): PixelData | undefined {
  const imageData = bitmap.imageData;
  if (imageData && imageData.width > 0 && imageData.height > 0 && imageData.data.BYTES_PER_ELEMENT === 1) {
    return imageData;
  }
  const context = bitmap.canvas?.getContext("2d");
  if (!context || !bitmap.canvas) return undefined;
  return context.getImageData(0, 0, bitmap.canvas.width, bitmap.canvas.height);
}

function applyPsdRasterMask(
  layerPixels: PixelData,
  layer: PsdLayer,
  mask: PsdLayerMask,
  maskPixels: PixelData,
): PixelData {
  const output = new Uint8ClampedArray(layerPixels.data.length);
  output.set(layerPixels.data as Uint8Array | Uint8ClampedArray);
  const maskData = maskPixels.data as Uint8Array | Uint8ClampedArray;
  const layerLeft = layer.left ?? 0;
  const layerTop = layer.top ?? 0;
  const maskLeft = mask.positionRelativeToLayer
    ? layerLeft + (mask.left ?? 0)
    : (mask.left ?? layerLeft);
  const maskTop = mask.positionRelativeToLayer
    ? layerTop + (mask.top ?? 0)
    : (mask.top ?? layerTop);
  const defaultMask = clampByte(mask.defaultColor ?? 0);
  const density = clampUnit(mask.fromVectorData
    ? (mask.vectorMaskDensity ?? mask.userMaskDensity ?? 1)
    : (mask.userMaskDensity ?? 1));

  for (let y = 0; y < layerPixels.height; y += 1) {
    for (let x = 0; x < layerPixels.width; x += 1) {
      const documentX = layerLeft + x;
      const documentY = layerTop + y;
      const maskX = documentX - maskLeft;
      const maskY = documentY - maskTop;
      const insideMask = maskX >= 0 && maskY >= 0 && maskX < maskPixels.width && maskY < maskPixels.height;
      const maskValue = insideMask
        ? maskData[(maskY * maskPixels.width + maskX) * 4] ?? defaultMask
        : defaultMask;
      const effectiveMask = 255 - (255 - maskValue) * density;
      const alphaIndex = (y * layerPixels.width + x) * 4 + 3;
      output[alphaIndex] = Math.round(output[alphaIndex] * (effectiveMask / 255));
    }
  }
  return { width: layerPixels.width, height: layerPixels.height, data: output };
}

function recordSpecialLayerFeatures(
  layer: PsdLayer,
  layerName: string,
  hasRasterPreview: boolean,
  report: CompatibilityReport,
  fidelityRisks: string[],
): boolean {
  let specialContent = false;
  const recordRasterized = (feature: string, detail: string) => {
    specialContent = true;
    addCompatibility(report, hasRasterPreview ? "rasterized" : "unsupported", feature, `${layerName}: ${detail}`);
    if (!hasRasterPreview) pushRisk(fidelityRisks, `${layerName}'s ${feature.toLowerCase()} has no cached raster preview.`);
  };

  if (layer.text) {
    recordRasterized("Text layer", hasRasterPreview
      ? "editable text was replaced with the PSD's cached raster pixels."
      : "editable text had no cached raster pixels to import.");
  }
  if (layer.vectorFill || layer.vectorStroke || layer.vectorOrigination) {
    recordRasterized("Vector content", hasRasterPreview
      ? "editable vector data was replaced with cached raster pixels."
      : "editable vector data had no cached raster pixels to import.");
  }
  if (layer.placedLayer) {
    recordRasterized("Placed layer", hasRasterPreview
      ? "the smart/placed object was replaced with cached raster pixels; the linked object remains non-editable."
      : "the smart/placed object had no cached raster pixels to import.");
  }
  if (layer.vectorMask) {
    const hasRasterMask = Boolean(layer.mask?.imageData || layer.mask?.canvas || layer.realMask?.imageData || layer.realMask?.canvas);
    addCompatibility(
      report,
      hasRasterMask && hasRasterPreview ? "rasterized" : "unsupported",
      "Vector mask",
      `${layerName}: vector paths are not editable${hasRasterMask ? "; the cached raster mask was used when active." : " and no cached raster mask was available."}`,
    );
    if (!hasRasterMask) pushRisk(fidelityRisks, `${layerName} has a vector mask without a raster channel.`);
  }
  if (layer.adjustment) {
    specialContent = true;
    addCompatibility(report, "unsupported", "PSD adjustment layer", `${layerName}: editable PSD adjustment data is not interpreted in this alpha.`);
    pushRisk(fidelityRisks, `${layerName} is a PSD adjustment layer that is not interpreted.`);
  }
  if (layer.effects) {
    const enabledEffects = !layer.effects.disabled && Object.keys(layer.effects).some((key) => key !== "disabled" && key !== "scale");
    addCompatibility(report, "unsupported", "Layer effects", `${layerName}: layer-effect metadata is not editable and cached layer pixels may omit the effect.`);
    if (enabledEffects) pushRisk(fidelityRisks, `${layerName} has enabled layer effects that can differ from the embedded composite.`);
  }
  if (layer.clipping) {
    addCompatibility(report, "unsupported", "Clipping relationship", `${layerName}: clipping-mask relationships are not represented by the current layer graph.`);
    pushRisk(fidelityRisks, `${layerName} participates in a clipping relationship.`);
  }
  return specialContent;
}

function imageDataToDataUrl(imageData: PixelData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const pixels = new Uint8ClampedArray(imageData.data.length);
  pixels.set(imageData.data as Uint8Array | Uint8ClampedArray);
  const browserImageData = typeof ImageData === "undefined"
    ? ({ width: imageData.width, height: imageData.height, data: pixels } as ImageData)
    : new ImageData(pixels, imageData.width, imageData.height);
  canvas.getContext("2d")?.putImageData(browserImageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function pushRisk(risks: string[], detail: string): void {
  if (!risks.includes(detail)) risks.push(detail);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${value} bytes`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown parser error";
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
    bounds: { x: 0, y: 0, width, height },
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
