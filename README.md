<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# PhotoPop

PhotoPop is a local-first, open-source desktop image editor for layered raster
compositing. It is Windows-first and deliberately narrow: dependable open, edit,
recover, save, reopen, and export workflows come before feature-count parity
with established professional editors.

> [!IMPORTANT]
> **Repository status: pre-alpha source.** The source is available for review,
> development, and testing, but a successful browser preview or source build is
> not evidence that a Windows binary passed the release gates. Use a packaged
> build only when it comes from a tagged prerelease with matching
> `SHA256SUMS.txt` and `PROVENANCE.json` files. The version in `package.json`
> alone does not identify a published release.

> [!WARNING]
> Keep independent copies of important source images. Do not make an alpha build
> the only home of irreplaceable work.

## What the alpha includes

- Raster, text, basic shape, group, adjustment, and mask-capable layers
- Move, selection, mask brush/reveal, fill, gradient, crop, eyedropper, text,
  rectangle, and ellipse tools
- Undo/redo, layer visibility, opacity, supported blend modes, duplication, and
  reordering
- PNG, JPEG, WebP, SVG-as-raster, desktop TIFF, and version-1 8-bit RGB PSD import
- Native `.photopop` project save/open, 30-second recovery snapshots, flattened
  image export, and a retained previous-save backup in the desktop build
- A sandboxed Electron desktop shell with no account, cloud dependency,
  telemetry, or generative AI

PSD import is a conversion, not round-trip editing. Unsupported content is
rasterized, substituted, flattened, or reported, and PhotoPop never overwrites
the source PSD. When an embedded composite is available, PhotoPop compares it
with the editable rendering and offers editable layers or a faithful flattened
copy when they materially differ.

Read the [format compatibility matrix](docs/format-compatibility.md) and
[public-alpha boundaries](docs/public-alpha.md) before using PhotoPop for
production work. The alpha does not promise PSD export, CMYK or 16/32-bit
editing, editable smart objects, RAW workflows, a plugin SDK, or macOS/Linux
release support.

## Run from source

The supported development and release-validation environment is Windows. The
browser preview may be useful on other systems, but it does not make those
systems release targets.

Prerequisites:

- Git
- Node.js 24.x, matching the CI baseline
- Corepack with pnpm 10.33.0, the exact release pinned in `package.json`

After cloning or forking the repository, open PowerShell in its root and run:

```powershell
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm --version
pnpm install --frozen-lockfile
```

The version check should print `10.33.0`. The frozen install intentionally fails
when `package.json` and `pnpm-lock.yaml` disagree; do not work around that failure
by regenerating the lockfile unless the dependency change is intentional.

### Choose the right run mode

| Command | Use it for | Important limitation |
| --- | --- | --- |
| `pnpm dev` | Fast Vite browser preview of the interface and document workflow | Does not exercise the Electron security boundary or native Windows capabilities |
| `pnpm dev:desktop` | Electron development shell with the native preload bridge | Still runs development assets and is not a packaged-release test |
| `pnpm build` then `pnpm preview` | Production browser/Sites bundle smoke check | Still cannot validate desktop installation or native file behavior |

Use the desktop shell when evaluating native open/save dialogs, TIFF handling,
recovery storage, clipboard integration, drag-and-drop, or Windows file
associations. Use an exact packaged artifact for installer, portable-build, icon,
upgrade, and uninstall QA.

## Verify a change

Run the same baseline gate required by repository CI before submitting a change:

```powershell
pnpm verify
```

That command runs the Vitest suites, TypeScript check, production build, Sites
bundle preparation, and Sites worker contract test.

For Windows desktop, rendering, recovery, export, or release-related changes,
also run the automated release gate:

```powershell
pnpm verify:release
```

It adds the deterministic CPU reference benchmark and Electron workflow tests.
It does not replace the manual and installed-artifact evidence listed in
[the public-alpha boundaries](docs/public-alpha.md) and
[the Windows release gates](tests/e2e/README.md).

Maintainers preparing an unsigned Windows x64 candidate use:

```powershell
pnpm build:desktop --x64
node scripts/verify-windows-release.mjs
```

This packages the installer, portable executable, and ZIP, smoke-tests the
packaged app, and creates checksums and provenance. Do not publish artifacts from
a dirty working tree or describe them as release-ready without completing the
documented manual gates. Each tagged release includes the exact GitHub CLI
attestation-verification command; see
[GitHub's artifact-attestation guide](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

## First steps in the editor

- [First-run and editing guide](docs/onboarding.md)
- [Keyboard shortcuts](docs/shortcuts.md)
- [Recovery and backup guide](docs/recovery.md)
- [Sample-project guide](samples/README.md)

Unsigned alpha artifacts can trigger Windows SmartScreen or Microsoft Defender
reputation warnings. Download them only from the project's tagged prerelease,
verify the SHA-256 checksum, and never disable system-wide security controls to
install PhotoPop.

## Contributing and reporting

Read [CONTRIBUTING.md](CONTRIBUTING.md) before a large feature or document-format
change. Use the repository's issue forms for reproducible bugs, data-safety
incidents, format-compatibility problems, and focused workflow proposals. Do not
attach private artwork, client data, or files you cannot redistribute.

For a suspected vulnerability, read [SECURITY.md](SECURITY.md) and use the
repository Security page's **Report a vulnerability** button. If private
reporting is unavailable, submit only the no-details **Security contact request**
issue form so maintainers can provide a private channel. Never disclose technical
details in a public issue, discussion, or pull request.

Technical references:

- [Architecture](docs/architecture.md)
- [Native `.photopop` format specification](docs/native-format.md)
- [Format compatibility matrix](docs/format-compatibility.md)
- [Public-alpha release boundaries](docs/public-alpha.md)

## License

PhotoPop is licensed under the Mozilla Public License 2.0. See
[LICENSE](LICENSE). Bundled artwork and third-party visual dependencies are
documented in [ASSETS.md](ASSETS.md). Third-party software licenses and attributions are collected in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
