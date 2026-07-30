# Format Compatibility

| Format | Import | Export | Notes |
| --- | --- | --- | --- |
| `.photopop` | Yes | Yes | Native layered project format |
| PNG | Yes | Yes | Alpha preserved |
| JPEG | Yes | Yes | Flattened; configurable quality |
| WebP | Yes | Yes | Flattened; configurable quality |
| TIFF | Desktop | Desktop | Converted through libvips |
| SVG | Yes | No | Rasterized on import |
| PSD | Common 8-bit RGB | No | Layers are imported when representable; unsupported content is rasterized or reported |
| PSB | No | No | Planned after Windows alpha |
| CMYK / 16 / 32-bit | No | No | Planned after color pipeline expansion |

PhotoPop reports imported, rasterized, substituted, flattened, and unsupported PSD features after every PSD conversion.
