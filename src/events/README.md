# Events

Ein Event (Halloween, Weihnachten, …) ist ein eigener Ordner hier unter
`src/events/`. Liegt der Ordner da, ist das Event in diesem Build an. Es gibt
keinen Kalender und keine Liste, die man pflegen müsste: Die App findet den
Ordner von allein (`import.meta.glob` in `index.ts`). Beendet wird ein Event mit
einem neuen Build ohne den Ordner.

```
src/events/
  index.ts          Rahmen: findet den Event-Ordner          (bleibt immer)
  EventIntro.tsx    spielt die Startanimation ab             (bleibt immer)
  halloween/        ← das Event, komplett
    event.ts        Kennung und Startanimation
    Intro.tsx       Startanimation (Fledermäuse)
    intro.css       ihr Stylesheet, lädt nur mit der Animation
    logo.webp       Logo in der App (192 px, Ecken transparent)
    logo-1024.png   Kachel für das App-Icon, Store, Website (nicht im Build)
    logo-original.jpg  Ausgangsdatei (nicht im Build)
    event.test.ts   Tests, wandern mit dem Ordner
```

Es darf immer nur ein Event-Ordner gleichzeitig liegen (ein Test passt darauf
auf).

## Was ein Event ändert

- **Logo in der App:** `logo.svg`, `logo.webp`, `logo.png` oder `logo.jpg` im
  Ordner (bei mehreren in dieser Reihenfolge) ersetzt den Vogel im grünen Feld
  überall in der App: Seitenleiste, Kopfzeile, App-Bar, Blatt, Onboarding,
  Rundgang. Erwartet wird eine quadratische Kachel mit eigener Rundung und
  transparenten Ecken. 192 px reichen für die größte Marke (44 px) auch auf
  4×-Displays.
- **Startanimation:** liegt über der App, fängt keine Klicks ab, lädt erst nach
  dem ersten Bild und entfernt sich nach gut drei Sekunden selbst. Bei
  „Bewegung reduzieren", in Store-Aufnahmen und unter Linux/WebKitGTK bleibt
  sie aus.
- **App-Icon** (Taskleiste, Startmenü, Installer, Android-Launcher, Store-Logos):
  liegt technisch nicht im Event-Ordner, sondern in `src-tauri/icons/` und
  `src-tauri/gen/android/`. Ein Skript setzt es aus der Kachel, siehe unten.

## Event starten

1. Ordner nach `src/events/` legen (z. B. aus `events-archiv/halloween/`).
2. App-Icon setzen:
   ```sh
   python scripts/set-app-icon.py src/events/halloween/logo-1024.png
   ```
3. Bauen und veröffentlichen.

## Event beenden

1. Ordner aus `src/events/` herausnehmen, etwa nach `events-archiv/halloween/`
   im Repo-Wurzelverzeichnis. Außerhalb von `src/` wird er weder gebaut noch
   geprüft.
2. App-Icon zurückstellen (ohne Argument nimmt das Skript den normalen Vogel aus
   `src-tauri/icons/source-icon.png`):
   ```sh
   python scripts/set-app-icon.py
   ```
3. Bauen und veröffentlichen.

## Neues Logo aus einer großen Vorlage

Mit Pillow: Rundung der Kachel messen, Ecken mit einer `rounded_rectangle`-Maske
freistellen, als `logo-1024.png` speichern; daraus `logo.webp` mit 192 px und
`quality=90`. So sind die Halloween-Dateien entstanden.

## Vergleichen in der Vorschau

`http://localhost:5173/?event=none` zeigt die App ohne Event.

## Ein neues Event anlegen

Ordner kopieren (z. B. `halloween/` → `weihnachten/`), in `event.ts` die `id`
anpassen, Animation und Logo austauschen. Die Startanimation ist eine
React-Komponente mit `onDone`, die sie aufruft, wenn sie fertig ist. Keine
Tailwind-Klassen dort, sondern eine eigene CSS-Datei, sonst landen die Klassen
im Stylesheet der App (siehe Budget in `scripts/check-bundle-size.mjs`).
