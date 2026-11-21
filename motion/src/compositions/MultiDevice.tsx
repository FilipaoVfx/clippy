import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, DeviceType, screenOf, Side} from '../components/Device';
import {Burst, Hub} from '../components/Hub';
import {Packet} from '../components/Packet';
import {Scene} from '../components/Scene';
import {ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator} from '../components/Sync';
import {Caption} from '../components/Type';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {accumulate, measure, Pt, strandPath} from '../lib/geometry';
import {Pastel, PASTELS} from '../theme';

export const MULTI = {width: 1080, height: 1080, fps: 30, durationInFrames: 210};

const HUB: Pt = {x: 540, y: 470};
const NODES: Array<{type: DeviceType; pos: Pt; scale: number; side: Side; pastel: Pastel; rotate: number; curl: boolean}> = [
  {type: 'watch', pos: {x: 540, y: 150}, scale: 0.62, side: 'bottom', pastel: PASTELS.blush, rotate: 0, curl: false},
  {type: 'tablet', pos: {x: 900, y: 300}, scale: 0.4, side: 'left', pastel: PASTELS.pasta, rotate: 5, curl: true},
  {type: 'monitor', pos: {x: 870, y: 690}, scale: 0.44, side: 'left', pastel: PASTELS.sand, rotate: -2, curl: false},
  {type: 'laptop', pos: {x: 220, y: 690}, scale: 0.42, side: 'right', pastel: PASTELS.apricot, rotate: 2, curl: true},
  {type: 'phone', pos: {x: 175, y: 300}, scale: 0.5, side: 'right', pastel: PASTELS.peach, rotate: -6, curl: false},
];
const BROADCAST = 136;
const TRAVEL = 30;

/** 03 · Many — one central node distributes to five connected devices. */
export const MultiDevice: React.FC<{captions?: boolean}> = ({captions = true}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const speedAt = (f: number) => interpolate(f, [BROADCAST - 10, BROADCAST + 10], [0.006, 0.024], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const phase = accumulate(frame, speedAt);
  const linkAt = (i: number) => 42 + i * 12;
  const linked = NODES.filter((_, i) => frame >= linkAt(i) + 24).length;

  const strands = NODES.map((n, i) => {
    const end = devicePort(n.type, n.pos, n.scale, n.side);
    const m = measure(strandPath(HUB, end, frame, {sag: 34, wiggle: 9, curlAt: n.curl ? 0.55 : undefined, curlRadius: 28, curlFlip: i % 2 === 0, seed: i * 1.3}));
    return {m, end, start: linkAt(i)};
  });

  return (
    <Scene
      offsetY={captions ? 0 : 70}
      tone="apricot"
      svg={
        <>
          {strands.map(({m, start}, i) => {
            const grow = tween(frame, start, 24, easeInOut);
            const connectAt = start + 24;
            return (
              <Strand
                key={i}
                id={`multi-${i}`}
                m={m}
                to={grow}
                lit={tween(frame, connectAt, 10)}
                flash={frame >= connectAt - 14 ? (frame - connectAt + 14) / 16 : -1}
                particles={grow > 0.98 ? 3 : 0}
                phase={phase + i * 0.17}
                speed={speedAt(frame)}
                width={18}
              />
            );
          })}
          {NODES.map((n, i) => {
            const s = screenOf(n.type);
            const connectAt = linkAt(i) + 24;
            const arrive = BROADCAST + TRAVEL;
            const glow = interpolate(frame, [arrive - 2, arrive + 4, arrive + 24], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            return (
              <Device key={i} id={`d${i}`} type={n.type} x={n.pos.x} y={n.pos.y} scale={n.scale} enter={drop(frame, fps, 10 + i * 5)} rotate={n.rotate} pastel={n.pastel} state={frame >= connectAt ? 'connected' : 'idle'} glow={glow} check={pop(frame, fps, connectAt + 2) * 0.7} bob={frame + i * 17}>
                <ScreenStatus w={s.w} h={s.h} label={frame >= connectAt ? (n.type === 'watch' ? '' : 'Linked') : n.type === 'watch' ? '' : '…'} tone={frame >= connectAt ? 'ok' : 'wait'} />
              </Device>
            );
          })}
          <Hub x={HUB.x} y={HUB.y} scale={pop(frame, fps, 4) * 0.9} frame={frame} pulse={frame >= BROADCAST - 10 ? 1.6 : 0.8} />
          {strands.map(({end}, i) => <Burst key={i} x={end.x} y={end.y} t={(frame - linkAt(i) - 24) / 18} size={0.55} />)}
          {strands.map(({m}, i) => {
            if (frame < BROADCAST - 3 || frame > BROADCAST + TRAVEL + 2) return null;
            const f = tween(frame, BROADCAST, TRAVEL, easeInOut);
            const p = m.point(f);
            const sc = Math.min(pop(frame, fps, BROADCAST - 3), 1 - tween(frame, BROADCAST + TRAVEL - 4, 6));
            return <Packet key={i} kind="text" x={p.x} y={p.y} scale={sc * 0.5} tilt={Math.sin(frame / 5 + i) * 8} />;
          })}
        </>
      }
      html={
        <>
          <SyncIndicator x={850} y={66} state={linked < NODES.length ? 'syncing' : 'synced'} appear={pop(frame, fps, 30)} frame={frame} detail={`${linked}/5`} size={0.78} />
          {captions ? <Caption kicker="03 · Many" title="Up to five devices." appear={tween(frame, 18, 22)} x={84} y={840} /> : null}
        </>
      }
    />
  );
};
