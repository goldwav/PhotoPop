<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Public Alpha Boundaries

PhotoPop’s alpha is a Windows-first validation of one complete, local
layered-compositing workflow. It is not a drop-in replacement for every
Photoshop workflow.

## Intended use

- Personal experiments and non-destructive editing of copied source material
- Layered raster compositions in an 8-bit sRGB document
- Native `.photopop` projects that can be reopened without flattening
- Flattened PNG, JPEG, WebP, and desktop TIFF delivery images
- Evaluation of version-1, 8-bit RGB PSD imports with an explicit compatibility
  report

## Not promised in this alpha

- PSD export or lossless PSD round trips
- PSB
- CMYK, Lab, indexed-color, duotone, or multichannel editing
- 16-bit or 32-bit-per-channel documents
- Editable smart objects, placed content, Photoshop effects, or arbitrary vector
  paths
- Editable imported PSD text or vector content when interpretation is unsafe
- RAW development, soft proofing, spot colors, or print-production separations
- Source ICC-profile or EXIF/IPTC/XMP metadata preservation
- Advanced typography, variable-font controls, or guaranteed font substitution
- Third-party plugins or a stable plugin SDK
- macOS or Linux release support
- Cloud documents, accounts, telemetry, generative AI, or paid features

## Current engineering boundary

The alpha compositor is the deterministic Canvas 2D reference path. The
CanvasKit/OffscreenCanvas tiled worker remains gated on rendering fixtures and
Windows GPU validation. This keeps the current output inspectable, but large
documents may not yet meet the planned responsiveness targets.

A deterministic 4096×4096, 30-layer CPU reference benchmark records timing,
memory, environment, and output-digest evidence for regression tracking. It does
not exercise the interactive viewport or input pipeline. No validated installed-
app integrated-GPU FPS or brush-latency measurements are published yet; the 30
FPS pan/zoom, 60 FPS target, and sub-25 ms p95 brush-latency figures remain
release gates rather than current guarantees. The evidence contract is documented
in [Windows release gates](../tests/e2e/README.md).

## Release evidence required

A public artifact should not be described as release-ready unless all of the
following refer to that exact packaged build:

- Repository tests, type checking, production build, and packaging tests pass.
- The installer, portable executable, and ZIP have published SHA-256 checksums.
- The installed and portable apps launch on the Windows reference system.
- Open, edit, save, force-quit, recover, reopen, and every advertised export
  format pass end-to-end.
- There are no known data-loss defects or unresolved critical/high security
  findings.
- Unsupported behaviors are published in this document and the
  [format compatibility matrix](format-compatibility.md).

An unsigned alpha must retain the Windows reputation warning in the release
notes. A green browser preview or source build is not evidence that a packaged
desktop artifact passed these gates.
