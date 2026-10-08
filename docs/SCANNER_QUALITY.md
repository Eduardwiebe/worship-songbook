# Scanner 1.2.1

Eine Scan-Seite bleibt ein Originalbild. Songbook setzt Text und Akkorde nicht durch OCR neu zusammen. Die Metadaten-Erkennung kann gedruckte Tonart/BPM ergänzen; sie verändert das Original-PDF nicht.

## Ursache und Änderung

Die bisherige Erkennung nahm vier unabhängige Extrempunkte einer hellen Fläche, zog die Ecken zusätzlich nach innen und bot keine manuelle Korrektur. Der Browser reduzierte Kamerabilder auf 2000 Pixel, die Bildvorbereitung skalierte kleine Fotos künstlich hoch, und die PDF-Erstellung führte eine zweite Erkennung samt Kontraständerung durch. Der zugeschnittene Ausgangsrahmen war danach verloren.

Die neue Erkennung passt ein konvexes Viereck an die gesamte Außenkontur an und verlangt eine nahezu rechteckige Flächenfüllung sowie übereinstimmende Grenzen bei zwei Helligkeitsschwellen. Unplausible, gerundete oder durch starke Schatten instabile Konturen werden verworfen. Bei zu heller/kontrastarmer Umgebung ist manuelle Korrektur weiterhin möglich. Ecken werden nicht absichtlich nach innen gezogen. Gekreuzte, nicht endliche und außerhalb des Bildes liegende Ecken werden abgelehnt.

Live-Aufnahmen werden erst bei stabilen Grenzen und ausreichend scharfen Details im Seiteninneren automatisch ausgelöst. Der Auslöser bleibt manuell nutzbar. Die Kamera fragt bis 3840×2160 an; die tatsächlich gelieferte Auflösung bestimmt der Browser/das Gerät. Der Scan verwendet bis 4600 Pixel lange Kante. Die zusätzliche Schaltfläche **Foto aufnehmen** nutzt die Systemkamera. Auflösung und geringe Detailschärfe werden in der Korrekturansicht angezeigt; das ist ein Hinweis, keine OCR-Qualitätsgarantie.

Nach der Live-Aufnahme erscheinen die vier Ecken am unbeschnittenen Bild. Ziehen funktioniert mit Touch, Stift als Pointer und Maus; Pfeiltasten bewegen eine fokussierte Ecke. Eine Lupe zeigt den berührten Bereich. Vorschau und ausdrückliches Übernehmen gehören zum Ablauf. Linke/rechte Buchseite setzt einen halben Rahmen anhand des erkannten Buchumrisses; die Kante am Falz lässt sich anschließend korrigieren. Drehen wirkt auf die Vorschau. Ganzes Foto, Erkennung zurücksetzen und Nachbearbeiten greifen immer auf die Quelle zurück, nicht auf einen bereits zugeschnittenen Ausschnitt. Galeriebilder haben denselben Editor über **Ausschnitt prüfen**.

Das Ausgangsbild bleibt während des geöffneten Scan-Dialogs erhalten. Nach dem Speichern wird nur die bestätigte Fassung als Song gespeichert; spätere Rückkehr zum unbeschnittenen Kamerafoto wird nicht zugesichert. Bei VisionKit ist die Quelle bereits die von Apple bestätigte Seite, nicht das unbeschnittene Kamerabild.

## PDF-Vertrag

Der Webclient sendet `pageProcessing=preserve`. Die API validiert `auto|preserve`; ohne Angabe bleibt der Ablauf alter Clients kompatibel. `scan_to_pdf.py output.pdf --preserve ...` behält EXIF-orientierte Abmessungen und Inhalte ohne Erkennung, Kontrastwechsel oder Skalierung. Normale JPEGs werden direkt als DCT-Bildstrom eingebettet, also ohne weitere JPEG-Kompression. PNG und EXIF-gedrehte Bilder werden verlustfrei als RGB-Flate-Bildstrom eingebettet. Transparenz erhält einen weißen Papierhintergrund. Perspektivkorrektur im Browser interpoliert Bildpunkte und erzeugt ein JPEG mit Qualität 97%; sie erfindet keine fehlenden Details.

