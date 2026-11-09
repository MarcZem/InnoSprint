import formidable from 'formidable';
import { readFile } from 'node:fs/promises';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '25mb',
  },
};

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function parseAudio(req) {
  const form = formidable({
    maxFiles: 1,
    maxFileSize: MAX_AUDIO_BYTES,
    allowEmptyFiles: false,
    multiples: false,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (error, _fields, files) => {
      if (error) return reject(error);
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) return reject(new Error('Keine Audiodatei empfangen.'));
      resolve(file);
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Nur POST ist erlaubt.' });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY ist in Vercel nicht konfiguriert.' });
  }

  try {
    const audio = await parseAudio(req);
    const bytes = await readFile(audio.filepath);
    const mimeType = audio.mimetype || 'audio/webm';
    const upload = new FormData();
    upload.append('file', new Blob([bytes], { type: mimeType }), audio.originalFilename || 'aufnahme.webm');
    upload.append('model', 'whisper-large-v3-turbo');
    upload.append('response_format', 'json');
    upload.append('language', 'de');

    const groq = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: upload,
      signal: AbortSignal.timeout(55_000),
    });
    const result = await groq.json().catch(() => ({}));
    if (!groq.ok) {
      console.error('Groq transcription failed:', groq.status, result?.error?.message || 'unknown error');
      return res.status(groq.status === 429 ? 429 : 502).json({ error: 'Die Spracherkennung ist gerade nicht verfügbar.' });
    }
    return res.status(200).json({ text: String(result.text || '').trim() });
  } catch (error) {
    const tooLarge = error?.code === 1009 || error?.httpCode === 413;
    return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Die Aufnahme ist zu groß (max. 25 MB).' : 'Die Audiodatei konnte nicht verarbeitet werden.' });
  }
}
