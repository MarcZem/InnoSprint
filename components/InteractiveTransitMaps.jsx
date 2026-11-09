import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleF, GoogleMap, InfoWindowF, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api';

const LIBRARIES = ['places'];
const CENTER = { lat: 48.1372, lng: 11.5756 };
const FACILITIES = [
  ['elevator', 'Aufzug', 'Aufzug am Bahnhof'],
  ['escalator', 'Rolltreppe', 'Rolltreppe am Bahnhof'],
  ['information', 'Auskunft', 'Auskunftsschalter Bahnhof'],
  ['security', 'Sicherheit', 'Sicherheitsschalter Bahnhof'],
];
const mapContainerStyle = { width: '100%', height: '100%' };
const mapOptions = { fullscreenControl: false, mapTypeControl: false, streetViewControl: false, clickableIcons: false, gestureHandling: 'greedy' };

function MapView({ mode, stops, events }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'gutankommen-google-maps',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });
  const [map, setMap] = useState(null);
  const [route, setRoute] = useState(null);
  const [center, setCenter] = useState(CENTER);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [layers, setLayers] = useState({ stops: true, crowd: true, events: true });
  const [facilityLayers, setFacilityLayers] = useState({});
  const [places, setPlaces] = useState([]);
  const [placesStatus, setPlacesStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onRoute = (event) => setRoute(event.detail || null);
    const onLocation = (event) => {
      const point = event.detail;
      if (point?.lat && point?.lon) {
        setCurrentPosition({ lat: point.lat, lng: point.lon });
        setCenter({ lat: point.lat, lng: point.lon });
      }
    };
    window.addEventListener('route:map', onRoute);
    window.addEventListener('location:updated', onLocation);
    return () => {
      window.removeEventListener('route:map', onRoute);
      window.removeEventListener('location:updated', onLocation);
    };
  }, []);

  const routePoints = route?.points || [];
  const mapStops = mode === 'route' ? routePoints.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) : stops
    .filter((stop) => stop.lat != null && stop.lon != null)
    .map((stop) => ({ stop, km: Math.hypot((stop.lat - center.lat) * 111, (stop.lon - center.lng) * 75) }))
    .filter((entry) => entry.km < 8).sort((a, b) => a.km - b.km).slice(0, 35).map((entry) => entry.stop);

  const searchFacility = useCallback(async (key) => {
    if (!map || !window.google?.maps?.importLibrary) return;
    const facility = FACILITIES.find(([id]) => id === key);
    if (!facility) return;
    setPlacesStatus('Orte werden gesucht …');
    try {
      const { Place } = await google.maps.importLibrary('places');
      const query = `${facility[2]} München`;
      const bounds = map.getBounds();
      const request = {
        textQuery: query,
        fields: ['displayName', 'location', 'formattedAddress', 'googleMapsURI'],
        locationBias: bounds || { center: map.getCenter(), radius: 10000 },
        language: 'de',
        region: 'de',
        maxResultCount: 8,
      };
      const result = await Place.searchByText(request);
      const found = (result.places || []).filter((place) => place.location).map((place) => ({
        id: place.id || `${key}-${place.displayName}`,
        name: place.displayName || facility[1],
        address: place.formattedAddress || '',
        url: place.googleMapsURI || '',
        position: { lat: place.location.lat(), lng: place.location.lng() },
        kind: facility[1],
      }));
      setPlaces((prior) => [...prior.filter((place) => place.kind !== facility[1]), ...found]);
      setPlacesStatus(found.length ? 'Google Maps-Orte gefunden. Verfügbarkeit bitte vor Ort prüfen.' : 'Keine passenden Orte gefunden. Angaben zu Einrichtungen sind unvollständig.');
    } catch (error) {
      console.error('Google Maps Places facility search failed:', error);
      setPlacesStatus('Einrichtungsdaten konnten nicht geladen werden. Bitte vor Ort nachfragen.');
    }
  }, [map]);

  function toggleFacility(key) {
    const enabled = !facilityLayers[key];
    setFacilityLayers((prior) => ({ ...prior, [key]: enabled }));
    if (enabled) searchFacility(key);
  }

  useEffect(() => {
    if (!map) return;
    const onPage = (event) => {
      if ((mode === 'home' && event.detail === 'plan') || (mode === 'route' && event.detail === 'detail')) {
        window.setTimeout(() => google.maps.event.trigger(map, 'resize'), 100);
      }
    };
    window.addEventListener('page:change', onPage);
    return () => window.removeEventListener('page:change', onPage);
  }, [map, mode]);

  const onLoad = useCallback((mapInstance) => {
    setMap(mapInstance);
    if (mode === 'route' && routePoints[0]) mapInstance.setCenter({ lat: routePoints[0].lat, lng: routePoints[0].lon });
  }, [mode, routePoints]);
  const path = useMemo(() => routePoints.filter((point) => point.lat != null && point.lon != null).map((point) => ({ lat: point.lat, lng: point.lon })), [routePoints]);

  useEffect(() => {
    if (!map || mode !== 'route' || !path.length) return;
    if (path.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      path.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 60);
    } else map.setCenter(path[0]);
  }, [map, mode, path]);

  const app = <div className={`map-feature${expanded ? ' map-feature-expanded' : ''}`}>
    <div className="map-layer-controls" aria-label="Kartenebenen">
      <label><input type="checkbox" checked={layers.stops} onChange={(event) => setLayers((state) => ({ ...state, stops: event.target.checked }))} /> Haltestellen</label>
      <label><input type="checkbox" checked={layers.crowd} onChange={(event) => setLayers((state) => ({ ...state, crowd: event.target.checked }))} /> Hohe historische Auslastung</label>
      <label><input type="checkbox" checked={layers.events} onChange={(event) => setLayers((state) => ({ ...state, events: event.target.checked }))} /> Veranstaltungen</label>
      {FACILITIES.map(([id, label]) => <label key={id}><input type="checkbox" checked={Boolean(facilityLayers[id])} onChange={() => toggleFacility(id)} /> {label}</label>)}
      <button className="map-expand" type="button" onClick={() => setExpanded((value) => !value)} aria-pressed={expanded}>{expanded ? 'Karte schließen' : 'Karte vergrößern'}</button>
    </div>
    {loadError ? <div className="map-key-message" role="alert">Google Maps konnte nicht geladen werden. Prüfen Sie Maps JavaScript API, Places API und den eingeschränkten Browser-Schlüssel.</div>
      : !isLoaded ? <div className="map-key-message" aria-live="polite">Karte wird geladen …</div>
      : <div className="google-map-canvas"><GoogleMap mapContainerStyle={mapContainerStyle} center={center} zoom={mode === 'route' ? 12 : 11} options={mapOptions} onLoad={onLoad}>
        {layers.stops && mapStops.map((stop) => <MarkerF key={`stop-${stop.id}`} position={{ lat: stop.lat, lng: stop.lon }} title={`${stop.name}${stop.wheelchairBoarding === 1 ? ' · barrierefrei laut Fahrplandaten' : ' · Barrierefreiheit nicht bestätigt'}`} onClick={() => setSelected({ name: stop.name, position: { lat: stop.lat, lng: stop.lon }, detail: stop.wheelchairBoarding === 1 ? 'Laut GTFS-Daten barrierefreier Einstieg; Aufzugstatus ungeprüft.' : 'Barrierefreiheit dieser Haltestelle ist nicht bestätigt.' })} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: stop.wheelchairBoarding === 1 ? '#17684f' : '#4e5c68', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }} />)}
        {layers.events && events.filter((event) => event.date >= new Date().toLocaleDateString('sv-SE')).map((event) => <CircleF key={event.id} center={{ lat: event.lat, lng: event.lon }} radius={event.radiusKm * 1000} options={{ fillColor: '#bf3b32', fillOpacity: 0.12, strokeColor: '#a32424', strokeOpacity: 0.8, strokeWeight: 2 }} />)}
        {layers.crowd && routePoints.filter((point) => point.level === 2 && Number.isFinite(point.lat) && Number.isFinite(point.lon)).map((point, index) => <CircleF key={`medium-${point.id}-${index}`} center={{ lat: point.lat, lng: point.lon }} radius={120} options={{ fillColor: '#b47819', fillOpacity: 0.22, strokeColor: '#81500c', strokeWeight: 1 }} />)}
        {layers.crowd && routePoints.filter((point) => point.level === 3).map((point, index) => <CircleF key={`crowd-${point.id}-${index}`} center={{ lat: point.lat, lng: point.lon }} radius={180} options={{ fillColor: '#bd3434', fillOpacity: 0.3, strokeColor: '#9a1e1e', strokeWeight: 2 }} />)}
        {path.length > 1 && <PolylineF path={path} options={{ strokeColor: '#155b47', strokeOpacity: 0.95, strokeWeight: 6 }} />}
        {routePoints.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon)).map((point, index) => <MarkerF key={`route-${point.id}-${index}`} position={{ lat: point.lat, lng: point.lon }} label={{ text: String(index + 1), color: '#fff', fontWeight: '700' }} title={`${point.name}${point.level === 3 ? ' · historisch stark gefüllt' : ''}`} />)}
        {mode === 'home' && currentPosition && <MarkerF position={currentPosition} title="Ihr Standort" label={{ text: 'Sie', color: '#075d42', fontWeight: '700' }} />}
        {places.filter((place) => facilityLayers[facilityId(place.kind)]).map((place) => <MarkerF key={place.id} position={place.position} label={{ text: place.kind.slice(0, 1), color: '#fff', fontWeight: '700' }} title={`${place.kind}: ${place.name} · nicht amtlich bestätigt`} onClick={() => setSelected({ name: place.name, position: place.position, detail: `${place.kind} · ${place.address} · Öffnungszeiten und Funktion vor Ort prüfen.`, url: place.url })} />)}
        {selected && <InfoWindowF position={selected.position || center} onCloseClick={() => setSelected(null)}><div className="map-info"><strong>{selected.name}</strong><p>{selected.detail}</p>{selected.url && <a href={selected.url} target="_blank" rel="noreferrer">In Google Maps öffnen</a>}</div></InfoWindowF>}
      </GoogleMap></div>}
    <p className="map-note">Rote Kreise zeigen historische hohe Auslastung oder einen Veranstaltungskontext, keine bestätigte Gefahrenstelle. Google Maps-Orte bestätigen keine Verfügbarkeit von Aufzügen oder Personal.</p>
    {placesStatus && <p className="map-status" role="status">{placesStatus}</p>}
  </div>;
  return app;
}

function PortalMap(props) {
  const [mount, setMount] = useState(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setMount(document.getElementById(props.targetId)); }, [props.targetId]);
  if (!mount) return null;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return createPortal(<div className={`map-feature map-key-missing${expanded ? ' map-feature-expanded' : ''}`}>
    <div className="map-key-message"><strong>Google Maps ist noch nicht verbunden.</strong><span>In Vercel fehlt NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Danach Maps JavaScript API und Places API aktivieren und den Schlüssel auf die Website-Domain beschränken.</span><button className="map-expand" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Karte schließen' : 'Karte vergrößern'}</button></div>
  </div>, mount);
  return createPortal(<MapView {...props} />, mount);
}

function facilityId(label) { return FACILITIES.find((item) => item[1] === label)?.[0]; }

export default function InteractiveTransitMaps({ stops = [], events = [] }) {
  return <>
    <PortalMap targetId="google-map-home" mode="home" stops={stops} events={events} />
    <PortalMap targetId="google-map-route" mode="route" stops={stops} events={events} />
  </>;
}
