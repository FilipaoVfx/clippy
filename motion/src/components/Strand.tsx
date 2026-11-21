import React from 'react';
import {interpolateColors} from 'remotion';
import {clamp, Measured} from '../lib/geometry';
import {C, LINE} from '../theme';

export type StrandProps = {
  id: string;
  m: Measured;
  width?: number;
  /** Drawn range of the strand, as fractions of its length. */
  from?: number;
  to?: number;
  /** 0..1 illumination: brighter body, halo, hot highlight. */
  lit?: number;
  /** 0..1 desaturation for a lost connection. */
  dim?: number;
  particles?: number;
  /** Integrated particle position (see `accumulate`). */
  phase?: number;
  /** Current particle speed (fraction of length per frame): sets trail length. */
  speed?: number;
  /** 0..1 position of the travelling ignition flash; <0 hides it. */
  flash?: number;
  reverseParticles?: boolean;
};

/**
 * A spaghetti strand rendered as a chunky tube: ink outline, shaded body,
 * specular highlight. Illumination adds a halo and hotter colours; data
 * particles ride along it with motion trails proportional to their speed.
 */
export const Strand: React.FC<StrandProps> = ({
  id,
  m,
  width = 26,
  from = 0,
  to = 1,
  lit = 0,
  dim = 0,
  particles = 0,
  phase = 0,
  speed = 0.004,
  flash = -1,
  reverseParticles = false,
}) => {
  const span = clamp(to) - clamp(from);
  if (span <= 0.0005) return null;
  const len = m.length;
  const dash = {strokeDasharray: `${span * len} ${len * 3}`, strokeDashoffset: -clamp(from) * len};
  const base = interpolateColors(dim, [0, 1], [interpolateColors(lit, [0, 1], [C.yellow, C.yellowLight]), C.offline]);
  const under = interpolateColors(dim, [0, 1], [C.yellowDeep, '#8f8780']);
  const hi = interpolateColors(lit, [0, 1], [C.yellowHi, '#ffffff']);
  const common = {d: m.d, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...dash};

  const dots: React.ReactNode[] = [];
  if (particles > 0) {
    const trailStep = clamp(speed * 1.6, 0.002, 0.03);
    for (let i = 0; i < particles; i++) {
      let f = (((i / particles + phase) % 1) + 1) % 1;
      if (reverseParticles) f = 1 - f;
      if (f < from || f > to) continue;
      for (let k = 3; k >= 0; k--) {
        const tf = reverseParticles ? f + k * trailStep : f - k * trailStep;
        if (tf < from || tf > to) continue;
        const p = m.point(tf);
        const r = width * (0.24 - k * 0.04) * (1 + lit * 0.35);
        dots.push(
          <circle
            key={`${i}-${k}`}
            cx={p.x}
            cy={p.y}
            r={Math.max(1.5, r)}
            fill={k === 0 ? '#ffffff' : C.yellowHi}
            opacity={(k === 0 ? 1 : 0.55 - k * 0.12) * (1 - dim)}
            stroke={k === 0 ? C.ink : 'none'}
            strokeWidth={k === 0 ? 2.5 : 0}
          />,
        );
      }
    }
  }

  return (
    <g>
      <defs>
        <filter id={`${id}-halo`} filterUnits="userSpaceOnUse" x={-400} y={-400} width={2800} height={2000}>
          <feGaussianBlur stdDeviation={width * 0.6} />
        </filter>
      </defs>
      {lit > 0.01 ? <path {...common} stroke={C.glow} strokeWidth={width * 2.6} opacity={0.75 * lit * (1 - dim)} filter={`url(#${id}-halo)`} /> : null}
      <path {...common} stroke={C.ink} strokeWidth={width + LINE * 2} />
      <path {...common} stroke={under} strokeWidth={width} />
      <path {...common} stroke={base} strokeWidth={width * 0.68} transform={`translate(0 ${-width * 0.1})`} />
      <path {...common} stroke={hi} strokeWidth={width * 0.2} opacity={0.85 * (1 - dim * 0.7)} transform={`translate(0 ${-width * 0.24})`} />
      {flash >= 0 && flash <= 1.2 ? (
        <path
          d={m.d}
          fill="none"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth={width * 0.55}
          strokeDasharray={`${len * 0.12} ${len * 3}`}
          strokeDashoffset={-(flash * len * 1.1 - len * 0.12)}
          opacity={1 - clamp((flash - 0.85) / 0.35)}
        />
      ) : null}
      {dots}
    </g>
  );
};
