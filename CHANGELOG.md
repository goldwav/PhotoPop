<!--
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Changelog

All notable user-facing and contributor-facing changes to PhotoPop will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Alpha releases may still change the native document schema; migrations and compatibility limits must be recorded here when they do.

## [Unreleased]

### Added

- Public contribution guidance, a private vulnerability-reporting route, a repository-publication checklist, dependency-update automation, and stable cross-platform editor settings.
- Packaged third-party notices for redistributed dependencies.
- Expanded deterministic rendering coverage for compositing, masks, adjustments, transforms, and transparency.

### Changed

- PhotoPop now uses the coral P-dot mark for desktop and packaged-app identity, with natural wordmark spacing and no divider before the File menu.
- GitHub Actions workflows now use least-privilege token permissions, commit-pinned actions, non-persistent checkout credentials, explicit timeouts, cancellation of superseded verification runs, and attestations for verified Windows artifacts.

### Fixed

- Prevented translucent alpha inflation when mask density and adjustment blending interact.

These entries describe work in progress for the first public alpha. Repository publication and binary release gates remain separate.
