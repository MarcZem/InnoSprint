# InnoSprint · GutAnkommen

**Ein MVP für angenehmere und besser begleitbare Regionalbusfahrten im Raum München.** GutAnkommen sucht Verbindungen ausschließlich in den MVV-Regionalbusdaten, zeigt historische Auslastung in drei verständlichen Stufen und kann während einer aktiv freigegebenen Fahrt den Standort mit einer vertrauten Person teilen.

## Ablauf und Oberfläche

- **Planen:** Die erste Seite enthält nur Start, Ziel und ein Standortfenster. Der Start kann per Geräte-Standort automatisch mit der nächsten MVV-Haltestelle ausgefüllt werden. Die Standortabfrage startet erst nach einem Tastendruck.
- **Sprechen:** Den Knopf „Strecke sprechen“ halten und den Satz, zum Beispiel „Von Garching nach Ismaning“, sagen. Beim Loslassen wird die Aufnahme an `/api/transcribe` gesendet. Der erkannte Text setzt Start und Ziel ein; vor der Suche können beide Felder geprüft werden.
- **Verbindungen:** Abfahrtszeit wählen und Busverbindungen nach „Empfohlen“, „Weniger voll“ oder „Schnellste“ ordnen.
- **Details:** Buslinie, Haltestellen, Umstieg, Abfahrten, Streckenkarte und die verfügbaren historischen Messwerte ansehen. Google Maps lässt sich zur externen Prüfung und Navigation öffnen.
- **Fahrt:** Live-Standortfreigabe ausdrücklich starten, privaten Begleitlink senden, Fahrt beenden oder die sichere Ankunft bestätigen.
- **Familie:** Einen Kontakt lokal auf dem Gerät speichern und während einer aktiven Fahrt den Begleitlink erneut teilen.
- **Wichtig:** Notruf 112 und Hinweise zu Auslastungs- und Fahrplandaten.
- **Begleitansicht:** Ein Link mit zufälliger UUID zeigt den letzten übertragenen Standort, die gewählte Busroute und den Zeitpunkt der Übertragung.

Das Design nutzt große Bedienelemente, reduzierte Farben und klare Texte. Die mobile Ansicht bleibt auf dieselben drei Navigationsbereiche beschränkt.

## Regionalbus-Routing

`scripts/build_transit_data.py` verarbeitet den MVV-GTFS-Feed 2025 und die beiden vom Team bereitgestellten Auslastungsdateien. Es werden nur nummerische Linien übernommen, die in den Auslastungsdateien vorkommen und im GTFS als Bus/Regionalbus markiert sind. Der erzeugte Datensatz umfasst 227 Linienvarianten, 3.376 Haltestellen und 23.955 Fahrten mit Wochenmustern.

Der Browser baut den Fahrplan nach Wochentag in einen Abfahrtsindex um. Die Suche erzeugt direkte Busfahrten und Verbindungen mit einem Umstieg. Ein Umstieg benötigt mindestens fünf Minuten. Für Gerätepositionen werden Haltestellen bis höchstens 1,8 km Fußweg berücksichtigt. Schienenverkehr wird nicht in den internen Routen angeboten.

Für die Sortierung werden Fahrtdauer, Umstiege und historische Auslastung kombiniert. „Weniger voll“ bevorzugt Verbindungen ohne häufig stark gefüllte Abschnitte; „Schnellste“ ordnet primär nach Dauer. Diese Stufen sind ein Komfort- und Planungsindikator, kein Sicherheitsurteil.

### Auslastungsstufen

Die CSV-Werte werden pro Regionalbuslinie, Haltestellenpaar, Tageszeit und Tagesgruppe (werktags, Samstag, Sonntag) zusammengeführt. Der Mittelwert der vorhandenen Beobachtungen wird auf eine Stufe gerundet:

| CSV-Wert | Anzeige |
| --- | --- |
| 1 | Wenig gefüllt |
| 2 | Mittel gefüllt |
| 3 oder höher | Stark gefüllt |
| Leer oder keine passende Streckenmessung | Keine Messwerte |

