const STOP_DATA_URL = "/data/stops.json";
const ROUTE_DATA_URL = "/data/regional-bus-network.json";
const API_URL = "/api/location";
const MAX_INITIAL_WAIT_MINUTES = 90;
const MAX_TRIP_STOPS = 16;
const DAY_BITS = [1, 2, 4, 8, 16, 32, 64];

const pages = [...document.querySelectorAll(".page")];
const originInput = document.querySelector("#originInput");
const destinationInput = document.querySelector("#destinationInput");
const toast = document.querySelector("#toast");
let stops = [];
let networkPromise;
let network;
let currentPosition = null;
let currentStartCandidates = [];
let currentEndCandidates = [];
let currentRoutes = [];
let currentSearchDate = null;
let selectedRoute = null;
let sortMode = "recommended";
let activePage = "plan";
let activeRideId = null;
let uploadInProgress = false;
let activeWatchId = null;
let uploadTimer = null;
let lastPosition = null;
let lastUploadedAt = 0;
let companionTimer = null;

const el = (selector) => document.querySelector(selector);
const norm = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 3500);
}

function go(page) {
  if (!document.querySelector(`[data-page="${page}"]`)) return;
  activePage = page;
  pages.forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("active", active);
    item.hidden = !active;
  });
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.go === page || (page === "results" || page === "detail" || page === "ride") && item.dataset.go === "plan"));
  window.scrollTo({ top: 0, behavior: "smooth" });
  window.dispatchEvent(new CustomEvent("page:change", { detail: page }));
}

document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => go(button.dataset.go)));

async function loadStops() {
  const response = await fetch(STOP_DATA_URL, { cache: "force-cache" });
  if (!response.ok) throw new Error("Die Haltestellen konnten nicht geladen werden.");
  stops = await response.json();
  const list = el("#stopSuggestions");
  const unique = new Map();
  stops.forEach((stop) => {
    if (stop.name && stop.lat != null && stop.lon != null && !unique.has(norm(stop.name))) unique.set(norm(stop.name), stop.name);
  });
  const fragment = document.createDocumentFragment();
  [...unique.values()].sort((a, b) => a.localeCompare(b, "de")).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    fragment.append(option);
  });
  list.replaceChildren(fragment);
  renderHomeMap();
}

function loadNetwork() {
  if (!networkPromise) {
    networkPromise = fetch(ROUTE_DATA_URL, { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error("Der Regionalbus-Datensatz konnte nicht geladen werden.");
      return response.json();
    }).then(async (data) => {
      network = data;
      try {
        const eventResponse = await fetch("/data/local-events.json", { cache: "force-cache" });
        network.events = eventResponse.ok ? (await eventResponse.json()).events : [];
      } catch { network.events = []; }
      network.hourlyLoads = new Map(data.occupancyHourly.map((row) => [`${row[0]}|${row[1]}|${row[2]}|${row[3]}|${row[4]}`, [row[5], row[6]]]));
      network.pairLoads = new Map(data.occupancyAllHours.map((row) => [`${row[0]}|${row[1]}|${row[2]}|${row[3]}`, [row[4], row[5]]]));
      network.stopById = new Map(data.stops.map((stop, index) => [stop.id, { ...stop, index }]));
      network.weekdayIndexes = new Map();
      return data;
    });
  }
  return networkPromise;
}

function kmBetween(aLat, aLon, bLat, bLon) {
  const toRad = (n) => n * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(aa));
}

function nearestStops(lat, lon, limit = 6) {
  return stops.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
    .map((stop) => ({ stop, km: kmBetween(lat, lon, stop.lat, stop.lon) }))
    .sort((a, b) => a.km - b.km).slice(0, limit);
}

