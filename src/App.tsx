/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBrush,
  IconBucketDroplet,
  IconChevronDown,
  IconChevronUp,
  IconCircle,
  IconColorPicker,
  IconCopy,
  IconCrop,
  IconDeviceFloppy,
  IconDownload,
  IconEraser,
  IconEye,
  IconEyeOff,
  IconFileImport,
  IconFolder,
  IconGradienter,
  IconGripVertical,
  IconLasso,
  IconLetterT,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconLock,
  IconPointer,
  IconRectangle,
  IconRotate,
  IconSearch,
  IconSquareDashed,
  IconTrash,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { EditorCanvas } from "./components/EditorCanvas";
import {
  createBlankDocument,
  createHistory,
  createId,
  createTextLayer,
  dispatchHistory,
} from "./core/document";
import {
  clearBrowserAutosave,
  createImportedRasterDocument,
  deserializeProject,
  exportFlattened,
  mimeTypeFor,
  openImageFile,
  PsdCompatibilityError,
  readBrowserAutosave,
  saveProject,
  writeAutosave,
  type PsdCompositeEvidence,
} from "./core/file-format";
import type {
  BlendMode,
  CompatibilityReport,
  EditorCommand,
  ExportOptions,
  HistoryState,
  Layer,
  Point,
  ToolId,
} from "./types";

const tools: Array<{ id: ToolId; label: string; shortcut: string; icon: Icon }> = [
  { id: "move", label: "Move", shortcut: "V", icon: IconPointer },
  { id: "marquee", label: "Marquee", shortcut: "M", icon: IconSquareDashed },
  { id: "lasso", label: "Lasso", shortcut: "L", icon: IconLasso },
  { id: "brush", label: "Brush mask", shortcut: "B", icon: IconBrush },
  { id: "eraser", label: "Reveal mask", shortcut: "E", icon: IconEraser },
  { id: "fill", label: "Fill", shortcut: "G", icon: IconBucketDroplet },
  { id: "gradient", label: "Gradient", shortcut: "Shift+G", icon: IconGradienter },
  { id: "crop", label: "Crop", shortcut: "C", icon: IconCrop },
  { id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: IconColorPicker },
  { id: "text", label: "Text", shortcut: "T", icon: IconLetterT },
  { id: "rectangle", label: "Rectangle", shortcut: "U", icon: IconRectangle },
  { id: "ellipse", label: "Ellipse", shortcut: "Shift+U", icon: IconCircle },
];

const menuDefinitions = [
  { name: "File", items: ["New", "Open…", "Save", "Save As…", "Export…", "Close"] },
  { name: "Edit", items: ["Undo", "Redo", "Copy merged", "Paste image", "Clear selection"] },
  { name: "Image", items: ["Fit to screen", "Rotate canvas left", "Rotate canvas right"] },
  { name: "Layer", items: ["Duplicate layer", "Delete layer", "Move layer up", "Move layer down"] },
  { name: "Select", items: ["Select all", "Clear selection"] },
  {
    name: "Filter",
    items: [
      "Brightness / Contrast",
      "Hue / Saturation",
      "Levels",
      "Curves",
      "Gaussian blur",
      "Sharpen",
    ],
  },
  { name: "View", items: ["Zoom in", "Zoom out", "Reset rotation"] },
  { name: "Window", items: ["Properties", "Color", "Layers"] },
  { name: "Help", items: ["Keyboard shortcuts", "Format compatibility", "About PhotoPop"] },
];

const commandShortcuts: Record<string, string> = {
  New: "Ctrl N",
  "Open…": "Ctrl O",
  Save: "Ctrl S",
  "Save As…": "Ctrl Shift S",
  Close: "Ctrl W",
  Undo: "Ctrl Z",
  Redo: "Ctrl Shift Z",
  "Copy merged": "Ctrl C",
  "Paste image": "Ctrl V",
  "Fit to screen": "Ctrl 0",
  "Zoom in": "Ctrl +",
  "Zoom out": "Ctrl −",
  "Reset rotation": "0",
};

const documentIndependentActions = new Set([
  "New",
  "Open…",
  "Keyboard shortcuts",
  "Format compatibility",
  "About PhotoPop",
]);

function canExecuteAction(action: string, documentOpen: boolean): boolean {
  return documentOpen || documentIndependentActions.has(action);
}

function rulerMarks(dimension: number): number[] {
  return Array.from({ length: 7 }, (_item, index) => Math.round(dimension * index / 6));
}

type InfoDialog = "shortcuts" | "compatibility" | "about";

interface PsdReview {
  evidence: PsdCompositeEvidence;
  report: CompatibilityReport;
  difference?: {
    meanChannelDelta: number;
    changedPixelRatio: number;
  };
}

const blendModes: Array<{ value: BlendMode; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "color-burn", label: "Color Burn" },
];