In den Dateien kommen auch Werte `4` vor; sie werden der dritten Stufe zugeordnet. Die Messwerte sind historisch und können die heutige Belegung, Verspätungen, Ausfälle oder freie Sitzplätze nicht anzeigen. Für eine aktuelle Auslastung wären Echtzeitdaten oder eine neue Erhebung nötig.

### Daten und Grenzen

| Datensatz | Verwendung |
| --- | --- |
| [MVV Regionalbus-Auslastung, Datei `...2024_auslastung.csv`](https://api.opendata-oepnv.de/dataset/c3b9f55f-e82a-434b-a6b1-a22aada57d49/resource/87a7c177-0c3b-4670-94d7-95cc25a29872/download/mvv-regionalbusverkehr_2024_auslastung.csv) | Historische Segmentmessungen |
| [MVV Regionalbus-Auslastung, Datei `...2025_auslastung.csv`](https://api.opendata-oepnv.de/dataset/c3b9f55f-e82a-434b-a6b1-a22aada57d49/resource/9cbd727b-0363-4e98-b82f-83c48b07887e/download/mvv-regionalbusverkehr_2025_auslastung.csv) | Neuere historische Segmentmessungen |
| [MVV GTFS Regionalbusse 2025](https://api.opendata-oepnv.de/dataset/17065229-c3fd-46d7-84a9-aae55aadbf40/resource/e95866e4-7639-4da6-982d-98e306805436/download/250810_mvvbus_ohneshape_google_transit.zip) | Haltestellen, Linien, Fahrten und Wochenmuster |

Der GTFS-Feed 2025 nennt den Gültigkeitsbereich **28. Juli bis 2. November 2025**. Die Anwendung kann aus diesem alten Feed keine aktuelle Abfahrt berechnen. Ergebnisse sind als Fahrplanmuster beschriftet und müssen vor einer echten Fahrt extern, etwa in Google Maps oder der MVV-Auskunft, geprüft werden. Die GTFS-Datei enthält keine Strecken-Shapes; die eingebettete Kartenansicht verbindet Haltestellen daher schematisch mit geraden Linien.

Das Briefing bezeichnet die erste Auslastungsdatei als 2023, obwohl ihr Dateiname `...2024_auslastung.csv` lautet. Außerdem wurde dieselbe zweite CSV-URL im Briefing sowohl für 2024 als auch 2025 angegeben. Das tatsächliche Erhebungsjahr sollte vor einer belastbaren Auswertung mit dem Datenanbieter geklärt werden.

## Standortfreigabe und Datenschutz

Die Startseite fragt den Standort erst ab, wenn „Standort abrufen“ angetippt wird. Dieser einmalige Standort bleibt auf dem Gerät und füllt den Startpunkt automatisch aus. Während einer Fahrt wird der Standort erst nach dem gesonderten Tastendruck „Standortfreigabe starten“ an die private Vercel-Blob-Ablage dieses Projekts gesendet.

Der Begleitlink ist ein privater Zugriffsschlüssel. Nur Personen, denen der Fahrgast den Link sendet, können Standort und Route abrufen. Die App überträgt nur den letzten Standort, nicht den Standortverlauf. Updates werden gedrosselt; beim Beenden oder bei sicherer Ankunft löscht die Anwendung den Datensatz. Ein geplanter Vercel-Aufräuf löscht abgelaufene Datensätze zusätzlich. Ungeöffnete oder abgebrochene Freigaben sind nach vier Stunden nicht mehr abrufbar und werden beim nächsten Aufräuf endgültig gelöscht. Kontaktname und Telefonnummer werden nur in `localStorage` auf dem jeweiligen Gerät gespeichert.

Der Standort wird an die Vercel-Projektablage in Frankfurt übertragen, damit die Begleitperson ihn auf einem anderen Gerät abrufen kann. Deshalb sollte der Link nur an die gewünschte Vertrauensperson gesendet werden. Die App benötigt sichere HTTPS-Auslieferung und Geolocation-Zugriff des Browsers.

## Projektdateien

- `index.html` – reduzierte Seitenstruktur für Suche, Ergebnisse, Details, Fahrt, Familie, Hilfe und Begleitansicht.
- `styles.css` – barriereärmere Typografie, Touch-Ziele, Auslastungsstufen, Karten und mobile Layouts.
- `app.js` – Standort-Autofill, Fahrplanindex, Bus-only-Routensuche, Bewertung, Teilen und Begleitansicht.
- `components/VoiceRouteControl.jsx` – MediaRecorder-Aufnahme, Upload und Anzeige der Transkription.
- `pages/api/transcribe.js` – nimmt Multipart-Audio entgegen, leitet es mit `whisper-large-v3-turbo` an Groq weiter und gibt `{ "text": "…" }` zurück.
- `pages/api/location/[id].js` – private Live-Standort-API mit UUID-Link, Eingabeprüfung und Vier-Stunden-Ablauf.
- `pages/api/cleanup.js` – tägliche Bereinigung abgelaufener Standortdaten.
- `pages/index.jsx` – Next.js-Seite, die die bestehende Anwendungshülle und die React-Sprachsteuerung verbindet.
- `scripts/sync-assets.js` – stellt die vorhandene Browser-Anwendung für Next.js bereit.
- `scripts/fetch_transit_sources.py` – lädt die öffentlichen Quelldateien nach `/private/tmp`.
- `scripts/build_transit_data.py` – erzeugt die kompakten JSON-Daten unter `public/data/`.
- `public/data/` – generierte Haltestellen-, Fahrplan- und Auslastungsdaten für den Client.
- `vercel.json` – täglicher Bereinigungslauf.

## Lokal ausführen

```bash
python3 scripts/fetch_transit_sources.py
python3 scripts/build_transit_data.py
npm install
npm run dev
```

Die Vercel-Umgebungsvariablen `GROQ_API_KEY` und `BLOB_READ_WRITE_TOKEN` werden serverseitig benötigt. Lokal können sie beispielsweise mit `vercel env pull .env.local` in die nicht versionierte `.env.local` geladen werden. Die App benötigt HTTPS für Mikrofon und Standortzugriff.

### Spracheingabe

Der Browser nimmt Audio ausschließlich nach einer bewussten Aktion über `navigator.mediaDevices.getUserMedia()` und `MediaRecorder` auf. Beim Loslassen wird eine Datei als `multipart/form-data` an `/api/transcribe` gesendet. Die API liest die Datei temporär, überträgt sie serverseitig an die Groq Audio Transcriptions API und antwortet mit JSON. Der Groq-Schlüssel wird nur aus `process.env.GROQ_API_KEY` gelesen und nie an den Browser ausgegeben. Dateien sind auf 25 MB begrenzt; im Request werden Deutsch und `whisper-large-v3-turbo` vorgegeben. Groq verarbeitet Audio für diese Anfrage; die Anwendung speichert keine Audiodateien dauerhaft.

Die Transkription löst keine Suche automatisch aus: gefundene Haltestellen werden zuerst in die Start- und Zielfelder eingesetzt. So kann die Person vor dem Berechnen prüfen, ob die Erkennung stimmt. Die Spracherkennung benötigt eine unterstützte Audioausgabe des Browsers und eine Netzwerkverbindung.

## Vercel

Das Repository ist mit dem Projekt `innosprint` verbunden. Ein privater Blob-Store in Frankfurt liefert `BLOB_READ_WRITE_TOKEN` für Production, Preview und Development. `CRON_SECRET` schützt den täglichen Aufruf von `/api/cleanup`. `GROQ_API_KEY` ist im Vercel-Projekt für Production, Preview und Development konfiguriert. Die Vercel Functions laufen in der Projektregion; Deployments werden durch Git-Pushes ausgelöst.
