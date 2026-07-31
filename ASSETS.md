# PhotoPop asset provenance

PhotoPop does not include Adobe artwork, icons, branding, or proprietary sample files.
Unless noted otherwise, project-created image assets in this repository are distributed with PhotoPop under the MPL-2.0 license. Third-party packages retain their own licenses.

## Project-created artwork

| Asset | Origin | SHA-256 |
| --- | --- | --- |
| `public/assets/portrait-layer.png` | Generated specifically for PhotoPop on 2026-07-30 using OpenAI built-in image generation, then edited with the same built-in mode to replace only the backdrop with warm paper-gray. No reference image or existing person was supplied. | `b14081dde5353c320034905a6be6f817b578d8ebbb679855def735d89e6ecaca` |
| `public/assets/editorial-cover.png` | Deterministically composed from the PhotoPop portrait plus original paper, coral, and masthead SVG layers by `scripts/generate-brand-assets.mjs`. | `916795dc90f2c71884e1f8a42fbb01d0f3c5eff175f357f645fe6dbac9dc307c` |
| `build/icon.png` | Original PhotoPop application mark generated deterministically from repository-owned SVG geometry by `scripts/generate-brand-assets.mjs`. | `f04dce88a47b157e2cf565d1429fe12266923031a4a7eb7dd8e3c6b55578e09f` |
| `samples/editorial-mask.photopop` | Reproducible native sample assembled by `scripts/create-sample-project.mjs` from the project-created artwork above. | `00272324dc9ffe20f9a0828dd19a56b55a9057c83d4cff49966419fb49438f28` |

### Image-generation prompt record

The initial built-in generation prompt was:

> Use case: photorealistic-natural. Asset type: bundled sample artwork for an open-source desktop image editor. Create an original editorial studio portrait of a fictional adult model for a professional paper-collage design sample. Use a seamless deep graphite-gray studio backdrop; one fictional adult with short textured dark hair, head and upper shoulders, a calm direct expression, and a contemporary black crew-neck top. Use refined high-fashion editorial photography, natural skin texture, subtle film grain, and realistic optics. Frame a square portrait with the subject centered slightly right, the head fully inside frame, generous clean negative space around the silhouette, and a crop at the upper chest. Light softly from the upper left with restrained contrast. Use mostly warm monochrome charcoal and cream highlights with very subtle muted skin tones. The image must be entirely original, with no logos, text, watermark, jewelry, props, border, extra people, celebrity likeness, glossy beauty retouching, dramatic colored lighting, busy background, or hands.

The follow-up built-in edit prompt was:

> Change only the seamless studio background from deep graphite to a warm pale paper-gray in the #d8d2c8 range with a subtle natural tonal falloff. Preserve the fictional subject exactly: the same face, identity, hair, expression, pose, crop, black shirt, skin texture, lighting direction, realistic optics, and square composition. Keep clear separation around the dark hair without halos. Do not add text, objects, logos, borders, shadows, or watermarks. Preserve the refined editorial-photography treatment and provide strong contrast for ink-black masthead typography over the upper-left background.
`design-reference.png` is a PhotoPop-specific ideation artifact selected by the project owner as visual direction option 2. It is design documentation and is not bundled into the desktop application.

Regenerate deterministic derivatives with:

```powershell
node scripts/generate-brand-assets.mjs
node scripts/create-sample-project.mjs
```

## Third-party visual dependencies

- Inter is provided through `@fontsource/inter` and remains subject to the SIL Open Font License.
- Interface icons are rendered from `@tabler/icons-react` and remain subject to the Tabler Icons MIT license.

Dependency license texts should be included in distributed notices when required by their upstream licenses.