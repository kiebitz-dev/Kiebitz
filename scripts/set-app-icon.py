#!/usr/bin/env python3
"""Setzt das App-Icon aller Plattformen aus einer quadratischen Kachel.

    python scripts/set-app-icon.py src/events/halloween/logo-1024.png   # Event an
    python scripts/set-app-icon.py                                      # zurück zum Vogel

Ohne Angabe ist die Kachel ``src-tauri/icons/source-icon.png``, das normale
Icon. Erwartet wird eine 1024er-Kachel mit transparenten Ecken.

Das Skript macht in einem Zug, was docs/DEPLOYMENT.md („Icons") beschreibt:

1. ``npx tauri icon`` erzeugt Desktop-, Store-, iOS- und Android-Icons.
2. Den Hintergrund des adaptiven Android-Icons setzt ``tauri icon`` auf Weiß;
   hier bekommt er die Farbe der Kachel (unten in der Mitte gemessen), sonst
   zeigen Launcher mit eckiger Maske weiße Ecken.
3. Den Vordergrund des adaptiven Icons streckt ``tauri icon`` bis an den Rand,
   und eckig maskierende Launcher zoomen ihn zu groß. Hier steht die Kachel
   stattdessen auf 88 % der Fläche, transparent drumherum.
4. Die Grafiken des Windows-Installers (scripts/make-installer-art.py).

Danach bauen; die erzeugten Dateien sind eingecheckt.
"""

import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ROOT / "src-tauri" / "icons" / "source-icon.png"
ANDROID_RES = [
    ROOT / "src-tauri" / "icons" / "android",
    ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "res",
]
DENSITIES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def background(tile: Image.Image) -> str:
    """Grundfarbe der Kachel · Mittel eines Flecks unten in der Mitte."""
    w, h = tile.size
    patch = tile.convert("RGB").crop((w // 2 - 20, int(h * 0.95), w // 2 + 20, int(h * 0.95) + 20))
    r, g, b = patch.resize((1, 1), Image.BOX).getpixel((0, 0))
    return f"#{r:02x}{g:02x}{b:02x}"


def main() -> None:
    source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT
    tile = Image.open(source).convert("RGBA")
    if tile.width != tile.height:
        sys.exit(f"{source} ist nicht quadratisch ({tile.width}x{tile.height})")

    subprocess.run(["npx", "tauri", "icon", str(source)], cwd=ROOT, check=True, shell=sys.platform == "win32")

    color = background(tile)
    for res in ANDROID_RES:
        values = res / "values" / "ic_launcher_background.xml"
        values.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            f'  <color name="ic_launcher_background">{color}</color>\n</resources>',
            encoding="utf-8",
            newline="\n",
        )
        for density, size in DENSITIES.items():
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            inner = round(size * 0.88)
            offset = (size - inner) // 2
            canvas.paste(tile.resize((inner, inner), Image.LANCZOS), (offset, offset))
            canvas.save(res / f"mipmap-{density}" / "ic_launcher_foreground.png", optimize=True)
    print(f"adaptives Android-Icon: Grund {color}, Vordergrund 88 %")

    subprocess.run([sys.executable, str(ROOT / "scripts" / "make-installer-art.py"), str(source)], check=True)


if __name__ == "__main__":
    main()
