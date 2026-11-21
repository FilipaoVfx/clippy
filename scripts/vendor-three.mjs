// Builds public/vendor/three.min.js: only the parts of three.js the visual
// engine imports, tree-shaken and minified. The site has no bundler, so this
// file is committed; re-run after upgrading `three`:
//   npm run vendor:three
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/vendor/three.min.js');

// Every name imported from '/vendor/three.min.js' under public/js/visual.
const names = new Set();
const files = ['materials', 'pasta-strand', 'connection-curve', 'device-node', 'particle-system', 'engine'];
for (const f of files) {
  const src = readFileSync(resolve(root, `public/js/visual/three/${f}.js`), 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\/vendor\/three\.min\.js'/g)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => names.add(n));
  }
}

const version = JSON.parse(readFileSync(resolve(root, 'node_modules/three/package.json'), 'utf8')).version;
const result = await build({
  stdin: {
    contents: `export { ${[...names].sort().join(', ')} } from 'three';`,
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
  write: false,
});

mkdirSync(dirname(out), { recursive: true });
const banner = `/* three.js r${version.split('.')[1]} (${version}) subset · MIT License · https://github.com/mrdoob/three.js/blob/dev/LICENSE */\n`;
const code = banner + result.outputFiles[0].text;
writeFileSync(out, code);
console.log(`three ${version}: ${names.size} exports → public/vendor/three.min.js (${(code.length / 1024).toFixed(0)} KB, ${(gzipSync(code).length / 1024).toFixed(0)} KB gzip)`);
