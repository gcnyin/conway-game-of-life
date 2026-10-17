import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'src');

const bundle = buildSync({
  entryPoints: [resolve(src, 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'inline',
  write: false,
  logLevel: 'silent',
  banner: {
    js: '/* three.js — MIT License — https://threejs.org */',
  },
}).outputFiles[0].text;

const fontData = (name) =>
  `data:font/woff2;base64,${readFileSync(resolve(root, 'assets', name)).toString('base64')}`;

const styles = readFileSync(resolve(src, 'styles.css'), 'utf8')
  .replaceAll('__SPACE_GROTESK__', fontData('space-grotesk-latin.woff2'))
  .replaceAll('__JETBRAINS_MONO__', fontData('jetbrains-mono-latin.woff2'));

let html = readFileSync(resolve(src, 'index.html'), 'utf8');

const script = bundle.replace(/<\/script/gi, '<\\/script');
html = html.replace('__STYLES__', () => styles).replace('__SCRIPT__', () => script);

const leftovers = ['__STYLES__', '__SCRIPT__', '__SPACE_GROTESK__', '__JETBRAINS_MONO__'];
for (const token of leftovers) {
  if (html.includes(token)) {
    throw new Error(`Build left an unreplaced placeholder: ${token}`);
  }
}

const output = resolve(root, 'index.html');
writeFileSync(output, html);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.log(`Built ${output}`);
console.log(`  HTML      ${kb(Buffer.byteLength(html))}`);
console.log(`  JS        ${kb(Buffer.byteLength(bundle))}`);
console.log(`  fonts     embedded`);
