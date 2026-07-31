/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portraitPath = path.join(repositoryRoot, "public", "assets", "portrait-layer.png");
const coverPath = path.join(repositoryRoot, "public", "assets", "editorial-cover.png");
const iconPath = path.join(repositoryRoot, "build", "icon.png");

const portrait = await sharp(portraitPath)
  .resize(1000, 1000, { fit: "cover", position: "centre" })
  .png({ compressionLevel: 9 })
  .toBuffer();

const editorialOverlay = Buffer.from(`
  <svg width="1000" height="1000" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 610 L245 575 L405 720 L540 658 L710 1000 L0 1000 Z"
      fill="#f3eee4" stroke="#e8e0d4" stroke-width="3"/>
    <path d="M735 1000 L1000 1000 L1000 382 L864 520 L782 690 L656 840 Z"
      fill="#f05445"/>
    <text x="30" y="166" fill="#171717" font-family="Georgia, 'Times New Roman', serif"
      font-size="154" font-weight="500" letter-spacing="-8">MOMENT</text>
  </svg>
`);

const cover = await sharp(portrait)
  .composite([{ input: editorialOverlay, top: 0, left: 0 }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(coverPath, cover);

const iconSvg = Buffer.from(`
  <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" rx="108" fill="#eeeae3"/>
    <path d="M133 98 H279 C367 98 418 145 418 222 C418 302 363 348 272 348 H222 V416 H133 Z
      M222 177 V271 H274 C311 271 329 254 329 224 C329 193 310 177 274 177 Z" fill="#ef5145"/>
    <circle cx="382" cy="382" r="42" fill="#292b2c"/>
  </svg>
`);
await sharp(iconSvg).png({ compressionLevel: 9 }).toFile(iconPath);

process.stdout.write(`Generated ${path.relative(repositoryRoot, coverPath)} and ${path.relative(repositoryRoot, iconPath)}\n`);