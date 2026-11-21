import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Packet, PacketKind} from '../components/Packet';
import {Scene} from '../components/Scene';
import {ScreenFeed, ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator} from '../components/Sync';
import {Caption} from '../components/Type';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {accumulate, measure, strandPath} from '../lib/geometry';
import {PASTELS} from '../theme';

export const TRANSFER = {width: 1080, height: 1080, fps: 30, durationInFrames: 210};

const SENDS: Array<{kind: PacketKind; at: number}> = [
  {kind: 'text', at: 52},
  {kind: 'image', at: 84},
  {kind: 'video', at: 116},
];
const TRAVEL = 40;

/** 02 · Share — text, image and video ride the lit strand and stack up on arrival. */
export const DataTransfer: React.FC<{captions?: boolean}> = ({captions = true}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const phonePos = {x: 250, y: 470};
  const tabletPos = {x: 800, y: 450};
  const a = devicePort('phone', phonePos, 0.76, 'right');
  const b = devicePort('tablet', tabletPos, 0.66, 'left');
  const m = measure(strandPath(a, b, frame, {sag: 90, wiggle: 12, curlAt: 0.45, curlRadius: 38, seed: 3}));

  const grow = tween(frame, 12, 26, easeInOut);
  const lit = tween(frame, 36, 10);
  const busy = (f: number) => (SENDS.some((s) => f >= s.at && f <= s.at + TRAVEL) ? 1 : 0);
  const speedAt = (f: number) => 0.006 + 0.012 * busy(f);
  const arrivals = SENDS.map((s) => s.at + TRAVEL);
  const glow = Math.max(0, ...arrivals.map((t) => interpolate(frame, [t - 2, t + 4, t + 20], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})));
  const ts = screenOf('tablet');
  const ps = screenOf('phone');

  return (
    <Scene
      offsetY={captions ? 0 : 110}
      tone="butter"
      svg={
        <>
          <Strand id="share" m={m} to={grow} lit={lit} flash={frame >= 36 ? (frame - 36) / 16 : -1} particles={grow > 0.98 ? 8 : 0} phase={accumulate(frame, speedAt)} speed={speedAt(frame)} width={24} />
          <Device id="p" type="phone" x={phonePos.x} y={phonePos.y} scale={0.76} enter={drop(frame, fps, 0)} rotate={-4} pastel={PASTELS.blush} state="connected" bob={frame}>
            <ScreenStatus w={ps.w} h={ps.h} label="Sending" tone="wait" sub="3 items" />
          </Device>
          <Device id="t" type="tablet" x={tabletPos.x} y={tabletPos.y} scale={0.66} enter={drop(frame, fps, 5)} rotate={3} pastel={PASTELS.pasta} state="connected" glow={glow} check={pop(frame, fps, arrivals[2] + 4)} bob={frame + 25}>
            <ScreenFeed w={ts.w} h={ts.h} items={SENDS.map((s, i) => ({kind: s.kind, appear: pop(frame, fps, arrivals[i])}))} />
          </Device>
          {SENDS.map((s, i) => {
            if (frame < s.at - 4 || frame > s.at + TRAVEL + 2) return null;
            const f = tween(frame, s.at, TRAVEL, easeInOut);
            const p = m.point(f);
            const sc = Math.min(pop(frame, fps, s.at - 4), 1 - tween(frame, s.at + TRAVEL - 4, 6));
            return <Packet key={i} kind={s.kind} x={p.x} y={p.y - 66} scale={sc * 0.85} tilt={Math.sin(frame / 5 + i) * 6} progress={f} />;
          })}
        </>
      }
      html={
        <>
          <SyncIndicator x={540} y={190} state="synced" appear={pop(frame, fps, 40)} frame={frame} detail={`${Math.min(3, arrivals.filter((t) => frame >= t).length)}/3`} />
          {captions ? <Caption kicker="02 · Share" title="Text, images, video." appear={tween(frame, 14, 22)} x={84} y={820} /> : null}
        </>
      }
    />
  );
};
