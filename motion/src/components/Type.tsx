import React from 'react';
import {spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, FONT_DISPLAY} from '../theme';

/**
 * Brutalist display line: each glyph slams in from above with its own spring,
 * carried by a hard yellow block shadow outlined in ink.
 */
export const SlamText: React.FC<{
  text: string;
  start: number;
  size: number;
  stagger?: number;
  shadow?: string;
  color?: string;
  accentLast?: boolean;
  style?: React.CSSProperties;
}> = ({text, start, size, stagger = 3, shadow = C.yellow, color = C.ink, accentLast = false, style}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const chars = [...text];
  const depth = Math.max(4, size * 0.07);
  const stroke = `${Math.max(3, size * 0.035)}px ${C.ink}`;
  const motion = chars.map((_, i) => {
    const s = spring({frame: frame - start - i * stagger, fps, config: {damping: 11, stiffness: 180, mass: 0.7}});
    const sq = Math.max(-0.12, Math.min(0.12, s - 1));
    return {
      visible: s > 0.001,
      transform: `translateY(${(1 - s) * -size * 1.3}px) rotate(${(1 - Math.min(1, s)) * (i % 2 ? 14 : -12)}deg) scale(${1 + sq * 1.3}, ${1 - sq * 1.3})`,
    };
  });
  // Two passes (all shadows, then all faces) so no glyph's block shadow
  // ever paints over its neighbour.
  const row = (layer: 'shadow' | 'face') =>
    chars.map((ch, i) => {
      const accent = accentLast && i === chars.length - 1;
      const fill = layer === 'shadow' ? (accent ? C.ink : shadow) : accent ? C.yellow : color;
      const outlined = layer === 'shadow' || accent;
      return (
        <span
          key={i}
          style={{
            display: 'inline-block',
            whiteSpace: 'pre',
            opacity: motion[i].visible ? 1 : 0,
            transform: motion[i].transform,
            transformOrigin: '50% 100%',
            color: fill,
            WebkitTextStroke: outlined ? stroke : undefined,
            paintOrder: 'stroke fill',
          }}
        >
          {ch}
        </span>
      );
    });
  return (
    <div style={{position: 'relative', fontFamily: FONT_DISPLAY, fontSize: size, lineHeight: 1, letterSpacing: '-0.04em', ...style}}>
      <div aria-hidden style={{position: 'absolute', left: depth, top: depth, display: 'flex'}}>
        {row('shadow')}
      </div>
      <div style={{position: 'relative', display: 'flex'}}>{row('face')}</div>
    </div>
  );
};

/** Caption block used at the bottom of each chapter clip. */
export const Caption: React.FC<{kicker: string; title: string; appear: number; x: number; y: number; width?: number}> = ({
  kicker,
  title,
  appear,
  x,
  y,
  width,
}) => {
  if (appear <= 0.001) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        transform: `translateY(${(1 - appear) * 40}px)`,
        opacity: Math.min(1, appear * 1.4),
      }}
    >
      <div
        style={{
          display: 'inline-block',
          fontFamily: 'Manrope',
          fontWeight: 800,
          fontSize: 24,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: C.ink,
          background: C.yellow,
          border: `4px solid ${C.ink}`,
          padding: '6px 14px',
          boxShadow: `6px 6px 0 ${C.ink}`,
          marginBottom: 18,
        }}
      >
        {kicker}
      </div>
      <div style={{fontFamily: FONT_DISPLAY, fontSize: 66, lineHeight: 1.04, letterSpacing: '-0.035em', color: C.ink}}>{title}</div>
    </div>
  );
};
