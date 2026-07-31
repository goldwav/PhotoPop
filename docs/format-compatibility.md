# Format Compatibility

PhotoPop edits 8-bit sRGB documents. “Import” means converting a source into a
PhotoPop document; it does not imply that every source feature remains editable
or can be written back to the source format.

| Format | Open/import | Save/export | Alpha behavior |
| --- | --- | --- | --- |
| `.photopop` | Yes | Yes | Native layered version-1 project. Use this format to retain editable PhotoPop structure. |
| PNG | Yes | Yes | Raster import; flattened export with alpha-channel support. |
| JPEG | Yes | Yes | Raster import; opaque flattened export with configurable quality. |
| WebP | Yes | Yes | Raster import; flattened export with quality and alpha-channel support. |
| TIFF | Desktop only | Desktop only | Decoded and encoded through libvips/Sharp; imported TIFF is normalized before entering the renderer. |
| SVG | Yes | No | Self-contained SVG is rasterized on import; vector editability is not retained. |
| PSD | Version 1, 8-bit RGB | No | Converted into a new unsaved PhotoPop document. See the PSD section below. |
| PSB | No | No | Unsupported in the alpha. |
| CMYK, Lab, indexed, duotone, or multichannel | No editable guarantee | No | Outside the alpha color pipeline. |
| 16/32-bit channels | No | No | Documents and exports use the 8-bit pipeline. |
| RAW camera formats | No | No | No RAW development pipeline. |

## PSD conversion

The editable target is a version-1, 8-bit RGB PSD. PSB (header version 2),
non-RGB color modes, and non-8-bit channels are rejected before bitmap decode
with an explicit compatibility report; PhotoPop does not silently convert them.

PhotoPop preserves groups, raster layer pixels, visibility, opacity, and these
blend modes when they can be interpreted safely: Normal, Darken, Multiply,
Lighten, Screen, Color Dodge, Color Burn, Overlay, Soft Light, and Hard Light.

- Supported PSD blend modes map to PhotoPop blend modes.
- Unsupported blend modes fall back to Normal and are listed as substitutions.
- Pixel layer masks are baked into the imported raster pixels when safely
  representable. They are not presented as falsely editable PhotoPop masks.
- Mask feather metadata is reported but is not reproduced. Group masks are not
  represented by the alpha’s flat group compositor.
- Text, vector, and placed/smart-object content use cached per-layer pixels when
  available, become raster content, and are reported.
- PSD adjustment semantics, layer effects, and clipping relationships are not
  interpreted and are listed as unsupported; cached pixels may omit an effect.
- When an embedded composite is available, PhotoPop compares a deterministic
  128×128 sample with the editable rendering. If the difference crosses the
  alpha’s materiality threshold, it shows both previews and asks the user to keep
  editable layers or open the visually faithful flattened composite.
- If sampled comparison cannot run but the import has known fidelity risks,
  PhotoPop still presents the choice rather than silently accepting the editable
  rendering.
- If no safe layer interpretation is available, PhotoPop may open the embedded
  composite as a flattened document and reports that outcome.

Opening a PSD never overwrites it. The converted document has no PSD save path and
must be saved as `.photopop` or exported to a flattened format.

## Compatibility report terms

Every PSD import attempt produces a report, including a safely rejected file:

- **Imported** — represented with editable PhotoPop structure.
- **Rasterized** — visually preserved as pixels but no longer editable in its
  original form.
- **Substituted** — replaced with the documented PhotoPop fallback.
- **Flattened** — preserved only in a composite image.
- **Unsupported** — not safely represented; the detail explains the boundary.

Review the report and the canvas before discarding or moving the source PSD.

The parser applies safety budgets of 512 MiB compressed input, 30,000 pixels per
axis, 500 layers, and 2 GiB estimated decoded pixels. These are rejection limits,
not performance targets.

## Color and metadata

The alpha editing pipeline is 8-bit sRGB. It does not promise source ICC-profile,
EXIF, IPTC, or XMP round trips, CMYK conversion accuracy, soft proofing, or print
separations. Export is for flattened visual delivery; keep the source file when
its profile or metadata matters.

## Resource limits

The desktop boundary rejects individual import, project, clipboard, or export
payloads above 512 MiB. Desktop TIFF decoding also limits input to 100 million
pixels. These are safety ceilings, not a claim that files near the limits will
meet the planned interaction-performance targets.

See [Public Alpha Boundaries](public-alpha.md) for the complete unsupported list.
