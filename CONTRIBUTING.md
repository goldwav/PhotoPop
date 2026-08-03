<!--
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Contributing to PhotoPop

Thank you for helping build a trustworthy, local-first image editor. PhotoPop is early software, so focused changes with strong evidence are more useful than broad feature additions.

## Before you start

- Search existing issues before opening a new one.
- Use the provided issue forms for bugs, data-safety reports, format compatibility, and workflow proposals.
- Open an issue before starting a large feature, architecture change, or document-format change so maintainers and contributors can agree on scope.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), never through a public issue.

## Local setup

PhotoPop requires Node.js 24 or newer and pnpm 10.33.0. From a clean checkout:

~~~powershell
pnpm install --frozen-lockfile
pnpm dev:desktop
~~~

The editor is Windows-first. Most unit and build checks are cross-platform, but desktop workflow and packaging gates currently require Windows.

## Development principles

- Keep changes narrow and avoid adding controls for unfinished behavior.
- Preserve the renderer sandbox, context isolation, restrictive content security policy, and typed preload boundary.
- Keep document mutations serializable and test their undo/redo behavior.
- Include format fixtures or rendering evidence when changing import, export, compositing, masks, text, transforms, or color handling.
- Never update a visual baseline silently. Explain the intended rendering change and its acceptable tolerance in the pull request.
- Do not introduce accounts, cloud dependencies, telemetry, generative AI, or paid features without an accepted project proposal.
- Add the MPL-2.0 header to new source and configuration files where the format supports comments.

## Verification

Run the repository gate before opening a pull request:

~~~powershell
pnpm verify
~~~

For changes that affect the desktop shell, rendering performance, file safety, or Windows packaging, also run the relevant release checks:

~~~powershell
pnpm benchmark:reference
pnpm test:e2e:windows
pnpm verify:release
~~~

If a check cannot run in your environment, say which check was skipped and why in the pull request. Do not describe an unrun check as passing.

## Pull requests

- Link the issue or explain the user problem being solved.
- Describe visible behavior, file-format impact, and data-safety implications.
- Include tests for changed behavior and concise manual verification steps when interaction is involved.
- Update documentation and [CHANGELOG.md](CHANGELOG.md) when users or contributors will notice the change.
- Keep generated build output, local recovery data, and editor preferences out of commits.

By contributing, you agree that your changes are made available under the [Mozilla Public License 2.0](LICENSE).
