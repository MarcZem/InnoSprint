import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const distanceKm = (a, b) => {
  const rad = (n) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

function eventWindow(event, dateValue) {
  if (dateValue.slice(0, 10) !== event.date) return false;
  if (!event.time) return true;
  const date = new Date(dateValue);
  const eventTime = new Date(`${event.date}T${event.time}:00+01:00`);
  const requested = Number.isNaN(date.valueOf()) ? null : date;
  return requested && requested >= new Date(eventTime.getTime() - 3 * 60 * 60 * 1000)
    && requested <= new Date(eventTime.getTime() + 3 * 60 * 60 * 1000);
}

export default function EventAlerts({ events = [] }) {
  const [mount, setMount] = useState(null);
  const [context, setContext] = useState(null);
  useEffect(() => {
    setMount(document.getElementById('events-root'));
    const receive = (event) => setContext(event.detail || null);
    window.addEventListener('route:search-context', receive);
    return () => window.removeEventListener('route:search-context', receive);
  }, []);

  if (!mount) return null;
  const applicable = (context?.events || events.filter((item) => eventWindow(item, context?.date || '')))
    .filter((event) => !context?.stops?.length || context.stops.some((stop) => distanceKm(stop, event) < event.radiusKm));
  if (!context) return createPortal(<section className="event-panel" aria-label="Veranstaltungshinweise">
    <h2>Großveranstaltungen</h2><p>Bei einer Veranstaltung in der Nähe können Haltestellen und Busse voller sein. Diese Warnung ist ein Hinweis, keine aktuelle Belegungsmessung.</p>
  </section>, mount);
  if (!applicable.length) return createPortal(null, mount);

  const quieter = context.routes?.filter((route) => !route.eventRisk).sort((a, b) => (a.peak || 2) - (b.peak || 2))[0];
  const event = applicable[0];
  return createPortal(<section className="event-panel event-panel-warning" aria-live="polite" aria-labelledby="eventWarningTitle">
    <h2 id="eventWarningTitle">Mehr Andrang durch Veranstaltung</h2>
    <p><strong>{event.title}</strong>{event.time ? ` · ${event.time} Uhr` : ' · Uhrzeit nicht veröffentlicht'} am {new Date(`${event.date}T12:00:00`).toLocaleDateString('de-DE')}.</p>
    <p>{event.venue}: Haltestellen im Umkreis könnten voller sein. Die Warnung basiert auf dem Veranstaltungskalender und der Lage Ihrer Regionalbusroute, nicht auf Echtzeit-Auslastung.</p>
    {quieter ? <p className="event-alternative">Ruhigere Alternative im Fahrplan: {quieter.lines.join(' → ')} · {quieter.peak === 1 ? 'meist wenig gefüllt' : 'historische Auslastung prüfen'}.</p> : <p>Für diese Suche ist keine ruhigere Alternative ohne Veranstaltungsnähe bekannt.</p>}
    <a href={event.source} target="_blank" rel="noreferrer">Termin beim Veranstalter prüfen</a>
  </section>, mount);
}
