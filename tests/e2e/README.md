<!-- This Source Code Form is subject to the terms of the Mozilla Public
     License, v. 2.0. If a copy of the MPL was not distributed with this
     file, You can obtain one at https://mozilla.org/MPL/2.0/. -->

# Windows release gates

The smoke suite launches the real Electron main process and exercises the
sandboxed preload API. A test-only entry point supplies deterministic paths to
native file dialogs; it does not change production behavior.

Run the current automated subset after building:

```powershell
pnpm build
pnpm exec playwright test --config playwright.electron.config.mts
```

`release-gates.json` is the authoritative list of checks that require a
disposable Windows VM or the 16 GB integrated-GPU reference device. Those gates
must attach the listed evidence to a release candidate. They are never treated
as passed merely because CI could not run them.

The 4096×4096, 30-layer CPU reference benchmark records reproducible timing,
memory, environment, and output-digest evidence:

```powershell
node scripts/performance-reference.mjs --assert --output artifacts/performance-reference.json
```
