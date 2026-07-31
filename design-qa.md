# PhotoPop Calm Canvas Design QA

## Comparison inputs

- Source visual truth: `D:\PhotoPop\design-reference.png`
- Source pixels: 1487 x 1058
- Implementation: `D:\PhotoPop\artifacts\calm-canvas\06-reference-viewport.jpg`
- Implementation pixels and CSS viewport: 1487 x 1058 at device pixel ratio 1
- Full-view comparison: `D:\PhotoPop\artifacts\calm-canvas\07-reference-comparison.jpg`
- Focused interaction view: `D:\PhotoPop\artifacts\calm-canvas\02-direct-manipulation.jpg`
- Minimum-workspace view: `D:\PhotoPop\artifacts\calm-canvas\05-final-workspace.jpg`
- State: Editorial-Cover, Mask tool active, 50% zoom, Properties and Layers visible
- Density normalization: none; the source and reference-size implementation are equal pixel dimensions

## Findings

- P0: none.
- P1: none.
- P2 found and fixed during this pass:
  - At the 1280 x 720 minimum, the contextual Add layer mask action was clipped below the fixed-height properties region.
  - The first collapsed-inspector treatment left an empty 46 px strip beside the canvas.
  - Polygon transform outlines used stored rectangular bounds even when the polygon points occupied a smaller area, extending the visible selection outline beyond the artwork.
  - Continuous gesture zoom could produce a value not represented by the status-bar zoom menu.

## Fixes and post-fix evidence

- The compact properties layout now fits its layer summary, X/Y/Rotation fields, and Add layer mask action at 1280 x 720. Verified in `02-direct-manipulation.jpg`.
- Collapsing the inspector now gives its full width to the canvas and leaves the persistent status-bar restore control available. Verified in `03-inspector-collapsed.jpg`.
- Polygon selection bounds are calculated from polygon points. The revised implementation was rebuilt and the move-tool state was exercised after the fix.
- Gesture zoom now inserts its live percentage into the zoom menu when it falls between preset values.
- Canvas-focus mode removes the options bar, tool rail, and inspector while preserving the menu, document tab, status, and an explicit exit control. Verified in `04-canvas-focus.jpg`.

## Required fidelity surfaces

- Fonts and typography: Inter remains the application typeface with the selected high-contrast serif confined to editable artwork. Menu, control, inspector, and status hierarchy match the existing PhotoPop direction.
- Spacing and layout rhythm: the compact menu, contextual bar, narrow tool rail, dark pasteboard, spacious right inspector, and status line preserve the selected anatomy. New controls reuse the established spacing and radii.
- Colors and visual tokens: warm chrome, graphite pasteboard, ink text, and coral active states remain unchanged. Motion and new states use the existing semantic colors.
- Image quality and assets: the supplied portrait layer remains sharp at both tested viewports. Existing Tabler icons are used for new inspector and focus controls; no placeholder or handcrafted icon assets were introduced.
- Copy and content: new copy is task-focused and concise: Space-to-pan guidance, command categories, contextual layer type, and accessible show/hide labels.

## Interaction checks

- Command palette opens, exposes grouped command metadata and shortcuts, moves selection with Arrow Down, and closes with Escape while the search input is focused.
- Selecting a layer does not mark the document as changed.
- Double-clicking a layer name opens inline rename; committing the rename updates the layer and marks the document as changed.
- Contextual properties switch from Mask settings to layer identity, position, rotation, and Add layer mask.
- Inspector collapse and restore work from the inspector and persistent status control.
- Canvas-focus mode enters and exits without losing the active document.
- Move-tool selection bounds render on the selected editable layer.
- Unit and package verification: 17 Vitest tests and 4 Sites packaging tests passed.
- Browser console warning/error count: 0.

## Evidence limits

- Browser verification covered the production-shaped local renderer, not the packaged Electron window.
- Trackpad pinch, middle-button pan, animation frame pacing, and reduced-motion behavior still require hardware-level desktop QA.
- The selected visual is a concept reference; the accepted PhotoPop implementation preserves its interface anatomy and art direction while retaining the existing functional sample document.

## Comparison history

1. Initial Calm Canvas pass: blocked by four P2 findings listed above.
2. Compact property layout, full-width inspector collapse, polygon point bounds, and live zoom-value fixes applied.
3. Post-fix implementation rebuilt, re-rendered at 1280 x 720 and 1487 x 1058, compared side by side with the source, and exercised through the primary interaction states.

## Follow-up polish

- P3: measure animation frame pacing and pointer latency in the packaged Windows build.
- P3: consider a small non-modal hint the first time canvas-focus mode is entered.

final result: passed
