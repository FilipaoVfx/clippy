import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Burst} from '../components/Hub';
import {Scene} from '../components/Scene';
import {ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {SyncIndicator, SyncState} from '../components/Sync';
import {Caption} from '../components/Type';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {accumulate, lerp, measure, Pt, strandPath} from '../lib/geometry';
import {C, PASTELS} from '../theme';

export const RECONNECT = {width: 1080, height: 1080, fps: 30, durationInFrames: 210};

const SNAP = 62;
const REACH = 118;
const REJOIN = 140;

/** 04 · Resume — the strand snaps, droops, then reaches back and relights. */
export const Reconnect: React.FC<{captions?: boolean}> = ({captions = true}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const phonePos = {x: 260, y: 470};
  const laptopPos = {x: 780, y: 450};
  const a = devicePort('phone', phonePos, 0.78, 'right');
  const b = devicePort('laptop', laptopPos, 0.6, 'left');
  const shape = {sag: 70, wiggle: frame > SNAP - 14 && frame < SNAP ? 30 : 12, curlAt: 0.5, curlRadius: 40, seed: 4};
  const whole = measure(strandPath(a, b, frame, shape));
  const breakPt = whole.point(0.5);

  // Loose ends: recoil and droop after the snap, then reach for each other.
  const recoil = spring({frame: frame - SNAP, fps, config: {damping: 7, stiffness: 120}});
  const reach = tween(frame, REACH, REJOIN - REACH, easeInOut);
  const droopL: Pt = {x: a.x + 40, y: a.y + 210};
  const droopR: Pt = {x: b.x - 40, y: b.y + 230};
  const endOf = (droop: Pt): Pt => ({
    x: lerp(lerp(breakPt.x, droop.x, recoil), breakPt.x, reach),
    y: lerp(lerp(breakPt.y, droop.y, recoil), breakPt.y, reach),
  });
  const broken = frame >= SNAP && frame < REJOIN;
  const dim = broken ? interpolate(frame, [SNAP, SNAP + 14, REACH, REJOIN], [0, 1, 1, 0.4], {extrapolateRight: 'clamp'}) : frame >= REJOIN ? 1 - tween(frame, REJOIN, 10) : 0;
  const lit = frame < SNAP ? tween(frame, 30, 10) : frame >= REJOIN ? tween(frame, REJOIN, 10) : 0;
  const speedAt = (f: number) => (f >= REJOIN ? interpolate(f, [REJOIN, REJOIN + 18], [0.004, 0.02], {extrapolateRight: 'clamp'}) : f >= SNAP ? 0 : 0.008);
  const phase = accumulate(frame, speedAt);

  const state: SyncState = frame < SNAP + 4 ? 'synced' : frame < REJOIN + 6 ? 'reconnecting' : 'resumed';
  const stateStart = state === 'synced' ? 34 : state === 'reconnecting' ? SNAP + 4 : REJOIN + 6;
  const laptopState = frame >= SNAP + 6 && frame < REJOIN + 4 ? 'offline' : 'connected';
  const ps = screenOf('phone');
  const ls = screenOf('laptop');

  const left = measure(strandPath(a, endOf(droopL), frame, {sag: 30, wiggle: 18, seed: 5}));
  const right = measure(strandPath(b, endOf(droopR), frame, {sag: -30, wiggle: 18, seed: 6}));

  return (
    <Scene
      offsetY={captions ? 0 : 110}
      tone="peach"
      svg={
        <>
          {broken ? (
            <>
              <Strand id="l" m={left} dim={dim} width={24} />
              <Strand id="r" m={right} dim={dim} width={24} />
            </>
          ) : (
            <Strand id="w" m={whole} to={tween(frame, 10, 22, easeInOut)} lit={lit} dim={dim} flash={frame >= REJOIN ? (frame - REJOIN) / 18 : frame >= 30 && frame < SNAP ? (frame - 30) / 16 : -1} particles={6} phase={phase} speed={speedAt(frame)} width={24} />
          )}
          <Device id="p" type="phone" x={phonePos.x} y={phonePos.y} scale={0.78} enter={drop(frame, fps, 0)} rotate={-4} pastel={PASTELS.butter} state="connected" bob={frame}>
            <ScreenStatus w={ps.w} h={ps.h} label={laptopState === 'offline' ? 'Holding' : 'Live'} tone={laptopState === 'offline' ? 'wait' : 'ok'} sub="room ABC-12K" />
          </Device>
          <Device id="lap" type="laptop" x={laptopPos.x} y={laptopPos.y} scale={0.6} enter={drop(frame, fps, 5)} rotate={3} pastel={PASTELS.sand} state={laptopState} check={frame >= REJOIN ? pop(frame, fps, REJOIN + 8) : 0} bob={frame + 20}>
            <ScreenStatus w={ls.w} h={ls.h} label={laptopState === 'offline' ? 'Offline' : frame >= REJOIN ? 'Resumed' : 'Live'} tone={laptopState === 'offline' ? 'off' : 'ok'} />
          </Device>
          <Burst x={breakPt.x} y={breakPt.y} t={(frame - SNAP) / 16} color={C.peachDeep} size={0.7} />
          <Burst x={breakPt.x} y={breakPt.y} t={(frame - REJOIN) / 20} size={0.9} />
        </>
      }
      html={
        <>
          <SyncIndicator x={540} y={200} state={state} appear={pop(frame, fps, stateStart)} frame={frame} detail={state === 'resumed' ? 'same room' : undefined} />
          {captions ? <Caption kicker="04 · Resume" title="Drops? It picks back up." appear={tween(frame, 16, 22)} x={84} y={820} /> : null}
        </>
      }
    />
  );
};
