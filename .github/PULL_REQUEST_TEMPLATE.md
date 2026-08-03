<!--
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

## What changed

<!-- Describe the user or contributor problem and the smallest change that solves it. -->

## Related issue

<!-- Use "Fixes #123" when this pull request should close an issue. -->

## Verification

<!-- List the automated checks and focused manual workflows you actually ran. -->

- [ ] `pnpm verify`
- [ ] Focused tests for the changed behavior
- [ ] Relevant desktop workflow checked manually, or not applicable

## Safety and compatibility

- [ ] I considered save/recovery and data-loss risks.
- [ ] I documented import, export, native-format, or rendering compatibility changes.
- [ ] I preserved Electron sandboxing, context isolation, CSP, and the narrow preload API.
- [ ] I did not silently update visual or rendering baselines.

## Contributor checklist

- [ ] The change is focused and does not expose unfinished controls.
- [ ] New source/configuration files include an MPL-2.0 header where supported.
- [ ] User-facing or contributor-facing changes are reflected in documentation and the changelog.
- [ ] Generated builds, recovery data, credentials, and local preferences are not included.
- [ ] Any skipped check is named and explained below.

## Screenshots or notes

<!-- Include before/after images for visible changes and explain any intentionally skipped checks. -->
