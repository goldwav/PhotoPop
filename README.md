# PhotoPop

PhotoPop is a local-first, open-source desktop image editor for layered raster
compositing. The Windows alpha is deliberately narrow: it aims to make opening,
editing, recovering, saving, and exporting a document dependable before pursuing
feature-count parity with established professional editors.

> [!WARNING]
> PhotoPop is pre-release software. Keep an independent copy of important source
> images and do not make an alpha build the only home of irreplaceable work.

## What the alpha includes

- Raster, text, basic shape, group, adjustment, and mask-capable layers
- Move, selection, mask brush/reveal, fill, gradient, crop, eyedropper, text,
  rectangle, and ellipse tools
- Undo/redo, layer visibility, opacity, supported blend modes, duplication, and
  reordering
- PNG, JPEG, WebP, SVG-as-raster, desktop TIFF, and version-1 8-bit RGB PSD import
- Native `.photopop` project save/open, 30-second recovery snapshots, flattened
  image export, and a retained previous-save backup in the desktop build
- A sandboxed Electron desktop shell with no account, cloud dependency,
  telemetry, or generative AI

PSD import is a conversion, not round-trip editing. Unsupported content is
rasterized, substituted, flattened, or reported; PhotoPop never overwrites the
source PSD. When an embedded composite is available, PhotoPop samples the editable
rendering against it and offers editable layers or a faithful flattened copy when
they materially differ. See the
[format compatibility matrix](docs/format-compatibility.md) and
[public-alpha boundaries](docs/public-alpha.md) before using the editor for
production work.

## Start here

- [First-run and editing guide](docs/onboarding.md)
- [Keyboard shortcuts](docs/shortcuts.md)
- [Recovery and backup guide](docs/recovery.md)
- [Sample-project guide](samples/README.md)

The browser build is a development preview. Use a packaged desktop artifact when
evaluating native open/save dialogs, TIFF handling, recovery storage, clipboard
integration, and Windows installation.

## Windows alpha warning

Alpha installers and portable executables are intentionally **unsigned**. Windows
SmartScreen or Microsoft Defender may show an “unrecognized app” or reputation
warning even when the artifact is authentic.

Before running an alpha:

1. Obtain it only from the project’s release artifacts.
2. Compare its SHA-256 digest with the adjacent `SHA256SUMS.txt`.
3. Proceed through a Windows reputation warning only when the download source and
   checksum both match what the project published.

Do not disable system-wide security controls to install PhotoPop. Stable releases
require a code-signing certificate before publication.

## Development

PhotoPop uses the repository-pinned pnpm release.

```powershell
pnpm install
pnpm dev
```

Run the desktop shell with `pnpm dev:desktop`. Run the complete repository gate
with `pnpm verify`.

Windows release automation produces an assisted installer, a portable executable,
a portable ZIP, and SHA-256 checksums. A green source build does not replace an
installed-artifact smoke test.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a large feature or
document-format change. Use the repository’s issue forms for reproducible bugs,
data-safety incidents, format compatibility, and workflow proposals.

Technical references:

- [Architecture](docs/architecture.md)
- [Native `.photopop` format specification](docs/native-format.md)
- [Format compatibility matrix](docs/format-compatibility.md)
- [Public-alpha release boundaries](docs/public-alpha.md)

Suspected security vulnerabilities must be reported privately according to
[SECURITY.md](SECURITY.md), never through a public issue.

## License

PhotoPop is licensed under the Mozilla Public License 2.0. See [LICENSE](LICENSE). Bundled artwork and third-party visual dependencies are documented in [ASSETS.md](ASSETS.md).
