#!/usr/bin/env python3
"""Download the public MVV source data used by build_transit_data.py."""

from pathlib import Path
from urllib.request import Request, urlopen

OUT = Path("/private/tmp")
SOURCES = {
    "gtfs25": "https://api.opendata-oepnv.de/dataset/17065229-c3fd-46d7-84a9-aae55aadbf40/resource/e95866e4-7639-4da6-982d-98e306805436/download/250810_mvvbus_ohneshape_google_transit.zip",
    "csv24": "https://api.opendata-oepnv.de/dataset/c3b9f55f-e82a-434b-a6b1-a22aada57d49/resource/87a7c177-0c3b-4670-94d7-95cc25a29872/download/mvv-regionalbusverkehr_2024_auslastung.csv",
    "csv25": "https://api.opendata-oepnv.de/dataset/c3b9f55f-e82a-434b-a6b1-a22aada57d49/resource/9cbd727b-0363-4e98-b82f-83c48b07887e/download/mvv-regionalbusverkehr_2025_auslastung.csv",
}

OUT.mkdir(parents=True, exist_ok=True)
for name, url in SOURCES.items():
    target = OUT / f"InnoSprint-{name}"
    request = Request(url, headers={"User-Agent": "InnoSprint-GutAnkommen/1.0"})
    with urlopen(request, timeout=60) as response, target.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    print(f"Downloaded {name}: {target}")
