import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {C} from '../theme';

export type StageTone = 'ivory' | 'apricot' | 'butter' | 'pasta' | 'peach' | 'sand';

// Warm environments only: ivory to apricot, never cold pastels.
const TONES: Record<StageTone, {base: string; deep: string; shapeA: string; shapeB: string; shapeC: string}> = {
  ivory: {base: '#f7f2ea', deep: '#ece2d3', shapeA: C.pasta, shapeB: C.peach, shapeC: C.butter},
  apricot: {base: '#fbeee2', deep: '#f5dcc6', shapeA: C.pasta, shapeB: C.peach, shapeC: C.butter},
  butter: {base: '#fdf5e0', deep: '#f6e5b8', shapeA: C.apricot, shapeB: C.sand, shapeC: C.peach},
  pasta: {base: '#fdf1d8', deep: '#f7e0a8', shapeA: C.peach, shapeB: C.apricot, shapeC: C.sand},
  peach: {base: '#fcece2', deep: '#f6d6c4', shapeA: C.pasta, shapeB: C.butter, shapeC: C.apricot},
  sand: {base: '#f6eee3', deep: '#eadcc8', shapeA: C.peach, shapeB: C.pasta, shapeC: C.apricot},
};

/**
 * Soft pastel environment with a few hard-edged geometric volumes, a key light
 * from the upper left, and a vignette. Shapes drift slowly for parallax.
 */
export const Stage: React.FC<{tone?: StageTone; children?: React.ReactNode; shapes?: boolean}> = ({
  tone = 'ivory',
  children,
  shapes = true,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const t = TONES[tone];
  const unit = Math.min(width, height);
  const drift = (k: number) => Math.sin(frame / 90 + k) * unit * 0.008;

  return (
    <AbsoluteFill style={{background: `radial-gradient(120% 95% at 28% 22%, #fffdf8 0%, ${t.base} 42%, ${t.deep} 100%)`}}>
      {shapes ? (
        <>
          {/* Big soft disc, partly off-canvas */}
          <div
            style={{
              position: 'absolute',
              width: unit * 0.78,
              height: unit * 0.78,
              borderRadius: '50%',
              left: -unit * 0.22 + drift(1),
              top: height - unit * 0.5 + drift(2),
              background: `radial-gradient(circle at 35% 30%, #ffffffaa, ${t.shapeA} 55%)`,
              opacity: 0.85,
            }}
          />
          {/* Half disc block, top right */}
          <div
            style={{
              position: 'absolute',
              width: unit * 0.42,
              height: unit * 0.21,
              borderRadius: `${unit * 0.21}px ${unit * 0.21}px 0 0`,
              right: unit * 0.06 + drift(3),
              top: unit * 0.05,
              transform: 'rotate(180deg)',
              background: `linear-gradient(180deg, ${t.shapeB}, #ffffff66)`,
              opacity: 0.9,
            }}
          />
          {/* Outlined rotated square: brutalist line accent */}
          <div
            style={{
              position: 'absolute',
              width: unit * 0.13,
              height: unit * 0.13,
              right: width * 0.1 + drift(4),
              bottom: height * 0.14 + drift(5),
              border: `4px solid ${C.ink}`,
              transform: `rotate(${14 + frame * 0.05}deg)`,
              opacity: 0.16,
            }}
          />
          {/* Dot grid patch */}
          <div
            style={{
              position: 'absolute',
              width: unit * 0.24,
              height: unit * 0.16,
              left: width * 0.07,
              top: height * 0.08 + drift(6),
              backgroundImage: `radial-gradient(${C.ink} 2.2px, transparent 2.6px)`,
              backgroundSize: '26px 26px',
              opacity: 0.13,
            }}
          />
        </>
      ) : null}
      {children}
      {/* Vignette */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(130% 110% at 50% 45%, transparent 55%, #4a33201f 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};

const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 0.9 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

/** Static film grain: subtle, and kind to video encoders. */
export const Grain: React.FC<{opacity?: number}> = ({opacity = 0.09}) => (
  <AbsoluteFill style={{backgroundImage: GRAIN, opacity, mixBlendMode: 'multiply', pointerEvents: 'none'}} />
);
