import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Burst} from '../components/Hub';
import {Scene} from '../components/Scene';
import {Strand} from '../components/Strand';
import {SlamText} from '../components/Type';
import {easeInOut, tween} from '../lib/anim';
import {accumulate, measure, strandPath} from '../lib/geometry';
import {C, FONT_DISPLAY} from '../theme';

export const BRAND = {width: 1920, height: 1080, fps: 30, durationInFrames: 150};

const T = {grow: 4, knot: 46, logo: 52, tagline: [86, 94, 102] as const};

/**
 * BrandIntro: on ivory, one strand unfurls across the frame, ties the loop
 * of the logo, lights up, and the wordmark lands under it with the tagline.
 */
export const BrandIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const a = {x: -80, y: 470};
  const b = {x: 2000, y: 410};
  const m = measure(strandPath(a, b, frame, {sag: -70, wiggle: 14, curlAt: 0.5, curlRadius: 110, seed: 3, segments: 12}));

  const grow = tween(frame, T.grow, T.knot - T.grow, easeInOut);
  const lit = tween(frame, T.knot, 14);
  const speedAt = (f: number) => interpolate(f, [T.knot, T.knot + 20], [0.002, 0.012], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const knot = m.point(0.5);
  const words = ['Copy.', 'Share.', 'Sync.'];

  return (
    <Scene
      tone="ivory"
      push={0.03}
      fadeOut={18}
      svg={
        <>
          <Strand id="brand" m={m} to={grow} width={34} lit={lit} flash={frame >= T.knot ? (frame - T.knot) / 22 : -1} particles={grow > 0.99 ? 9 : 0} phase={accumulate(frame, speedAt)} speed={speedAt(frame)} />
          <Burst x={knot.x} y={knot.y} t={(frame - T.knot) / 22} size={1.6} />
        </>
      }
      html={
        <>
          <div style={{position: 'absolute', left: 0, right: 0, top: 560, display: 'flex', justifyContent: 'center'}}>
            <SlamText text="Pastty." start={T.logo} size={210} stagger={3} accentLast />
          </div>
          <div style={{position: 'absolute', left: 0, right: 0, top: 850, display: 'flex', justifyContent: 'center', gap: 34}}>
            {words.map((w, i) => {
              const t = tween(frame, T.tagline[i], 12);
              return (
                <span
                  key={w}
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: 76,
                    color: i === 2 ? C.yellowDeep : C.ink,
                    opacity: t,
                    transform: `translateY(${(1 - t) * 30}px)`,
                    display: 'inline-block',
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        </>
      }
    />
  );
};
