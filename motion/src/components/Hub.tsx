import React from 'react';
import {C, LINE} from '../theme';

/** The Pastty mark as a single loop of strand. */
export const LoopMark: React.FC<{size?: number; stroke?: string; width?: number}> = ({size = 1, stroke = C.ink, width = 9}) => (
  <path
    transform={`scale(${size})`}
    d="M -44 18 C -20 18, -6 -34, 18 -34 C 40 -34, 40 4, 16 4 C -8 4, -4 -28, 20 -28 C 34 -28, 40 -14, 44 0"
    fill="none"
    stroke={stroke}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

/** Central distribution node: an extruded yellow puck with pulse rings. */
export const Hub: React.FC<{x: number; y: number; scale?: number; frame: number; pulse?: number; r?: number}> = ({
  x,
  y,
  scale = 1,
  frame,
  pulse = 1,
  r = 96,
}) => {
  if (scale <= 0.001) return null;
  const rings = [0, 1, 2].map((k) => ((frame + k * 20) % 60) / 60);
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {rings.map((t, k) => (
        <circle key={k} r={r + t * 120} fill="none" stroke={C.ink} strokeWidth={4 * (1 - t)} opacity={0.35 * (1 - t) * pulse} />
      ))}
      <circle cx={16} cy={18} r={r} fill={C.yellowDeep} stroke={C.ink} strokeWidth={LINE} />
      <circle r={r} fill={C.yellow} stroke={C.ink} strokeWidth={LINE} />
      <circle r={r} fill="url(#hub-key)" />
      <defs>
        <radialGradient id="hub-key" cx="0.32" cy="0.28" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#7a4a00" stopOpacity="0.18" />
        </radialGradient>
      </defs>
      <g transform="translate(0 10)">
        <LoopMark size={1.25} />
      </g>
    </g>
  );
};

/** Ignition burst at the moment a link is established. */
export const Burst: React.FC<{x: number; y: number; t: number; color?: string; size?: number}> = ({x, y, t, color = C.yellow, size = 1}) => {
  if (t <= 0 || t >= 1) return null;
  const ring = 30 + t * 130;
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`} opacity={1 - t}>
      <circle r={ring} fill="none" stroke={C.ink} strokeWidth={6 * (1 - t) + 1} />
      <circle r={ring * 0.7} fill="none" stroke={color} strokeWidth={10 * (1 - t) + 1} />
      {Array.from({length: 8}, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        const r1 = 40 + t * 90;
        const r2 = r1 + 34 * (1 - t);
        return (
          <line
            key={i}
            x1={Math.cos(a) * r1}
            y1={Math.sin(a) * r1}
            x2={Math.cos(a) * r2}
            y2={Math.sin(a) * r2}
            stroke={C.ink}
            strokeWidth={7}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
};
