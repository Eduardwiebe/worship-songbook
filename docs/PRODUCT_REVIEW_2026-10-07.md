# Songbook Band: Produktprüfung und nächster Ausbau

Stand: 7. Oktober 2026. Geprüfte Basis: `b8be27e910ef8b5aa0169f50a713e04813df29f8` aus Eduardwiebe/worship-songbook.

## Ergebnis

Songbook Band hat eine brauchbare Grundlage für Bands und Worship-Teams: Original-PDFs, Scannen, Sets, Team, Termine, Einladungen, Bühne, Offline-Seiten, Aufnahme, Stimmgerät und deutsche/englische Oberfläche. Die untersuchte Version ist ausdrücklich ein Original-Songbook. `lib/originalOnly.mjs` aktiviert `ORIGINAL_ONLY_SONGBOOK`; Akkordrekonstruktion und Transposition gehören laut README zu Lyruma. Alte Analysebibliotheken sind kein Beleg, dass diese Funktionen im Produkt nutzbar sind.

Der Vorsprung sollte aus einem zuverlässig verbundenen Ablauf entstehen: Quelle prüfen, Arrangement freigeben, jeder Musiker sieht seinen Part, Probe dokumentieren, gemeinsame Bühnenfassung vorbereiten. Es gibt keinen belastbaren Nachweis, dass diese Kombination weltweit einzigartig wäre. Einzelne Bestandteile sind bei Wettbewerbern vorhanden. Die Verkaufsargumente müssen deshalb messbare Zeitersparnis, geringe Fehlerrate und einfache Bedienung sein.

## Reichweite der Prüfung

Repository geklont; Kernkomponenten, Stores, Authentifizierung, Server-Routen, Offline-Cache, Original-Modus, CI und vorhandene Tests untersucht. Öffentliche Live-Seite erreichbar, HTTP 200, Anmeldeoberfläche im Browser angesehen. Keine authentifizierte Prüfung mit echten Banddaten. Kein SSH-Zugang: `srv1` ist hier nicht auflösbar. Serverdateien, Datenbank, Backup-Inhalte, Restorefähigkeit, Ressourcen und exakte deployed Revision bleiben ungeprüft. Der sichtbare Build-Zeitpunkt entspricht dem 28. September; das beweist keine vollständige Gleichheit mit GitHub.

## Marktvergleich: dokumentierte Angebote

Anbieterangaben, keine eigenen Dauertests; Preise ohne Währungsumrechnung und ohne Zusage ihrer Verfügbarkeit. Quelle jeweils am Ende.

| Produkt | Dokumentierte Stärke | Konsequenz für Songbook Band |
|---|---|---|
| OnSong 2026 | Charts, Annotationen, Bühne, Pedale/MIDI, Audio, Gruppen; Apple-Geräte | Transponieren und Bühnenfunktionen sind Grundausstattung, kein Alleinstellungsmerkmal. |
| SongbookPro | Offline-Songs/PDFs, Transposition textbasierter Songs, Pedale; Groups mit gemeinsamer Bibliothek, Web-Verwaltung und Rechten | Günstiger etablierter Vergleich. Solo ungefähr 6,99 USD je Plattform; Groups wirbt ab 4 USD pro Nutzer/Jahr. |
| BandHelper | Repertoire, Planung, Kontakte, Finanzen, Stage Plots, Practice Log, MIDI/OSC | Eine große Featureliste allein reicht gegen einen breiten Anbieter nicht. Pro für 2-5 Nutzer laut Preisseite 8 USD/Monat oder 80 USD/Jahr. |
| Planning Center Services + Music Stand | Worship-Planung, Teams, Arrangements, Probenmedien, Blätter, Pedal, Annotationen | Im Worship-Bereich müssen Organisation und Musikvorbereitung gut zusammenarbeiten. Services: 20 Personen 15 USD/Monat; Music Stand Zusatzpreis je Paket prüfen. |
| forScore | PDF-Lesen, Annotationen, Setlisten, Audio und iCloud | Original-Blätter müssen schnell, lesbar und angenehm nutzbar sein. |
| MobileSheets | PDF-/Notenverwaltung, Annotationen, Bühnenmodus, Pedal und MIDI | Gute Notenanzeige ist schon ein anspruchsvoller etablierter Markt. |
| Moises | Stems, Tonhöhe/Tempo, Akkorderkennung und Üben | KI-Audioanalyse allein ist ebenfalls kein neues Verkaufsargument. |
| Songbook Buddy | Band-Modus, Rollen, Live-Sessions, Echtzeit-Sync und Verschlüsselung laut Anbieter | Auch neuere Anbieter besetzen die Band-Zusammenarbeit. |
| SetSync | Live-Sync, PDF-/Fotoimport, KI-Scanner, persönliche Layer, Notizen und Edit-Locks | Direkter Gegenbeleg zur Behauptung, Live-Sync oder Musikeransichten seien neu. Pro 1,99 GBP/Monat oder 19,99 GBP/Jahr laut Website. |

