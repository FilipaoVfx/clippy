import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Burst} from '../components/Hub';
import {Scene} from '../components/Scene';
import {ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator} from '../components/Sync';
import {pop, tween} from '../lib/anim';
import {measure, strandPath} from '../lib/geometry';
import {PASTELS} from '../theme';

export const SYNC_CONFIRM = {width: 1080, height: 1080, fps: 30, durationInFrames: 42};

/** SyncConfirmation: one pulse along the strand, a short accent, a clean ending. */
export const SyncConfirmation: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const lap = {x: 300, y: 570};
  const phone = {x: 790, y: 550};
  const a = devicePort('laptop', lap, 0.58, 'right');
  const b = devicePort('phone', phone, 0.72, 'left');
  const m = measure(strandPath(a, b, frame, {sag: 80, wiggle: 8, curlAt: 0.5, curlRadius: 44, seed: 6}));
  const mid = m.point(0.5);
  const ls = screenOf('laptop');
  const ps = screenOf('phone');

  return (
    <Scene
      tone="peach"
      fadeOut={8}
      push={0.02}
      svg={
        <>
          <Strand id="sync" m={m} lit={1 - tween(frame, 18, 14)} flash={frame >= 2 ? (frame - 2) / 16 : -1} width={24} />
          <Device id="l" type="laptop" x={lap.x} y={lap.y} scale={0.58} enter={1} rotate={-3} pastel={PASTELS.apricot} state="connected" bob={frame}>
            <ScreenStatus w={ls.w} h={ls.h} label="Synced" />
          </Device>
          <Device id="p" type="phone" x={phone.x} y={phone.y} scale={0.72} enter={1} rotate={4} pastel={PASTELS.peach} state="connected" check={pop(frame, fps, 14)} glow={tween(frame, 12, 6) * (1 - tween(frame, 22, 10))} bob={frame + 10}>
            <ScreenStatus w={ps.w} h={ps.h} label="Synced" />
          </Device>
          <Burst x={mid.x} y={mid.y} t={(frame - 8) / 18} size={1.1} />
        </>
      }
      html={<SyncIndicator x={540} y={200} state="synced" appear={pop(frame, fps, 6)} frame={frame} />}
    />
  );
};
