# InnoSprint
# InnoSprint · GutAnkommen

**Ein TUM Innovation Sprint MVP für mehr Sicherheit im öffentlichen Verkehr im Raum München.** GutAnkommen macht typische Auslastung sichtbar, bevorzugt ruhigere regionale Busverbindungen und erleichtert es älteren Fahrgästen, eine vertraute Person an der Fahrt teilhaben zu lassen.

## Warum dieses Konzept?

Ein stark ausgelasteter Bus kann sich für manche Fahrgäste unsicher oder belastend anfühlen. GutAnkommen ergänzt die Routenwahl deshalb um einen verständlichen Hinweis zur typischen Auslastung: „Eher ruhig“ oder „Häufig stärker ausgelastet“. Nutzer:innen können eine ruhigere Alternative priorisieren, die Fahrt starten, einen Link teilen und die sichere Ankunft bestätigen. Ein gut sichtbarer Notruf 112 ist direkt erreichbar.

## Was der Prototyp heute zeigt

- Große, kontrastreiche Bedienelemente und eine einfache deutsche Nutzerführung.
- Start und Ziel eingeben und eine priorisierte, ruhigere Verbindung mit einer Alternative ansehen.
- Google Maps mit der eingegebenen ÖPNV-Verbindung öffnen.
- Begleitansicht per Link öffnen und Status sowie Routenübersicht zeigen.
- Fahrt teilen (native Teilen-Funktion oder Zwischenablage) und sichere Ankunft bestätigen.
- Direkter Anruf des Notrufs 112.

**MVP-Grenze:** Die hier angezeigten Buslinien, Fahrzeiten und Auslastungsklassen sind Demonstrationsdaten. Der Prototyp ruft die MVV-Datensätze noch nicht ab, berechnet keine echte Verbindung und übermittelt keinen Live-Standort. Ein geteilter Link öffnet eine Demo-Begleitansicht; er ist noch nicht mit einem Backend oder einem echten Standortstream verbunden. Google Maps erhält die Route erst, wenn Nutzer:innen den externen Link öffnen. So wird keine Echtzeitgenauigkeit vorgetäuscht.

## Datenbasis und nächster Ausbauschritt

Die vom Team bereitgestellten öffentlichen MVV/Open-Data-Dateien bilden die Grundlage für eine echte Auslastungs- und Fahrplanintegration. Die zwei Auslastungslinks sind nach Dateiname **Auslastungsdaten**; aus ihnen sollten nur die tatsächlich enthaltenen Messgrößen verwendet werden. Die doppelte 2025-Angabe im ursprünglichen Briefing zeigt dieselbe URL wie 2024, daher ist die Jahreszuordnung vor Analyse zu prüfen.

| Daten | Zeitraum laut Briefing | Quelle |
| --- | --- | --- |
| MVV Regionalbus Auslastung | 2023/2024 | [CSV: mvv-regionalbusverkehr_2024_auslastung.csv](https://api.opendata-oepnv.de/dataset/c3b9f55f-e82a-434b-a6b1-a22aada57d49/resource/87a7c177-0c3b-4670-94d7-95cc25a29872/download/mvv-regionalbusverkehr_2024_auslastung.csv) |
| MVV Regionalbus Auslastung | 2024/2025 | [CSV: mvv-regionalbusverkehr_2025_auslastung.csv](https://api.opendata-oepnv.de/dataset/c3b9f55f-e82a-434b-a6b1-a22aada57d49/resource/9cbd727b-0363-4e98-b82f-83c48b07887e/download/mvv-regionalbusverkehr_2025_auslastung.csv) |
| MVV GTFS Regionalbusse | 2024 | [GTFS ZIP](https://api.opendata-oepnv.de/dataset/17065229-c3fd-46d7-84a9-aae55aadbf40/resource/d672f5e8-6359-4ce9-a294-728219f1a305/download/mvv_gtfs.zip) |
| MVV GTFS Regionalbusse | 2025 | [GTFS ZIP](https://api.opendata-oepnv.de/dataset/17065229-c3fd-46d7-84a9-aae55aadbf40/resource/e95866e4-7639-4da6-982d-98e306805436/download/250810_mvvbus_ohneshape_google_transit.zip) |

Im nächsten Schritt werden GTFS-Fahrten und Haltestellen mit den Auslastungsbeobachtungen verknüpft. Ein Routinggraph kann dann zulässige Verbindungen (inklusive Umstiegen) berechnen und typische Auslastung je Linie, Fahrt, Zeitfenster oder Streckenabschnitt einordnen. Die Auswahl sollte Nutzerpräferenzen wie „weniger volle Busse“ und „weniger Umsteigen“ gewichten und klare Hinweise auf Datenzeitraum und Unsicherheit geben. Für eine aktuelle Belegung wären zusätzliche Echtzeitdaten oder eine neue Erhebung nötig; historische Daten erlauben nur eine Prognose typischer Muster.

## Projektstruktur

- `index.html` – semantische Oberfläche, Routingformular, Ergebnis-, Karten-, Hilfe- und Begleitansichten.
- `styles.css` – responsive Gestaltung, große Touch-Ziele, Kontrast und mobile Darstellung.
- `app.js` – Formular, Google Maps Directions URL, Demo-Fahrtstatus, Teilen, Begleitansicht und Ankunftsbestätigung.
- `vercel.json` – Vercel-Konfiguration für die statische App.

## Lokal starten

Die App ist statisch und braucht kein Build-System. Öffne `index.html` direkt oder starte einen lokalen Server, zum Beispiel:

```bash
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen.

## Vercel

Vercel kann das Repository als statische Website ausliefern. Projekt-Root ist das Repository-Verzeichnis; Build Command bleibt leer, Output Directory ist `.`. Nach Git-Verknüpfung baut Vercel Preview-Deployments für Änderungen und das Production-Deployment vom Produktionsbranch. Für eine echte Google-Maps-Karte innerhalb der Seite kann später ein Google Maps Embed/Maps JavaScript API Key ergänzt werden; dieser MVP nutzt den datenschutzärmeren externen Google-Maps-Routenlink und eine lokale Routenvorschau.
