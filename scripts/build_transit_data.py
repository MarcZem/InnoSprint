#!/usr/bin/env python3
"""Build a compact, regional-bus-only browser routing network from MVV GTFS/CSV.

Download the source files named below to /private/tmp/InnoSprint-{gtfs25,csv24,csv25},
then run: python3 scripts/build_transit_data.py
"""

from __future__ import annotations

import csv
import json
import math
import pathlib
import zipfile
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"
TMP = pathlib.Path("/private/tmp")
FEED = TMP / "InnoSprint-gtfs25"
LOAD_FILES = [TMP / "InnoSprint-csv24", TMP / "InnoSprint-csv25"]
BUS_TYPES = {"3", "701"}  # GTFS bus and regional-bus types used in MVV feeds.
WEEKDAY_BITS = {"monday": 1, "tuesday": 2, "wednesday": 4, "thursday": 8,
                "friday": 16, "saturday": 32, "sunday": 64}


def read_gtfs(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    return list(csv.DictReader(zf.read(name).decode("utf-8-sig").splitlines()))


def csv_records(path: pathlib.Path):
    with path.open(encoding="cp1252", newline="") as handle:
        yield from csv.DictReader(handle, delimiter=";")


def class_value(raw: str) -> int | None:
    try:
        value = float(raw.strip().replace(",", "."))
    except (AttributeError, ValueError):
        return None
    if value <= 0:
        return None
    return min(3, max(1, round(value)))


def seconds(raw: str) -> int:
    hour, minute, second = (int(part) for part in raw.split(":"))
    return hour * 60 + minute + (1 if second >= 30 else 0)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def main() -> None:
    if not FEED.exists() or not all(path.exists() for path in LOAD_FILES):
        raise SystemExit("Expected public MVV downloads under /private/tmp/InnoSprint-*")

    zf = zipfile.ZipFile(FEED)
    agency = read_gtfs(zf, "agency.txt")[0]
    feed = read_gtfs(zf, "feed_info.txt")[0]
    all_routes = read_gtfs(zf, "routes.txt")
    all_stops = read_gtfs(zf, "stops.txt")
    all_trips = read_gtfs(zf, "trips.txt")
    all_stop_times = read_gtfs(zf, "stop_times.txt")
    calendars = read_gtfs(zf, "calendar.txt")

    # CSV load observations use route short name and the public stop Global IDs.
    load_groups: dict[tuple[str, str, str, int, str], list[int]] = defaultdict(list)
    observed_lines: set[str] = set()
    for path in LOAD_FILES:
        for row in csv_records(path):
            line = row.get("Linie", "").strip()
            day_type = row.get("Tagtyp", "")
            day_group = "wd" if day_type in {"MFS", "MFF"} else "sa" if day_type == "Sa" else "su" if day_type == "So" else "any"
            value = class_value(row.get("Auslastung", ""))
            origin = row.get("Von_Global ID") or row.get("Global ID") or ""
            destination = row.get("Nach_Global ID", "")
            departure = row.get("AbZeit Soll", "")
            if not line.isdigit():
                continue
            observed_lines.add(line)
            if value is None or not origin or not destination or not departure:
                continue
            hour = int(departure.split(":", 1)[0]) % 24
            load_groups[(line, origin, destination, hour, day_group)].append(value)

    load_lookup = {key: {"level": round(sum(vals) / len(vals)), "count": len(vals)}
                   for key, vals in load_groups.items()}
    # Fallback across time for a known stop pair; do not invent a class when no sample exists.
    pair_groups: dict[tuple[str, str, str, str], list[int]] = defaultdict(list)
    for (line, origin, destination, _hour, day_group), vals in load_groups.items():
        pair_groups[(line, origin, destination, day_group)].extend(vals)
    pair_lookup = {key: {"level": round(sum(vals) / len(vals)), "count": len(vals)}
                   for key, vals in pair_groups.items()}

    route_rows = [r for r in all_routes if r.get("route_type") in BUS_TYPES
                  and r.get("route_short_name", "").strip().isdigit()
                  and r["route_short_name"].strip() in observed_lines]
    route_by_id = {r["route_id"]: r for r in route_rows}
    route_ids = set(route_by_id)
    stops_by_id = {s["stop_id"]: s for s in all_stops}
    service_mask: dict[str, int] = {}
    for row in calendars:
        mask = sum(bit for day, bit in WEEKDAY_BITS.items() if row.get(day) == "1")
        service_mask[row["service_id"]] = service_mask.get(row["service_id"], 0) | mask

    # Keep only trips whose weekday service is in the 2025 feed. Use a stop's
    # parent station as its canonical public/global stop ID when present.
    chosen_trips = {t["trip_id"]: t for t in all_trips if t["route_id"] in route_ids
                    and service_mask.get(t["service_id"], 0)}
    raw_trip_stops: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in all_stop_times:
        if row["trip_id"] in chosen_trips:
            raw_trip_stops[row["trip_id"]].append(row)

    def canonical(raw_id: str) -> str:
        row = stops_by_id.get(raw_id)
        return row.get("parent_station") or raw_id if row else raw_id

    stop_rows: dict[str, dict] = {}
    for trip_id, stop_times in raw_trip_stops.items():
        stop_times.sort(key=lambda x: int(x["stop_sequence"]))
        for item in stop_times:
            raw_id = item["stop_id"]
            stop = stops_by_id.get(raw_id, {})
            cid = canonical(raw_id)
            parent = stops_by_id.get(cid, {})
            lat = parent.get("stop_lat") or stop.get("stop_lat") or ""
            lon = parent.get("stop_lon") or stop.get("stop_lon") or ""
            if cid not in stop_rows:
                stop_rows[cid] = {"id": cid, "name": parent.get("stop_name") or stop.get("stop_name") or cid,
                                  "lat": float(lat) if lat else None, "lon": float(lon) if lon else None}

    stop_list = list(stop_rows.values())
    stop_index = {s["id"]: i for i, s in enumerate(stop_list)}
    route_list = []
    route_index = {}
    for row in route_rows:
        route_index[row["route_id"]] = len(route_list)
        route_list.append([row["route_id"], row["route_short_name"].strip(), row.get("route_long_name", "")])

    trip_list = []
    pairs = set()
    for trip_id, trip in chosen_trips.items():
        items = raw_trip_stops.get(trip_id, [])
        sequence = []
        for item in items:
            stop = stop_index.get(canonical(item["stop_id"]))
            if stop is None:
                continue
            arr = seconds(item.get("arrival_time") or item.get("departure_time"))
            dep = seconds(item.get("departure_time") or item.get("arrival_time"))
            entry = [stop, arr, dep]
            if sequence and sequence[-1][0] == stop:
                sequence[-1] = entry
            else:
                sequence.append(entry)
        if len(sequence) < 2:
            continue
        ri = route_index[trip["route_id"]]
        trip_list.append([ri, service_mask[trip["service_id"]], trip.get("trip_headsign", ""), sequence])
        for a, b in zip(sequence, sequence[1:]):
            pairs.add((route_list[ri][1], stop_list[a[0]]["id"], stop_list[b[0]]["id"]))

    # Keep observations only for actual GTFS stop pairs; encode exact hourly
    # counts and all-hour pair fallback separately to avoid bundling raw CSVs.
    stop_ids = {s["id"] for s in stop_list}
    def matched(load_key):
        line, origin, dest, hour, day_group = load_key
        return origin in stop_ids and dest in stop_ids and (line, origin, dest) in pairs

    hourly = [[line, origin, dest, hour, day_group, val["level"], val["count"]]
              for (line, origin, dest, hour, day_group), val in load_lookup.items() if matched((line, origin, dest, hour, day_group))]
    all_hours = [[line, origin, dest, day_group, val["level"], val["count"]]
                 for (line, origin, dest, day_group), val in pair_lookup.items()
                 if origin in stop_ids and dest in stop_ids and (line, origin, dest) in pairs]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output = DATA_DIR / "regional-bus-network.json"
    network = {
        "meta": {"agency": agency["agency_name"], "scheduleVersion": feed.get("feed_version"),
                 "scheduleStart": feed.get("feed_start_date"), "scheduleEnd": feed.get("feed_end_date"),
                 "loadSources": ["2024 CSV", "2025 CSV"], "occupancyCount": sum(len(v) for v in load_groups.values()),
                 "classes": {"1": "Wenig gefüllt", "2": "Mittel gefüllt", "3+": "Stark gefüllt"},
                 "scope": "numeric named MVV regional bus lines only", "minTransferMinutes": 5},
        "stops": stop_list,
        "routes": route_list,
        "trips": trip_list,
        "occupancyHourly": hourly,
        "occupancyAllHours": all_hours,
    }
    output.write_text(json.dumps(network, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DATA_DIR / "stops.json").write_text(json.dumps(stop_list, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(output), "bytes": output.stat().st_size,
                      "regionalRoutes": len(route_list), "stops": len(stop_list),
                      "weekdayTrips": len(trip_list), "observedEdgesWithHour": len(hourly),
                      "observedEdgesAllHours": len(all_hours), "rawObservationSamples": network["meta"]["occupancyCount"]}, indent=2))


if __name__ == "__main__":
    main()