## Prüfung

- `node scripts/test-live-scan-geometry.mjs`
- `node scripts/test-scan-deskew.mjs`
- `node scripts/test-scan-save-guard.mjs`
- `node scripts/test-scan-quality.mjs`: helle Unterlage, Schatten, gerundete Fläche, Schärfe im Inneren, Ecke-/Farbzuordnung, kontinuierliche Bewegung, pixelgleiche PNGs und bytegleiche JPEGs im PDF, Poppler-Rendering und echte authentifizierte API in temporärer SQLite-Instanz.
- `node scripts/test-scan-dialog-playwright.mjs`: Produktionsbuild, Galerie, automatische Kameraaufnahme, Erhalt und Wiederherstellung der Quelle, Buchseite/Drehen, ungültige Ecken, echtes Chromium-Touch-Ereignis mit Lupe sowie Tablet-/Handy-Größe. Die Kamera ist dafür synthetisch, kein Hardware-Qualitätsnachweis.

## Deployment für srv1

Projekt `/var/www/songbook`, Dienst `songbook-api.service`, Webroot `app/dist`, Live-URL https://songbook.lyruma.de. Grundlage ist das gemergte PR #21. Version 1.2.1 enthält keine DB-Migration und keine Änderungen an bereits gespeicherten PDFs.

1. PR-Head und grünen CI-Lauf prüfen; lokalen Serverzustand/Änderungen erfassen. DB konsistent sichern sowie Medien inklusive `data/performances`, aktuellen Build, Laufzeitdateien und Konfiguration in einem geschützten Verzeichnis unter `backups/`. Prüfsummen prüfen.
2. Backend, `scan_to_pdf.py` und `scan_document.py` aus derselben Revision bereitstellen. Pillow ist bereits über `requirements-ocr.txt` erforderlich; ausführbaren `SONGBOOK_OCR_PYTHON` bzw. `.venv-ocr/bin/python` prüfen.
3. API **vor** dem neuen Frontend neu starten: Ein altes Backend würde den neuen `preserve`-Wunsch ignorieren. Gewohnten autorisierten systemd-Neustart nutzen. Falls nur SIGTERM möglich ist, vorher MainPID und `Restart=always` verifizieren und danach Zustand/Health prüfen.
4. Frontend mit `npm ci` und `npm run build` außerhalb des aktiven Webroots bauen und vollständig austauschen. Version/Bündel, lokale und öffentliche Health sowie DB-Integrität prüfen.
5. Tests ausschließlich mit temporären Datenbanken und eigenen Ports ausführen. Keine Testnutzer oder Testuploads in der Live-Datenbank erzeugen.
6. Bericht mit tatsächlicher Revision, Version 1.2.1, Backup-Pfad, Neustartmethode, Testergebnissen und Grenzen zurückgeben. Nicht ausgeführte Gerätescans ausdrücklich benennen.

Rollback stellt alten Code und Frontend wieder her; Datenbank und Medien einschließlich neu angelegter Songs erhalten. Keine DB-Rücksicherung für einen reinen Code-Rollback.

## Noch praktisch zu prüfen

Echtes iPad/Safari/PWA und Android: je eine flache Seite, helle Unterlage, seitlicher Schatten und eine einzelne Buchseite mit Akkorden aufnehmen. Alle vier Ecken, kleine Akkordzusätze, obere/untere Zeilen und Falz in Vorschau und gespeichertem PDF vergleichen. Auf Systemkamera-Auflösung und Orientierung achten. Apple-Pencil-Eingabe und VisionKit/native Builds sind in dieser Umgebung nicht hardwaregeprüft.

Eine Perspektivkorrektur entzerrt eine ebene Seite. Stark gewölbte Buchseiten, Reflexionen, verdeckte Texte und echte Unschärfe benötigen bessere Aufnahmebedingungen bzw. künftig eine gesonderte Buchseitenentzerrung. Bereits beschädigt zugeschnittene alte PDFs werden durch dieses Update nicht rekonstruiert; dafür muss die Originalseite erneut gescannt werden.
