<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Getting Started

PhotoPop’s Windows alpha opens directly into an editorial collage so that the
canvas, mask workflow, layers, properties, color, and history surfaces can be
explored without creating an account or downloading a sample.

## Before the first launch

1. Keep a separate copy of every source image. PhotoPop is alpha software.
2. Download the installer, portable executable, or portable ZIP from the
   project’s release artifacts.
3. Verify the artifact against the published `SHA256SUMS.txt`.
4. Expect Windows SmartScreen to warn that unsigned alpha artifacts are
   unrecognized. Continue only when both the source and checksum are trusted.

The installer adds normal Windows shortcuts. The portable executable and ZIP can
be run without installation; their preferences and recovery data still use the
current Windows user profile.

## Learn the workspace

- The **top bar** contains menus and controls for the active tool.
- The **left rail** selects editing tools.
- The **center canvas** is the document; pan and zoom without changing pixels.
- The **right inspector** contains Properties, Color, and Layers.
- The **bottom status area** shows zoom and canvas-focus controls.
- Press **Ctrl+K** to search available commands without navigating menus.

The canvas is intentionally dominant. Canvas Focus recedes optional chrome while
keeping essential document state visible.

## A safe first workflow

1. Choose **File → Save As** and save the starter collage as a `.photopop`
   project before experimenting.
2. Select the portrait layer and its mask thumbnail.
3. Use **Brush mask (B)** to conceal an area and **Reveal mask (E)** to bring it
   back.
4. Change layer visibility or opacity and use **Ctrl+Z** / **Ctrl+Shift+Z** to
   verify undo and redo.
5. Save with **Ctrl+S**.
6. Use **File → Export** for a flattened delivery image. Reopen the exported file
   in another viewer before sending or deleting source material.

For a self-contained 3000×3000 native project and a focused exercise list, use
[the sample-project guide](../samples/README.md).

## Open or import a file

Use **File → Open**, the open control, or drag a supported file into the
workspace. PhotoPop opens `.photopop` projects and imports supported image
formats as documents.

- PNG, JPEG, WebP, and self-contained SVG are raster imports.
- TIFF import is available in the packaged desktop app.
- PSD import always creates a converted, unsaved PhotoPop document.
- A PSD compatibility report explains anything imported, rasterized,
  substituted, flattened, or unsupported. When the editable rendering materially
  differs from the embedded composite, choose editable layers or a faithful
  flattened copy before continuing.

Review [format compatibility](format-compatibility.md) before relying on PSD,
color-profile, metadata, or high-bit-depth behavior.

## Save versus export

**Save** writes the editable document graph to `.photopop`. Desktop saves use a
sibling temporary file, validate the package, replace the destination, and retain
the previous version as `.bak`.

**Export** renders the document into a flattened PNG, JPEG, WebP, or desktop TIFF.
Export does not preserve editable layers. Exported files are normalized to the
alpha’s 8-bit sRGB pipeline; source metadata is not a round-trip guarantee.

## If the app closed unexpectedly

PhotoPop writes a recovery snapshot about every 30 seconds after an edited
document has a renderable preview. On the next launch, use the recovery banner
before starting new work. See [Recovery and Backups](recovery.md) for manual
recovery steps and the exact limits of autosave.

## Privacy

PhotoPop is local-first. It has no account, cloud dependency, usage telemetry, or
crash-report upload. A project, imported image, recovery snapshot, or diagnostic
file leaves the computer only when the user deliberately moves or shares it.
