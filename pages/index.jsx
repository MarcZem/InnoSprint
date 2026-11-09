import { readFile } from 'node:fs/promises';
import Head from 'next/head';
import { useEffect } from 'react';
import VoiceRouteControl from '../components/VoiceRouteControl.jsx';

export async function getStaticProps() {
  const html = await readFile('index.html', 'utf8');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
  const shell = body
    .replace(/\s*<script[^>]*src=["']app\.js["'][^>]*><\/script>/i, '')
    .replace('<button class="button button-primary search-button"', '<div id="voice-root"></div><button class="button button-primary search-button"');
  return { props: { shell } };
}

export default function Home({ shell }) {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/app.js';
    script.defer = true;
    document.body.appendChild(script);
    return () => script.remove();
  }, []);

  return <>
    <Head>
      <title>GutAnkommen · Regionalbus planen</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#f7f6f1" />
      <meta name="description" content="Ruhigere Regionalbus-Routen im Münchner Umland planen und die Fahrt mit einer vertrauten Person teilen." />
      <link rel="stylesheet" href="/styles.css" />
    </Head>
    <div id="app-shell" dangerouslySetInnerHTML={{ __html: shell }} />
    <VoiceRouteControl />
  </>;
}