## Befunde im aktuellen Code

1. **Offline-Erfolg wurde zu früh gemeldet.** `cachePutMedia` fing Schreibfehler ab und gab keinen belastbaren Erfolg zurück. `cachePagesPayload` meldete anschließend trotzdem `true`. In dieser Änderung behoben; unvollständige Seitensätze werden außerdem verworfen.
2. **Fehlende Set-Songs verschwanden aus der Ansicht.** `SetDetailPage` filtert nicht gefundene Referenzen aus. Der neue Set-Check hält sämtliche Set-Einträge sichtbar und nennt fehlende Songs. Die bestehende Wiedergabe wird dadurch nicht automatisch umgebaut.
3. **Speichern ist optimistisch und unbestätigt.** `SetDetailPage.update` aktualisiert lokal und ruft für jede Änderung `saveSet` auf; Fehler landen nur in der Konsole. Keine Versionsprüfung im PUT-Endpunkt. Risiko: alte Requests oder mehrere Nutzer überschreiben neuere Daten. Noch zu beheben.
4. **Web-Cache und Band-Kontext passen nicht sauber zusammen.** Stores verwenden `getSelectedBandId` aus `nativeSession`; Web-Auswahl setzt ihn in `bandStore` nicht. Cache-Schlüssel enthalten keine Nutzer-ID. Web-Logout räumt den Offline-Cache im gezeigten Client nicht auf. Kontowechsel und zwei Bands auf einem Gerät müssen gezielt auf Vermischung getestet und abgesichert werden. Dies ist ein Codebefund, kein Nachweis eines öffentlich ausnutzbaren Lecks.
5. **Cache-Fallback ist zu breit.** Listen-Stores greifen nach beliebigen API-Fehlern auf Cache zurück. Rechteverlust und Serverfehler sollten getrennt von echten Netzwerkausfällen behandelt werden.
6. **Gemeinsame Bühnensteuerung fehlt im untersuchten Ablauf.** `RunSet` hat lokalen Songindex, Tastatur/Pedal-Tasten und Swipe; keine aktive Session mit Leader/Follower, Eventsequenz und Wiederverbindung in diesem Ablauf gefunden.
7. **Band-Mitgliedschaft ist nicht gleich Bearbeitungsrecht.** Die untersuchten Set-Mutationen prüfen Band-Zugehörigkeit, nicht getrennt Leser/Editor/Leitung. Differenzierte Rechte und Tests für direkte API-Aufrufe fehlen dort.
8. **Betrieb und Auslieferung bleiben offen.** SQLite- und OCR-Pfade sind serverbezogen; native Hüllen sind laut Dokumentation teilweise Grundlage/unsignierte Builds. Datensicherung und physische iPad-/Android-/Pedaltests wurden hier nicht nachgewiesen.

## Zielprodukt: eine geprüfte Fassung für die ganze Band

Beispiel: Eine Band importiert ein eigenes Lied. Lyruma erzeugt einen bearbeitbaren Vorschlag neben dem unveränderten Original. Unsichere Stellen werden markiert. Die Leitung korrigiert einen Akkord auf der richtigen Silbe, ordnet Intro, Strophe, Refrain und Bridge und gibt Version 3 frei. Die Band spielt in F; die Gitarre erhält E-Griffe mit Capo 1, der Bass klingende Akkorde in F, der Gesang nur Text und Einsätze. Persönliche Notizen ändern das gemeinsame Arrangement nicht. Bei einer spontanen Refrainwiederholung folgen die Geräte derselben Abschnitts-ID. Bricht die Verbindung ab, bleibt die vorbereitete Fassung lesbar; nach Wiederverbindung erscheint zunächst der Sessionstand, kein unkontrollierter Sprung.

### Vier zusammenhängende Schwerpunkte

- **Geprüfter Import:** Original, Erkennungsvorschlag und freigegebene Fassung als getrennte Versionen; korrigierbare Akkord-/Silbenanker; Konfidenz nicht als Richtigkeitsgarantie darstellen. Transponierte MusikXML/ChordPro-Fassung nur nach Prüfung, PDF selbst bleibt unverändert.
- **Gemeinsames Arrangement, persönliche Ansicht:** stabile Abschnitts-IDs, klingende Tonart, Griff-Tonart und Capo explizit; Ansichten für Gesang, Gitarre, Bass, Keys und Technik; persönliche Annotationen getrennt vom Bandinhalt.
- **Probe wird Vorbereitung:** Aufnahme oder eigener Audioupload mit Abschnittsmarken; Loop und Aufgabe je Passage; Mitglieder bestätigen ihre Vorbereitung auf eine bestimmte Version. Transkription ist ein prüfbarer Vorschlag, schreibt keine Vereinbarung automatisch fest.
- **Bühnenfassung mit Gerätecheck:** unveränderlicher Set-Snapshot einschließlich Versionen und Dateihashes; jedes Gerät prüft lokale Seiten; Leitung sieht zuletzt bestätigten Zustand und Zeitpunkt, keine Garantie über aktuell getrennte Geräte. Ausweichlösung ist lokale Darstellung, nicht erfundene Offline-Synchronisation.