function stopMatches(query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const starts = [], contains = [];
  for (const stop of stops) {
    const name = norm(stop.name);
    if (name === q) starts.push(stop);
    else if (name.startsWith(q)) starts.push(stop);
    else if (name.includes(q)) contains.push(stop);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

function locateAndFill() {
  if (!navigator.geolocation) {
    notify("Dieses Gerät unterstützt keine Standortabfrage. Bitte Start-Haltestelle eingeben.");
    return;
  }
  el("#locationStatus").textContent = "Standort wird gesucht";
  navigator.geolocation.getCurrentPosition((position) => {
    currentPosition = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp };
    window.dispatchEvent(new CustomEvent("location:updated", { detail: currentPosition }));
    const nearby = nearestStops(currentPosition.lat, currentPosition.lon, 1)[0];
    if (nearby && nearby.km <= 2) {
      originInput.value = `Mein Standort · ${nearby.stop.name}`;
      originInput.dataset.stopId = nearby.stop.id;
    } else {
      originInput.value = "Mein Standort";
      delete originInput.dataset.stopId;
    }
    el("#locationStatus").textContent = "Standort aktualisiert";
    el("#locationStatus").classList.add("is-live");
    el("#locationMessage").textContent = nearby ? `Nächste MVV-Haltestelle: ${nearby.stop.name} · etwa ${Math.round(nearby.km * 1000)} m.` : "Standort gefunden. In der Nähe wurde keine passende MVV-Haltestelle gefunden.";
    el("#homeMapLabel").textContent = `${currentPosition.lat.toFixed(5)}, ${currentPosition.lon.toFixed(5)} · Genauigkeit ±${Math.round(currentPosition.accuracy)} m`;
    renderHomeMap();
  }, (error) => {
    el("#locationStatus").textContent = "Standort nicht verfügbar";
    const message = error.code === 1 ? "Standortzugriff wurde nicht erlaubt." : "Standort konnte nicht ermittelt werden.";
    el("#locationMessage").textContent = `${message} Sie können den Start manuell eingeben.`;
    notify(message);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
}

el("#useLocation").addEventListener("click", locateAndFill);
el("#locateButton").addEventListener("click", locateAndFill);

function renderHomeMap() {
  const svg = el("#homeMapSvg");
  if (!svg) return;
  svg.replaceChildren();
  if (!currentPosition) return;
  const near = nearestStops(currentPosition.lat, currentPosition.lon, 3).filter((x) => x.km < 2);
  const ns = "http://www.w3.org/2000/svg";
  const points = [{ lat: currentPosition.lat, lon: currentPosition.lon, name: "Ihr Standort", type: "user" }, ...near.map((x) => ({ lat: x.stop.lat, lon: x.stop.lon, name: x.stop.name, type: "stop" }))];
  const minLat = Math.min(...points.map((x) => x.lat)) - 0.008, maxLat = Math.max(...points.map((x) => x.lat)) + 0.008;
  const minLon = Math.min(...points.map((x) => x.lon)) - 0.012, maxLon = Math.max(...points.map((x) => x.lon)) + 0.012;
  const xy = (point) => [40 + (point.lon - minLon) / (maxLon - minLon || 1) * 560, 30 + (maxLat - point.lat) / (maxLat - minLat || 1) * 155];
  const [ux, uy] = xy(points[0]);
  near.forEach((item) => {
    const [x, y] = xy({ lat: item.stop.lat, lon: item.stop.lon });
    const line = document.createElementNS(ns, "line"); line.setAttribute("x1", ux); line.setAttribute("y1", uy); line.setAttribute("x2", x); line.setAttribute("y2", y); line.setAttribute("stroke", "#74977d"); line.setAttribute("stroke-dasharray", "5 5"); line.setAttribute("stroke-width", "2"); svg.append(line);
    const dot = document.createElementNS(ns, "circle"); dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", "6"); dot.setAttribute("fill", "#fff"); dot.setAttribute("stroke", "#17684f"); dot.setAttribute("stroke-width", "3"); svg.append(dot);
  });
  const user = document.createElementNS(ns, "circle"); user.setAttribute("cx", ux); user.setAttribute("cy", uy); user.setAttribute("r", "9"); user.setAttribute("fill", "#28677e"); user.setAttribute("stroke", "white"); user.setAttribute("stroke-width", "4"); svg.append(user);
}

function endpointStops(input, isOrigin) {
  const value = input.value.trim();
  const selectedId = input.dataset.stopId;
  if (isOrigin && currentPosition && (value === "Mein Standort" || value.startsWith("Mein Standort ·"))) {
    const nearby = nearestStops(currentPosition.lat, currentPosition.lon, 8).filter((x) => x.km <= 1.8);
    return nearby.map((x) => ({ ...x.stop, walkMinutes: Math.max(0, Math.ceil(x.km * 1000 / 68)), distanceKm: x.km }));
  }
  const exact = selectedId ? stops.find((stop) => stop.id === selectedId) : null;
  const matches = exact ? [exact] : stopMatches(value, 8);
  if (norm(value).startsWith("mein standort") && currentPosition) return endpointStops({ value: "Mein Standort" }, true);
  return matches.slice(0, 8).map((stop) => ({ ...stop, walkMinutes: 0, distanceKm: 0 }));
}

originInput.addEventListener("input", () => { delete originInput.dataset.stopId; });
destinationInput.addEventListener("input", () => { delete destinationInput.dataset.stopId; });
for (const input of [originInput, destinationInput]) {
  input.addEventListener("change", () => {
    const exact = stops.find((stop) => norm(stop.name) === norm(input.value));
    if (exact) input.dataset.stopId = exact.id;
  });
}

function fillVoiceRoute(transcript) {
  const clean = (text) => text.replace(/[.!?]+$/g, "").replace(/\b(bitte|fahren|reise|route|suchen)\b/gi, "").trim();
  const match = transcript.match(/(?:von|ab)\s+(.+?)\s+(?:nach|zu|zum|zur|bis)\s+(.+)/i)
    || transcript.match(/^(.+?)\s+nach\s+(.+)$/i);
  let startText = match ? clean(match[1]) : "";
  let endText = match ? clean(match[2]) : clean((transcript.match(/(?:nach|zu|zum|zur)\s+(.+)/i) || [])[1] || transcript);
  const selectStop = (query) => {
    const found = stopMatches(query, 12);
    return found.find((stop) => norm(stop.name) === norm(query)) || found[0] || null;
  };
  const startStop = startText ? selectStop(startText) : null;
  const endStop = selectStop(endText);
  if (!endStop) {
    notify(`Ziel „${endText}“ nicht gefunden. Bitte Haltestelle eingeben.`);
    return;
  }
  if (startText && !startStop) {
    notify(`Start „${startText}“ nicht gefunden. Bitte Haltestelle eingeben.`);
    return;
  }
  if (startStop) {
    originInput.value = startStop.name;
    originInput.dataset.stopId = startStop.id;
  } else if (currentPosition) {
    const nearby = nearestStops(currentPosition.lat, currentPosition.lon, 1)[0];
    if (nearby && nearby.km <= 2) {
      originInput.value = `Mein Standort · ${nearby.stop.name}`;
      originInput.dataset.stopId = nearby.stop.id;
    } else {
      originInput.value = "Mein Standort";
      delete originInput.dataset.stopId;
    }
  }
  destinationInput.value = endStop.name;
  destinationInput.dataset.stopId = endStop.id;
  notify("Start und Ziel eingesetzt. Bitte prüfen und Regionalbusse suchen.");
}

window.addEventListener("voice:route", (event) => fillVoiceRoute(event.detail?.transcript || ""));

function weekdayBit(date) {
  return DAY_BITS[date.getDay() === 0 ? 6 : date.getDay() - 1];
}

function dayGroupForDate(date) {
  return date.getDay() === 6 ? "sa" : date.getDay() === 0 ? "su" : "wd";
}

function dayIndex(bit) {
  if (network.weekdayIndexes.has(bit)) return network.weekdayIndexes.get(bit);
  const index = new Map();
  network.trips.forEach((trip, tripIndex) => {
    if ((trip[1] & bit) === 0) return;
    trip[3].forEach((point, position) => {
      const stopId = network.stops[point[0]].id;
      if (!index.has(stopId)) index.set(stopId, []);
      index.get(stopId).push([tripIndex, position, point[2]]);
    });
  });
  index.forEach((items) => items.sort((a, b) => a[2] - b[2]));
  network.weekdayIndexes.set(bit, index);
  return index;
}

function occupancyFor(line, fromId, toId, minute, dayGroup = "wd") {
  const hour = Math.floor(minute / 60) % 24;
  return network.hourlyLoads.get(`${line}|${fromId}|${toId}|${hour}|${dayGroup}`)
    || network.pairLoads.get(`${line}|${fromId}|${toId}|${dayGroup}`)
    || network.hourlyLoads.get(`${line}|${fromId}|${toId}|${hour}|any`)
    || network.pairLoads.get(`${line}|${fromId}|${toId}|any`)
    || null;
}

function getPreferences() {
  try { return JSON.parse(localStorage.getItem("gutankommenPreferences") || "{}"); } catch { return {}; }
}

function minimumTransferMinutes() {
  return getPreferences().extraTransferTime ? 12 : 5;
}

function eventRiskFor(route, date = currentSearchDate) {
  if (!network?.events?.length || !date) return false;
  const points = route.legs.flatMap((leg) => leg.stops).filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
  return network.events.some((event) => {
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (event.date !== dateKey) return false;
    if (event.time) {
      const [hour, minute] = event.time.split(":").map(Number);
      const eventMinute = hour * 60 + minute;
      const routeMinute = date.getHours() * 60 + date.getMinutes();
      if (Math.abs(routeMinute - eventMinute) > 180) return false;
    }
    return points.some((point) => kmBetween(point.lat, point.lon, event.lat, event.lon) <= event.radiusKm);
  });
}

function eventMatchesRouteAndTime(event, route, date) {
  if (!date) return false;
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (event.date !== dateKey) return false;
  if (event.time) {
    const [hour, minute] = event.time.split(":").map(Number);
    if (Math.abs((date.getHours() * 60 + date.getMinutes()) - (hour * 60 + minute)) > 180) return false;
  }
  return route.legs.flatMap((leg) => leg.stops).some((stop) => stop.lat != null && kmBetween(stop.lat, stop.lon, event.lat, event.lon) <= event.radiusKm);
}

function notifyEventContext(date) {
  const events = [...new Map(currentRoutes.flatMap((route) => network.events.filter((event) => eventMatchesRouteAndTime(event, route, date))).map((event) => [event.id, event])).values()];
  window.dispatchEvent(new CustomEvent("route:search-context", { detail: {
    events,
    routes: currentRoutes.map((route) => ({ eventRisk: Boolean(eventRiskFor(route, date)), peak: route.peak, lines: route.legs.map((leg) => `Bus ${leg.line}`) })),
  } }));
}

function makeLeg(tripIndex, boardPosition, endPosition, index, dayGroup) {
  const trip = network.trips[tripIndex];
  const route = network.routes[trip[0]];
  const sequence = trip[3];
  const stopsInLeg = sequence.slice(boardPosition, endPosition + 1).map((point) => {
    const stop = network.stops[point[0]];
    return { id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon, wheelchairBoarding: stop.wheelchairBoarding, arrival: point[1], departure: point[2] };
  });
  const classes = [];
  let count = 0;
  for (let p = boardPosition; p < endPosition; p += 1) {
    const fromId = network.stops[sequence[p][0]].id;
    const toId = network.stops[sequence[p + 1][0]].id;
    const load = occupancyFor(route[1], fromId, toId, sequence[p][2], dayGroup);
    classes.push(load ? load[0] : null);
    if (load) count += load[1];
  }
  const known = classes.filter((v) => v != null);
  const typical = known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
  const peak = known.length ? Math.max(...known) : null;
  return { line: route[1], routeName: route[2], headsign: trip[2], start: stopsInLeg[0], end: stopsInLeg.at(-1), stops: stopsInLeg, departure: sequence[boardPosition][2], arrival: sequence[endPosition][1], typical, peak, sampleCount: count };
}

function targetStopIds(candidates) {
  return new Set(candidates.map((item) => item.id));
}

function appendCandidate(results, legs, start, end, requestedAt, dayGroup) {
  const allLegStops = legs.flatMap((leg) => leg.stops);
  const totalEnd = legs.at(-1).arrival + end.walkMinutes;
  const duration = totalEnd - requestedAt;
  if (duration <= 0 || duration > 260) return;
  const pathKey = `${legs.map((leg) => `${leg.line}:${leg.start.id}:${leg.end.id}`).join("/")}:${legs[0].departure}`;
  if (results.some((route) => route.key === pathKey)) return;
  const accessibilityFlags = [...allLegStops, start, end].map((stop) => stop.wheelchairBoarding).filter((value) => value === 1 || value === 2);
  const accessibility = accessibilityFlags.includes(2) ? "not-accessible" : accessibilityFlags.length && accessibilityFlags.length === [...allLegStops, start, end].length ? "accessible" : "unknown";
  const classes = legs.map((leg) => leg.peak).filter((value) => value != null);
  const typicals = legs.map((leg) => leg.typical).filter((value) => value != null);
  results.push({
    key: pathKey, legs, start, end, startMinute: requestedAt, endMinute: totalEnd, dayGroup,
    duration, transfers: legs.length - 1, peak: classes.length ? Math.max(...classes) : null,
    typical: typicals.length ? Math.round(typicals.reduce((a, b) => a + b, 0) / typicals.length) : null,
    sampleCount: legs.reduce((sum, leg) => sum + leg.sampleCount, 0),
    allStopIds: [...new Set(allLegStops.map((stop) => stop.id))],
    accessibility,
  });
}

function generateRoutes(startCandidates, endCandidates, departureDate) {
  const bit = weekdayBit(departureDate);
  const dayGroup = dayGroupForDate(departureDate);
  const index = dayIndex(bit);
  const targetIds = targetStopIds(endCandidates);
  const requestedAt = departureDate.getHours() * 60 + departureDate.getMinutes();
  const found = [];
  const firstVisits = [];
  for (const start of startCandidates) {
    const readyAt = requestedAt + start.walkMinutes;
    for (const visit of index.get(start.id) || []) {
      if (visit[2] < readyAt || visit[2] > readyAt + MAX_INITIAL_WAIT_MINUTES) continue;
      firstVisits.push({ ...start, visit });
    }
  }
  firstVisits.sort((a, b) => a.visit[2] - b.visit[2]);
  const limitedFirst = firstVisits.slice(0, 160);

  for (const first of limitedFirst) {
    const [firstTripIndex, firstBoard, firstDeparture] = first.visit;
    const firstTrip = network.trips[firstTripIndex];
    const firstSeq = firstTrip[3];
    const firstRoute = network.routes[firstTrip[0]];
    const firstOrigin = network.stops[firstSeq[firstBoard][0]];
    const startCandidate = first;
    let transfersConsidered = 0;
    for (let transferPosition = firstBoard + 1; transferPosition < firstSeq.length; transferPosition += 1) {
      const transferPoint = firstSeq[transferPosition];
      const transferStop = network.stops[transferPoint[0]];
      if (targetIds.has(transferStop.id)) {
        for (const end of endCandidates.filter((item) => item.id === transferStop.id)) {
          appendCandidate(found, [makeLeg(firstTripIndex, firstBoard, transferPosition, index, dayGroup)], startCandidate, end, requestedAt, dayGroup);
        }
      }
      if (transferPoint[1] - firstDeparture > 100 || transferPosition - firstBoard > MAX_TRIP_STOPS || targetIds.has(transferStop.id)) continue;
      const nextVisits = index.get(transferStop.id) || [];
      let consideredHere = 0;
      let examinedHere = 0;
      for (const visit of nextVisits) {
        const [secondTripIndex, secondBoard, secondDeparture] = visit;
        if (secondDeparture < transferPoint[1] + minimumTransferMinutes()) continue;
        if (secondDeparture > transferPoint[1] + 80) break;
        if (++examinedHere > 30) break;
        const secondTrip = network.trips[secondTripIndex];
        const secondRoute = network.routes[secondTrip[0]];
        if (firstRoute[0] === secondRoute[0] || firstTripIndex === secondTripIndex) continue;
        const secondSeq = secondTrip[3];
        let reached = false;
        for (let endPosition = secondBoard + 1; endPosition < secondSeq.length; endPosition += 1) {
          const endId = network.stops[secondSeq[endPosition][0]].id;
          if (!targetIds.has(endId)) continue;
          for (const end of endCandidates.filter((item) => item.id === endId)) {
            const legA = makeLeg(firstTripIndex, firstBoard, transferPosition, index, dayGroup);
            const legB = makeLeg(secondTripIndex, secondBoard, endPosition, index, dayGroup);
            appendCandidate(found, [legA, legB], startCandidate, end, requestedAt, dayGroup);
          }
          reached = true;
        }
        if (reached && ++consideredHere >= 3) break;
      }
      if (++transfersConsidered >= 650) break;
    }
  }

  const unique = new Map();
  found.forEach((route) => { if (!unique.has(route.key)) unique.set(route.key, route); });
  const preferences = getPreferences();
  return [...unique.values()].filter((route) => !(preferences.stepFree && route.accessibility === "not-accessible"));
}

function scoreRoute(route) {
  const levels = route.legs.flatMap((leg) => leg.stops.slice(0, -1).map((_, i) => {
    const next = leg.stops[i + 1];
    return occupancyFor(leg.line, leg.stops[i].id, next.id, leg.stops[i].departure, route.dayGroup)?.[0] ?? 2;
  }));
  const crowdCost = levels.reduce((sum, level) => sum + (level === 1 ? 0 : level === 2 ? 8 : 22), 0);
  const preferences = getPreferences();
  const transferCost = route.transfers * (preferences.fewTransfers ? 70 : 8);
  const walkingCost = (route.start.walkMinutes || 0) + (route.end.walkMinutes || 0);
  const accessibilityCost = preferences.stepFree ? (route.accessibility === "accessible" ? 0 : 600) : 0;
  const rollatorCost = preferences.rollator ? route.transfers * 24 + walkingCost * 12 : 0;
  const eventCost = eventRiskFor(route) ? 3000 : 0;
  const seatCost = preferences.preferSeat ? crowdCost * 5 : crowdCost;
  if (sortMode === "fast" && !preferences.preferSeat) return route.duration + transferCost + accessibilityCost + rollatorCost + eventCost;
  if (sortMode === "quiet" || preferences.preferSeat) return (route.peak || 2) * 100 + seatCost + transferCost + walkingCost + accessibilityCost + rollatorCost + eventCost;
  return (route.peak || 2) * 100 + seatCost + transferCost + route.duration * 0.2 + walkingCost + accessibilityCost + rollatorCost + eventCost;
}

function formatTime(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function formatDateTimeLocal(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function crowdLabel(level) {
  if (level === 1) return "Wenig gefüllt";
  if (level === 2) return "Mittel gefüllt";
  if (level === 3) return "Stark gefüllt";
  return "Keine Messwerte";
}

function meter(level) {
  const normalized = level || 0;
  return `<span class="load-meter level-${normalized}" aria-label="${esc(crowdLabel(level))}"><span></span><span></span><span></span></span>`;
}

function routeCard(route, index) {
  const badgeClass = route.peak === 3 ? "full" : route.peak === 2 ? "medium" : "";
  const badge = route.peak === 3 ? "Stark gefüllter Abschnitt" : route.peak === 2 ? "Teils mittel gefüllt" : route.peak === 1 ? "Meist wenig gefüllt" : "Noch keine Messwerte";
  const lineChips = route.legs.map((leg) => `<span class="line-chip">Bus ${esc(leg.line)}</span>`).join("");
  const preferences = getPreferences();
  const sub = route.legs.length > 1 ? `${route.transfers} Umstieg · ${route.legs.map((leg) => esc(leg.end.name)).slice(0, -1).join(" · ")}` : "Direkte Busverbindung";
  const accessNote = (preferences.stepFree || preferences.rollator) ? `<p class="route-safety-note ${route.accessibility === "accessible" ? "verified" : "unverified"}">${route.accessibility === "accessible" ? "Barrierefreiheit laut Fahrplandaten gemeldet" : route.accessibility === "not-accessible" ? "Barrierefreiheit nicht gegeben" : "Barrierefreiheit nicht bestätigt"}</p>` : "";
  const eventNote = eventRiskFor(route) ? `<p class="route-safety-note event-inline">Veranstaltungsandrang in der Nähe möglich</p>` : "";
  return `<article class="route-card" role="button" tabindex="0" data-route-index="${index}" aria-label="Route ${index + 1}: ${esc(route.legs.map((leg) => `Bus ${leg.line}`).join(", "))}, ${route.duration} Minuten, ${esc(badge)}">
    <div class="route-card-head"><div><p class="route-card-title">${route.legs.length > 1 ? `${route.legs.map((leg) => `Bus ${esc(leg.line)}`).join(" · ")}` : `Bus ${esc(route.legs[0].line)}`}</p><p class="route-card-subtitle">${sub}</p></div><span class="route-badge ${badgeClass}">${esc(badge)}</span></div>
    <div class="route-times"><strong>${formatTime(route.startMinute)}</strong><span>bis</span><strong>${formatTime(route.endMinute)}</strong><span class="time-duration">${route.duration} Min.</span></div>
    <div class="bus-lines">${lineChips}</div>
    <div class="occupancy-row">${meter(route.peak)}<span class="load-label">${esc(crowdLabel(route.peak))}</span></div>
    ${accessNote}${eventNote}
    <div class="route-card-foot"><span>${route.transfers ? `${route.transfers} Umstieg` : "Ohne Umstieg"}</span><strong>Details ansehen</strong></div>
  </article>`;
}

function sortedRoutes() {
  return currentRoutes.slice().sort((a, b) => scoreRoute(a) - scoreRoute(b));
}

function drawMap(svg, points, current = null, width = 720, height = 260) {
  const ns = "http://www.w3.org/2000/svg";
  svg.replaceChildren();
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (valid.length < 2 && !current) return;
  const boundsPoints = current && valid.length ? [...valid, current] : valid;
  let minLat = Math.min(...boundsPoints.map((x) => x.lat)), maxLat = Math.max(...boundsPoints.map((x) => x.lat));
  let minLon = Math.min(...boundsPoints.map((x) => x.lon)), maxLon = Math.max(...boundsPoints.map((x) => x.lon));
  const latPad = Math.max((maxLat - minLat) * .15, .006), lonPad = Math.max((maxLon - minLon) * .15, .008);
  minLat -= latPad; maxLat += latPad; minLon -= lonPad; maxLon += lonPad;
  const xy = (p) => [30 + (p.lon - minLon) / (maxLon - minLon || 1) * (width - 60), 25 + (maxLat - p.lat) / (maxLat - minLat || 1) * (height - 55)];
  const pathByLeg = [];
  const chunks = [];
  let last = null;
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    if (point.legStart && chunks.length) { pathByLeg.push(chunks.splice(0)); }
    chunks.push(point);
    last = point;
  }
  if (chunks.length) pathByLeg.push(chunks);
  pathByLeg.forEach((chunk) => {
    if (chunk.length < 2) return;
    const polyline = document.createElementNS(ns, "polyline");
    polyline.setAttribute("points", chunk.map((point) => xy(point).join(",")).join(" "));
    polyline.setAttribute("fill", "none"); polyline.setAttribute("stroke", "#17684f"); polyline.setAttribute("stroke-width", "7"); polyline.setAttribute("stroke-linecap", "round"); polyline.setAttribute("stroke-linejoin", "round"); svg.append(polyline);
  });
  valid.forEach((point, i) => {
    const [x, y] = xy(point);
    const circle = document.createElementNS(ns, "circle"); circle.setAttribute("cx", x); circle.setAttribute("cy", y); circle.setAttribute("r", i === 0 || i === valid.length - 1 ? 8 : 5); circle.setAttribute("fill", i === 0 ? "#17684f" : i === valid.length - 1 ? "#a36323" : "white"); circle.setAttribute("stroke", "white"); circle.setAttribute("stroke-width", "3"); svg.append(circle);
  });
  if (current && Number.isFinite(current.lat) && Number.isFinite(current.lon)) {
    const [x, y] = xy(current);
    const halo = document.createElementNS(ns, "circle"); halo.setAttribute("cx", x); halo.setAttribute("cy", y); halo.setAttribute("r", "14"); halo.setAttribute("fill", "#28677e44"); svg.append(halo);
    const dot = document.createElementNS(ns, "circle"); dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", "8"); dot.setAttribute("fill", "#28677e"); dot.setAttribute("stroke", "white"); dot.setAttribute("stroke-width", "4"); svg.append(dot);
  }
  if (last) {
    const label = document.createElementNS(ns, "text"); const [x, y] = xy(valid[0]); label.setAttribute("x", x + 12); label.setAttribute("y", y - 10); label.setAttribute("fill", "#31443a"); label.setAttribute("font-size", "12"); label.setAttribute("font-family", "system-ui"); label.textContent = valid[0].name || "Start"; svg.append(label);
  }
}

function routePoints(route) {
  const points = [];
  route.legs.forEach((leg) => {
    leg.stops.forEach((stop, index) => {
      const next = leg.stops[index + 1];
      const load = next ? occupancyFor(leg.line, stop.id, next.id, stop.departure, route.dayGroup) : null;
      points.push({ ...stop, level: load?.[0] ?? null, legStart: index === 0 });
    });
  });
  return points;
}

function renderRoutes() {
  const sorted = sortedRoutes().slice(0, 15);
  const list = el("#routeList");
  if (!sorted.length) {
    list.innerHTML = `<div class="empty-state"><h2>Keine passende Regionalbusverbindung gefunden</h2><p>Prüfen Sie Haltestellen in der Nähe oder wählen Sie eine spätere Abfahrt. Es werden nur MVV-Regionalbusse aus dem bereitgestellten Datensatz verwendet.</p></div>`;
    el("#resultsStatus").textContent = "";
    return;
  }
  list.innerHTML = sorted.map(routeCard).join("");
  el("#resultsStatus").textContent = `${sorted.length} passende Verbindung${sorted.length === 1 ? "" : "en"} · ${network.meta.occupancyCount.toLocaleString("de-DE")} historische Messungen insgesamt`;
  list.querySelectorAll(".route-card").forEach((card) => {
    const activate = () => { selectedRoute = sorted[Number(card.dataset.routeIndex)]; showDetail(selectedRoute); };
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
  });
}

function walkText(candidate) {
  if (!candidate.walkMinutes) return "";
  return `<div class="transfer-note">Zu Fuß zur Haltestelle ${esc(candidate.name)} · etwa ${candidate.walkMinutes} Min.</div>`;
}

function showDetail(route) {
  selectedRoute = route;
  const lines = route.legs.map((leg) => `Bus ${leg.line}`).join(" · ");
  el("#detailTitle").textContent = `${route.legs.length > 1 ? "Ruhiger umsteigen" : "Direkt mit dem Regionalbus"}`;
  const preferences = getPreferences();
  const safetyWarning = (preferences.stepFree || preferences.rollator) && route.accessibility !== "accessible" ? `<p class="route-access-warning" role="status">Bitte prüfen: Barrierefreiheit ist für diese Route nicht bestätigt.</p>` : "";
  el("#detailSummary").innerHTML = `<div class="detail-summary-title">${esc(lines)} · ${route.duration} Minuten</div><div class="detail-summary-meta">${formatTime(route.startMinute)} bis ${formatTime(route.endMinute)} · ${route.transfers ? `${route.transfers} Umstieg` : "ohne Umstieg"} · ${esc(crowdLabel(route.peak))}</div>${safetyWarning}`;
  const points = routePoints(route);
  window.dispatchEvent(new CustomEvent("route:map", { detail: { points } }));
  const html = [];
  if (route.start.walkMinutes) html.push(walkText(route.start));
  route.legs.forEach((leg, legIndex) => {
    if (legIndex > 0) html.push(`<div class="transfer-note">Umstieg an ${esc(leg.start.name)} · mindestens ${minimumTransferMinutes()} Min. Umsteigezeit</div>`);
    const stopRows = leg.stops.map((stop, index) => {
      const next = leg.stops[index + 1];
      const load = next ? occupancyFor(leg.line, stop.id, next.id, stop.departure, route.dayGroup) : null;
      const time = index === 0 ? stop.departure : stop.arrival;
      return `<div class="stop-row"><span class="stop-rail" aria-hidden="true"></span><span class="stop-name">${esc(stop.name)}</span><span class="stop-time">${formatTime(time)}</span>${next ? `<div class="load-detail">${meter(load?.[0] ?? null)}<span>${esc(crowdLabel(load?.[0] ?? null))}${load ? ` · ${load[1].toLocaleString("de-DE")} Messwerte` : ""}</span></div>` : ""}</div>`;
    }).join("");
    html.push(`<article class="detail-leg"><div class="leg-head"><span class="leg-title">Bus ${esc(leg.line)}</span><span class="leg-time">${formatTime(leg.departure)}–${formatTime(leg.arrival)}</span></div><p class="leg-route-name">${esc(leg.routeName)} · Richtung ${esc(leg.headsign)}</p>${stopRows}</article>`);
  });
  if (route.end.walkMinutes) html.push(`<div class="transfer-note">Von ${esc(route.end.name)} weiter zu Fuß · etwa ${route.end.walkMinutes} Min.</div>`);
  el("#detailSteps").innerHTML = html.join("");
  const confidence = route.sampleCount >= 100 ? "Viele historische Beobachtungen" : route.sampleCount >= 10 ? "Einige historische Beobachtungen" : route.sampleCount ? "Wenige historische Beobachtungen" : "Keine passenden Messwerte";
  el("#routeSourceCard").innerHTML = `<h2>So ist die Einschätzung gemeint</h2><p>${esc(crowdLabel(route.peak))} ist eine historische Schätzung aus ${route.sampleCount.toLocaleString("de-DE")} passenden Streckenmessungen (${esc(confidence)}). Auslastung ist kein Sicherheitsurteil und keine aktuelle Belegung. Fahrplanmuster: ${esc(network.meta.scheduleStart)} bis ${esc(network.meta.scheduleEnd)}.</p>`;
  if (preferences.readAloud && "speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(`Ihre Fahrt mit ${lines}. Abfahrt ${formatTime(route.startMinute)}. ${route.transfers ? `${route.transfers} Umstieg mit mindestens ${minimumTransferMinutes()} Minuten.` : "Direkte Verbindung."} Historische Auslastung: ${crowdLabel(route.peak)}.`);
    utterance.lang = "de-DE";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
  const origin = route.start.lat != null ? `${route.start.lat},${route.start.lon}` : route.start.name;
  const dest = route.end.lat != null ? `${route.end.lat},${route.end.lon}` : route.end.name;
  const waypoints = route.legs.slice(0, -1).map((leg) => `${leg.end.lat},${leg.end.lon}`).join("|");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1"); url.searchParams.set("origin", origin); url.searchParams.set("destination", dest); url.searchParams.set("travelmode", "transit");
  if (waypoints) url.searchParams.set("waypoints", waypoints);
  el("#googleDirections").href = url.toString();
  go("detail");
}

async function searchRoutes() {
  const start = endpointStops(originInput, true);
  const end = endpointStops(destinationInput, false);
  if (!start.length) { notify("Start nicht gefunden. Bitte Standortfreigabe nutzen oder eine Haltestelle auswählen."); go("plan"); originInput.focus(); return; }
  if (!end.length) { notify("Bitte eine MVV-Haltestelle als Ziel auswählen."); go("plan"); destinationInput.focus(); return; }
  if (currentPosition && currentPosition.accuracy > 3000) notify("Der Standort ist ungenau. Bitte prüfen Sie den Startpunkt.");
  go("results");
  el("#routeList").innerHTML = `<div class="empty-state"><h2>Verbindungen werden gesucht</h2><p>Wir prüfen Fahrten auf MVV-Regionalbuslinien.</p></div>`;
  el("#resultsStatus").textContent = "Fahrplandaten werden geladen …";
  try {
    await loadNetwork();
    const dateInput = el("#departureInput");
    const chosen = dateInput.value ? new Date(dateInput.value) : new Date(Date.now() + 5 * 60000);
    currentSearchDate = chosen;
    currentStartCandidates = start; currentEndCandidates = end;
    currentRoutes = generateRoutes(start, end, chosen);
    currentRoutes.forEach((route) => { route.eventRisk = Boolean(eventRiskFor(route, chosen)); });
    notifyEventContext(chosen);
    el("#routeSummary").textContent = `${start[0].name} → ${end[0].name}`;
    const startDate = network.meta.scheduleStart;
    const endDate = network.meta.scheduleEnd;
    el("#scheduleNotice").textContent = `Fahrplanmuster vom ${startDate} bis ${endDate}. Diese Daten sind älter als ein aktueller Fahrplan und können Änderungen oder Ausfälle nicht abbilden. Die Routen hier sind nur ein Planungsprototyp; bitte vor der Fahrt extern prüfen.`;
    renderRoutes();
  } catch (error) {
    el("#resultsStatus").textContent = "";
    el("#routeList").innerHTML = `<div class="empty-state"><h2>Fahrplandaten gerade nicht verfügbar</h2><p>${esc(error.message)}</p></div>`;
  }
}

el("#routeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nearDate = new Date(Date.now() + 5 * 60000);
  el("#departureInput").value = formatDateTimeLocal(nearDate);
  await searchRoutes();
});
el("#refreshRoutes").addEventListener("click", searchRoutes);
document.querySelectorAll(".sort-tab").forEach((button) => button.addEventListener("click", () => {
  sortMode = button.dataset.sort;
  document.querySelectorAll(".sort-tab").forEach((item) => item.classList.toggle("selected", item === button));
  renderRoutes();
}));

window.addEventListener("preferences:change", (event) => {
  if (currentSearchDate && currentStartCandidates.length && currentEndCandidates.length) {
    currentRoutes = generateRoutes(currentStartCandidates, currentEndCandidates, currentSearchDate);
    currentRoutes.forEach((route) => { route.eventRisk = Boolean(eventRiskFor(route, currentSearchDate)); });
    renderRoutes();
    notifyEventContext(currentSearchDate);
  }
  if (event.detail?.readAloud) notify("Vorlesen ist eingeschaltet. Routendetails werden vorgelesen.");
});

function routeSharePayload(route) {
  return {
    origin: route.start.name,
    destination: route.end.name,
    departure: formatTime(route.startMinute),
    arrival: formatTime(route.endMinute),
    duration: route.duration,
    routeLines: route.legs.map((leg) => `Bus ${leg.line}`),
    stops: route.legs.map((leg) => ({
      line: leg.line,
      routeName: leg.routeName,
      from: { id: leg.start.id, name: leg.start.name, lat: leg.start.lat, lon: leg.start.lon, time: formatTime(leg.departure) },
      to: { id: leg.end.id, name: leg.end.name, lat: leg.end.lat, lon: leg.end.lon, time: formatTime(leg.arrival) },
      class: leg.peak,
      intermediate: leg.stops.slice(1, -1).map((stop) => ({ name: stop.name, lat: stop.lat, lon: stop.lon, time: formatTime(stop.arrival) })),
    })),
    scheduleReference: `${network.meta.scheduleStart}–${network.meta.scheduleEnd}`,
  };
}

el("#startRide").addEventListener("click", () => {
  if (!selectedRoute) return;
  activeRideId = null;
  lastPosition = null; lastUploadedAt = 0;
  el("#shareFamilyRide").disabled = true;
  el("#rideRouteLabel").textContent = `${selectedRoute.legs.map((leg) => `Bus ${leg.line}`).join(" · ")} · ${selectedRoute.start.name} bis ${selectedRoute.end.name}`;
  el("#rideLiveStatus").textContent = "Aus";
  el("#rideStatusTitle").textContent = "Mit vertrauter Person teilen";
  el("#rideExplanation").textContent = "Wenn Sie die Freigabe starten, fragt Ihr Gerät nach Standortzugriff. Ihre aktuelle Position wird dann an das private GutAnkommen-Backend übertragen. Nur Personen mit dem persönlichen Begleitlink können sie abrufen. Sie können die Übertragung jederzeit beenden.";
  el("#enableSharing").disabled = false;
  el("#enableSharing").textContent = "Standortfreigabe starten";
  el("#shareLink").disabled = true;
  el("#shareLink").textContent = "Begleitlink wird nach dem ersten Standort verfügbar";
  el("#rideUpdated").textContent = "";
  el("#riderPositionLabel").textContent = "Standort noch nicht freigegeben";
  drawMap(el("#rideMapSvg"), routePoints(selectedRoute));
  go("ride");
});

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function writeLocation(position) {
  if (!activeRideId || !selectedRoute || uploadInProgress) return;
  uploadInProgress = true;
  const payload = {
    location: { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: Date.now() },
    route: routeSharePayload(selectedRoute),
  };
  let response;
  try {
    response = await fetch(`${API_URL}/${activeRideId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store",
    });
    if (!response.ok) throw new Error("Die sichere Standortverbindung ist gerade nicht verfügbar.");
  } catch (error) {
    uploadInProgress = false;
    throw error;
  }
  const now = new Date();
  el("#rideLiveStatus").textContent = "Wird geteilt";
  el("#rideLiveStatus").classList.add("is-live");
  el("#rideStatusTitle").textContent = "Standort wird geteilt";
  el("#rideExplanation").textContent = "Ihr Begleitlink ist bereit. Er zeigt den letzten Standort und die von Ihnen gewählte Busroute. Standortfreigabe jederzeit beenden.";
  el("#shareLink").disabled = false;
  el("#shareLink").textContent = "Begleitlink senden";
  el("#rideUpdated").textContent = `Letzte Übertragung: ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
  el("#riderPositionLabel").textContent = `Standort übermittelt · ±${Math.round(position.coords.accuracy)} m Genauigkeit`;
  drawMap(el("#rideMapSvg"), routePoints(selectedRoute), { lat: position.coords.latitude, lon: position.coords.longitude });
  lastPosition = position;
  lastUploadedAt = Date.now();
  sessionStorage.setItem("gutankommenRide", JSON.stringify({ id: activeRideId, route: routeSharePayload(selectedRoute) }));
  el("#shareFamilyRide").disabled = false;
  uploadInProgress = false;
}

function stopWatch() {
  if (activeWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(activeWatchId);
  activeWatchId = null;
  clearInterval(uploadTimer); uploadTimer = null;
}

el("#enableSharing").addEventListener("click", () => {
  if (!navigator.geolocation) { notify("Dieses Gerät unterstützt keine Standortfreigabe."); return; }
  el("#enableSharing").disabled = true;
  el("#enableSharing").textContent = "Standort wird abgerufen …";
  activeRideId = makeId();
  const onPosition = async (position) => {
    lastPosition = position;
    if (Date.now() - lastUploadedAt < 12000) return;
    try { await writeLocation(position); }
    catch (error) {
      el("#enableSharing").disabled = false;
      el("#enableSharing").textContent = "Erneut versuchen";
      el("#rideLiveStatus").textContent = "Verbindung fehlgeschlagen";
      el("#rideExplanation").textContent = `${error.message} Ihre Position wurde nicht geteilt. Prüfen Sie die Internetverbindung und versuchen Sie es erneut.`;
      notify(error.message);
    }
  };
  const onError = (error) => {
    stopWatch();
    activeRideId = null;
    el("#enableSharing").disabled = false;
    el("#enableSharing").textContent = "Standortfreigabe erneut starten";
    el("#rideLiveStatus").classList.remove("is-live");
    el("#rideLiveStatus").textContent = "Aus";
    notify(error.code === 1 ? "Standortfreigabe wurde abgelehnt." : "Der aktuelle Standort ist gerade nicht verfügbar.");
  };
  navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  activeWatchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, timeout: 30000, maximumAge: 10000 });
  uploadTimer = setInterval(() => { if (lastPosition && Date.now() - lastUploadedAt >= 28000) onPosition(lastPosition); }, 30000);
});

function companionUrl() {
  const url = new URL(location.href);
  url.search = ""; url.hash = ""; url.searchParams.set("begleitung", activeRideId);
  return url.toString();
}

async function shareRideLink() {
  const saved = sessionStorage.getItem("gutankommenRide");
  const id = activeRideId || (saved ? JSON.parse(saved).id : null);
  if (!id) { notify("Starten Sie zuerst die Standortfreigabe."); return; }
  const currentId = activeRideId;
  activeRideId = id;
  const url = companionUrl();
  activeRideId = currentId;
  const route = selectedRoute;
  const shareText = route ? `Meine Regionalbusfahrt: ${route.start.name} nach ${route.end.name}. Der Link zeigt meinen Live-Standort während der Fahrt.` : "Begleite meine GutAnkommen-Fahrt über diesen privaten Link.";
  try {
    if (navigator.share) await navigator.share({ title: "GutAnkommen – geteilte Fahrt", text: shareText, url });
    else { await navigator.clipboard.writeText(url); notify("Begleitlink kopiert. Senden Sie ihn nur an Ihre vertraute Person."); }
  } catch (error) {
    if (error.name !== "AbortError") { try { await navigator.clipboard.writeText(url); notify("Begleitlink kopiert."); } catch { notify("Link konnte nicht kopiert werden. Bitte versuchen Sie es erneut."); } }
  }
}
el("#shareLink").addEventListener("click", shareRideLink);
el("#shareFamilyRide").addEventListener("click", shareRideLink);

async function deleteRide() {
  stopWatch();
  if (activeRideId) {
    try { await fetch(`${API_URL}/${activeRideId}`, { method: "DELETE", cache: "no-store" }); } catch { /* The API also expires links after four hours. */ }
  }
  activeRideId = null; lastPosition = null;
  el("#shareFamilyRide").disabled = true;
  sessionStorage.removeItem("gutankommenRide");
}

el("#endRide").addEventListener("click", async () => {
  await deleteRide();
  notify("Standortfreigabe beendet. Der Begleitlink ist gelöscht.");
  go("plan");
});
el("#arrivedButton").addEventListener("click", async () => {
  await deleteRide();
  notify("Ankunft bestätigt. Die Standortfreigabe ist beendet.");
  go("plan");
});

function routeMapStops(route) {
  if (!route?.stops) return [];
  const points = [];
  route.stops.forEach((leg) => {
    if (leg.from) points.push({ ...leg.from, name: leg.from.name, legStart: true });
    (leg.intermediate || []).forEach((stop) => points.push(stop));
    if (leg.to) points.push(leg.to);
  });
  return points;
}

function nearestRouteStop(position, route) {
  const points = routeMapStops(route);
  const nearest = points.map((stop) => ({ stop, km: kmBetween(position.lat, position.lon, stop.lat, stop.lon) })).sort((a, b) => a.km - b.km)[0];
  return nearest || null;
}

function showCompanionError(message) {
  el("#companionSubhead").textContent = message;
  el("#companionDetails").innerHTML = `<p>${esc(message)}</p>`;
}

async function refreshCompanion(id) {
  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (response.status === 404 || response.status === 410) {
      clearInterval(companionTimer); companionTimer = null;
      showCompanionError("Diese Fahrt wurde beendet oder der Begleitlink ist abgelaufen.");
      return;
    }
    if (!response.ok) throw new Error("Standort vorübergehend nicht erreichbar.");
    const record = await response.json();
    const route = record.route;
    const points = routeMapStops(route);
    drawMap(el("#companionMapSvg"), points, record.location);
    const nearby = nearestRouteStop(record.location, route);
    const ageSeconds = Math.max(0, Math.floor((Date.now() - record.location.timestamp) / 1000));
    const proximity = nearby ? `${nearby.stop.name}${nearby.km < 1.5 ? ` · etwa ${Math.round(nearby.km * 1000)} m entfernt` : " · weiter von der Route entfernt"}` : "Standort erhalten";
    el("#companionSubhead").textContent = `${route.origin} → ${route.destination}`;
    el("#companionPositionLabel").textContent = `Letzter Standort nahe ${proximity}`;
    const lines = (route.routeLines || []).map((line) => `<span class="line-chip">${esc(line)}</span>`).join(" ");
    const legs = (route.stops || []).map((leg) => `<p><strong>Bus ${esc(leg.line)}</strong> · ${esc(leg.from?.name)} ${esc(leg.from?.time)} bis ${esc(leg.to?.name)} ${esc(leg.to?.time)} · ${esc(crowdLabel(leg.class))}</p>`).join("");
    el("#companionDetails").innerHTML = `<h2>Route und Fahrt</h2><p>${esc(route.departure)}–${esc(route.arrival)} · etwa ${Number(route.duration)} Minuten</p><div class="bus-lines">${lines}</div>${legs}<p>Fahrplanmuster ${esc(route.scheduleReference)} · keine Echtzeit-Fahrplanauskunft.</p>`;
    const updated = new Date(record.location.timestamp);
    el("#companionUpdated").textContent = ageSeconds < 90 ? `Standort vor ${ageSeconds} Sek. aktualisiert · Genauigkeit ±${Math.round(record.location.accuracy)} m` : `Letzter Standort vor ${Math.floor(ageSeconds / 60)} Min. · möglicherweise nicht aktuell`;
  } catch {
    el("#companionSubhead").textContent = "Verbindung zur Fahrt wird wiederhergestellt …";
  }
}

function startCompanionPage(id) {
  go("companion");
  refreshCompanion(id);
  companionTimer = setInterval(() => refreshCompanion(id), 12000);
}

el("#contactForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = el("#contactName").value.trim();
  const phone = el("#contactPhone").value.trim();
  if (!name || !phone) { notify("Bitte Name und Telefonnummer eingeben."); return; }
  localStorage.setItem("gutankommenContact", JSON.stringify({ name, phone }));
  renderContact();
  notify("Kontakt nur auf diesem Gerät gespeichert.");
});

function renderContact() {
  const saved = localStorage.getItem("gutankommenContact");
  if (!saved) return;
  try {
    const contact = JSON.parse(saved);
    el("#contactName").value = contact.name;
    el("#contactPhone").value = contact.phone;
    el("#savedContact").hidden = false;
    el("#savedContact").innerHTML = `<p>${esc(contact.name)}</p><a href="tel:${esc(contact.phone.replace(/[^+\d]/g, ""))}">${esc(contact.phone)} anrufen</a>`;
  } catch { localStorage.removeItem("gutankommenContact"); }
}

function loadCompanionFromUrl() {
  const token = new URL(location.href).searchParams.get("begleitung");
  if (token && /^[a-f0-9-]{30,40}$/i.test(token)) startCompanionPage(token);
}

el("#departureInput").value = formatDateTimeLocal(new Date(Date.now() + 5 * 60000));
renderContact();
if (sessionStorage.getItem("gutankommenRide")) el("#shareFamilyRide").disabled = false;
loadStops().catch(() => { el("#locationMessage").textContent = "Haltestellenliste nicht verfügbar. Bitte später erneut laden."; });
loadCompanionFromUrl();
