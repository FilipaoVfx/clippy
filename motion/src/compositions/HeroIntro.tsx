import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Burst} from '../components/Hub';
import {Packet, PacketKind} from '../components/Packet';
import {Scene} from '../components/Scene';
import {ScreenCode, ScreenFeed, ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator} from '../components/Sync';
import {SlamText} from '../components/Type';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {accumulate, measure, strandPath} from '../lib/geometry';
import {PASTELS} from '../theme';

export const HERO = {width: 1920, height: 1080, fps: 30, durationInFrames: 360};

// Beat sheet (frames @30fps)
const T = {
  title: 6,
  titleLift: 46,
  // Devices fall only once the title has cleared the middle of the frame.
  phone: 74,
  laptop: 84,
  growStart: 104,
  growEnd: 160,
  connect: 162,
  checks: 178,
  sends: [204, 240, 274] as const,
  travel: 40,
  tagline: [212, 248, 282] as const,
};
const KINDS: PacketKind[] = ['text', 'image', 'video'];

export const HeroIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const phonePos = {x: 520, y: 620};
  const laptopPos = {x: 1390, y: 580};
  const scale = 0.95;
  const a = devicePort('phone', phonePos, scale, 'right');
  const b = devicePort('laptop', laptopPos, scale, 'left');
  const m = measure(strandPath(a, b, frame, {sag: 80, wiggle: 16, curlAt: 0.5, curlRadius: 56, seed: 1, segments: 10}));

  const grow = tween(frame, T.growStart, T.growEnd - T.growStart, easeInOut);
  const lit = tween(frame, T.connect, 14);
  const flash = frame >= T.connect ? (frame - T.connect) / 20 : -1;
  const speedAt = (f: number) => interpolate(f, [T.connect, T.connect + 24], [0.0025, 0.016], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const phase = accumulate(frame, speedAt);
  const connected = frame >= T.connect + 6;

  // Title: slams in centred, then lifts to make room for the devices.
  const lift = tween(frame, T.titleLift, 26, easeInOut);
  const titleY = interpolate(lift, [0, 1], [540, 150]);
  const titleScale = interpolate(lift, [0, 1], [1, 0.46]);

  const arrivals = T.sends.map((s) => s + T.travel);
  const laptopGlow = Math.max(0, ...arrivals.map((t) => interpolate(frame, [t - 2, t + 4, t + 22], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));
  const phoneGlow = Math.max(0, ...T.sends.map((t) => interpolate(frame, [t - 6, t, t + 14], [0, 0.8, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));

  const ps = screenOf('phone');
  const ls = screenOf('laptop');
  const mid = m.point(0.5);

  const svg = (
    <>
      <Strand id="hero" m={m} to={grow} lit={lit} flash={flash} particles={grow > 0.98 ? 7 : 0} phase={phase} speed={speedAt(frame)} width={28} />
      <Device id="phone" type="phone" x={phonePos.x} y={phonePos.y} scale={scale} enter={drop(frame, fps, T.phone)} rotate={-4} pastel={PASTELS.peach} state={connected ? 'connected' : 'idle'} glow={phoneGlow} check={pop(frame, fps, T.checks)} bob={frame}>
        {connected ? <ScreenStatus w={ps.w} h={ps.h} label="Connected" sub="ABC-12K" /> : <ScreenCode w={ps.w} h={ps.h} code="ABC-12K" reveal={tween(frame, T.phone + 10, 20)} />}
      </Device>
      <Device id="laptop" type="laptop" x={laptopPos.x} y={laptopPos.y} scale={scale} enter={drop(frame, fps, T.laptop)} rotate={2} pastel={PASTELS.apricot} state={connected ? 'connected' : 'idle'} glow={laptopGlow} check={pop(frame, fps, T.checks + 6)} bob={frame + 30}>
        {frame < T.connect + 6 ? (
          <ScreenStatus w={ls.w} h={ls.h} label="Joining…" tone="wait" />
        ) : frame < arrivals[0] ? (
          <ScreenStatus w={ls.w} h={ls.h} label="Connected" />
        ) : (
          <ScreenFeed w={ls.w} h={ls.h} items={arrivals.map((t, i) => ({kind: KINDS[i], appear: pop(frame, fps, t)}))} />
        )}
      </Device>
      <Burst x={a.x} y={a.y} t={(frame - T.connect) / 22} />
      <Burst x={b.x} y={b.y} t={(frame - T.connect - 16) / 22} />
      {T.sends.map((s, i) => {
        const f = tween(frame, s, T.travel, easeInOut);
        if (frame < s - 4 || frame > s + T.travel + 2) return null;
        const p = m.point(f);
        const sc = Math.min(pop(frame, fps, s - 4), 1 - tween(frame, s + T.travel - 4, 6));
        return <Packet key={i} kind={KINDS[i]} x={p.x} y={p.y - 70} scale={sc * 0.9} tilt={Math.sin(frame / 5 + i) * 6} progress={f} />;
      })}
    </>
  );

  const html = (
    <>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: titleY,
          display: 'flex',
          justifyContent: 'center',
          transform: `translateY(-50%) scale(${titleScale})`,
        }}
      >
        <SlamText text="Pastty." start={T.title} size={300} accentLast />
      </div>
      <SyncIndicator x={mid.x} y={mid.y - 175} state={frame < T.connect + 10 ? 'syncing' : 'synced'} appear={pop(frame, fps, T.connect + 4)} frame={frame} detail="12 ms" />
      <div style={{position: 'absolute', left: 0, right: 0, top: 930, display: 'flex', justifyContent: 'center', gap: 46}}>
        {['Copy.', 'Share.', 'Sync.'].map((w, i) => (
          <SlamText key={w} text={w} start={T.tagline[i]} size={92} stagger={1.5} accentLast={i === 2} />
        ))}
      </div>
    </>
  );

  return <Scene tone="apricot" svg={svg} html={html} push={0.035} fadeOut={22} />;
};
