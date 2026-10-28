import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [source, output] = process.argv.slice(2);
if (!source || !output || path.resolve(source) === path.resolve(output)) throw new Error('Usage: build-site.mjs dist output');
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
const imports = /(\bfrom\s+|\bimport\s*)(['"])(\.\/[a-z0-9-]+\.js)\2/g;

async function build(target, redirectBase) {
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  const hashes = new Map(), visiting = new Set();
  async function compile(filename) {
    if (hashes.has(filename)) return;
    if (visiting.has(filename)) throw new Error(`Circular module dependency: ${filename}`);
    visiting.add(filename);
    let code = await readFile(path.join(source, filename), 'utf8');
    for (const match of code.matchAll(imports)) await compile(match[3].slice(2));
    code = code.replace(imports, (_, prefix, quote, reference) => `${prefix}${quote}${reference}?v=${hashes.get(reference.slice(2))}${quote}`);
    if (filename === 'app.js') code = code.replace("new URL('./', location.href).href", `new URL('${redirectBase}', location.href).href`);
    await writeFile(path.join(target, filename), code);
    hashes.set(filename, hash(Buffer.from(code)));
    visiting.delete(filename);
  }
  for (const filename of await readdir(source)) if (filename.endsWith('.js')) await compile(filename);
  let html = await readFile(path.join(source, 'index.html'), 'utf8');
  for (const filename of ['style.css', 'dinotaeng.css', 'entry.css', 'app.js']) {
    const revision = hashes.get(filename) || hash(await readFile(path.join(target, filename)));
    html = html.replace(`./${filename}"`, `./${filename}?v=${revision}"`);
  }
  await writeFile(path.join(target, 'index.html'), html);
}

await build(output, './');
// Keep the previously shared preview URL usable after the main release.
await build(path.join(output, 'preview', 'dinotaeng'), '../../');
await writeFile(path.join(output, '.nojekyll'), '');
console.log('Built production site and compatible preview URL with versioned styles and module imports.');