## Priorisierte Umsetzung

### Paket 0: Verlässlichkeit vor Verkauf

Erster Teil hier: Set-Check plus korrekte Speicherrückgabe. Danach Nutzer/Band-Cache-Kontext, Logout-Bereinigung und Schutz gegen verspätete Cache-Schreibvorgänge; Fallback nur bei Netzfehlern; serialisierte/coalesced Speicherung, sichtbare Fehler und Retry; serverseitige Versionsprüfung mit 409-Konflikt. Rechte owner/editor/viewer für sämtliche Mutationen. Download eigener Daten und Wiederherstellen vor Verkauf testen.

Abnahme: Band A/B und Nutzer A/B teilen einen Testbrowser; kein fremder Cache bei Wechsel, Logout oder Rechteentzug. Zwei Browser ändern dasselbe Set: Konflikt wird angezeigt statt still überschrieben. Künstlicher Schreibfehler zählt als Fehlschlag. Jedes Set ist nach Flugmodus-Neustart vollständig lesbar oder benennt die fehlenden Dateien.

### Paket 1: Arrangements und persönliche Ansichten

Song und Arrangement trennen. Set enthält Arrangement-ID plus freigegebene Version, nicht nur Song-ID. Erst manuell editierbares ChordPro; Lyruma liefert später strukturierte Vorschläge. Original bleibt verfügbar. Persönliche Ansicht für mindestens Gesang und Capo-Gitarre. Abnahme mit eigenen oder passend lizenzierten Liedern, deutschen Umlauten, Slash-Akkorden, Wiederholungen und wechselnden Zeilenlängen.

### Paket 2: Gemeinsame Bühnen-Session

Session mit Band-ID, Set-Snapshot, Leader, monotonic sequence und aktuellen Song-/Abschnitts-IDs. Transport zunächst SSE für Updates plus autorisierte POST-Steuerung oder WebSocket nach Architekturprüfung. Follow/Pause jederzeit sichtbar; nur Leitung steuert. Kein Audio-Sync über einfache Scroll-Events. Internetfreie Band-Sync erfordert eine ausdrücklich geplante lokale Verbindung, etwa einen nativen LAN-Host; ein Hotspot allein ersetzt keinen erreichbaren Server.

Abnahme: fünf Geräte; Leaderwechsel, Abschnitt wiederholen, Netzabbruch, Wiederverbindung, verspätetes Event und unberechtigter Steuerbefehl. Messziel im Pilot: typische Abschnittswechsel unter 300 ms bei gutem Netz; kein Versprechen vor Messung.

### Paket 3: Probe und Freigabe

Marker, Loop, Aufgaben, Zustimmung je Arrangement-Version. Set einfrieren; spätere Änderungen ergeben eine neue Fassung. Bereits heruntergeladene Auftrittsfassung wird nicht durch Hintergrund-Updates verändert. Erst danach kostenpflichtige KI-Probenanalyse, wenn sie im Pilot Zeit spart.

### Paket 4: Verkauf und Betrieb

Demo ohne Registrierung mit eigenen Songs; Importhilfe aus offenen Formaten; Nutzenvergleich und klare Preise; exportierbare Daten. Betreiberkontakt, Datenschutz, Vertrags- und Lizenzprozesse passend zum tatsächlichen Betrieb prüfen. Monitoring, Limits für Upload/OCR, Restore-Test und Supportablauf. Keine fremden Songkataloge ohne passende Nutzungserlaubnis bündeln. Keine automatische SongSelect/CCLI-Integration ohne dokumentierte Schnittstelle und Berechtigung.

## Open Source und bezahltes Angebot

Das Repository ist Apache-2.0-lizenziert; die Oberfläche verspricht freien Open-Source-Code und freiwillige Unterstützung. Ein bezahltes Angebot sollte deshalb Hosting, verlässliche Band-Dienste, Einrichtung, Support und begrenzte Analyseleistung verkaufen. Der bestehende freie Code und seine Lizenzhinweise bleiben bestehen. Den Produktnamen und die Domain einheitlich verwenden; Songbook Band ist die Bühnen-App, Lyruma die verknüpfte Bearbeitung. Eine zentrale Anmeldung und ein direkter Übergang sollen zwei Werkzeuge wie einen Ablauf nutzbar machen.