function App() {
  const [history, setHistory] = useState<HistoryState>(() => createHistory());
  const [tool, setTool] = useState<ToolId>("brush");
  const [zoom, setZoom] = useState(0.5);
  const [rotation, setRotation] = useState(0);
  const [brush, setBrush] = useState({
    size: 250,
    hardness: 0,
    opacity: 1,
    mode: "hide" as "hide" | "reveal",
  });
  const [activeMenu, setActiveMenu] = useState<string>();
  const [inspectorTab, setInspectorTab] = useState<"properties" | "color">("properties");
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [projectPath, setProjectPath] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [compatibility, setCompatibility] = useState<CompatibilityReport>();
  const [compatibilityRejected, setCompatibilityRejected] = useState(false);
  const [psdReview, setPsdReview] = useState<PsdReview>();
  const [textPoint, setTextPoint] = useState<Point>();
  const [textDraft, setTextDraft] = useState("New text");
  const [exportOpen, setExportOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [recoverable, setRecoverable] = useState<HistoryState["present"]>();
  const [layersExpanded, setLayersExpanded] = useState(true);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [viewResetKey, setViewResetKey] = useState(0);
  const [documentOpen, setDocumentOpen] = useState(true);
  const [infoDialog, setInfoDialog] = useState<InfoDialog>();
  const [pendingDocumentAction, setPendingDocumentAction] = useState<"close" | "new" | "open" | "quit">();
  const [pendingFileOpen, setPendingFileOpen] = useState<{ file: File; sourcePath?: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);
  const commandWasOpenRef = useRef(false);
  const allowFileInputReplaceRef = useRef(false);
  const savedSnapshotRef = useRef<HistoryState["present"] | null>(history.present);
  const autosaveRef = useRef({
    document: history.present,
    previewDataUrl: "",
    revision: 0,
    savedRevision: 0,
    inFlight: false,
    documentOpen: true,
  });
  const snapshot = history.present;
  const selectedLayer = snapshot.layers.find((layer) => layer.id === snapshot.selectedLayerId);

  const dispatch = useCallback((command: EditorCommand) => {
    setHistory((current) => {
      const next = dispatchHistory(current, command);
      if (command.type === "layer/select" && savedSnapshotRef.current === current.present) {
        savedSnapshotRef.current = next.present;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setIsDirty(documentOpen && snapshot !== savedSnapshotRef.current);
  }, [documentOpen, snapshot]);

  const replaceDocument = useCallback((
    document: HistoryState["present"],
    dirty = false,
    path?: string,
  ) => {
    savedSnapshotRef.current = dirty ? null : document;
    setHistory(createHistory(document));
    setProjectPath(path);
    setZoom(0.5);
    setRotation(0);
    setViewResetKey((value) => value + 1);
    setDocumentOpen(true);
    setIsDirty(dirty);
  }, []);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? undefined : current), 2800);
  }, []);

  const clearRecovery = useCallback(async (documentId?: string) => {
    if (window.photoPop) {
      await window.photoPop.clearAutosave(documentId);
    } else {
      clearBrowserAutosave(documentId);
    }
  }, []);

  useEffect(() => {
    const recover = async () => {
      try {
        if (window.photoPop) {
          const result = await window.photoPop.readAutosave();
          if (!result.canceled && result.data) {
            setRecoverable(await deserializeProject(result.data));
          }
        } else {
          setRecoverable(await readBrowserAutosave());
        }
      } catch {
        // Recovery is best effort and should never block startup.
      }
    };
    void recover();
  }, []);

  useEffect(() => {
    autosaveRef.current = {
      ...autosaveRef.current,
      document: snapshot,
      previewDataUrl,
      revision: history.revision,
      documentOpen,
    };
  }, [documentOpen, history.revision, previewDataUrl, snapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = autosaveRef.current;
      if (
        !current.documentOpen
        || current.revision === 0
        || current.revision === current.savedRevision
        || current.inFlight
        || !current.previewDataUrl
      ) return;
      const revision = current.revision;
      current.inFlight = true;
      void writeAutosave(current.document, current.previewDataUrl)
        .then(() => {
          current.savedRevision = revision;
          announce("Recovery copy updated");
        })
        .catch(() => undefined)
        .finally(() => {
          current.inFlight = false;
        });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [announce]);

  useEffect(() => {
    if (!psdReview || psdReview.difference || !previewDataUrl) return;
    let canceled = false;
    void compareImageDataUrls(previewDataUrl, psdReview.evidence.embeddedCompositeDataUrl)
      .then((difference) => {
        if (canceled) return;
        const materiallyDifferent = difference.meanChannelDelta >= 4
          || difference.changedPixelRatio >= 0.05;
        if (materiallyDifferent) {
          setPsdReview((current) => current ? { ...current, difference } : current);
        } else {
          setPsdReview(undefined);
          setCompatibility(psdReview.report);
        }
      })
      .catch(() => {
        if (canceled) return;
        if (psdReview.evidence.fidelityRisks.length > 0) {
          setPsdReview((current) => current ? {
            ...current,
            difference: { meanChannelDelta: 0, changedPixelRatio: 0 },
          } : current);
        } else {
          setPsdReview(undefined);
          setCompatibility(psdReview.report);
        }
      });
    return () => {
      canceled = true;
    };
  }, [previewDataUrl, psdReview]);
  const openFiles = useCallback(async (
    files: FileList | File[],
    sourcePath?: string,
    replaceCurrent = false,
  ): Promise<boolean> => {
    const file = Array.from(files)[0];
    if (!file) return false;
    if (documentOpen && isDirty && !replaceCurrent) {
      setPendingFileOpen({ file, sourcePath });
      return false;
    }
    try {
      const result = await openImageFile(file);
      const isProject = file.name.toLowerCase().endsWith(".photopop");
      if (replaceCurrent && documentOpen) {
        await clearRecovery(snapshot.id).catch(() => undefined);
      }
      replaceDocument(result.document, !isProject, isProject ? sourcePath : undefined);
      setPsdReview(undefined);
      setCompatibilityRejected(false);
      if (result.comparison && result.report) {
        setCompatibility(undefined);
        setPsdReview({ evidence: result.comparison, report: result.report });
      } else {
        setCompatibility(result.report);
      }
      announce(`${file.name} opened`);
      return true;
    } catch (error) {
      if (error instanceof PsdCompatibilityError) {
        setCompatibilityRejected(true);
        setCompatibility(error.report);
      }
      announce(error instanceof Error ? error.message : "PhotoPop could not open that file");
      return false;
    }
  }, [announce, clearRecovery, documentOpen, isDirty, replaceDocument, snapshot.id]);

  const openFromDesktop = useCallback(async (replaceCurrent = false) => {
    if (!window.photoPop) {
      allowFileInputReplaceRef.current = replaceCurrent;
      fileInputRef.current?.click();
      return;
    }
    const result = await window.photoPop.openImage();
    if (result.canceled || !result.data || !result.name) return;
    const file = new File([new Uint8Array(result.data)], result.name, { type: result.mimeType });
    await openFiles([file], result.path, replaceCurrent);
  }, [openFiles]);

  useEffect(() => {
    if (!window.photoPop) return;
    return window.photoPop.onLaunchFileRequested((request) => {
      const file = new File([new Uint8Array(request.data)], request.name, { type: request.mimeType });
      void openFiles([file], request.path);
    });
  }, [openFiles]);

  const save = useCallback(async (forceDialog = false): Promise<boolean> => {
    if (!documentOpen || !previewDataUrl) return false;
    try {
      const path = await saveProject(snapshot, previewDataUrl, forceDialog ? undefined : projectPath);
      if (window.photoPop && !path) return false;
      if (path) setProjectPath(path);
      savedSnapshotRef.current = snapshot;
      setIsDirty(false);
      autosaveRef.current.savedRevision = history.revision;
      await clearRecovery(snapshot.id).catch(() => undefined);
      announce("Project saved safely");
      return true;
    } catch (error) {
      announce(error instanceof Error ? error.message : "Save failed");
      return false;
    }
  }, [announce, clearRecovery, documentOpen, history.revision, previewDataUrl, projectPath, snapshot]);

  const closeDocument = useCallback(async () => {
    await clearRecovery(snapshot.id).catch(() => undefined);
    autosaveRef.current.savedRevision = autosaveRef.current.revision;
    setDocumentOpen(false);
    setProjectPath(undefined);
    setPreviewDataUrl("");
    setCompatibility(undefined);
    setRecoverable(undefined);
    setFocusMode(false);
    setIsDirty(false);
    announce("Document closed");
  }, [announce, clearRecovery, snapshot.id]);

  const performDocumentAction = useCallback(async (action: "close" | "new" | "open" | "quit") => {
    if (action === "close") {
      await closeDocument();
      return;
    }
    if (action === "quit") {
      await clearRecovery(snapshot.id).catch(() => undefined);
      await window.photoPop?.confirmWindowClose();
      return;
    }
    if (action === "new") {
      await clearRecovery(snapshot.id).catch(() => undefined);
      replaceDocument(createBlankDocument(), true);
      announce("New document created");
      return;
    }
    await openFromDesktop(true);
  }, [announce, clearRecovery, closeDocument, openFromDesktop, replaceDocument, snapshot.id]);

  const requestDocumentAction = useCallback((action: "close" | "new" | "open" | "quit") => {
    if (documentOpen && isDirty) {
      setPendingDocumentAction(action);
      return;
    }
    void performDocumentAction(action);
  }, [documentOpen, isDirty, performDocumentAction]);

  useEffect(() => {
    void window.photoPop?.setDocumentDirty(documentOpen && isDirty);
  }, [documentOpen, isDirty]);

  useEffect(() => {
    if (!window.photoPop) return;
    return window.photoPop.onWindowCloseRequested(() => requestDocumentAction("quit"));
  }, [requestDocumentAction]);

  const addAdjustment = useCallback((adjustment: Extract<Layer, { type: "adjustment" }>["adjustment"]) => {
    const values: Record<string, number> = adjustment === "brightness-contrast"
      ? { brightness: 0, contrast: 0 }
      : adjustment === "hue-saturation"
        ? { hue: 0, saturation: 0 }
        : adjustment === "levels"
          ? { black: 0, gamma: 1, white: 255 }
          : adjustment === "curves"
            ? { shadows: 0, midtones: 0, highlights: 0 }
            : adjustment === "sharpen"
              ? { amount: 50 }
              : { radius: 2 };
    dispatch({
      type: "layer/add",
      layer: {
        id: createId("layer"),
        name: adjustment.replace("-", " "),
        type: "adjustment",
        adjustment,
        values,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      },
    });
  }, [dispatch]);

  const copyComposite = useCallback(async () => {
    if (!previewDataUrl) {
      announce("Nothing is ready to copy");
      return;
    }
    try {
      if (window.photoPop) {
        await window.photoPop.writeClipboardImage(previewDataUrl);
      } else {
        const blob = await fetch(previewDataUrl).then((response) => response.blob());
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      }
      announce("Merged image copied");
    } catch (error) {
      announce(error instanceof Error ? error.message : "Clipboard copy failed");
    }
  }, [announce, previewDataUrl]);

  const pasteClipboardImage = useCallback(async () => {
    try {
      let source: string | undefined;
      if (window.photoPop) {
        source = await window.photoPop.readClipboardImage();
      } else if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const item = items.find((candidate) => candidate.types.includes("image/png"));
        if (item) {
          const blob = await item.getType("image/png");
          source = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("Clipboard read failed"));
            reader.readAsDataURL(blob);
          });
        }
      }
      if (!source) {
        announce("The clipboard does not contain a PNG image");
        return;
      }
      dispatch({
        type: "layer/add",
        layer: {
          id: createId("layer"),
          name: "Clipboard image",
          type: "raster",
          source,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        },
      });
      announce("Clipboard image pasted as a layer");
    } catch (error) {
      announce(error instanceof Error ? error.message : "Clipboard paste failed");
    }
  }, [announce, dispatch]);

  const executeAction = useCallback((action: string) => {
    setActiveMenu(undefined);
    setCommandOpen(false);
    setCommandSearch("");
    if (!canExecuteAction(action, documentOpen)) {
      announce("Open or create a document to use that command");
      return;
    }
    setRecentCommands((current) => [action, ...current.filter((item) => item !== action)].slice(0, 5));
    switch (action) {
      case "New":
        requestDocumentAction("new");
        break;
      case "Open…":
        requestDocumentAction("open");
        break;
      case "Save":
        void save(false);
        break;
      case "Save As…":
        void save(true);
        break;
      case "Export…":
        if (documentOpen) setExportOpen(true);
        else announce("Open or create a document before exporting");
        break;
      case "Close":
        requestDocumentAction("close");
        break;
      case "Undo":
        setHistory((current) => dispatchHistory(current, { type: "history/undo" }));
        break;
      case "Redo":
        setHistory((current) => dispatchHistory(current, { type: "history/redo" }));
        break;
      case "Copy merged":
        void copyComposite();
        break;
      case "Paste image":
        void pasteClipboardImage();
        break;
      case "Clear selection":
        dispatch({ type: "selection/clear" });
        break;
      case "Select all":
        dispatch({
          type: "selection/set",
          selection: { kind: "rect", bounds: { x: 0, y: 0, width: snapshot.width, height: snapshot.height }, feather: 0 },
        });
        break;
      case "Fit to screen":
        setZoom(0.5);
        setViewResetKey((value) => value + 1);
        break;
      case "Zoom in":
        setZoom((value) => Math.min(4, value + 0.1));
        break;
      case "Zoom out":
        setZoom((value) => Math.max(0.1, value - 0.1));
        break;
      case "Rotate canvas left":
        setRotation((value) => value - 15);
        break;
      case "Rotate canvas right":
        setRotation((value) => value + 15);
        break;
      case "Reset rotation":
        setRotation(0);
        setViewResetKey((value) => value + 1);
        break;
      case "Duplicate layer":
        dispatch({ type: "layer/duplicate", layerId: snapshot.selectedLayerId, newId: createId("layer") });
        break;
      case "Delete layer":
        dispatch({ type: "layer/remove", layerId: snapshot.selectedLayerId });
        break;
      case "Move layer up":
        dispatch({ type: "layer/reorder", layerId: snapshot.selectedLayerId, direction: "up" });
        break;
      case "Move layer down":
        dispatch({ type: "layer/reorder", layerId: snapshot.selectedLayerId, direction: "down" });
        break;
      case "Brightness / Contrast":
        addAdjustment("brightness-contrast");
        break;
      case "Hue / Saturation":
        addAdjustment("hue-saturation");
        break;
      case "Levels":
        addAdjustment("levels");
        break;
      case "Curves":
        addAdjustment("curves");
        break;
      case "Gaussian blur":
        addAdjustment("blur");
        break;
      case "Sharpen":
        addAdjustment("sharpen");
        break;
      case "Properties":
        setFocusMode(false);
        setInspectorCollapsed(false);
        setInspectorTab("properties");
        break;
      case "Color":
        setFocusMode(false);
        setInspectorCollapsed(false);
        setInspectorTab("color");
        break;
      case "Layers":
        setFocusMode(false);
        setInspectorCollapsed(false);
        setLayersExpanded(true);
        break;
      case "Keyboard shortcuts":
        setInfoDialog("shortcuts");
        break;
      case "Format compatibility":
        setInfoDialog("compatibility");
        break;
      case "About PhotoPop":
        setInfoDialog("about");
        break;
    }
  }, [addAdjustment, announce, copyComposite, dispatch, documentOpen, pasteClipboardImage, requestDocumentAction, save, snapshot.height, snapshot.selectedLayerId, snapshot.width]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        setActiveMenu(undefined);
        setCommandOpen(false);
        setTextPoint(undefined);
        setExportOpen(false);
        setInfoDialog(undefined);
        setPendingDocumentAction(undefined);
        setPendingFileOpen(undefined);
        return;
      }
      if (target?.matches("input, textarea, select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandSearch("");
        setCommandIndex(0);
        setCommandOpen(true);
        return;
      }      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        requestDocumentAction("new");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        requestDocumentAction("open");
        return;
      }
      if (!documentOpen) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        requestDocumentAction("close");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(event.shiftKey);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setHistory((current) => dispatchHistory(current, { type: event.shiftKey ? "history/redo" : "history/undo" }));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyComposite();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void pasteClipboardImage();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        setZoom(0.5);
        setRotation(0);
        setViewResetKey((value) => value + 1);
        return;
      }      if ((event.ctrlKey || event.metaKey) && ["+", "="].includes(event.key)) {
        event.preventDefault();
        setZoom((value) => Math.min(4, value + 0.1));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "-") {
        event.preventDefault();
        setZoom((value) => Math.max(0.1, value - 0.1));
        return;
      }
      const match = tools.find((candidate) => {
        const shortcut = candidate.shortcut.toLowerCase();
        return shortcut.startsWith("shift+")
          ? event.shiftKey && shortcut.endsWith(event.key.toLowerCase())
          : !event.shiftKey && shortcut === event.key.toLowerCase();
      });
      if (match) setTool(match.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copyComposite, documentOpen, pasteClipboardImage, requestDocumentAction, save]);

  const commandItems = useMemo(
    () => menuDefinitions
      .flatMap((menu) => menu.items.map((label) => ({ label, group: menu.name })))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.label === item.label) === index),
    [],
  );
  const filteredCommands = commandItems
    .filter((item) => canExecuteAction(item.label, documentOpen))
    .filter((item) => item.label.toLowerCase().includes(commandSearch.toLowerCase()))
    .sort((a, b) => {
      if (commandSearch) return 0;
      const aRecent = recentCommands.indexOf(a.label);
      const bRecent = recentCommands.indexOf(b.label);
      if (aRecent < 0 && bRecent < 0) return 0;
      if (aRecent < 0) return 1;
      if (bRecent < 0) return -1;
      return aRecent - bRecent;
    });

  useEffect(() => {
    setCommandIndex(0);
  }, [commandSearch, commandOpen]);

  useEffect(() => {
    if (commandWasOpenRef.current && !commandOpen) commandTriggerRef.current?.focus();
    commandWasOpenRef.current = commandOpen;
  }, [commandOpen]);

  const applyText = () => {
    if (!textPoint) return;
    dispatch({ type: "layer/add", layer: createTextLayer(textDraft, textPoint, snapshot.foreground) });
    setTextPoint(undefined);
    setTextDraft("New text");
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const replaceCurrent = allowFileInputReplaceRef.current;
    allowFileInputReplaceRef.current = false;
    if (event.target.files) void openFiles(event.target.files, undefined, replaceCurrent);
    event.target.value = "";
  };

  const applyCrop = () => {
    if (snapshot.selection.bounds) {
      dispatch({ type: "document/crop", bounds: snapshot.selection.bounds });
      setTool("move");
    }
  };

  return (
    <main
      className={focusMode ? "app-shell canvas-focus" : "app-shell"}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length) void openFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".photopop,.psd,.png,.jpg,.jpeg,.webp,.svg,.tif,.tiff"
        onChange={onFileInput}
      />

      <header className="menu-bar">
        <button className="brand" onClick={() => announce("PhotoPop is local-first and open source")}>PhotoPop</button>
        <nav aria-label="Application menu">
          {menuDefinitions.map((menu) => (
            <div className="menu-root" key={menu.name}>
              <button
                className={activeMenu === menu.name ? "menu-trigger active" : "menu-trigger"}
                onClick={() => setActiveMenu((current) => current === menu.name ? undefined : menu.name)}
                aria-expanded={activeMenu === menu.name}
              >
                {menu.name}
              </button>
              {activeMenu === menu.name && (
                <div className="menu-popover" role="menu">
                  {menu.items.map((item) => (
                    <button role="menuitem" key={item} disabled={!canExecuteAction(item, documentOpen)} onClick={() => executeAction(item)}>{item}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <button
          ref={commandTriggerRef}
          className="command-button"
          onClick={() => {
            setCommandSearch("");
            setCommandIndex(0);
            setCommandOpen(true);
          }}
        >
          <IconSearch size={15} />
          <span>Search commands</span>
          <kbd>Ctrl K</kbd>
        </button>
      </header>

      {documentOpen ? (
        <OptionsBar
          tool={tool}
          brush={brush}
          setBrush={setBrush}
          selectionExists={snapshot.selection.kind !== "none"}
          hiddenFromInteraction={focusMode}
          applyCrop={applyCrop}
          clearSelection={() => dispatch({ type: "selection/clear" })}
        />
      ) : (
        <div className="options-bar options-bar-empty" aria-label="No document options">
          <span>No document open</span>
        </div>
      )}

      <section className={[
        "workspace",
        inspectorCollapsed ? "inspector-collapsed" : "",
        focusMode ? "focus-mode" : "",
        !documentOpen ? "document-closed" : "",
      ].filter(Boolean).join(" ")}>
        <aside
          className="tool-rail"
          aria-label="Editing tools"
          aria-hidden={focusMode || !documentOpen}
          inert={focusMode || !documentOpen}
        >
          {tools.map(({ id, label, shortcut, icon: ToolIcon }) => (
            <button
              key={id}
              className={tool === id ? "tool-button active" : "tool-button"}
              onClick={() => setTool(id)}
              title={`${label} (${shortcut})`}
              aria-label={`${label}, shortcut ${shortcut}`}
              aria-pressed={tool === id}
            >
              <ToolIcon size={26} stroke={1.65} />
            </button>
          ))}
          <div className="color-stack" title="Foreground and background colors">
            <button
              className="color-chip background"
              style={{ backgroundColor: snapshot.background }}
              onClick={() => dispatch({ type: "colors/set", foreground: snapshot.background, background: snapshot.foreground })}
              aria-label="Swap foreground and background colors"
            />
            <label className="color-chip foreground" style={{ backgroundColor: snapshot.foreground }}>
              <span className="visually-hidden">Foreground color</span>
              <input
                type="color"
                value={snapshot.foreground}
                onChange={(event) => dispatch({ type: "colors/set", foreground: event.target.value })}
              />
            </label>
          </div>
        </aside>

        <section className="document-region">
          <div className="document-tab-row">
            {documentOpen && (
              <div className="document-tab active">
                <span>{snapshot.name}</span>
                {isDirty && <span className="unsaved-dot" aria-label="Unsaved changes" />}
                <button
                  type="button"
                  className="document-tab-close"
                  onClick={() => requestDocumentAction("close")}
                  aria-label={`Close ${snapshot.name}`}
                  title="Close document (Ctrl+W)"
                >
                  <IconX size={15} />
                </button>
              </div>
            )}
          </div>
          <div className="canvas-frame">
            {documentOpen ? (
              <>
                <div className="ruler ruler-horizontal">
                  {rulerMarks(snapshot.width).map((mark, index) => <span key={index}>{mark}</span>)}
                </div>
                <div className="ruler ruler-vertical">
                  {rulerMarks(snapshot.height).map((mark, index) => <span key={index}>{mark}</span>)}
                </div>
                <EditorCanvas
                  document={snapshot}
                  tool={tool}
                  zoom={zoom}
                  rotation={rotation}
                  viewResetKey={viewResetKey}
                  brush={brush}
                  onDispatch={dispatch}
                  onZoomChange={setZoom}
                  onPreview={setPreviewDataUrl}
                  onSampleColor={(color) => {
                    dispatch({ type: "colors/set", foreground: color });
                    announce(`Sampled ${color}`);
                  }}
                  onRequestText={(point) => {
                    setTextPoint(point);
                    setTextDraft("New text");
                  }}
                />
              </>
            ) : (
              <section className="empty-workspace" aria-label="No document open">
                <div className="empty-workspace-icon"><IconFileImport size={30} /></div>
                <h1>Start with an image</h1>
                <p>Open a project or create a fresh local document. Nothing leaves this computer.</p>
                <div className="empty-workspace-actions">
                  <button className="primary" onClick={() => requestDocumentAction("new")}>New document</button>
                  <button className="secondary" onClick={() => requestDocumentAction("open")}>Open file…</button>
                </div>
                <span>PSD, PNG, JPEG, WebP, TIFF, SVG, or .photopop</span>
              </section>
            )}
          </div>
        </section>

        <aside
          className="inspector"
          aria-hidden={focusMode || inspectorCollapsed || !documentOpen}
          inert={focusMode || inspectorCollapsed || !documentOpen}
        >
          <div className="inspector-tabs" role="tablist">
            <button
              className={inspectorTab === "properties" ? "inspector-tab-button active" : "inspector-tab-button"}
              role="tab"
              aria-selected={inspectorTab === "properties"}
              onClick={() => setInspectorTab("properties")}
            >
              Properties
            </button>
            <button
              className={inspectorTab === "color" ? "inspector-tab-button active" : "inspector-tab-button"}
              role="tab"
              aria-selected={inspectorTab === "color"}
              onClick={() => setInspectorTab("color")}
            >
              Color
            </button>
            <button
              className="inspector-toggle"
              onClick={() => setInspectorCollapsed((value) => !value)}
              aria-label={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
              title={inspectorCollapsed ? "Expand inspector" : "Collapse inspector"}
            >
              {inspectorCollapsed
                ? <IconLayoutSidebarRightExpand size={18} />
                : <IconLayoutSidebarRightCollapse size={18} />}
            </button>
          </div>
          {!inspectorCollapsed && (
            <>
              <div className="inspector-content" key={`${inspectorTab}-${selectedLayer?.id ?? "none"}`}>
                {inspectorTab === "properties" ? (
                  <MaskProperties
                    layer={selectedLayer}
                    onDispatch={dispatch}
                  />
                ) : (
                  <ColorPanel
                    foreground={snapshot.foreground}
                    background={snapshot.background}
                    onChange={(foreground, background) => dispatch({ type: "colors/set", foreground, background })}
                  />
                )}
              </div>
              <LayersPanel
                layers={snapshot.layers}
                selectedLayerId={snapshot.selectedLayerId}
                expanded={layersExpanded}
                onToggleExpanded={() => setLayersExpanded((value) => !value)}
                onDispatch={dispatch}
              />
            </>
          )}
        </aside>

        <footer className="status-bar">
          {documentOpen ? (
            <>
              <div className="zoom-controls">
                <button onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))} aria-label="Zoom out">−</button>
                <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Canvas zoom">
                  {![0.25, 0.5, 0.75, 1, 1.5].includes(zoom) && (
                    <option value={zoom}>{Math.round(zoom * 100)}%</option>
                  )}
                  <option value={0.25}>25%</option>
                  <option value={0.5}>50%</option>
                  <option value={0.75}>75%</option>
                  <option value={1}>100%</option>
                  <option value={1.5}>150%</option>
                </select>
                <button onClick={() => setZoom((value) => Math.min(4, value + 0.1))} aria-label="Zoom in">+</button>
              </div>
              <span>{snapshot.width} × {snapshot.height} px</span>
              <span>RGB/8 · sRGB</span>
              <div className="rotation-control">
                <IconRotate size={15} />
                <input
                  aria-label="Canvas rotation"
                  type="number"
                  value={rotation}
                  onChange={(event) => setRotation(Number(event.target.value))}
                />
                <span>°</span>
              </div>
              <div className="workspace-controls">
                <button
                  onClick={() => setInspectorCollapsed((value) => !value)}
                  aria-pressed={inspectorCollapsed}
                  aria-label={inspectorCollapsed ? "Show inspector" : "Hide inspector"}
                  title={inspectorCollapsed ? "Show inspector" : "Hide inspector"}
                >
                  {inspectorCollapsed
                    ? <IconLayoutSidebarRightExpand size={17} />
                    : <IconLayoutSidebarRightCollapse size={17} />}
                </button>
                <button
                  onClick={() => setFocusMode((value) => !value)}
                  aria-pressed={focusMode}
                  aria-label={focusMode ? "Exit canvas focus" : "Enter canvas focus"}
                  title={focusMode ? "Exit canvas focus" : "Enter canvas focus"}
                >
                  {focusMode ? <IconArrowsMinimize size={17} /> : <IconArrowsMaximize size={17} />}
                </button>
              </div>
            </>
          ) : (
            <span className="status-empty">Ready · local-only workspace</span>
          )}
        </footer>
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
      {recoverable && (
        <div className="recovery-banner" role="status" aria-live="polite">
          <span>A recoverable copy of <strong>{recoverable.name}</strong> is available.</span>
          <button
            disabled={documentOpen && isDirty}
            title={documentOpen && isDirty ? "Save or close the current document before recovering" : undefined}
            onClick={() => {
            replaceDocument(recoverable, true);
            setRecoverable(undefined);
            announce("Recovery copy opened");
          }}>Recover</button>
          <button onClick={() => {
            const documentId = recoverable.id;
            setRecoverable(undefined);
            void clearRecovery(documentId).then(
              () => announce("Recovery copy dismissed"),
              () => announce("Could not dismiss the recovery copy"),
            );
          }}>Discard recovery copy</button>
        </div>
      )}
      {psdReview?.difference && (
        <PsdFidelityDialog
          review={psdReview}
          editablePreview={previewDataUrl}
          onChooseEditable={() => {
            setPsdReview(undefined);
            setCompatibility(psdReview.report);
            announce("Editable PSD layers kept");
          }}
          onChooseFlattened={() => {
            const flattened = createImportedRasterDocument(
              psdReview.evidence.embeddedCompositeDataUrl,
              `${psdReview.report.sourceName.replace(/\.psd$/i, "")} faithful composite.png`,
              psdReview.evidence.width,
              psdReview.evidence.height,
            );
            const report: CompatibilityReport = {
              ...psdReview.report,
              flattened: [
                ...psdReview.report.flattened,
                {
                  feature: "Faithful embedded composite",
                  detail: "You chose the visually faithful flattened copy instead of the editable layer conversion.",
                },
              ],
            };
            replaceDocument(flattened, true);
            setPsdReview(undefined);
            setCompatibility(report);
            announce("Faithful flattened copy opened");
          }}
        />
      )}
      {compatibility && (
        <CompatibilityDialog
          report={compatibility}
          rejected={compatibilityRejected}
          onClose={() => {
            setCompatibility(undefined);
            setCompatibilityRejected(false);
          }}
        />
      )}
      {textPoint && (
        <Modal title="Add text layer" onClose={() => setTextPoint(undefined)}>
          <label className="field">
            <span>Text</span>
            <textarea autoFocus value={textDraft} onChange={(event) => setTextDraft(event.target.value)} />
          </label>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setTextPoint(undefined)}>Cancel</button>
            <button className="primary" onClick={applyText}>Add text</button>
          </div>
        </Modal>
      )}
      {exportOpen && (
        <ExportDialog
          snapshot={snapshot}
          previewDataUrl={previewDataUrl}
          onClose={() => setExportOpen(false)}
          onComplete={(message) => {
            setExportOpen(false);
            announce(message);
          }}
        />
      )}
      {pendingFileOpen && (
        <Modal title="Save changes before opening this file?" onClose={() => setPendingFileOpen(undefined)}>
          <p className="dialog-copy">
            <strong>{snapshot.name}</strong> has unsaved changes. Save them before opening <strong>{pendingFileOpen.file.name}</strong>.
          </p>
          <div className="modal-actions three-actions">
            <button className="secondary" onClick={() => setPendingFileOpen(undefined)}>Cancel</button>
            <button className="secondary danger-text" onClick={() => {
              const pending = pendingFileOpen;
              setPendingFileOpen(undefined);
              void openFiles([pending.file], pending.sourcePath, true);
            }}>Discard changes</button>
            <button className="primary" onClick={() => {
              const pending = pendingFileOpen;
              void save(false).then((saved) => {
                if (!saved) return;
                setPendingFileOpen(undefined);
                void openFiles([pending.file], pending.sourcePath, true);
              });
            }}><IconDeviceFloppy size={17} />Save</button>
          </div>
        </Modal>
      )}
      {pendingDocumentAction && (
        <Modal title="Save changes before continuing?" onClose={() => setPendingDocumentAction(undefined)}>
          <p className="dialog-copy">
            <strong>{snapshot.name}</strong> has changes that have not been saved. Save them before you {pendingDocumentAction === "close" ? "close it" : pendingDocumentAction === "quit" ? "quit PhotoPop" : pendingDocumentAction === "new" ? "create another document" : "open another file"}.
          </p>
          <div className="modal-actions three-actions">
            <button className="secondary" onClick={() => setPendingDocumentAction(undefined)}>Cancel</button>
            <button className="secondary danger-text" onClick={() => {
              const action = pendingDocumentAction;
              setPendingDocumentAction(undefined);
              void performDocumentAction(action);
            }}>Discard changes</button>
            <button className="primary" onClick={() => {
              const action = pendingDocumentAction;
              void save(false).then((saved) => {
                if (!saved) return;
                setPendingDocumentAction(undefined);
                void performDocumentAction(action);
              });
            }}>
              <IconDeviceFloppy size={17} />
              Save
            </button>
          </div>
        </Modal>
      )}
      {infoDialog && (
        <InfoDialogModal kind={infoDialog} onClose={() => setInfoDialog(undefined)} />
      )}
      {commandOpen && (
        <div className="modal-backdrop command-backdrop" onMouseDown={() => setCommandOpen(false)}>
          <div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                event.preventDefault();
                event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
              }
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="command-search">
              <IconSearch size={19} />
              <input
                autoFocus
                placeholder="Type a command…"
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setCommandOpen(false);
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandIndex((value) => Math.min(Math.min(filteredCommands.length, 12) - 1, value + 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandIndex((value) => Math.max(0, value - 1));
                  }
                  if (event.key === "Enter" && filteredCommands[commandIndex]) {
                    event.preventDefault();
                    executeAction(filteredCommands[commandIndex].label);
                  }
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="command-results"
                aria-activedescendant={filteredCommands[commandIndex] ? `command-${filteredCommands[commandIndex].label.replace(/\W+/g, "-")}` : undefined}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="command-list" id="command-results" role="listbox" aria-label="Available commands">
              {filteredCommands.slice(0, 12).map((item, index) => (
                <button
                  id={`command-${item.label.replace(/\W+/g, "-")}`}
                  key={item.label}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === commandIndex}
                  className={index === commandIndex ? "selected" : ""}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => executeAction(item.label)}
                >
                  <span className="command-copy">
                    <strong>{item.label}</strong>
                    <small>{recentCommands.includes(item.label) && !commandSearch ? "Recent · " : ""}{item.group}</small>
                  </span>
                  <span className="command-shortcut">
                    {commandShortcuts[item.label] ?? (index === commandIndex ? "Enter" : "")}
                  </span>
                </button>
              ))}
              {filteredCommands.length === 0 && (
                <div className="command-empty" role="status">No matching commands</div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

interface OptionsBarProps {
  tool: ToolId;
  brush: { size: number; hardness: number; opacity: number; mode: "hide" | "reveal" };
  setBrush: Dispatch<SetStateAction<OptionsBarProps["brush"]>>;
  selectionExists: boolean;
  hiddenFromInteraction: boolean;
  applyCrop: () => void;
  clearSelection: () => void;
}

function OptionsBar({ tool, brush, setBrush, selectionExists, hiddenFromInteraction, applyCrop, clearSelection }: OptionsBarProps) {
  const activeTool = tools.find((candidate) => candidate.id === tool);
  const ToolIcon = activeTool?.icon ?? IconPointer;
  return (
    <div className="options-bar" aria-hidden={hiddenFromInteraction} inert={hiddenFromInteraction}>
      <div className="active-tool-label">
        <ToolIcon size={22} stroke={1.8} />
        <strong>{tool === "brush" ? "Mask" : activeTool?.label}</strong>
      </div>
      <div className="contextual-options" key={tool}>
        {["brush", "eraser"].includes(tool) ? (
          <>
            <ToolbarField label="Mode">
              <select
                value={tool === "eraser" ? "reveal" : brush.mode}
                disabled={tool === "eraser"}
                onChange={(event) => setBrush((value) => ({ ...value, mode: event.target.value as "hide" | "reveal" }))}
              >
                <option value="hide">Normal</option>
                <option value="reveal">Reveal</option>
              </select>
            </ToolbarField>
            <ToolbarField label="Opacity">
              <select value={brush.opacity} onChange={(event) => setBrush((value) => ({ ...value, opacity: Number(event.target.value) }))}>
                <option value={0.4}>40%</option>
                <option value={0.72}>72%</option>
                <option value={1}>100%</option>
              </select>
            </ToolbarField>

            <ToolbarField label="Hardness">
              <select value={brush.hardness} onChange={(event) => setBrush((value) => ({ ...value, hardness: Number(event.target.value) }))}>
                <option value={0}>0%</option>
                <option value={0.4}>40%</option>
                <option value={0.75}>75%</option>
                <option value={1}>100%</option>
              </select>
            </ToolbarField>
            <div className="brush-preview" style={{ width: Math.max(16, Math.min(34, brush.size / 4)), height: Math.max(16, Math.min(34, brush.size / 4)) }} />
            <ToolbarField label="Size">
              <input
                className="size-input"
                type="number"
                min={2}
                max={500}
                value={brush.size}
                onChange={(event) => setBrush((value) => ({ ...value, size: Number(event.target.value) }))}
              />
              <span>px</span>
            </ToolbarField>
            <button className="icon-control" title="Reset brush" onClick={() => setBrush({ size: 250, hardness: 0, opacity: 1, mode: "hide" })}>
              <IconRotate size={18} />
            </button>

          </>
        ) : (
          <div className="options-message">
            {tool === "move" && "Drag the selected layer to reposition it. Hold Space to pan."}
            {tool === "marquee" && "Drag to create a rectangular selection."}
            {tool === "lasso" && "Draw a freeform selection."}
            {tool === "fill" && "Click to fill the selected shape with the foreground color."}
            {tool === "gradient" && "Drag to add a foreground-to-background gradient layer."}
            {tool === "crop" && "Drag a crop boundary, then apply it."}
            {tool === "eyedropper" && "Click the artwork to sample a foreground color."}
            {tool === "text" && "Click the artwork to place an editable text layer."}
            {tool === "rectangle" && "Drag to add a rectangle shape layer."}
            {tool === "ellipse" && "Drag to add an ellipse shape layer."}
          </div>
        )}
        {tool === "crop" && selectionExists && <button className="toolbar-action" onClick={applyCrop}>Apply crop</button>}
        {selectionExists && tool !== "crop" && <button className="toolbar-action quiet" onClick={clearSelection}>Clear selection</button>}
      </div>
    </div>
  );
}

function ToolbarField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="toolbar-field">
      <span>{label}:</span>
      <div>{children}</div>
    </label>
  );
}

function MaskProperties({ layer, onDispatch }: { layer?: Layer; onDispatch: (command: EditorCommand) => void }) {
  if (!layer) return <section className="properties-panel empty">Select a layer to edit its properties.</section>;

  if (layer.type === "adjustment") {
    const controlSets: Record<typeof layer.adjustment, Array<{
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      suffix: string;
    }>> = {
      "brightness-contrast": [
        { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, suffix: "%" },
        { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, suffix: "%" },
      ],
      "hue-saturation": [
        { key: "hue", label: "Hue", min: -180, max: 180, step: 1, suffix: "°" },
        { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, suffix: "%" },
      ],
      levels: [
        { key: "black", label: "Black point", min: 0, max: 254, step: 1, suffix: "" },
        { key: "gamma", label: "Midtone gamma", min: 0.1, max: 3, step: 0.05, suffix: "" },
        { key: "white", label: "White point", min: 1, max: 255, step: 1, suffix: "" },
      ],
      curves: [
        { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1, suffix: "%" },
        { key: "midtones", label: "Midtones", min: -100, max: 100, step: 1, suffix: "%" },
        { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1, suffix: "%" },
      ],
      blur: [
        { key: "radius", label: "Radius", min: 0, max: 30, step: 0.5, suffix: " px" },
      ],
      sharpen: [
        { key: "amount", label: "Amount", min: 0, max: 200, step: 1, suffix: "%" },
      ],
    };
    const title = layer.adjustment
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" / ");
    return (
      <section className="properties-panel adjustment-properties">
        <div className="layer-summary">
          <LayerThumbnail layer={layer} size={48} />
          <div><strong>{title}</strong><span>Non-destructive adjustment</span></div>
        </div>
        <div className="property-sliders adjustment-sliders">
          {controlSets[layer.adjustment].map((control) => {
            const value = layer.values[control.key] ?? 0;
            return (
              <label key={control.key}>
                <span>{control.label} <output>{value}{control.suffix}</output></span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={value}
                  onChange={(event) => onDispatch({
                    type: "layer/update",
                    layerId: layer.id,
                    changes: {
                      values: { ...layer.values, [control.key]: Number(event.target.value) },
                    } as Partial<Layer>,
                  })}
                />
              </label>
            );
          })}
        </div>
        <button className="secondary reset-adjustment" onClick={() => {
          const defaults = layer.adjustment === "brightness-contrast"
            ? { brightness: 0, contrast: 0 }
            : layer.adjustment === "hue-saturation"
              ? { hue: 0, saturation: 0 }
              : layer.adjustment === "levels"
                ? { black: 0, gamma: 1, white: 255 }
                : layer.adjustment === "curves"
                  ? { shadows: 0, midtones: 0, highlights: 0 }
                  : layer.adjustment === "sharpen"
                    ? { amount: 50 }
                    : { radius: 2 };
          onDispatch({
            type: "layer/update",
            layerId: layer.id,
            changes: { values: defaults } as Partial<Layer>,
          });
        }}>Reset adjustment</button>
        {layer.mask ? (
          <div className="adjustment-mask-controls">
            <h3>Layer mask</h3>
            <MaskControlFields layer={layer} onDispatch={onDispatch} />
          </div>
        ) : (
          <button
            className="secondary add-mask"
            onClick={() => onDispatch({ type: "mask/ensure", layerId: layer.id })}
          >
            Add layer mask
          </button>
        )}
      </section>
    );
  }

  if (layer.type === "text" && !layer.mask) {
    return (
      <section className="properties-panel text-properties">
        <div className="layer-summary">
          <LayerThumbnail layer={layer} size={48} />
          <div><strong>{layer.name}</strong><span>Editable text layer</span></div>
        </div>
        <label className="field"><span>Text</span><textarea value={layer.text} onChange={(event) => onDispatch({
          type: "layer/update", layerId: layer.id, changes: { text: event.target.value } as Partial<Layer>,
        })} /></label>
        <div className="text-property-grid">
          <label><span>Typeface</span><select value={layer.fontFamily} onChange={(event) => onDispatch({
            type: "layer/update", layerId: layer.id, changes: { fontFamily: event.target.value } as Partial<Layer>,
          })}><option value="Inter, sans-serif">Inter</option><option value="Georgia, 'Times New Roman', serif">Editorial serif</option></select></label>
          <label><span>Size</span><input type="number" min={6} max={500} value={layer.fontSize} onChange={(event) => onDispatch({
            type: "layer/update", layerId: layer.id, changes: { fontSize: Number(event.target.value) } as Partial<Layer>,
          })} /></label>
          <label><span>Weight</span><select value={layer.fontWeight} onChange={(event) => onDispatch({
            type: "layer/update", layerId: layer.id, changes: { fontWeight: Number(event.target.value) } as Partial<Layer>,
          })}><option value={400}>Regular</option><option value={500}>Medium</option><option value={600}>Semibold</option><option value={700}>Bold</option></select></label>
          <label><span>Color</span><input type="color" value={layer.color} onChange={(event) => onDispatch({
            type: "layer/update", layerId: layer.id, changes: { color: event.target.value } as Partial<Layer>,
          })} /></label>
          <label><span>Tracking</span><input type="number" min={-20} max={100} value={layer.letterSpacing} onChange={(event) => onDispatch({
            type: "layer/update", layerId: layer.id, changes: { letterSpacing: Number(event.target.value) } as Partial<Layer>,
          })} /></label>
          <label><span>Align</span><select value={layer.align} onChange={(event) => onDispatch({
            type: "layer/update", layerId: layer.id, changes: { align: event.target.value as CanvasTextAlign } as Partial<Layer>,
          })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        </div>
        <button className="secondary add-mask" onClick={() => onDispatch({ type: "mask/ensure", layerId: layer.id })}>Add layer mask</button>
      </section>
    );
  }

  const mask = layer.mask;
  if (!mask) {
    return (
      <section className="properties-panel">
        <h2 className="visually-hidden">Layer</h2>
        <div className="layer-summary">
          <LayerThumbnail layer={layer} size={48} />
          <div>
            <strong>{layer.name}</strong>
            <span>{`${layer.type[0].toUpperCase()}${layer.type.slice(1)}`} layer</span>
          </div>
        </div>
        <div className="transform-grid">
          {([
            ["X", "x", layer.transform.x],
            ["Y", "y", layer.transform.y],
            ["Rotation", "rotation", layer.transform.rotation],
          ] as const).map(([label, property, value]) => (
            <label key={property}>
              <span>{label}</span>
              <input
                type="number"
                value={Math.round(value * 10) / 10}
                onChange={(event) => onDispatch({
                  type: "layer/update",
                  layerId: layer.id,
                  changes: {
                    transform: {
                      ...layer.transform,
                      [property]: Number(event.target.value),
                    },
                  },
                })}
              />
            </label>
          ))}
        </div>
        <button className="secondary add-mask" onClick={() => onDispatch({ type: "mask/ensure", layerId: layer.id })}>
          Add layer mask
        </button>
      </section>
    );
  }
  return (
    <section className="properties-panel">
      <h2>Mask</h2>
      <MaskControlFields layer={layer} onDispatch={onDispatch} />
    </section>
  );
}

function MaskControlFields({
  layer,
  onDispatch,
}: {
  layer: Layer;
  onDispatch: (command: EditorCommand) => void;
}) {
  const mask = layer.mask;
  if (!mask) return null;
  return (
    <div className="mask-settings">
      <MaskThumbnail layer={layer} size={66} />
      <div className="property-sliders">
        <label>
          <span>Density <output>{Math.round(mask.density * 100)}%</output></span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mask.density}
            onChange={(event) => onDispatch({
              type: "mask/settings",
              layerId: layer.id,
              density: Number(event.target.value),
            })}
          />
        </label>
        <label>
          <span>Feather <output>{mask.feather} px</output></span>
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={mask.feather}
            onChange={(event) => onDispatch({
              type: "mask/settings",
              layerId: layer.id,
              feather: Number(event.target.value),
            })}
          />
        </label>
      </div>
    </div>
  );
}

function ColorPanel({
  foreground,
  background,
  onChange,
}: {
  foreground: string;
  background: string;
  onChange: (foreground: string, background: string) => void;
}) {
  return (
    <section className="properties-panel color-panel">
      <h2>Color</h2>
      <div className="large-color-preview" style={{ backgroundColor: foreground }} />
      <label className="field inline">
        <span>Foreground</span>
        <input type="color" value={foreground} onChange={(event) => onChange(event.target.value, background)} />
        <code>{foreground.toUpperCase()}</code>
      </label>
      <label className="field inline">
        <span>Background</span>
        <input type="color" value={background} onChange={(event) => onChange(foreground, event.target.value)} />
        <code>{background.toUpperCase()}</code>
      </label>
    </section>
  );
}

function LayersPanel({
  layers,
  selectedLayerId,
  expanded,
  onToggleExpanded,
  onDispatch,
}: {
  layers: Layer[];
  selectedLayerId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDispatch: (command: EditorCommand) => void;
}) {
  const selected = layers.find((layer) => layer.id === selectedLayerId);
  const [draggingLayerId, setDraggingLayerId] = useState<string>();
  const [dropTargetId, setDropTargetId] = useState<string>();
  const [renamingLayerId, setRenamingLayerId] = useState<string>();
  const [renameDraft, setRenameDraft] = useState("");

  const beginRename = (layer: Layer) => {
    setRenamingLayerId(layer.id);
    setRenameDraft(layer.name);
  };

  const commitRename = (layer: Layer) => {
    const name = renameDraft.trim();
    if (name && name !== layer.name) {
      onDispatch({ type: "layer/update", layerId: layer.id, changes: { name } });
    }
    setRenamingLayerId(undefined);
  };

  return (
    <section className="layers-panel">
      <button className="panel-heading" onClick={onToggleExpanded} aria-expanded={expanded} aria-controls="layers-panel-content">
        <span>Layers</span>
        {expanded ? <IconChevronDown size={17} /> : <IconChevronUp size={17} />}
      </button>
      {expanded && (
        <div id="layers-panel-content">
          <div className="layer-controls">
            <select
              aria-label="Blend mode"
              disabled={!selected || selected.locked}
              value={selected?.blendMode ?? "normal"}
              onChange={(event) => selected && onDispatch({
                type: "layer/update",
                layerId: selected.id,
                changes: { blendMode: event.target.value as BlendMode },
              })}
            >
              {blendModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
            <label>
              <span>Opacity</span>
              <input
                type="number"
                min={0}
                max={100}
                disabled={!selected || selected.locked}
                value={Math.round((selected?.opacity ?? 1) * 100)}
                onChange={(event) => selected && onDispatch({
                  type: "layer/update",
                  layerId: selected.id,
                  changes: { opacity: Number(event.target.value) / 100 },
                })}
              />
              <span>%</span>
            </label>
          </div>
          <div className="layer-locks">
            <span>Lock:</span>
            <button
              className={selected?.locked ? "active" : ""}
              disabled={!selected}
              aria-label={selected?.locked ? `Unlock ${selected.name}` : `Lock ${selected?.name ?? "selected layer"}`}
              aria-pressed={Boolean(selected?.locked)}
              onClick={() => selected && onDispatch({
              type: "layer/update",
              layerId: selected.id,
              changes: { locked: !selected.locked },
            })}
            >
              <IconLock size={15} />
            </button>
          </div>
          <div className="layer-list" role="list" aria-label="Document layers">
            {[...layers].reverse().map((layer) => (
              <div
                key={layer.id}
                className={[
                  "layer-row",
                  layer.id === selectedLayerId ? "selected" : "",
                  layer.id === draggingLayerId ? "dragging" : "",
                  layer.id === dropTargetId ? "drop-target" : "",
                ].filter(Boolean).join(" ")}
                role="listitem"
                draggable
                onDragStart={(event) => {
                  setDraggingLayerId(layer.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", layer.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (draggingLayerId && draggingLayerId !== layer.id) setDropTargetId(layer.id);
                }}
                onDragLeave={() => setDropTargetId((current) => current === layer.id ? undefined : current)}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggingLayerId ?? event.dataTransfer.getData("text/plain");
                  if (sourceId && sourceId !== layer.id) {
                    onDispatch({ type: "layer/reorder-to", layerId: sourceId, targetLayerId: layer.id });
                  }
                  setDraggingLayerId(undefined);
                  setDropTargetId(undefined);
                }}
                onDragEnd={() => {
                  setDraggingLayerId(undefined);
                  setDropTargetId(undefined);
                }}
                onClick={() => onDispatch({ type: "layer/select", layerId: layer.id })}
              >
                <IconGripVertical className="layer-grip" size={15} aria-hidden="true" />
                <button
                  type="button"
                  className="visibility-toggle"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDispatch({ type: "layer/toggle-visibility", layerId: layer.id });
                  }}
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                >
                  {layer.visible ? <IconEye size={18} /> : <IconEyeOff size={18} />}
                </button>
                {renamingLayerId === layer.id ? (
                  <input
                    className="layer-name-input"
                    autoFocus
                    value={renameDraft}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => commitRename(layer)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") commitRename(layer);
                      if (event.key === "Escape") setRenamingLayerId(undefined);
                    }}
                    aria-label={`Rename ${layer.name}`}
                  />
                ) : (
                  <button
                    type="button"
                    className="layer-select"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      beginRename(layer);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "F2") {
                        event.preventDefault();
                        beginRename(layer);
                      }
                    }}
                  >
                    <LayerThumbnail layer={layer} size={44} />
                    {layer.mask && <MaskThumbnail layer={layer} size={44} />}
                    <span className="layer-name">{layer.name}</span>
                  </button>
                )}
                {layer.locked && <IconLock className="layer-lock" size={15} />}
              </div>
            ))}
          </div>
          <div className="layer-actions">
            <button aria-label="Duplicate layer" title="Duplicate layer" onClick={() => onDispatch({ type: "layer/duplicate", layerId: selectedLayerId, newId: createId("layer") })}>
              <IconCopy size={18} />
            </button>
            <button aria-label="Move layer up" title="Move layer up" onClick={() => onDispatch({ type: "layer/reorder", layerId: selectedLayerId, direction: "up" })}>
              <IconChevronUp size={18} />
            </button>
            <button aria-label="Move layer down" title="Move layer down" onClick={() => onDispatch({ type: "layer/reorder", layerId: selectedLayerId, direction: "down" })}>
              <IconChevronDown size={18} />
            </button>
            <button aria-label="Delete layer" title="Delete layer" disabled={!selected || selected.locked || layers.length === 1} onClick={() => onDispatch({ type: "layer/remove", layerId: selectedLayerId })}>
              <IconTrash size={18} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function LayerThumbnail({ layer, size }: { layer: Layer; size: number }) {
  if (layer.type === "raster") {
    return <img className="layer-thumbnail" src={layer.source} alt="" width={size} height={size} />;
  }
  if (layer.type === "text") {
    return <span className="layer-thumbnail type-thumb" style={{ width: size, height: size }}>T</span>;
  }
  if (layer.type === "shape") {
    return <span className="layer-thumbnail shape-thumb" style={{ width: size, height: size, backgroundColor: layer.fill }} />;
  }
  if (layer.type === "adjustment") {
    return <span className="layer-thumbnail adjustment-thumb" style={{ width: size, height: size }}><IconAdjustmentsHorizontal size={size * 0.55} /></span>;
  }
  return <span className="layer-thumbnail group-thumb" style={{ width: size, height: size }}><IconFolder size={size * 0.55} /></span>;
}

function MaskThumbnail({ layer, size }: { layer: Layer; size: number }) {
  const ref = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = size * 2;
    canvas.height = size * 2;
    context.scale(size / 1000 * 2, size / 1000 * 2);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1000, 1000);
    layer.mask?.strokes.forEach((stroke) => {
      context.globalAlpha = stroke.opacity;
      context.globalCompositeOperation = stroke.mode === "hide" ? "destination-out" : "source-over";
      context.strokeStyle = "#ffffff";
      context.lineWidth = stroke.size;
      context.lineCap = "round";
      context.beginPath();
      if (stroke.points[0]) context.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    });
  }, [layer, size]);
  return <canvas ref={ref} className="layer-thumbnail mask-thumbnail" style={{ width: size, height: size }} aria-label={`${layer.name} mask`} />;
}

