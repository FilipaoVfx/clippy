import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Packet, PacketKind} from '../components/Packet';
import {Scene} from '../components/Scene';
import {ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {easeInOut, pop, tween} from '../lib/anim';
import {accumulate, measure, strandPath} from '../lib/geometry';
import {PASTELS} from '../theme';

export const TRANSFER_SEQ = {width: 1080, height: 1080, fps: 30, durationInFrames: 66};

/**
 * TransferSequence: an abstract card (text or image, no real content) rides
 * the lit strand while the particles speed up, and lands on the other side.
 */
export const TransferSequence: React.FC<{contentType?: PacketKind}> = ({contentType = 'text'}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const phone = {x: 270, y: 560};
  const lap = {x: 790, y: 540};
  const a = devicePort('phone', phone, 0.72, 'right');
  const b = devicePort('laptop', lap, 0.58, 'left');
  const m = measure(strandPath(a, b, frame, {sag: 70, wiggle: 10, curlAt: 0.5, curlRadius: 40, seed: 4}));
  const send = 8;
  const land = 42;
  const travel = tween(frame, send, land - send, easeInOut);
  const speedAt = (f: number) => interpolate(f, [0, send, send + 8, land, land + 10], [0.004, 0.004, 0.026, 0.026, 0.006], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const p = m.point(travel);
  const arrived = frame >= land;
  const glow = interpolate(frame, [land - 2, land + 4, land + 18], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const ps = screenOf('phone');
  const ls = screenOf('laptop');

  return (
    <Scene
      tone="butter"
      fadeOut={10}
      svg={
        <>
          <Strand id="transfer" m={m} lit={0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, travel))} particles={8} phase={accumulate(frame, speedAt)} speed={speedAt(frame)} width={24} />
          <Device id="p" type="phone" x={phone.x} y={phone.y} scale={0.72} enter={1} rotate={-4} pastel={PASTELS.peach} state="connected" bob={frame}>
            <ScreenStatus w={ps.w} h={ps.h} label={arrived ? 'Sent' : 'Sending'} tone={arrived ? 'ok' : 'wait'} />
          </Device>
          <Device id="l" type="laptop" x={lap.x} y={lap.y} scale={0.58} enter={1} rotate={3} pastel={PASTELS.sand} state="connected" glow={glow} check={pop(frame, fps, land + 2)} bob={frame + 12}>
            <ScreenStatus w={ls.w} h={ls.h} label={arrived ? 'Received' : 'Live'} />
          </Device>
          {frame >= send && !arrived ? <Packet x={p.x} y={p.y - 70} kind={contentType} scale={0.9} tilt={Math.sin(frame / 4) * 6} progress={travel} /> : null}
        </>
      }
    />
  );
};
