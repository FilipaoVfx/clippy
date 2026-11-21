#!/usr/bin/env node
/**
 * Renders the compositions with Remotion, then encodes lightweight web
 * versions (VP9 WebM + H.264 MP4 + WebP poster) into ../public/assets/motion.
 * The production site only ever loads these static files: no Remotion
 * runtime ships to users.
 *
 *   npm run render                    # the five web pieces
 *   npm run render -- BrandIntro      # a subset (web or social ids)
 *   npm run render:social             # longer captioned cuts -> out/social
 *   ENCODE_ONLY=1 npm run render      # re-encode existing masters only
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out');
const web = resolve(root, '..', 'public', 'assets', 'motion');
mkdirSync(resolve(out, 'social'), {recursive: true});
mkdirSync(resolve(out, 'master'), {recursive: true});
mkdirSync(web, {recursive: true});

// file: web asset basename · size: web width · poster: frame for the still · crf: [x264, vp9]
const WEB = [
  {id: 'BrandIntro', file: 'brand', size: 1600, poster: 122, crf: [25, 42]},
  {id: 'SessionCreated', file: 'created', size: 720, poster: 54, crf: [27, 44]},
  {id: 'DevicePairing', file: 'pairing', size: 720, poster: 50, crf: [27, 44]},
  {id: 'TransferSequence', file: 'transfer', size: 720, poster: 26, crf: [27, 44]},
  {id: 'SyncConfirmation', file: 'sync', size: 720, poster: 20, crf: [27, 44]},
];
const SOCIAL = ['HeroIntro', 'DeviceConnection', 'DataTransfer', 'MultiDevice', 'Reconnect'];

const args = process.argv.slice(2);
const socialMode = args.includes('--social');
const only = args.filter((a) => !a.startsWith('--'));
const run = (cmd, args) => execFileSync(cmd, args, {cwd: root, stdio: 'inherit'});
const remotion = (args) => run('npx', ['remotion', ...args, '--log=error']);
const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2) + ' MB';
const lean = ['--concurrency=2', '--timeout=120000', '--offthreadvideo-cache-size-in-bytes=268435456'];

if (socialMode || only.some((id) => SOCIAL.includes(id))) {
  for (const id of SOCIAL.filter((x) => !only.length || only.includes(x))) {
    remotion(['render', 'src/index.ts', id, resolve(out, 'social', `${id}.mp4`), '--codec=h264', '--crf=18', ...lean]);
  }
}

if (!socialMode) {
  for (const job of WEB.filter((j) => !only.length || only.includes(j.id))) {
    const master = resolve(out, 'master', `${job.file}.mp4`);
    if (!(process.env.ENCODE_ONLY && existsSync(master))) {
      remotion(['render', 'src/index.ts', job.id, master, '--codec=h264', '--crf=14', ...lean]);
    }
    encode(job, master);
  }
}

function encode(job, master) {
  // Remotion masters are full-range (yuvj420p, bt470bg). Convert to the
  // limited-range BT.709 every browser expects, and tag it, or players
  // disagree on levels and the MP4 shows up washed out.
  const scale = `scale=${job.size}:-2:flags=lanczos:out_range=tv:out_color_matrix=bt709,format=yuv420p`;
  const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const mp4 = resolve(web, `${job.file}.mp4`);
  const webm = resolve(web, `${job.file}.webm`);
  const poster = resolve(web, `${job.file}.webp`);
  run('ffmpeg', ['-loglevel', 'error', '-y', '-i', master, '-vf', scale, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(job.crf[0]), '-profile:v', 'high', ...tags, '-movflags', '+faststart', mp4]);
  run('ffmpeg', ['-loglevel', 'error', '-y', '-i', master, '-vf', scale, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(job.crf[1]), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', ...tags, webm]);
  run('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(job.poster / 30), '-i', master, '-frames:v', '1', '-vf', `scale=${job.size}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', poster]);
  console.log(`${job.id}: mp4 ${mb(mp4)} · webm ${mb(webm)} · poster ${mb(poster)}`);
}
