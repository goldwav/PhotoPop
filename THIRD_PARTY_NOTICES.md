# PhotoPop third-party notices

This notice describes third-party software and fonts shipped with the PhotoPop
Windows x64 alpha. It is provided for attribution and redistribution
transparency. It does not replace or modify any upstream license terms.

PhotoPop's own source code is licensed under the Mozilla Public License 2.0; see
LICENSE. Artwork provenance is recorded separately in ASSETS.md.

Resolved versions are pinned by pnpm-lock.yaml. Platform-specific native
components are taken from the installed @img package for the release target, so
this inventory must be refreshed when the operating system, architecture, or
Sharp version changes.

## Where these notices ship

Windows desktop artifacts contain this file at
resources/THIRD_PARTY_NOTICES.md as a directly readable copy.

Electron also places LICENSE.electron.txt and LICENSES.chromium.html next to the
application executable. Those files contain the Electron and Chromium notices
generated for the runtime used by the packaged application.

## Primary shipped components

| Component | Resolved version | License declared by the installed package | Project |
| --- | --- | --- | --- |
| Electron | 43.2.0 | MIT; Chromium and other runtime notices are shipped separately | https://github.com/electron/electron |
| React, React DOM, Scheduler | 19.2.0, 19.2.0, 0.27.0 | MIT | https://github.com/facebook/react |
| Tabler Icons and Tabler Icons React | 3.46.0 | MIT | https://github.com/tabler/tabler-icons |
| Inter, distributed through @fontsource/inter | 5.3.0 | SIL Open Font License 1.1 | https://github.com/rsms/inter |
| ag-psd | 31.0.2 | MIT | https://github.com/Agamnentzar/ag-psd |
| JSZip | 3.10.1 | MIT or GPL-3.0-or-later; PhotoPop uses the MIT option | https://github.com/Stuk/jszip |
| pako | 1.0.11 and 2.1.0 | MIT and zlib | https://github.com/nodeca/pako |
| Sharp | 0.35.3 | Apache-2.0 | https://github.com/lovell/sharp |
| @img/sharp-win32-x64 | 0.35.3 | Apache-2.0 and LGPL-3.0-or-later | https://github.com/lovell/sharp |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour |
| detect-libc | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc |
| semver | 7.7.4 | ISC | https://github.com/npm/node-semver |

Additional JavaScript packages retained in the desktop archive are listed
below. Electron exposes package paths through its virtual
resources/app.asar/node_modules/ namespace; selected package contents are
physically stored under resources/app.asar.unpacked/node_modules/.

| Component | Version | License |
| --- | --- | --- |
| core-util-is | 1.0.3 | MIT |
| immediate | 3.0.6 | MIT |
| inherits | 2.0.4 | ISC |
| isarray | 1.0.0 | MIT |
| lie | 3.3.0 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| readable-stream | 2.3.8 | MIT |
| safe-buffer | 5.1.2 | MIT |
| setimmediate | 1.0.5 | MIT |
| string_decoder | 1.1.1 | MIT |
| util-deprecate | 1.0.2 | MIT |

## Sharp Windows x64 native bundle

The installed @img/sharp-win32-x64 package declares the combined expression
Apache-2.0 AND LGPL-3.0-or-later. Its versions.json manifest identifies the
native libraries bundled with the Windows x64 build. The package's upstream
licensing table records the following terms:

