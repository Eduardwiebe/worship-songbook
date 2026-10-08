# Songbook Band 1.2.0: Bandnotizen und Auftrittsfassungen

## Produktnutzen

Die Band kann gemeinsam an Originalblättern arbeiten und anschließend eine
Auftrittsfassung festschreiben. Jeder spielt dieselben Originale mit denselben
Notizen, Übergängen und Songleitungen. Spätere Änderungen am Entwurf ändern eine
freigegebene Fassung nicht. Diese Verbindung ist die vorgeschlagene Positionierung;
eine weltweite Alleinstellung wird damit nicht behauptet.

## Bedienung

1. Die richtige Band auswählen. Einen Song im Bearbeitungsschritt oder über das
   Augensymbol öffnen und **Notizen bearbeiten** wählen.
2. **Stift / Finger** zeichnet auf der jeweiligen Seite. **Text auf dem Blatt**
   fügt einen Text an der angetippten Position hinzu. Farben, Rückgängig,
   Markierung löschen und ein Blättern-Modus stehen bereit. In den gemeinsamen
   Bandnotizen lassen sich Struktur, Arrangement und Songleitung festhalten.
3. **Notizen speichern** abwarten. Bandmitglieder sehen die gespeicherten Notizen
   nach Öffnen bzw. Neuladen. Im persönlichen Songbook bleiben Notizen privat.
4. Bei einem Speicherkonflikt bleibt der eigene Entwurf erhalten. **Gespeicherte
   Notizen laden** verwirft ihn nach Bestätigung und lädt den gemeinsamen Stand.
   Offline oder bei einem Speicherfehler werden Änderungen nicht als gespeichert
   für die Band angezeigt. Lokale Entwürfe liegen separat im Gerätespeicher; bei
   fehlendem Speicher erscheint eine Meldung. Browserdaten löschen/Logout entfernt
   auch diese lokalen Entwürfe.
5. Im Set die Entwurfsänderungen fertig speichern und **Neue Auftrittsfassung
   freigeben** wählen. Die API kopiert Original-PDFs und gerenderte Seiten und
   friert Reihenfolge, Songmetadaten, Songleitung, Einsatzhinweise und die aktuell
   gespeicherten Notizen ein. Ungespeicherte lokale Notizen sind nicht enthalten.
6. Auf jedem Gerät die gewünschte Version auswählen, **Diese Fassung offline
   laden** und die vollständige Bestätigung abwarten. **Auftrittsfassung starten**
   nutzt ausschließlich die Blätter und Notizen dieser Version. Ein früherer
   Download eines Entwurfs ersetzt diesen Schritt nicht.
7. Die Band sieht den Zeitpunkt der letzten gemeldeten Offline-Vorbereitung pro
   Konto/Gerät. Dies ist kein Echtzeitnachweis des Gerätespeichers. Das Gerät prüft
   seine Dateien beim Laden und vor einem Offline-Start selbst.

## Technische Grenzen und Aufbewahrung

- Die Original-PDFs bleiben unverändert. Notizen sind eine separate SVG-/Textebene;
  vorhandene PDF-Druck-/Download-Schaltflächen liefern weiterhin das Original ohne
  diese Ebene. Ein exportierbares PDF mit eingebrannten Notizen ist kein Teil
  dieses Entwicklungsschritts.
- Notizen sind pro Song und Band gespeichert; private Notizen haben einen eigenen
  Kontobereich. Die API erzwingt Zugriff und eine numerische Notizrevision.
- SHA-256 bindet Notizen und Auftrittsarchive an den Originalinhalt. Bei einem
  geänderten Original werden alte Markierungen erst nach bewusster Zuordnung
  erneut gezeigt. Veröffentlichungen bestehen aus archivierten Originalen.
- Freigaben sind unveränderlich; eine Aktualisierung erzeugt v2, v3 usw. Einzelne
  Versionen haben in dieser ersten Fassung keinen Lösch-Endpunkt. Nach Löschen
  eines Sets sind seine Archive nicht mehr über die API erreichbar; die Dateien
  bleiben für eine gesonderte, später festzulegende Aufbewahrungsregel auf dem
  Server. Auch ein gelöschter Bibliothekssong ändert freigegebene Fassungen nicht.
- Vollständige lokale Vorbereitung prüft Metadaten und alle Seitendaten. Der
  Browser kann sie später entfernen. Das API-Archiv bewahrt zusätzlich das PDF;
  der offline spielbare Bühnenmodus braucht seine gerenderten Seiten und Notizen.
- Keine Live-Verbindung oder automatische Übernahme einer neuen Auftrittsversion.
  Geräte wählen und laden die gewünschte Version ausdrücklich.

## Bereitstellung auf srv1 durch Grok

Dieser PR enthält auch den bereits grünen CI-Fix aus PR #20. Er richtet sich
gegen `main` und kann nach seinen erforderlichen Checks integriert werden.
Falls PR #20 vorher separat integriert wird, entfällt dieser Anteil am Diff. Vor dem
Deploy eine konsistente SQLite- und Mediensicherung sowie den bisherigen Build
sichern. **data/performances/** gehört ab diesem Deploy zur Mediensicherung.

Wie bisher: `npm ci` und `npm run build` unter `app/`, anschließend die API neu
starten. Benötigt wird `/usr/bin/pdftoppm` (bereits für Originalseiten verwendet).
Die neue API legt drei zusätzliche Tabellen an: `song_annotations`,
`set_performances`, `performance_receipts`. Bestehende Tabellen werden durch diesen
Schritt nicht geändert. Das Backend muss vor der Nutzung der neuen UI laufen.

Beim Rollback die Datenbank nicht durch eine alte Kopie ersetzen. Alte Codeversionen
ignorieren die neuen Tabellen, zeigen die neuen Funktionen aber nicht. Die
Auftrittsarchive und neuen Nutzdaten bewahren. Ein integrierter Backup- oder
Rollback-Job ist nicht Teil dieses PRs.

## Verifikation

- `node scripts/test-band-performance-api.mjs`: echte temporäre API/SQLite,
  Bandrechte, private Trennung, CAS-Konflikte, Inhaltsänderung, festgeschriebene
  Blätter/Notizen/Cues, Gerätebestätigung und Archivzugriff nach Bibliothekslöschung.
- `node scripts/test-band-performance-playwright.mjs`: Produktionsbuild gegen
  isolierte API, Maus und echte Chromium-Touch-Ereignisse, Text/Rückgängig,
  Persistenz mit zweitem Bandkonto, Konfliktentwurf nach Neuladen, Veröffentlichung,
  Offline-Neustart, festgeschriebene Notizen und Ausrichtung auf schmalem Bildschirm.
- Bestehende Set-/Offline-/Cache-/Layout-/Probe-Tests bleiben Bestandteil der Prüfung.
- Der separate i18n-Paritätstest meldet weiterhin die bereits vor diesem PR
  leeren Werte `de:header.eyebrow,en:header.eyebrow`. Neue Texte sind zweisprachig
  und die Kataloge aus `strings.mjs` regeneriert. Dieser bekannte Fehler ist
  nicht Teil des CI-Workflows.
- Nicht hier nachgewiesen: Live-Deploy, echte Geräte, Safari/WebKit, Apple Pencil,
  native Tauri-Builds und eine reale Bandprobe. Mit Living Hope zuerst auf jedem
  Gerät die neue Version laden, gemeinsam notieren, eine Fassung freigeben und
  anschließend im Flugmodus mit geschlossen/neu geöffneter App spielen.
