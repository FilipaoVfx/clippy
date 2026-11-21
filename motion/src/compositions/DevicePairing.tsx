import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Burst} from '../components/Hub';
import {Scene} from '../components/Scene';
import {ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator} from '../components/Sync';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {accumulate, measure, strandPath} from '../lib/geometry';
import {PASTELS} from '../theme';

export const PAIRING = {width: 1080, height: 1080, fps: 30, durationInFrames: 66};

/** DevicePairing: a second device arrives, the strand reaches it, lights up, both confirm. */
export const DevicePairing: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const lap = {x: 300, y: 560};
  const phone = {x: 800, y: 540};
  const a = devicePort('laptop', lap, 0.58, 'right');
  const b = devicePort('phone', phone, 0.72, 'left');
  const m = measure(strandPath(a, b, frame, {sag: 80, wiggle: 12, curlAt: 0.5, curlRadius: 44, seed: 2}));
  const connect = 36;
  const grow = tween(frame, 8, connect - 8, easeInOut);
  const speedAt = (f: number) => interpolate(f, [connect, connect + 12], [0.004, 0.022], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const connected = frame >= connect + 2;
  const ls = screenOf('laptop');
  const ps = screenOf('phone');

  return (
    <Scene
      tone="apricot"
      fadeOut={10}
      svg={
        <>
          <Strand id="pairing" m={m} to={grow} lit={tween(frame, connect, 8)} flash={frame >= connect ? (frame - connect) / 14 : -1} particles={connected ? 6 : 0} phase={accumulate(frame, speedAt)} speed={speedAt(frame)} width={24} />
          <Device id="l" type="laptop" x={lap.x} y={lap.y} scale={0.58} enter={1} rotate={-3} pastel={PASTELS.apricot} state={connected ? 'connected' : 'idle'} check={pop(frame, fps, connect + 6)} bob={frame}>
            <ScreenStatus w={ls.w} h={ls.h} label={connected ? 'Paired' : 'Waiting'} tone={connected ? 'ok' : 'wait'} />
          </Device>
          <Device id="p" type="phone" x={phone.x} y={phone.y} scale={0.72} enter={drop(frame, fps, 0)} rotate={4} pastel={PASTELS.peach} state={connected ? 'connected' : 'idle'} check={pop(frame, fps, connect + 10)} bob={frame + 15}>
            <ScreenStatus w={ps.w} h={ps.h} label={connected ? 'Paired' : 'Joining'} tone={connected ? 'ok' : 'wait'} />
          </Device>
          <Burst x={a.x} y={a.y} t={(frame - connect) / 16} size={0.8} />
          <Burst x={b.x} y={b.y} t={(frame - connect - 4) / 16} size={0.8} />
        </>
      }
      html={<SyncIndicator x={540} y={190} state={connected ? 'synced' : 'syncing'} appear={pop(frame, fps, 14)} frame={frame} />}
    />
  );
};
