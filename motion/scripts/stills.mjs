// Stills for the website outside the showcase videos:
//   og-pastty.jpg          1200×630 social card (BrandIntro, last frame, cropped)
//   transfer-image.webp    720² figure for the photo guides (TransferSequence, image card)
// Usage: npm run render:stills
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'out/stills');
const web = resolve(root, '../public/assets');
mkdirSync(out, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
const still = (id, file, frame, props) => run('npx', ['remotion', 'still', 'src/index.ts', id, resolve(out, file), `--frame=${frame}`, '--timeout=120000', ...(props ? [`--props=${JSON.stringify(props)}`] : [])]);

still('BrandIntro', 'og.png', 122);
run('ffmpeg', ['-loglevel', 'error', '-y', '-i', resolve(out, 'og.png'), '-vf', 'scale=1200:675:flags=lanczos,crop=1200:630:0:22', '-q:v', '3', resolve(web, 'og-pastty.jpg')]);

still('TransferSequence', 'transfer-image.png', 26, { contentType: 'image' });
run('ffmpeg', ['-loglevel', 'error', '-y', '-i', resolve(out, 'transfer-image.png'), '-vf', 'scale=720:-2:flags=lanczos', '-c:v', 'libwebp', '-quality', '82', resolve(web, 'motion/transfer-image.webp')]);
console.log('Stills written to public/assets/');
