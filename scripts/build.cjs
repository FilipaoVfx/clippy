const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '..');
const output = resolve(root, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(root, 'public'), output, { recursive: true });

// Hash every deployed shell asset: local, dashboard and CI builds all refresh
// installed PWAs, without modifying version-controlled source files.
const swPath = resolve(output, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const shell = [...sw.matchAll(/^  '(\/[^']*)',?$/gm)].map((match) => match[1]);
const hash = createHash('sha256').update(sw);
for (const asset of shell) {
  hash.update(asset).update(readFileSync(resolve(output, asset === '/' ? 'index.html' : asset.slice(1))));
}
const buildId = hash.digest('hex').slice(0, 16);
writeFileSync(swPath, sw.replaceAll('__BUILD_ID__', buildId));
console.log(`Built public/ → dist/ (PWA ${buildId})`);