| Library | Bundled version | Upstream terms recorded by @img/sharp-win32-x64 |
| --- | --- | --- |
| aom | 3.14.1 | BSD 2-Clause and Alliance for Open Media Patent License 1.0 |
| libarchive | 3.8.7 | BSD 2-Clause |
| cairo | 1.18.4 | Mozilla Public License 2.0 |
| cgif | 0.5.3 | MIT |
| libexif | 0.6.26 | LGPLv3 |
| expat | 2.8.1 | MIT |
| libffi | 3.5.2 | MIT |
| fontconfig | 2.18.1 | fontconfig license (BSD-like) |
| freetype | 2.14.3 | FreeType license (BSD-like) |
| fribidi | 1.0.16 | LGPLv3 |
| glib | 2.89.0 | LGPLv3 |
| harfbuzz | 14.2.1 | MIT |
| libheif | 1.23.0 | LGPLv3 |
| highway | 1.4.0 | BSD 3-Clause |
| libimagequant | 2.4.1 | BSD 2-Clause |
| libnsgif | not separately reported in versions.json | MIT |
| lcms | 2.19.1 | MIT |
| mozjpeg | revision 0826579 | zlib, IJG, and BSD 3-Clause |
| pango | 1.57.1 | LGPLv3 |
| pixman | 0.46.4 | MIT |
| libpng | 1.6.58 | libpng license |
| proxy-libintl | 0.5 | LGPLv3 |
| librsvg | 2.62.3 | LGPLv3 |
| libtiff | revision 732665c | libtiff license (BSD-like) |
| libultrahdr | revision 13a058f | MIT |
| libvips | 8.18.3 | LGPLv3 |
| libwebp | 1.6.0 | New BSD |
| libxml2 | 2.15.3 | MIT |
| zlib-ng | 2.3.3 | zlib |

The platform package states that use of libraries under LGPLv3 is through the
"any later version" clause of LGPLv2 or LGPLv2.1. The package metadata,
component manifest, native libraries, and Apache license are physically stored
at resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/. The installed
platform package supplies an Apache-2.0 LICENSE file but no separate LGPL file
next to that package. The packaged Electron runtime's LICENSES.chromium.html includes the
full LGPLv3 and GPLv3 license texts for offline review. Authoritative LGPL terms
and corresponding upstream source remain linked below.

Source and license references for the native bundle:

- Sharp 0.35.3: https://github.com/lovell/sharp/tree/v0.35.3
- libvips 8.18.3: https://github.com/libvips/libvips/tree/v8.18.3
- Sharp's prebuilt libvips packaging: https://github.com/lovell/sharp-libvips
- GNU Lesser General Public License 3.0: https://www.gnu.org/licenses/lgpl-3.0.html
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0

## Renderer-bundled attribution notices

The following projects are compiled into PhotoPop's renderer, so their package
directories are not separately visible in the installed application.

### MIT-licensed components

- React, React DOM, and Scheduler: Copyright (c) Meta Platforms, Inc. and affiliates.
- Tabler Icons: Copyright (c) 2020-2026 Paweł Kuna.
- ag-psd: Copyright (c) 2016 Agamnentzar. The ag-psd upstream license excludes
  image and brush files from that repository; PhotoPop does not redistribute
  those upstream media files.
- JSZip: Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz
  Buchinger, António Afonso.
- pako: Copyright (c) 2014-2017 Vitaly Puzrin and Andrei Tuputcyn.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### pako zlib-derived code

pako includes a JavaScript port based on zlib 1.2.8.

Copyright (c) 1995-2013 Jean-loup Gailly and Mark Adler
Copyright (c) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

This software is provided "as-is", without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use
of this software.

Permission is granted to anyone to use this software for any purpose, including
commercial applications, and to alter it and redistribute it freely, subject
to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.

### Inter font

Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter).

This Font Software is licensed under the SIL Open Font License, Version 1.1.
The full license text distributed by @fontsource/inter is available at
https://openfontlicense.org/open-font-license-official-text/ and in the
@fontsource/inter source package.

### Other retained package notices

Electron resolves all runtime packages through the virtual
resources/app.asar/node_modules/ namespace. Sharp, JSZip, and @img package
contents are physically stored at resources/app.asar.unpacked/node_modules/sharp/,
resources/app.asar.unpacked/node_modules/jszip/, and
resources/app.asar.unpacked/node_modules/@img/ respectively. pako and the
remaining pure-JavaScript support packages stay physically inside app.asar.
Those upstream license files are authoritative for their components.
