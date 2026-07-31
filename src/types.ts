/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type ToolId =
  | "move"
  | "marquee"
  | "lasso"
  | "brush"
  | "eraser"
  | "fill"
  | "gradient"
  | "crop"
  | "eyedropper"
  | "text"
  | "rectangle"
  | "ellipse";

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface MaskStroke {
  id: string;
  points: Point[];
  size: number;
  hardness: number;
  opacity: number;
  mode: "hide" | "reveal";
}

export interface LayerMask {
  density: number;
  feather: number;
  strokes: MaskStroke[];
}

export interface BaseLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  transform: Transform;
  parentId?: string;
  mask?: LayerMask;
}

export interface RasterLayer extends BaseLayer {
  type: "raster";
  source: string;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  letterSpacing: number;
  align: CanvasTextAlign;
}

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shape: "rectangle" | "ellipse" | "polygon" | "gradient";
  bounds: Rect;
  points?: Point[];
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  gradientEnd?: string;
}

export interface GroupLayer extends BaseLayer {
  type: "group";
}

export interface AdjustmentLayer extends BaseLayer {
  type: "adjustment";
  adjustment: "brightness-contrast" | "hue-saturation" | "levels" | "curves" | "blur" | "sharpen";
  values: Record<string, number>;
}

export type Layer = RasterLayer | TextLayer | ShapeLayer | GroupLayer | AdjustmentLayer;

export interface SelectionState {
  kind: "none" | "rect" | "lasso";
  bounds?: Rect;
  points?: Point[];
  feather: number;
}

export interface DocumentSnapshot {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  colorSpace: "srgb";
  bitDepth: 8;
  layers: Layer[];
  selectedLayerId: string;
  selection: SelectionState;
  foreground: string;
  background: string;
  createdAt: string;
  updatedAt: string;
  sourcePath?: string;
}

export type EditorCommand =
  | { type: "layer/select"; layerId: string }
  | { type: "layer/add"; layer: Layer; index?: number }
  | { type: "layer/remove"; layerId: string }
  | { type: "layer/duplicate"; layerId: string; newId: string }
  | { type: "layer/reorder"; layerId: string; direction: "up" | "down" }
  | { type: "layer/reorder-to"; layerId: string; targetLayerId: string }
  | { type: "layer/toggle-visibility"; layerId: string }
  | { type: "layer/update"; layerId: string; changes: Partial<Layer> }
  | { type: "mask/ensure"; layerId: string }
  | { type: "mask/settings"; layerId: string; density?: number; feather?: number }
  | { type: "mask/stroke"; layerId: string; stroke: MaskStroke }
  | { type: "selection/set"; selection: SelectionState }
  | { type: "selection/clear" }
  | { type: "document/rename"; name: string }
  | { type: "document/crop"; bounds: Rect }
  | { type: "colors/set"; foreground?: string; background?: string };

export interface HistoryState {
  past: DocumentSnapshot[];
  present: DocumentSnapshot;
  future: DocumentSnapshot[];
  revision: number;
}

export interface CompatibilityItem {
  feature: string;
  detail: string;
}

export interface CompatibilityReport {
  sourceName: string;
  imported: CompatibilityItem[];
  rasterized: CompatibilityItem[];
  flattened: CompatibilityItem[];
  substituted: CompatibilityItem[];
  unsupported: CompatibilityItem[];
}

export interface ExportOptions {
  format: "png" | "jpeg" | "webp" | "tiff";
  quality: number;
  width: number;
  height: number;
  preserveTransparency: boolean;
  metadata: "preserve" | "strip";
  colorProfile: "srgb";
}

export interface DesktopOpenResult {
  canceled: boolean;
  name?: string;
  path?: string;
  data?: Uint8Array;
  mimeType?: string;
}

export interface DesktopLaunchFile {
  name: string;
  path: string;
  data: Uint8Array;
  mimeType: "application/x-photopop";
}

export interface PhotoPopDesktopApi {
  isDesktop: true;
  openProject: () => Promise<DesktopOpenResult>;
  openImage: () => Promise<DesktopOpenResult>;
  saveProject: (request: { bytes: Uint8Array; suggestedName: string; path?: string }) => Promise<{ canceled: boolean; path?: string }>;
  exportImage: (request: { dataUrl: string; suggestedName: string; quality: number } & Omit<ExportOptions, "quality">) => Promise<{ canceled: boolean; path?: string }>;
  writeAutosave: (request: { bytes: Uint8Array; documentId: string }) => Promise<{ path: string }>;
  readAutosave: () => Promise<DesktopOpenResult>;
  clearAutosave: (documentId?: string) => Promise<void>;
  recentFiles: () => Promise<string[]>;
  listFonts: () => Promise<string[]>;
  readClipboardImage: () => Promise<string | undefined>;
  writeClipboardImage: (dataUrl: string) => Promise<void>;
  readPreferences: () => Promise<Record<string, unknown>>;
  writePreferences: (preferences: Record<string, unknown>) => Promise<void>;
  setDocumentDirty: (dirty: boolean) => Promise<void>;
  onLaunchFileRequested: (callback: (file: DesktopLaunchFile) => void) => () => void;
  onWindowCloseRequested: (callback: () => void) => () => void;
  confirmWindowClose: () => Promise<void>;
}
