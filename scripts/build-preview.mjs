import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
await writeFile(app, (await readFile(app, 'utf8')).replace(
  "const redirectTo = new URL('./', location.href).href;",
  "const redirectTo = new URL('../../', location.href).href;"
));
const expected = await readFile(path.join(productionDist, 'index.html'));
const actual = await readFile(path.join(output, 'index.html'));
if (!expected.equals(actual)) throw new Error('Production entry point was changed while preparing preview');
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Prepared unchanged main site plus preview/dinotaeng/');