function ExportDialog({
  snapshot,
  previewDataUrl,
  onClose,
  onComplete,
}: {
  snapshot: HistoryState["present"];
  previewDataUrl: string;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const [options, setOptions] = useState<ExportOptions>({
    format: "png",
    quality: 0.92,
    width: snapshot.width,
    height: snapshot.height,
    preserveTransparency: true,
    metadata: "strip",
    colorProfile: "srgb",
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const execute = async () => {
    setWorking(true);
    setError(undefined);
    try {
      if (!Number.isFinite(options.width) || !Number.isFinite(options.height)
        || options.width < 1 || options.height < 1
        || options.width > 32_768 || options.height > 32_768) {
        throw new Error("Export dimensions must be between 1 and 32,768 pixels.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(options.width);
      canvas.height = Math.round(options.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the export surface.");
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not prepare the export."));
        image.src = previewDataUrl;
      });
      if (options.format === "jpeg" || !options.preserveTransparency) {
        context.fillStyle = options.format === "jpeg" ? "#ffffff" : snapshot.background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = options.format === "tiff"
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL(mimeTypeFor(options.format), options.quality);
      const result = await exportFlattened(dataUrl, snapshot.name, options);
      if (result.status === "canceled") return;
      onComplete(`${options.format.toUpperCase()} exported`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal title="Export image" onClose={onClose}>
      <div className="export-grid">
        <label className="field">
          <span>Format</span>
          <select
            value={options.format}
            onChange={(event) => setOptions((current) => ({ ...current, format: event.target.value as ExportOptions["format"] }))}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            {window.photoPop && <option value="tiff">TIFF</option>}
          </select>
        </label>
        <label className="field">
          <span>Quality</span>
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.01}
            value={options.quality}
            disabled={options.format === "png" || options.format === "tiff"}
            onChange={(event) => setOptions((current) => ({ ...current, quality: Number(event.target.value) }))}
          />
        </label>
        <label className="field">
          <span>Width</span>
          <input type="number" min={1} max={32768} value={options.width} onChange={(event) => setOptions((current) => ({ ...current, width: Number(event.target.value) }))} />
        </label>
        <label className="field">
          <span>Height</span>
          <input type="number" min={1} max={32768} value={options.height} onChange={(event) => setOptions((current) => ({ ...current, height: Number(event.target.value) }))} />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={options.preserveTransparency}
            disabled={options.format === "jpeg"}
            onChange={(event) => setOptions((current) => ({ ...current, preserveTransparency: event.target.checked }))}
          />
          Preserve transparency
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary" disabled={working} onClick={onClose}>Cancel</button>
        <button className="primary" disabled={working} onClick={() => void execute()}>
          <IconDownload size={17} />
          {working ? "Exporting…" : "Export"}
        </button>
      </div>
    </Modal>
  );
}

function InfoDialogModal({ kind, onClose }: { kind: InfoDialog; onClose: () => void }) {
  if (kind === "shortcuts") {
    const editingShortcuts = [
      ["Command palette", "Ctrl K"],
      ["New document", "Ctrl N"],
      ["Open", "Ctrl O"],
      ["Save", "Ctrl S"],
      ["Save as", "Ctrl Shift S"],
      ["Close document", "Ctrl W"],
      ["Undo / Redo", "Ctrl Z / Ctrl Shift Z"],
      ["Copy merged / Paste image", "Ctrl C / Ctrl V"],
      ["Fit and reset view", "Ctrl 0"],
      ["Zoom", "Ctrl + / Ctrl −"],
      ["Temporarily pan", "Hold Space"],
    ];
    return (
      <Modal title="Keyboard shortcuts" onClose={onClose} wide>
        <div className="shortcut-sections">
          <section>
            <h3>Workspace</h3>
            <div className="shortcut-list">
              {editingShortcuts.map(([label, shortcut]) => (
                <div key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>
              ))}
            </div>
          </section>
          <section>
            <h3>Tools</h3>
            <div className="shortcut-list">
              {tools.map((item) => (
                <div key={item.id}><span>{item.label}</span><kbd>{item.shortcut}</kbd></div>
              ))}
            </div>
          </section>
        </div>
        <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }

  if (kind === "compatibility") {
    const formats = [
      ["PhotoPop", "Open and save", "Lossless editable project"],
      ["PSD", "Import", "Version-1, 8-bit RGB; conversion report always shown"],
      ["PNG / JPEG / WebP", "Open and export", "Flattened image"],
      ["TIFF", "Desktop open and export", "8-bit RGB flattened image"],
      ["SVG", "Import", "Rasterized on open"],
      ["PSB / RAW / CMYK", "Not supported", "Planned after the public alpha"],
    ];
    return (
      <Modal title="Format compatibility" onClose={onClose} wide>
        <p className="dialog-copy">PhotoPop never overwrites an imported PSD. It creates a new unsaved document and reports anything converted or unsupported.</p>
        <div className="format-table" role="table" aria-label="Supported file formats">
          {formats.map(([format, support, detail]) => (
            <div className="format-row" role="row" key={format}>
              <strong role="cell">{format}</strong>
              <span role="cell">{support}</span>
              <span role="cell">{detail}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="About PhotoPop" onClose={onClose}>
      <div className="about-panel">
        <div className="about-mark">P</div>
        <div>
          <h3>PhotoPop 0.1.0-alpha.1</h3>
          <p>A local-first, open-source image editor. No account, cloud dependency, telemetry, generative AI, or paid features.</p>
          <p>Licensed under MPL 2.0. Your documents stay on this computer unless you choose to move them.</p>
        </div>
      </div>
      <div className="modal-actions"><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
function PsdFidelityDialog({
  review,
  editablePreview,
  onChooseEditable,
  onChooseFlattened,
}: {
  review: PsdReview;
  editablePreview: string;
  onChooseEditable: () => void;
  onChooseFlattened: () => void;
}) {
  const measured = review.difference
    && (review.difference.meanChannelDelta > 0 || review.difference.changedPixelRatio > 0);
  return (
    <Modal title="Choose PSD conversion" onClose={onChooseEditable} wide dismissible={false}>
      <p className="dialog-copy">
        PhotoPop found a meaningful visual difference between the editable layer conversion and the PSD&apos;s embedded composite. Choose editability or exact appearance for this document.
      </p>
      <div className="fidelity-previews">
        <figure>
          <img src={editablePreview} alt="PhotoPop editable layer conversion" />
          <figcaption><strong>Editable layers</strong><span>{review.evidence.editableLayerCount} converted layers</span></figcaption>
        </figure>
        <figure>
          <img src={review.evidence.embeddedCompositeDataUrl} alt="PSD embedded composite" />
          <figcaption><strong>Faithful composite</strong><span>Flattened, visually authoritative</span></figcaption>
        </figure>
      </div>
      {measured && review.difference && (
        <p className="fidelity-measure">
          Mean channel difference {review.difference.meanChannelDelta.toFixed(1)} · {Math.round(review.difference.changedPixelRatio * 100)}% of sampled pixels changed
        </p>
      )}
      {review.evidence.fidelityRisks.length > 0 && (
        <details className="fidelity-risks">
          <summary>Why the editable rendering may differ</summary>
          <ul>{review.evidence.fidelityRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
        </details>
      )}
      <div className="modal-actions fidelity-actions">
        <button className="secondary" onClick={onChooseFlattened}>Use faithful flattened copy</button>
        <button className="primary" onClick={onChooseEditable}>Keep editable layers</button>
      </div>
    </Modal>
  );
}
function CompatibilityDialog({ report, rejected, onClose }: { report: CompatibilityReport; rejected: boolean; onClose: () => void }) {
  const groups: Array<[keyof Omit<CompatibilityReport, "sourceName">, string]> = [
    ["imported", "Imported"],
    ["rasterized", "Rasterized"],
    ["flattened", "Flattened"],
    ["substituted", "Substituted"],
    ["unsupported", "Unsupported"],
  ];
  return (
    <Modal title={rejected ? "PSD could not be opened" : "PSD compatibility report"} onClose={onClose} wide>
      <p className="compatibility-intro">
        {rejected ? (
          <>PhotoPop left the current document unchanged because <strong>{report.sourceName}</strong> could not be converted safely.</>
        ) : (
          <><strong>{report.sourceName}</strong> was converted into an untitled PhotoPop document. The source file was not changed.</>
        )}
      </p>
      <div className="compatibility-groups">
        {groups.map(([key, label]) => report[key].length > 0 && (
          <section key={key}>
            <h3>{label} <span>{report[key].length}</span></h3>
            {report[key].map((item, index) => (
              <div className="compatibility-row" key={`${item.feature}-${index}`}>
                <strong>{item.feature}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>{rejected ? "Return to document" : "Continue editing"}</button>
      </div>
    </Modal>
  );
}

async function compareImageDataUrls(
  editableDataUrl: string,
  compositeDataUrl: string,
): Promise<{ meanChannelDelta: number; changedPixelRatio: number }> {
  const size = 128;
  const [editable, composite] = await Promise.all([
    loadComparisonImage(editableDataUrl),
    loadComparisonImage(compositeDataUrl),
  ]);
  const read = (image: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not compare PSD renderings.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return context.getImageData(0, 0, size, size).data;
  };
  const editablePixels = read(editable);
  const compositePixels = read(composite);
  let totalDelta = 0;
  let changedPixels = 0;
  for (let index = 0; index < editablePixels.length; index += 4) {
    const red = Math.abs(editablePixels[index] - compositePixels[index]);
    const green = Math.abs(editablePixels[index + 1] - compositePixels[index + 1]);
    const blue = Math.abs(editablePixels[index + 2] - compositePixels[index + 2]);
    totalDelta += red + green + blue;
    if (Math.max(red, green, blue) >= 12) changedPixels += 1;
  }
  const pixelCount = size * size;
  return {
    meanChannelDelta: totalDelta / (pixelCount * 3),
    changedPixelRatio: changedPixels / pixelCount,
  };
}

function loadComparisonImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode a PSD comparison image."));
    image.src = source;
  });
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const firstBodyControl = dialog.querySelector<HTMLElement>(
        ".modal-body button:not([disabled]), .modal-body input:not([disabled]), .modal-body textarea:not([disabled]), .modal-body select:not([disabled]), .modal-body [tabindex]:not([tabindex='-1'])",
      );
      (firstBodyControl ?? dialog).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && dismissible) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    )).filter((element) => !element.closest("[inert]") && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={dismissible ? onClose : undefined}>
      <section
        ref={dialogRef}
        className={wide ? "modal wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          {dismissible && <button onClick={onClose} aria-label="Close dialog"><IconX size={19} /></button>}
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export { App };
