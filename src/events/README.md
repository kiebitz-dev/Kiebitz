# Saison-Events

Jedes Event ist ein eigener Ordner hier unter `src/events/`. Alles, was zum
Event gehört, liegt in diesem einen Ordner. Die App findet ihn von allein
(`import.meta.glob` in `index.ts`), es gibt keine Liste, die man pflegen müsste.

```
src/events/
  index.ts          Rahmen: findet die Events, prüft das Datum   (bleibt immer)
  EventIntro.tsx    spielt die Startanimation ab                 (bleibt immer)
  halloween/        ← das Event, komplett
    event.ts        Zeitfenster (MM-TT bis MM-TT, jedes Jahr) und Animation
    Intro.tsx       Startanimation (Fledermäuse)
    intro.css       ihr Stylesheet, lädt nur mit der Animation
    logo.webp       Event-Logo für die App (192 px, Ecken transparent)
    logo-1024.png   große Vorlage für Store, Website, Social Media (nicht im Build)
    logo-original.jpg  Ausgangsdatei (nicht im Build)
    event.test.ts   Tests, wandern mit dem Ordner
```

## Wie ein Event wirkt

- **Zeitfenster:** `from`/`to` in `event.ts`. Es gilt jedes Jahr wieder, das
  Jahr steht nirgends. Außerhalb des Fensters passiert nichts und es wird nichts
  nachgeladen.
- **Logo:** Liegt eine `logo.svg`, `logo.webp`, `logo.png` oder `logo.jpg` im
  Ordner (bei mehreren in dieser Reihenfolge), zeigt die App sie überall dort,
  wo sonst der Vogel im grünen Feld steht (Seitenleiste, Kopfzeile, App-Bar,
  Blatt, Onboarding, Rundgang). Erwartet wird eine fertige quadratische Kachel
  mit eigener Rundung und transparenten Ecken; das Feld der App fällt dann weg.
  Ohne Datei bleibt es beim Vogel. Andere Dateinamen (`logo-1024.png` usw.)
  werden nicht gebaut.

  Neue Fassung aus einer großen Vorlage, z. B. mit Pillow: Ecken freistellen
  (Rundung messen, `rounded_rectangle` als Maske), auf 192 px verkleinern,
  als WebP mit `quality=90` speichern. 192 px reichen für die größte Marke
  (44 px) auch auf 4×-Displays und halten die Datei bei rund 6 kB.
- **Startanimation:** liegt über der App, fängt keine Klicks ab, lädt erst nach
  dem ersten Bild und entfernt sich nach gut drei Sekunden selbst. Bei
  „Bewegung reduzieren", in Store-Aufnahmen und unter Linux/WebKitGTK bleibt
  sie aus.

## Ausprobieren außerhalb des Fensters

- Browser-Vorschau (`npm run dev`): `http://localhost:5173/?event=halloween`
- Auf einem Gerät oder in der Desktop-App: in den Entwicklerwerkzeugen
  `localStorage.setItem("kiebitz.event", "halloween")`, App neu starten.
  Zurück mit `localStorage.removeItem("kiebitz.event")`.
- `?event=none` bzw. `"none"` schaltet ein laufendes Event ab.

## Auslagern und wiederverwenden

Nach dem Event den Ordner einfach **aus `src/events/` herausnehmen**, etwa nach
`events-archiv/halloween/` im Repo-Wurzelverzeichnis. Außerhalb von `src/`
wird er weder gebaut noch geprüft, und die App ist wieder wie vorher.

Nächstes Jahr den Ordner zurück nach `src/events/` schieben, fertig. Das
Zeitfenster stimmt schon, weil es kein Jahr enthält.

Den Ordner einfach liegen zu lassen geht auch: Dann kommt das Event jedes Jahr
im Fenster von selbst. Außerhalb davon kostet es nur die paar Zeilen aus
`event.ts` im Startbündel.

## Ein neues Event anlegen

Ordner kopieren (z. B. `halloween/` → `weihnachten/`), in `event.ts` `id`,
`from` und `to` anpassen, Animation und Logo austauschen. Die Startanimation ist
eine React-Komponente mit `onDone`, die sie aufruft, wenn sie fertig ist.
Tailwind-Klassen dort meiden und eine eigene CSS-Datei nehmen, sonst landen die
Klassen im Stylesheet der App (siehe Budget in `scripts/check-bundle-size.mjs`).
