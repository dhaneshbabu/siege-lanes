// Bundles the TV and phone pages into dist/ (plain files, no network needed at runtime).
// The game itself (rules, bots, drawing, sound) comes from ../arena/src, shared with the web version.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const out = process.env.OUT || 'dist';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const common = { bundle: true, minify: true, format: 'iife', target: ['chrome64', 'safari12'], legalComments: 'none', logLevel: 'warning' };
await esbuild.build({ ...common, entryPoints: ['web/src/tv/main.js'], outfile: `${out}/tv.js` });
await esbuild.build({ ...common, entryPoints: ['web/src/phone/main.js'], outfile: `${out}/phone.js` });

for (const f of ['tv.html', 'tv.css', 'index.html', 'phone.css', 'fonts.css']) fs.copyFileSync(`web/${f}`, `${out}/${f}`);
const fs5 = 'node_modules/@fontsource';
const fonts = {
  'grenze-gotisch-800.woff2': `${fs5}/grenze-gotisch/files/grenze-gotisch-latin-800-normal.woff2`,
  'alegreya-sans-400.woff2': `${fs5}/alegreya-sans/files/alegreya-sans-latin-400-normal.woff2`,
  'alegreya-sans-500.woff2': `${fs5}/alegreya-sans/files/alegreya-sans-latin-500-normal.woff2`,
  'alegreya-sans-700.woff2': `${fs5}/alegreya-sans/files/alegreya-sans-latin-700-normal.woff2`,
  'alegreya-sans-800.woff2': `${fs5}/alegreya-sans/files/alegreya-sans-latin-800-normal.woff2`,
  'ibm-plex-mono-600.woff2': `${fs5}/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2`,
};
for (const [to, from] of Object.entries(fonts)) fs.copyFileSync(from, `${out}/fonts/${to}`);

const size = (f) => (fs.statSync(`${out}/${f}`).size / 1024).toFixed(0) + ' KB';
console.log(`built ${out}/  tv.js ${size('tv.js')}  phone.js ${size('phone.js')}`);
