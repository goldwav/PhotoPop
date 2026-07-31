# `.photopop` Native Format

This document describes the version-1 format written by PhotoPop
`0.1.0-alpha.1`. The extension is `.photopop`; the media type used by the app is
`application/x-photopop`.

## Container

A project is a ZIP archive using DEFLATE compression. Version 1 defines these
entries:

| Entry | Required | Content |
| --- | --- | --- |
| `manifest.json` | Yes | Container identity, schema version, application version, document ID, and timestamps |
| `document.json` | Yes | The complete versioned `DocumentSnapshot` |
| `preview.png` | No | Flattened PNG used by recovery and future file-browser previews |
| `assets/` | Reserved | Future embedded raster/resource entries; the alpha writer does not emit this directory |

Readers use the exact root entry names and do not extract the archive into the
filesystem. Entry names are case-sensitive.

## Manifest

The version-1 writer emits UTF-8 JSON with this shape:

```json
{
  format: photopop,
  schemaVersion: 1,
  applicationVersion: 0.1.0-alpha.1,
  documentId: document-...,
  createdAt: 2026-07-30T12:00:00.000Z,
  savedAt: 2026-07-30T12:05:00.000Z
}
```

`format`, `schemaVersion`, and `documentId` are validated before the desktop app
accepts a staged save or recovery package. `documentId` must equal the ID in
`document.json`.

## Document graph

`document.json` is a UTF-8 JSON `DocumentSnapshot`. Version 1 contains:

- `schemaVersion: 1`, a document `id`, a display `name`, and ISO-8601 creation and
  update timestamps
- positive integer canvas `width` and `height`
- `colorSpace: srgb` and `bitDepth: 8`
- foreground/background colors, selection state, selected-layer ID, and an
  ordered layer array
- raster, group, text, shape, and adjustment layers
- visibility, lock state, opacity, supported blend mode, transform, optional
  parent group, and optional PhotoPop stroke mask on each applicable layer

Raster `source` values are currently embedded data/resource URLs in the document
graph. The planned 512×512 lossless tile/resource storage is not yet the active
version-1 writer. Implementations must not assume the reserved `assets/` layout is
populated.

A conforming graph has a selected layer that exists, unique layer IDs, known layer
types, and parent references that identify a different group layer. PhotoPop’s
renderer additionally validates finite/bounded values and type-specific fields.
The privileged staged-save validator enforces the basic document, canvas, ID, and
layer envelope before replacing an existing destination.

## Forward compatibility

Readers reject unknown major schema versions. Unknown fields should be preserved
when a reader can safely do so; they must not be interpreted as supported
behavior. A newer writer that changes required semantics must increment the
schema version rather than silently reusing version 1.

## Validation and resource limits

The desktop boundary validates ZIP central-directory metadata before inflating
required entries. It rejects malformed/encrypted packages, duplicate required
entries, excessive entry counts, unsafe compression ratios, oversized manifest
or document JSON, mismatched document IDs, and invalid document graphs.

The privileged desktop boundary applies these alpha ceilings:

- 512 MiB compressed package payload
- 4,096 ZIP entries
- 768 MiB total declared expanded content
- 512 MiB for any one entry
- 64 KiB for `manifest.json`
- 256 MiB for `document.json`
- 200:1 declared compression ratio for entries larger than 1 MiB

ZIP64 metadata may be read only when it is complete and internally consistent;
ZIP64-scale authoring is not an advertised alpha capability. These limits are
decompression-safety budgets, not target project sizes.

## Atomic desktop save

Desktop save uses this sequence:

1. Validate the requested absolute `.photopop` destination and payload size.
2. Write a uniquely named sibling temporary file.
3. Read the staged bytes back and validate the container, manifest, and document
   graph.
4. Move an existing destination to the one-generation `.bak` sibling.
5. Rename the validated temporary file to the destination.
6. Restore the backup if replacement fails, and remove the staged temporary file
   on failure.

A `.bak` file is a recovery aid, not document history. See
[Recovery and Backups](recovery.md).

## Imported sources

Imported PSD documents always become unsaved PhotoPop documents. Their source PSD
is never overwritten. Other raster imports likewise become document content; use
`.photopop` to retain the resulting editable PhotoPop structure.
