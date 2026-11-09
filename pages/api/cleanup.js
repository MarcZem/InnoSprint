import { del, list } from "@vercel/blob";

const MAX_AGE_MS = 4 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const now = Date.now();
    let cursor;
    let deleted = 0;
    do {
      const page = await list({ prefix: "active-trips/", access: "private", limit: 1000, cursor });
      for (const blob of page.blobs) {
        if (now - new Date(blob.uploadedAt).getTime() > MAX_AGE_MS) {
          await del(blob.url);
          deleted += 1;
        }
      }
      cursor = page.cursor;
    } while (cursor);
    return res.status(200).json({ deleted });
  } catch (error) {
    console.error("Trip cleanup failed", error?.message || error);
    return res.status(503).json({ error: "Cleanup temporarily unavailable" });
  }
}
