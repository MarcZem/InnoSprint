import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('public', { recursive: true });
await Promise.all([
  copyFile('app.js', 'public/app.js'),
  copyFile('styles.css', 'public/styles.css'),
]);
