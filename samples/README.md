<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# PhotoPop Samples

## Included project

[editorial-mask.photopop](editorial-mask.photopop) is a self-contained 1000×1000
version-1 project for the portrait-mask and editorial-paper workflow. Its raster
source is embedded, so it does not rely on `/assets/` paths or a network
connection.

Published SHA-256:

```text
4e7c6ed266c43cecc18e6152227ddd4674bd3398d6288b1a891ab392fabe2bc4
```

Before editing the repository copy:

1. Open `samples/editorial-mask.photopop` in PhotoPop.
2. Immediately choose **File → Save As**.
3. Save a working copy outside the repository or under a new name.
4. Close and reopen that working copy to confirm the native round trip.

The app also starts with a lighter built-in **Editorial-Cover** document, so a
packaged build can demonstrate the same anatomy without the repository sample.

Suggested exercises:

- Conceal and reveal the portrait through its mask with `B` and `E`.
- Toggle paper and typography layers to check compositing order.
- Change opacity and a supported blend mode, then undo and redo the change.
- Duplicate and reorder a layer.
- Save, close, reopen, and compare the canvas.
- Export PNG and JPEG copies and reopen both in an independent viewer.

## Contributing a sample

Sample submissions must be safe to redistribute under terms compatible with the
repository:

- Use original, public-domain, or clearly licensed assets.
- Include source and license attribution beside the sample.
- Do not include client files, faces without permission, trademarks used as
  product endorsements, or proprietary Photoshop assets.
- Keep the editable `.photopop` project and a flattened PNG reference together.
- State the PhotoPop schema/application version used to create the file.
- Identify which workflow the sample proves: masks, blend modes, transforms,
  adjustments, text, transparency, or recovery.

Rendering fixtures should be minimal and deterministic. A compatibility fixture
may intentionally contain unsupported input, but its expected compatibility
report and redistribution license must be documented.

## Reproduce the included project

Contributors can regenerate the project from the checked-in repository artwork:

```powershell
node scripts/create-sample-project.mjs
```

The generator fixes the document and ZIP timestamps, validates the current
document graph, and verifies byte-identical output across repeated generation.
After regeneration, compare the SHA-256 value deliberately; do not update the
published digest without reviewing the document and flattened preview.