## Preis und Markteintritt: Hypothesen zum Testen

Zunächst deutschsprachige Worship-Teams und kleine Bands mit 3-10 Personen. Living Hope ist der interne Praxistest; zusätzlich mindestens fünf unabhängige Teams, damit das Produkt nicht nur die eigenen Abläufe abbildet.

Bandpreis statt komplizierter Einzellizenzen: etwa 9,90 EUR/Monat für bis zu acht Mitglieder als Testhypothese; eine zweite Variante mit Jahrespreis und Einrichtungsservice vergleichen. Das ist keine beschlossene Preisliste. Analysejobs getrennt begrenzen und nach real gemessenen Kosten kalkulieren. Lesen, Auftritt und Export dürfen während eines laufenden Sets nicht an einem überraschenden Limit scheitern. Gratis-Gäste mit befristetem Leserecht nur für das ausgewählte Set.

Vor Preisentscheidung: BandHelper und günstiges SongbookPro setzen einen niedrigen Vergleichspreis. Ein höherer Preis braucht belegte Zeitersparnis. Reine Rechenprobe: 100 Bands x 9,90 EUR = 990 EUR monatlicher Umsatz vor Steuern, Ausfällen und sämtlichen Kosten, keine Gewinnprognose. Server, Medien, KI-Jobs, Zahlungsabwicklung und Support messen; keine unbegrenzte KI versprechen.

Pilotziele: fünf Teams schließen Import und erstes Set ab; mindestens vier spielen zwei Proben und einen Auftritt; Vorbereitung benötigt weniger Zeit als zuvor; jede Gruppe kann ihren Inhalt exportieren. Zahlungsbereitschaft durch tatsächliches Angebot prüfen. Marketing beginnt mit einer 90-Sekunden-Demo dieses Arbeitsablaufs, nicht mit einer unbewiesenen Aussage wie „weltweit einzig“.

## Validierung und Auslieferung dieser Änderung

Die Änderung betrifft Frontend und Cache, keine Datenbankmigration. Produktionsbuild, Node-Regressionsprüfungen sowie Offline-, Listen-/Viewer- und Bühnen-Safe-Area-Browsertests liefen erfolgreich. Lint meldet bestehende Warnungen, keine neuen Warnungen in den hinzugefügten Modulen. Der vorhandene allgemeine Übersetzungstest scheitert schon in der Basis an dem bewusst leeren Schlüssel header.eyebrow; die neuen deutschen und englischen Schlüssel sind vollständig vorhanden. Node-Tests prüfen Cache-Schreibfehler, unvollständige Seiten, fehlende Referenzen, Versionsabweichung und Leitung. Das bestehende Offline-Browsertestskript wurde um Set-Check und Telefonbreite ergänzt. Web-CI führt diese Tests künftig aus.

Vor Deployment auf srv1: aktuelle Serverrevision und lokale Änderungen vergleichen; exakte verwendete Dienste und Build-Schritte ermitteln; konsistente SQLite-Sicherung und Mediensicherung außerhalb eines öffentlichen Downloads erstellen; Änderung isoliert bauen und testen; danach bewusst deployen und Live-Browser prüfen. Das vorhandene Verzeichnis `/var/www/songbook/backups/` wurde nicht untersucht und ist kein belegtes Restore-Konzept.

Die Geräteprüfung bestätigt gespeicherte Bytes und vorhandene Metadaten. Eine perfekte Wiedergabe jedes Blatts oder langfristige Browseraufbewahrung wird damit nicht bewiesen. Aktuelle Cache-Revision verwendet Dateiname/Dateigröße; für veröffentlichte Fassungen ist ein Inhalts-Hash erforderlich.

## Quellen (abgerufen 07.10.2026)

- https://www.onsongapp.com/features/
- https://apps.onsongapp.com/pricing/
- https://songbook-pro.com/pricing/
- https://songbook-pro.com/docs/manual/licensing/
- https://www.bandhelper.com/main/features.html (Suchindex; Direktabruf zeitweise 503)
- https://www.bandhelper.com/main/pricing.html (Suchindex; Direktabruf zeitweise 503)
- https://www.planningcenter.com/services
- https://www.planningcenter.com/music-stand
- https://forscore.co/
- https://www.zubersoft.com/mobilesheets/features/utilities/
- https://www.zubersoft.com/mobilesheets/features/annotations/
- https://moises.ai/features/
- https://songbookbuddy.com/de/features/all/
- https://songbookbuddy.com/de/pro/
- https://setsync.uk/
