<!--
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
-->

# Recovery and Backups

PhotoPop uses two separate safety mechanisms:

- **Recovery snapshots** protect recent unsaved changes after an unexpected exit.
- **Save backups** retain the previous version of a project when a desktop save
  successfully replaces it.

Neither mechanism replaces an independent backup of important work.

## Automatic recovery

After an edited document has a renderable preview, PhotoPop writes a recovery
snapshot approximately every 30 seconds. A power loss or forced termination can
therefore lose up to roughly 30 seconds of work, and possibly more if storage is
full, unavailable, or the process is terminated before the first snapshot.

When a valid snapshot is found at startup, PhotoPop displays a recovery banner:

- **Recover** opens the snapshot as an unsaved document. Save it to a deliberate
  `.photopop` destination before continuing.
- **Dismiss** removes that recovery candidate. Dismiss only after confirming that
  the normal saved project is current.

A successful project save clears the matching recovery candidate. PhotoPop does
not silently upload recovery data.

## Where desktop recovery data lives

Packaged Windows builds use the application data directory:

```text
%APPDATA%\PhotoPop\Recovery
```

Development builds may use Electron’s development application-data directory
instead. The recovery folder contains a `.photopop` package named for the
document and a small pointer identifying the latest candidate.

Do not edit these files in place while PhotoPop is running. If manual recovery is
needed, close the app and copy the candidate to another folder first.

## Restore the previous saved version

Desktop save uses a sibling temporary file, verifies the new package, and then
replaces the destination. When a prior destination exists, PhotoPop keeps one
sibling backup:

```text
My Project.photopop
My Project.photopop.bak
```

To inspect the backup:

1. Close PhotoPop.
2. Copy `My Project.photopop.bak`; do not rename or overwrite the only backup.
3. Rename the copy to a new `.photopop` name, such as
   `My Project recovered.photopop`.
4. Open that copy and immediately use **Save As**.

The backup is one generation, not version history. A later successful save can
replace it.

## Browser preview limitations

The browser development preview stores its latest recovery package in browser
site storage. Clearing site data, using a private session, changing origins, or
browser storage eviction can remove it. The browser preview cannot provide the
same filesystem and backup guarantees as the packaged desktop app.

## If recovery fails

Preserve the affected `.photopop`, `.bak`, and recovery files before retrying.
Record the PhotoPop build, Windows version, last successful save, available disk
space, and exact actions before the failure. Use the repository’s **Data safety
incident** issue form with a reduced, license-safe sample when possible.

Do not publish private client artwork. Do not use a public issue for a suspected
security vulnerability; follow [SECURITY.md](../SECURITY.md).
