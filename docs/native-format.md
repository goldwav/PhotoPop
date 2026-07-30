# `.photopop` Native Format

Version 1 is a ZIP package with these entries:

- `manifest.json`: format identity, schema version, application version, and timestamps
- `document.json`: versioned `DocumentSnapshot`
- `preview.png`: optional flattened composite used by file browsers and recovery UI
- `assets/`: optional embedded raster resources

Unknown fields must be preserved where possible. Readers reject unknown major schema versions and may accept newer minor fields. A save is valid only when the package can be reopened and both manifest and document pass validation.

Imported PSD documents always become untitled PhotoPop documents; the source PSD is never overwritten.
