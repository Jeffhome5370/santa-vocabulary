import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const [productionDist, trialDist, output] = process.argv.slice(2);
if (!productionDist || !trialDist || !output) throw new Error('Usage: build-preview.mjs production/dist trial/dist output');
await mkdir(output, { recursive: true });
await cp(productionDist, output, { recursive: true });
// Reuse the complete dependency-aware compiler so every new module is versioned.
const scratch = await mkdtemp(path.join(os.tmpdir(), 'santa-preview-'));
try {
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./build-site.mjs', import.meta.url)), trialDist, scratch]);
  await cp(path.join(scratch, 'preview', 'dinotaeng'), path.join(output, 'preview', 'dinotaeng'), { recursive: true });
} finally {
  if (path.dirname(path.resolve(scratch)) !== path.resolve(os.tmpdir()) || !path.basename(scratch).startsWith('santa-preview-')) throw new Error('Unexpected scratch path');
  await rm(scratch, { recursive: true, force: true });
}
const expected = await readFile(path.join(productionDist, 'index.html'));
const actual = await readFile(path.join(output, 'index.html'));
if (!expected.equals(actual)) throw new Error('Production entry point was changed while preparing preview');
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Prepared unchanged main site plus versioned preview/dinotaeng/');
