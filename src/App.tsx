/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
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
  IconLasso,
  IconLetterT,
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
  createHistory,
  createId,
  createTextLayer,
  dispatchHistory,
} from "./core/document";
import {
  deserializeProject,
  exportFlattened,
  mimeTypeFor,
  openImageFile,
  readBrowserAutosave,
  saveProject,
  writeAutosave,
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
  { name: "File", items: ["New", "Open…", "Save", "Save As…", "Export…"] },
  { name: "Edit", items: ["Undo", "Redo", "Copy merged", "Paste image", "Clear selection"] },
  { name: "Image", items: ["Fit to screen", "Rotate canvas left", "Rotate canvas right"] },
  { name: "Layer", items: ["Duplicate layer", "Delete layer", "Move layer up", "Move layer down"] },
  { name: "Select", items: ["Select all", "Clear selection"] },
  { name: "Filter", items: ["Brightness / Contrast", "Hue / Saturation", "Gaussian blur"] },
  { name: "View", items: ["Zoom in", "Zoom out", "Reset rotation"] },
  { name: "Window", items: ["Properties", "Color", "Layers"] },
  { name: "Help", items: ["Keyboard shortcuts", "Format compatibility", "About PhotoPop"] },
];

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
  const [textPoint, setTextPoint] = useState<Point>();
  const [textDraft, setTextDraft] = useState("New text");
  const [exportOpen, setExportOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");
  const [recoverable, setRecoverable] = useState<HistoryState["present"]>();
  const [layersExpanded, setLayersExpanded] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autosaveRef = useRef({
    document: history.present,
    previewDataUrl: "",
    revision: 0,
    savedRevision: 0,
  });
  const snapshot = history.present;
  const selectedLayer = snapshot.layers.find((layer) => layer.id === snapshot.selectedLayerId);

  const dispatch = useCallback((command: EditorCommand) => {
    setHistory((current) => dispatchHistory(current, command));
  }, []);

  const replaceDocument = useCallback((document: HistoryState["present"]) => {
    setHistory(createHistory(document));
    setProjectPath(undefined);
    setZoom(0.5);
    setRotation(0);
  }, []);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? undefined : current), 2800);
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
    };
  }, [history.revision, previewDataUrl, snapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = autosaveRef.current;
      if (
        current.revision === 0
        || current.revision === current.savedRevision
        || !current.previewDataUrl
      ) return;
      current.savedRevision = current.revision;
      void writeAutosave(current.document, current.previewDataUrl)
        .then(() => announce("Recovery copy updated"))
        .catch(() => {
          current.savedRevision = -1;
        });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [announce]);

  const openFiles = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    try {
      const result = await openImageFile(file);
      replaceDocument(result.document);
      setCompatibility(result.report);
      announce(`${file.name} opened`);
    } catch (error) {
      announce(error instanceof Error ? error.message : "PhotoPop could not open that file");
    }
  }, [announce, replaceDocument]);

  const openFromDesktop = useCallback(async () => {
    if (!window.photoPop) {
      fileInputRef.current?.click();
      return;
    }
    const result = await window.photoPop.openImage();
    if (result.canceled || !result.data || !result.name) return;
    const file = new File([new Uint8Array(result.data)], result.name, { type: result.mimeType });
    await openFiles([file]);
  }, [openFiles]);

  const save = useCallback(async (forceDialog = false) => {
    if (!previewDataUrl) return;
    try {
      const path = await saveProject(snapshot, previewDataUrl, forceDialog ? undefined : projectPath);
      if (path) setProjectPath(path);
      announce("Project saved safely");
    } catch (error) {
      announce(error instanceof Error ? error.message : "Save failed");
    }
  }, [announce, previewDataUrl, projectPath, snapshot]);

  const addAdjustment = useCallback((adjustment: Extract<Layer, { type: "adjustment" }>["adjustment"]) => {
    const values: Record<string, number> = adjustment === "brightness-contrast"
      ? { brightness: 6, contrast: 8 }
      : adjustment === "hue-saturation"
        ? { hue: 0, saturation: 12 }
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
    switch (action) {
      case "New":
        replaceDocument(createHistory().present);
        break;
      case "Open…":
        void openFromDesktop();
        break;
      case "Save":
        void save(false);
        break;
      case "Save As…":
        void save(true);
        break;
      case "Export…":
        setExportOpen(true);
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
          selection: { kind: "rect", bounds: { x: 0, y: 0, width: 1000, height: 1000 }, feather: 0 },
        });
        break;
      case "Fit to screen":
        setZoom(0.5);
        break;
      case "Zoom in":
        setZoom((value) => Math.min(2, value + 0.1));
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
      case "Gaussian blur":
        addAdjustment("blur");
        break;
      case "Properties":
        setInspectorTab("properties");
        break;
      case "Color":
        setInspectorTab("color");
        break;
      case "Layers":
        setLayersExpanded(true);
        break;
      case "Keyboard shortcuts":
        setCommandOpen(true);
        break;
      case "Format compatibility":
        announce("Compatibility details are documented in docs/format-compatibility.md");
        break;
      case "About PhotoPop":
        announce("PhotoPop 0.1 alpha · MPL 2.0 · local-first");
        break;
    }
  }, [addAdjustment, announce, copyComposite, dispatch, openFromDesktop, pasteClipboardImage, replaceDocument, save, snapshot.selectedLayerId]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
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
      if (event.key === "Escape") {
        setActiveMenu(undefined);
        setCommandOpen(false);
        setTextPoint(undefined);
        setExportOpen(false);
        return;
      }
      const match = tools.find((candidate) => {
        const shortcut = candidate.shortcut.toLowerCase();
        return shortcut === event.key.toLowerCase()
          || (shortcut.startsWith("shift+") && event.shiftKey && shortcut.endsWith(event.key.toLowerCase()));
      });
      if (match) setTool(match.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copyComposite, pasteClipboardImage, save]);

  const commandItems = useMemo(
    () => menuDefinitions.flatMap((menu) => menu.items).filter((item, index, all) => all.indexOf(item) === index),
    [],
  );
  const filteredCommands = commandItems.filter((item) =>
    item.toLowerCase().includes(commandSearch.toLowerCase()),
  );

  const applyText = () => {
    if (!textPoint) return;
    dispatch({ type: "layer/add", layer: createTextLayer(textDraft, textPoint, snapshot.foreground) });
    setTextPoint(undefined);
    setTextDraft("New text");
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void openFiles(event.target.files);
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
      className="app-shell"
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
                <div className="menu-popover">
                  {menu.items.map((item) => (
                    <button key={item} onClick={() => executeAction(item)}>{item}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <button className="command-button" onClick={() => setCommandOpen(true)}>
          <IconSearch size={15} />
          <span>Search commands</span>
          <kbd>Ctrl K</kbd>
        </button>
      </header>

      <OptionsBar
        tool={tool}
        brush={brush}
        setBrush={setBrush}
        selectionExists={snapshot.selection.kind !== "none"}
        applyCrop={applyCrop}
        clearSelection={() => dispatch({ type: "selection/clear" })}
      />

      <section className="workspace">
        <aside className="tool-rail" aria-label="Editing tools">
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
            <button className="document-tab active">
              <span>{snapshot.name}</span>
              {history.revision > 0 && <span className="unsaved-dot" aria-label="Unsaved changes" />}
              <IconX size={15} />
            </button>
          </div>
          <div className="canvas-frame">
            <div className="ruler ruler-horizontal">
              {[0, 500, 1000, 1500, 2000, 2500, 3000].map((mark) => <span key={mark}>{mark}</span>)}
            </div>
            <div className="ruler ruler-vertical">
              {[0, 500, 1000, 1500, 2000, 2500, 3000].map((mark) => <span key={mark}>{mark}</span>)}
            </div>
            <EditorCanvas
              document={snapshot}
              tool={tool}
              zoom={zoom}
              rotation={rotation}
              brush={brush}
              onDispatch={dispatch}
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
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={inspectorTab === "properties"}
              className={inspectorTab === "properties" ? "active" : ""}
              onClick={() => setInspectorTab("properties")}
            >
              Properties
            </button>
            <button
              role="tab"
              aria-selected={inspectorTab === "color"}
              className={inspectorTab === "color" ? "active" : ""}
              onClick={() => setInspectorTab("color")}
            >
              Color
            </button>
          </div>
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
          <LayersPanel
            layers={snapshot.layers}
            selectedLayerId={snapshot.selectedLayerId}
            expanded={layersExpanded}
            onToggleExpanded={() => setLayersExpanded((value) => !value)}
            onDispatch={dispatch}
          />
        </aside>

        <footer className="status-bar">
          <div className="zoom-controls">
            <button onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))} aria-label="Zoom out">−</button>
            <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Canvas zoom">
              <option value={0.25}>25%</option>
              <option value={0.5}>50%</option>
              <option value={0.75}>75%</option>
              <option value={1}>100%</option>
              <option value={1.5}>150%</option>
            </select>
            <button onClick={() => setZoom((value) => Math.min(2, value + 0.1))} aria-label="Zoom in">+</button>
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
        </footer>
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
      {recoverable && (
        <div className="recovery-banner">
          <span>A recoverable copy of <strong>{recoverable.name}</strong> is available.</span>
          <button onClick={() => {
            replaceDocument(recoverable);
            setRecoverable(undefined);
            announce("Recovery copy opened");
          }}>Recover</button>
          <button onClick={() => setRecoverable(undefined)}>Dismiss</button>
        </div>
      )}
      {compatibility && (
        <CompatibilityDialog report={compatibility} onClose={() => setCompatibility(undefined)} />
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
      {commandOpen && (
        <div className="modal-backdrop command-backdrop" onMouseDown={() => setCommandOpen(false)}>
          <div className="command-palette" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-search">
              <IconSearch size={19} />
              <input
                autoFocus
                placeholder="Type a command…"
                value={commandSearch}
                onChange={(event) => setCommandSearch(event.target.value)}
                onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter" && filteredCommands[0]) executeAction(filteredCommands[0]);
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div className="command-list">
              {filteredCommands.slice(0, 12).map((item, index) => (
                <button key={item} className={index === 0 ? "selected" : ""} onClick={() => executeAction(item)}>
                  <span>{item}</span>
                  {index === 0 && <span className="command-enter">Enter</span>}
                </button>
              ))}
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
  applyCrop: () => void;
  clearSelection: () => void;
}

function OptionsBar({ tool, brush, setBrush, selectionExists, applyCrop, clearSelection }: OptionsBarProps) {
  const activeTool = tools.find((candidate) => candidate.id === tool);
  const ToolIcon = activeTool?.icon ?? IconPointer;
  return (
    <div className="options-bar">
      <div className="active-tool-label">
        <ToolIcon size={22} stroke={1.8} />
        <strong>{tool === "brush" ? "Mask" : activeTool?.label}</strong>
      </div>
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
          <ToolbarField label="Flow">
            <select value={0.4} disabled aria-label="Flow is fixed at 40 percent">
              <option value={0.4}>40%</option>
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
          <button className="icon-control" title="Brush settings">
            <IconAdjustmentsHorizontal size={18} />
          </button>
        </>
      ) : (
        <div className="options-message">
          {tool === "move" && "Drag the selected layer to reposition it."}
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
  const mask = layer.mask;
  return (
    <section className="properties-panel">
      <h2>{mask ? "Mask" : "Layer"}</h2>
      <div className="mask-settings">
        {mask ? <MaskThumbnail layer={layer} size={66} /> : <LayerThumbnail layer={layer} size={66} />}
        <div className="property-sliders">
          <label>
            <span>Density <output>{Math.round((mask?.density ?? 1) * 100)}%</output></span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mask?.density ?? 1}
              onChange={(event) => onDispatch({ type: "mask/settings", layerId: layer.id, density: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Feather <output>{mask?.feather ?? 0} px</output></span>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={mask?.feather ?? 0}
              onChange={(event) => onDispatch({ type: "mask/settings", layerId: layer.id, feather: Number(event.target.value) })}
            />
          </label>
        </div>
      </div>
      {!mask && (
        <button className="secondary add-mask" onClick={() => onDispatch({ type: "mask/ensure", layerId: layer.id })}>
          Add layer mask
        </button>
      )}
    </section>
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
  return (
    <section className="layers-panel">
      <button className="panel-heading" onClick={onToggleExpanded}>
        <span>Layers</span>
        {expanded ? <IconChevronDown size={17} /> : <IconChevronUp size={17} />}
      </button>
      {expanded && (
        <>
          <div className="layer-controls">
            <select
              aria-label="Blend mode"
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
            <button className={selected?.locked ? "active" : ""} onClick={() => selected && onDispatch({
              type: "layer/update",
              layerId: selected.id,
              changes: { locked: !selected.locked },
            })}>
              <IconLock size={15} />
            </button>
          </div>
          <div className="layer-list">
            {[...layers].reverse().map((layer) => (
              <button
                key={layer.id}
                className={layer.id === selectedLayerId ? "layer-row selected" : "layer-row"}
                onClick={() => onDispatch({ type: "layer/select", layerId: layer.id })}
              >
                <span
                  className="visibility-toggle"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDispatch({ type: "layer/toggle-visibility", layerId: layer.id });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onDispatch({ type: "layer/toggle-visibility", layerId: layer.id });
                    }
                  }}
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                >
                  {layer.visible ? <IconEye size={18} /> : <IconEyeOff size={18} />}
                </span>
                <LayerThumbnail layer={layer} size={44} />
                {layer.mask && <MaskThumbnail layer={layer} size={44} />}
                <span className="layer-name">{layer.name}</span>
                {layer.locked && <IconLock className="layer-lock" size={15} />}
              </button>
            ))}
          </div>
          <div className="layer-actions">
            <button title="New group" onClick={() => onDispatch({
              type: "layer/add",
              layer: {
                id: createId("group"),
                type: "group",
                name: "Group",
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: "normal",
                transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
              },
            })}>
              <IconFolder size={19} />
            </button>
            <button title="Duplicate layer" onClick={() => onDispatch({ type: "layer/duplicate", layerId: selectedLayerId, newId: createId("layer") })}>
              <IconCopy size={18} />
            </button>
            <button title="Move layer up" onClick={() => onDispatch({ type: "layer/reorder", layerId: selectedLayerId, direction: "up" })}>
              <IconChevronUp size={18} />
            </button>
            <button title="Move layer down" onClick={() => onDispatch({ type: "layer/reorder", layerId: selectedLayerId, direction: "down" })}>
              <IconChevronDown size={18} />
            </button>
            <button title="Delete layer" onClick={() => onDispatch({ type: "layer/remove", layerId: selectedLayerId })}>
              <IconTrash size={18} />
            </button>
          </div>
        </>
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

  const execute = async () => {
    setWorking(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, options.width);
      canvas.height = Math.max(1, options.height);
      const context = canvas.getContext("2d");
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not prepare the export."));
        image.src = previewDataUrl;
      });
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = options.format === "tiff"
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL(mimeTypeFor(options.format), options.quality);
      await exportFlattened(dataUrl, snapshot.name, options);
      onComplete(`${options.format.toUpperCase()} exported`);
    } catch (error) {
      onComplete(error instanceof Error ? error.message : "Export failed");
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
          <input type="number" value={options.width} onChange={(event) => setOptions((current) => ({ ...current, width: Number(event.target.value) }))} />
        </label>
        <label className="field">
          <span>Height</span>
          <input type="number" value={options.height} onChange={(event) => setOptions((current) => ({ ...current, height: Number(event.target.value) }))} />
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
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={working} onClick={() => void execute()}>
          <IconDownload size={17} />
          {working ? "Exporting…" : "Export"}
        </button>
      </div>
    </Modal>
  );
}

function CompatibilityDialog({ report, onClose }: { report: CompatibilityReport; onClose: () => void }) {
  const groups: Array<[keyof Omit<CompatibilityReport, "sourceName">, string]> = [
    ["imported", "Imported"],
    ["rasterized", "Rasterized"],
    ["flattened", "Flattened"],
    ["substituted", "Substituted"],
    ["unsupported", "Unsupported"],
  ];
  return (
    <Modal title="PSD compatibility report" onClose={onClose} wide>
      <p className="compatibility-intro">
        <strong>{report.sourceName}</strong> was converted into an untitled PhotoPop document. The source file was not changed.
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
        <button className="primary" onClick={onClose}>Continue editing</button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close dialog"><IconX size={19} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export { App };
