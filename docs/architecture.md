# Architecture

PhotoPop separates the product shell, document engine, renderer, and privileged desktop operations.

## Renderer

React owns menus, tools, panels, keyboard routing, and accessibility. The document engine is framework-independent: every mutation is a serializable `EditorCommand`, producing a versioned `DocumentSnapshot` and bounded undo entry.

The active alpha viewport uses a deterministic Canvas 2D reference compositor. The repository includes 512×512 tile addressing, dirty-command bounds, the documented undo-memory budget, and CanvasKit as the planned GPU backend. Activating the OffscreenCanvas worker remains a release-gated follow-up: it will replace the reference compositor only after GPU golden tests pass on the Windows reference matrix.

## Desktop boundary

Electron runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. The preload exposes only open/import, atomic save, export, recent files, clipboard, font discovery, and preferences. IPC payloads and file extensions are validated in the main process.

## Data safety

Native saves are versioned ZIP `.photopop` packages. Desktop writes go to a
sibling temporary file, are read back for manifest and document-graph validation,
and then replace the destination atomically. The previous file is retained as
`.bak`. Autosave stores the latest recoverable package every 30 seconds after a
mutation. The alpha’s 512 MiB payload limit means ZIP64-scale projects are not yet
an advertised capability.

Recovery candidates are cleared after a successful matching save or an explicit
dismissal. See [Recovery and Backups](recovery.md) for user-facing behavior and
manual recovery steps.
