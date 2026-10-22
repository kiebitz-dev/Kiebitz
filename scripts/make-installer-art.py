#!/usr/bin/env python3
"""Erzeugt die Grafiken für den Windows-Installer aus dem App-Icon.

NSIS und WiX wollen unkomprimierte BMPs in festen Maßen. Die Ergebnisse liegen
unter ``src-tauri/installer/`` und sind eingecheckt · der Release-Build in der
CI hat weder Python noch die Schriftarten. Dieses Skript ist nur da, damit die
Bilder reproduzierbar bleiben, wenn sich Icon oder Farben ändern.

    python scripts/make-installer-art.py [icon.png]

Ohne Angabe ist das Icon ``src-tauri/icons/source-icon.png``; für ein Event
(siehe ``scripts/set-app-icon.py``) kommt dessen Kachel als Argument.

Maße und Fundstellen:

* NSIS-Header 150x57, NSIS-Sidebar 164x314 (von Tauri so dokumentiert).
* WiX-Banner 493x58, WiX-Dialog 493x312 (Maße der WixUI-Standardbilder).

Bei WiX zeichnet der Installer seinen Text *über* das Bild, und zwar weiter,
als man denkt. Die Maße stammen aus den WixUI-Dialogen (Dialogeinheiten × 4/3):

* Banner · "Description" liegt bei X=25 W=280 du, reicht also bis rund 406 px.
  Rechts davon bleiben knapp 90 px für die Marke · dort steht nur noch das
  Signet, für den Schriftzug ist kein Platz, ohne dass sich beides berührt.
* Dialog · Titel und Text beginnen bei X=135 du, also erst ab rund 180 px.
  Die dunkle Fläche links bleibt darum schmaler als das.

Beides ist kein Ermessen: überlappt es, steht der schwarze Dialogtext im Logo.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "src-tauri" / "icons" / "source-icon.png"
OUT = ROOT / "src-tauri" / "installer"

# Dieselben Werte wie in src/index.css.
BG = (0x0E, 0x0E, 0x0D)
BG_TOP = (0x13, 0x21, 0x1B)
INK = (0xF2, 0xF1, 0xEC)
INK3 = (0x8B, 0x8A, 0x82)
ACCENT = (0x22, 0xC0, 0x8A)
PAPER = (0xF4, 0xF3, 0xEF)

WORDMARK = "Kiebitz"
# Englisch, weil die Bilder statisch sind, die MSI nur in en-US gebaut wird und
# Neuinstallationen der App ohnehin auf Englisch starten.
TAGLINE = "Moves take flight"

FONTS = Path("C:/Windows/Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def badge(size: int) -> Image.Image:
    return Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)


def vertical_wash(width: int, height: int) -> Image.Image:
    """Dunkler Verlauf von einem Hauch Grün oben nach Anthrazit unten."""
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(1, height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG)),
        )
    return image


def centered(draw: ImageDraw.ImageDraw, text: str, f, y: int, width: int, fill) -> None:
    box = draw.textbbox((0, 0), text, font=f)
    draw.text(((width - (box[2] - box[0])) / 2 - box[0], y), text, font=f, fill=fill)


def nsis_header() -> Image.Image:
    image = Image.new("RGB", (150, 57), BG)
    image.paste(badge(38), (9, 9), badge(38))
    draw = ImageDraw.Draw(image)
    draw.text((56, 18), WORDMARK, font=font("seguisb.ttf", 15), fill=INK)
    # Kante zum weißen Kopfbereich des Installers.
    draw.rectangle([0, 55, 150, 57], fill=ACCENT)
    return image


def nsis_sidebar() -> Image.Image:
    image = vertical_wash(164, 314)
    mark = badge(88)
    image.paste(mark, ((164 - 88) // 2, 74), mark)
    draw = ImageDraw.Draw(image)
    centered(draw, WORDMARK, font("seguisb.ttf", 24), 180, 164, INK)
    centered(draw, TAGLINE, font("segoeui.ttf", 12), 212, 164, INK3)
    draw.rectangle([162, 0, 164, 314], fill=ACCENT)
    return image


def wix_banner() -> Image.Image:
    # Titel und Beschreibung des Dialogs laufen bis rund 406 px · rechts davon
    # ist nur noch Platz fürs Signet, ohne Schriftzug.
    image = Image.new("RGB", (493, 58), PAPER)
    mark = badge(36)
    image.paste(mark, (493 - 36 - 14, (58 - 36) // 2), mark)
    ImageDraw.Draw(image).rectangle([0, 56, 493, 58], fill=ACCENT)
    return image


def wix_dialog() -> Image.Image:
    # Der Fließtext des Dialogs beginnt bei ~180 px · nur links wird dunkel.
    panel = 164
    image = Image.new("RGB", (493, 312), PAPER)
    image.paste(vertical_wash(panel, 312), (0, 0))
    mark = badge(84)
    image.paste(mark, ((panel - 84) // 2, 84), mark)
    draw = ImageDraw.Draw(image)
    box = draw.textbbox((0, 0), WORDMARK, font=font("seguisb.ttf", 22))
    draw.text(
        ((panel - (box[2] - box[0])) / 2 - box[0], 186),
        WORDMARK,
        font=font("seguisb.ttf", 22),
        fill=INK,
    )
    box = draw.textbbox((0, 0), TAGLINE, font=font("segoeui.ttf", 12))
    draw.text(
        ((panel - (box[2] - box[0])) / 2 - box[0], 216),
        TAGLINE,
        font=font("segoeui.ttf", 12),
        fill=INK3,
    )
    draw.rectangle([panel - 2, 0, panel, 312], fill=ACCENT)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in [
        ("nsis-header.bmp", nsis_header),
        ("nsis-sidebar.bmp", nsis_sidebar),
        ("wix-banner.bmp", wix_banner),
        ("wix-dialog.bmp", wix_dialog),
    ]:
        image = build()
        # 24 Bit, unkomprimiert · alles andere verweigern NSIS und WiX.
        image.convert("RGB").save(OUT / name, "BMP")
        print(f"{name}: {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    main()
