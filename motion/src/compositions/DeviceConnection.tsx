import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Burst} from '../components/Hub';
import {Scene} from '../components/Scene';
import {ScreenCode, ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator} from '../components/Sync';
import {Caption} from '../components/Type';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {accumulate, measure, strandPath} from '../lib/geometry';
import {PASTELS} from '../theme';

export const CONNECTION = {width: 1080, height: 1080, fps: 30, durationInFrames: 180};

/** 01 · Pair — a code on one device, typed on the other, and the strand finds its way. */
export const DeviceConnection: React.FC<{captions?: boolean}> = ({captions = true}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const phonePos = {x: 270, y: 470};
  const laptopPos = {x: 760, y: 440};
  const a = devicePort('phone', phonePos, 0.78, 'right');
  const b = devicePort('laptop', laptopPos, 0.6, 'left');
  const m = measure(strandPath(a, b, frame, {sag: 70, wiggle: 12, curlAt: 0.52, curlRadius: 40, seed: 2}));

  const connect = 108;
  const grow = tween(frame, 68, 38, easeInOut);
  const lit = tween(frame, connect, 12);
  const speedAt = (f: number) => interpolate(f, [connect, connect + 20], [0.003, 0.02], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const connected = frame >= connect + 4;
  const ps = screenOf('phone');
  const ls = screenOf('laptop');

  return (
    <Scene
      offsetY={captions ? 0 : 110}
      tone="pasta"
      svg={
        <>
          <Strand id="pair" m={m} to={grow} lit={lit} flash={frame >= connect ? (frame - connect) / 16 : -1} particles={grow > 0.98 ? 6 : 0} phase={accumulate(frame, speedAt)} speed={speedAt(frame)} width={24} />
          <Device id="p" type="phone" x={phonePos.x} y={phonePos.y} scale={0.78} enter={drop(frame, fps, 2)} rotate={-5} pastel={PASTELS.peach} state={connected ? 'connected' : 'idle'} check={pop(frame, fps, connect + 12)} bob={frame}>
            {connected ? <ScreenStatus w={ps.w} h={ps.h} label="Paired" /> : <ScreenCode w={ps.w} h={ps.h} code="ABC-12K" reveal={tween(frame, 14, 18)} />}
          </Device>
          <Device id="l" type="laptop" x={laptopPos.x} y={laptopPos.y} scale={0.6} enter={drop(frame, fps, 10)} rotate={3} pastel={PASTELS.sand} state={connected ? 'connected' : 'idle'} check={pop(frame, fps, connect + 18)} bob={frame + 20}>
            {connected ? (
              <ScreenStatus w={ls.w} h={ls.h} label="Paired" />
            ) : (
              <g transform="translate(78 10) scale(0.65)">
                <ScreenCode w={460} h={420} code="ABC-12K" reveal={tween(frame, 36, 28)} />
              </g>
            )}
          </Device>
          <Burst x={a.x} y={a.y} t={(frame - connect) / 20} size={0.8} />
          <Burst x={b.x} y={b.y} t={(frame - connect - 12) / 20} size={0.8} />
        </>
      }
      html={
        <>
          <SyncIndicator x={540} y={210} state={frame < connect + 8 ? 'syncing' : 'synced'} appear={pop(frame, fps, connect - 30)} frame={frame} detail={frame < connect + 8 ? undefined : '12 ms'} />
          {captions ? <Caption kicker="01 · Pair" title="One code. Instant link." appear={tween(frame, 18, 22)} x={84} y={820} /> : null}
        </>
      }
    />
  );
};
