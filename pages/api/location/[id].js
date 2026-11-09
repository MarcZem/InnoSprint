import { del, get, put } from "@vercel/blob";

const MAX_AGE_MS = 4 * 60 * 60 * 1000;
const ID_PATTERN = /^[a-f0-9-]{30,40}$/i;

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function validSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return origin === `${proto}://${host}`;
}

async function readBlob(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return { data: JSON.parse(await new Response(result.stream).text()), url: result.blob.url };
}

async function removeBlob(pathname) {
  try {
    const prior = await get(pathname, { access: "private" });
    if (prior?.statusCode === 200) await del(prior.blob.url);
  } catch {
    // The session may already have expired or been removed.
  }
}

export default async function handler(req, res) {
  if (!validSameOrigin(req)) return reply(res, 403, { error: "Origin not allowed" });
  const id = String(req.query.id || "");
  if (!ID_PATTERN.test(id)) return reply(res, 400, { error: "Invalid trip link" });
  const pathname = `active-trips/${id}.json`;

  try {
    if (req.method === "GET") {
      const existing = await readBlob(pathname);
      if (!existing) return reply(res, 404, { error: "Trip not found" });
      if (Date.now() > existing.data.expiresAt) {
        await del(existing.url);
        return reply(res, 410, { error: "Trip link expired" });
      }
      return reply(res, 200, existing.data);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const location = body?.location;
      const route = body?.route;
      if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)
        || location.lat < 47 || location.lat > 49 || location.lon < 9 || location.lon > 14
        || !Number.isFinite(location.accuracy) || location.accuracy > 5000
        || !route || typeof route.origin !== "string" || typeof route.destination !== "string"
        || !Array.isArray(route.routeLines) || route.routeLines.length > 4 || !Array.isArray(route.stops) || route.stops.length > 4) {
        return reply(res, 400, { error: "Invalid location or route data" });
      }
      const now = Date.now();
      const existing = await readBlob(pathname).catch(() => null);
      if (existing && now > existing.data.expiresAt) {
        await del(existing.url);
        return reply(res, 410, { error: "Trip link expired" });
      }
      if (existing && now - existing.data.updatedAt < 7000) return reply(res, 429, { error: "Updates are too frequent" });
      const createdAt = existing?.data.createdAt || now;
      const data = {
        createdAt,
        updatedAt: now,
        expiresAt: createdAt + MAX_AGE_MS,
        location: { lat: location.lat, lon: location.lon, accuracy: location.accuracy, timestamp: now },
        route: {
          origin: route.origin.slice(0, 120), destination: route.destination.slice(0, 120),
          departure: String(route.departure || "").slice(0, 8), arrival: String(route.arrival || "").slice(0, 8),
          duration: Math.min(600, Math.max(0, Number(route.duration) || 0)),
          routeLines: route.routeLines.map((line) => String(line).slice(0, 32)),
          stops: route.stops.map((leg) => ({
            line: String(leg.line || "").slice(0, 20), routeName: String(leg.routeName || "").slice(0, 160),
            from: { name: String(leg.from?.name || "").slice(0, 120), lat: leg.from?.lat, lon: leg.from?.lon, time: String(leg.from?.time || "").slice(0, 8) },
            to: { name: String(leg.to?.name || "").slice(0, 120), lat: leg.to?.lat, lon: leg.to?.lon, time: String(leg.to?.time || "").slice(0, 8) },
            class: [1, 2, 3].includes(leg.class) ? leg.class : null,
            intermediate: Array.isArray(leg.intermediate) ? leg.intermediate.slice(0, 20).map((stop) => ({
              name: String(stop.name || "").slice(0, 120), lat: stop.lat, lon: stop.lon, time: String(stop.time || "").slice(0, 8),
            })) : [],
          })),
          scheduleReference: String(route.scheduleReference || "").slice(0, 40),
        },
      };
      const blob = await put(pathname, JSON.stringify(data), {
        access: "private", addRandomSuffix: false, allowOverwrite: true,
        contentType: "application/json", cacheControlMaxAge: 0,
      });
      return reply(res, 200, { updatedAt: now, expiresAt: data.expiresAt });
    }

    if (req.method === "DELETE") {
      await removeBlob(pathname);
      return reply(res, 200, { deleted: true });
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return reply(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Trip location API failed", error?.message || error);
    return reply(res, 503, { error: "Trip location storage is temporarily unavailable" });
  }
}
