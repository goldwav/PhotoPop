# PhotoPop

PhotoPop is a local-first, open-source desktop image editor for design professionals. The public alpha focuses on a trustworthy layered-compositing workflow rather than feature-count parity with proprietary editors.

## Alpha capabilities

- Layered raster, text, vector-shape, group, and adjustment document model
- Move, selection, brush-mask, eraser, fill, gradient, crop, eyedropper, text, rectangle, and ellipse tools
- Undo/redo, layer visibility, opacity, blend modes, duplication, reordering, and masks
- PNG, JPEG, WebP, SVG, and common 8-bit RGB PSD import
- `.photopop` project save/open, autosave snapshots, recovery, and flattened export
- Sandboxed Electron desktop wrapper plus a browser preview for development

PhotoPop does not yet promise PSB, CMYK, 16/32-bit channels, editable smart objects, or PSD export. Imported PSD features that cannot be represented are reported instead of silently discarded.

## Development

```powershell
pnpm install
pnpm dev
```

Run the desktop shell with `pnpm dev:desktop`. Verify the repository with `pnpm verify`.

Windows release jobs produce an assisted installer, a portable executable, a portable ZIP, and SHA-256 checksums. Alpha artifacts are intentionally unsigned and may trigger a Windows reputation warning. Stable releases require a code-signing certificate before publication.

## License

PhotoPop is licensed under the Mozilla Public License 2.0. See [LICENSE](LICENSE).
