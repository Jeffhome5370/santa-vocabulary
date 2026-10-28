import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [productionDist, trialDist, output] = process.argv.slice(2);
if (!productionDist || !trialDist || !output) throw new Error('Usage: build-preview.mjs production/dist trial/dist output');
await mkdir(output, { recursive: true });
await cp(productionDist, output, { recursive: true });
const preview = path.join(output, 'preview', 'dinotaeng');
await mkdir(preview, { recursive: true });
await cp(trialDist, preview, { recursive: true });
// Email verification/recovery returns to the already allowlisted production URL.
// Password login, synchronization and AI remain available directly in the preview.
const app = path.join(preview, 'app.js');
let appSource = (await readFile(app, 'utf8')).replace(
  "const redirectTo = new URL('./', location.href).href;",
  "const redirectTo = new URL('../../', location.href).href;"
);
// The new entry point must not import an older cached design module.
for (const filename of ['design.js', 'icons.js', 'speech.js']) {
  const hash = createHash('sha256').update(await readFile(path.join(preview, filename))).digest('hex').slice(0, 12);
  appSource = appSource.replace(`'./${filename}'`, `'./${filename}?v=${hash}'`);
}
await writeFile(app, appSource);
// Pages uses browser/CDN caching. Tie the theme and entry module URL to content.
const entry = path.join(preview, 'index.html');
let html = await readFile(entry, 'utf8');
for (const filename of ['forest.css', 'entry.css', 'app.js']) {
  const hash = createHash('sha256').update(await readFile(path.join(preview, filename))).digest('hex').slice(0, 12);
  html = html.replace(`./${filename}"`, `./${filename}?v=${hash}"`);
}
await writeFile(entry, html);
const expected = await readFile(path.join(productionDist, 'index.html'));
const actual = await readFile(path.join(output, 'index.html'));
if (!expected.equals(actual)) throw new Error('Production entry point was changed while preparing preview');
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Prepared unchanged main site plus preview/dinotaeng/');
