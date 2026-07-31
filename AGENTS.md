# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## PhotoPop visual direction

The selected design is ideation option 2, preserved at `design-reference.png`.

- Use warm light-gray application chrome, a graphite pasteboard, ink-black typography, and coral-red active states.
- Keep the canvas dominant, the tool rail narrow, and the right inspector spacious.
- Use Inter for the application UI and a high-contrast serif only inside editable artwork.
- The default sample document demonstrates portrait mask editing in an editorial paper collage.
- Do not add account, cloud, AI, telemetry, or decorative dashboard surfaces.
- Prefer a "Calm Canvas" interaction model: the artwork stays dominant, controls appear contextually, and workspace chrome can recede without hiding essential state.
- Motion must be short and purposeful, preserve spatial continuity, avoid easing active brush or pan input, and honor reduced-motion preferences.
