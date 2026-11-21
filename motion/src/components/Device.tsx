import React from 'react';
import {interpolateColors} from 'remotion';
import {squash} from '../lib/anim';
import {clamp, Pt} from '../lib/geometry';
import {C, LINE, Pastel} from '../theme';

export type DeviceType = 'phone' | 'tablet' | 'laptop' | 'monitor' | 'watch';
export type DeviceState = 'idle' | 'connected' | 'offline';

type Rect = {x: number; y: number; w: number; h: number; r: number};
type Spec = {body: Rect; screen: Rect; depth: number};

// Local coordinates, origin at the centre of the front face.
const SPECS: Record<DeviceType, Spec> = {
  phone: {body: {x: -105, y: -205, w: 210, h: 410, r: 42}, screen: {x: -89, y: -189, w: 178, h: 378, r: 28}, depth: 16},
  tablet: {body: {x: -180, y: -235, w: 360, h: 470, r: 38}, screen: {x: -158, y: -213, w: 316, h: 426, r: 22}, depth: 18},
  laptop: {body: {x: -250, y: -165, w: 500, h: 320, r: 26}, screen: {x: -228, y: -145, w: 456, h: 280, r: 12}, depth: 16},
  monitor: {body: {x: -230, y: -150, w: 460, h: 290, r: 24}, screen: {x: -212, y: -132, w: 424, h: 254, r: 12}, depth: 18},
  watch: {body: {x: -68, y: -78, w: 136, h: 156, r: 40}, screen: {x: -54, y: -64, w: 108, h: 128, r: 28}, depth: 12},
};

export const screenOf = (type: DeviceType) => SPECS[type].screen;

export type Side = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** Where a strand plugs into a device, in scene coordinates. */
export function devicePort(type: DeviceType, pos: Pt, scale = 1, side: Side = 'right'): Pt {
  const b = SPECS[type].body;
  const local: Record<Side, Pt> = {
    left: {x: b.x + 6, y: b.y + b.h * 0.62},
    right: {x: b.x + b.w - 6, y: b.y + b.h * 0.62},
    top: {x: 0, y: b.y + 6},
    bottom: {x: 0, y: b.y + b.h - 6 + (type === 'laptop' ? 40 : type === 'monitor' ? 60 : 0)},
    center: {x: 0, y: 0},
  };
  const p = local[side];
  return {x: pos.x + p.x * scale, y: pos.y + p.y * scale};
}

const Extras: React.FC<{type: DeviceType; pastel: Pastel; depth: number}> = ({type, pastel, depth}) => {
  if (type === 'laptop') {
    // Keyboard deck below the lid.
    return (
      <g>
        <path d={`M ${-288 + depth} ${178 + depth} L ${288 + depth} ${178 + depth} L ${312 + depth} ${212 + depth} L ${-312 + depth} ${212 + depth} Z`} fill={pastel.deep} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
        <path d="M -270 160 L 270 160 L 312 206 L -312 206 Z" fill={pastel.face} stroke={C.ink} strokeWidth={LINE} strokeLinejoin="round" />
        <rect x={-60} y={186} width={120} height={10} rx={5} fill={pastel.deep} stroke={C.ink} strokeWidth={3} />
      </g>
    );
  }
  if (type === 'monitor') {
    return (
      <g>
        <rect x={-26 + depth / 2} y={140} width={52} height={64} fill={pastel.deep} stroke={C.ink} strokeWidth={LINE} />
        <rect x={-120 + depth} y={198 + depth / 2} width={240} height={26} rx={13} fill={pastel.deep} stroke={C.ink} strokeWidth={LINE} />
        <rect x={-120} y={198} width={240} height={26} rx={13} fill={pastel.face} stroke={C.ink} strokeWidth={LINE} />
      </g>
    );
  }
  if (type === 'watch') {
    return (
      <g>
        <rect x={-42} y={-142} width={84} height={80} rx={18} fill={pastel.deep} stroke={C.ink} strokeWidth={LINE} />
        <rect x={-42} y={62} width={84} height={80} rx={18} fill={pastel.deep} stroke={C.ink} strokeWidth={LINE} />
        <rect x={68} y={-20} width={16} height={40} rx={6} fill={pastel.deep} stroke={C.ink} strokeWidth={4} />
      </g>
    );
  }
  return null;
};

export type DeviceProps = {
  id: string;
  type: DeviceType;
  x: number;
  y: number;
  scale?: number;
  /** Spring value for the drop-in; 1 = landed. Overshoot drives squash. */
  enter?: number;
  rotate?: number;
  pastel: Pastel;
  state?: DeviceState;
  /** 0..1 yellow halo around the screen while data flows. */
  glow?: number;
  /** 0..1(+) spring for the confirmation badge. */
  check?: number;
  /** Gentle idle bob; pass the current frame. */
  bob?: number;
  children?: React.ReactNode;
};

/**
 * Playful 3D-cartoon device: a pastel slab with a hard extruded side, a thick
 * ink outline, a key-lit gradient and a glossy screen. Screen content is
 * passed as children in screen-local coordinates (origin top-left).
 */
export const Device: React.FC<DeviceProps> = ({
  id,
  type,
  x,
  y,
  scale = 1,
  enter = 1,
  rotate = 0,
  pastel,
  state = 'idle',
  glow = 0,
  check = 0,
  bob = 0,
  children,
}) => {
  const spec = SPECS[type];
  const {body: b, screen: s, depth} = spec;
  if (enter <= 0.001) return null;
  const [sx, sy] = squash(enter);
  const fall = (1 - clamp(enter, 0, 1)) * -760;
  const bobY = Math.sin(bob / 22 + x * 0.01) * 5;
  const bottom = b.y + b.h;
  const offline = state === 'offline';
  const face = offline ? interpolateColors(0.7, [0, 1], [pastel.face, '#e7e2de']) : pastel.face;
  const deep = offline ? interpolateColors(0.7, [0, 1], [pastel.deep, C.offline]) : pastel.deep;
  const screenTop = offline ? '#ece8e4' : '#fffdf8';
  const screenBottom = offline ? '#d6d0cb' : state === 'connected' ? C.yellowHi : '#f3ece6';

  return (
    <g transform={`translate(${x} ${y + fall + bobY}) rotate(${rotate}) scale(${scale})`}>
      <defs>
        <linearGradient id={`${id}-key`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#5a3b22" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id={`${id}-screen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={screenTop} />
          <stop offset="1" stopColor={screenBottom} />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor={C.ink} stopOpacity="0.28" />
          <stop offset="1" stopColor={C.ink} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />
        </clipPath>
      </defs>
      {/* Contact shadow shrinks while the device is still falling */}
      <ellipse
        cx={depth}
        cy={bottom + (type === 'laptop' ? 64 : type === 'monitor' ? 78 : type === 'watch' ? 82 : 34) - fall - bobY}
        rx={b.w * 0.62 * clamp(enter)}
        ry={22 * clamp(enter)}
        fill={`url(#${id}-shadow)`}
      />
      <g transform={`translate(0 ${bottom}) scale(${sx} ${sy}) translate(0 ${-bottom})`}>
        <Extras type={type} pastel={{face, deep}} depth={depth} />
        {/* Extruded side */}
        <rect x={b.x + depth} y={b.y + depth} width={b.w} height={b.h} rx={b.r} fill={deep} stroke={C.ink} strokeWidth={LINE} />
        {/* Front face */}
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.r} fill={face} stroke={C.ink} strokeWidth={LINE} />
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.r} fill={`url(#${id}-key)`} />
        {glow > 0.001 ? (
          <rect
            x={s.x - 9}
            y={s.y - 9}
            width={s.w + 18}
            height={s.h + 18}
            rx={s.r + 8}
            fill="none"
            stroke={C.yellow}
            strokeWidth={10}
            opacity={glow}
          />
        ) : null}
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill={`url(#${id}-screen)`} stroke={C.ink} strokeWidth={3.5} />
        <g clipPath={`url(#${id}-clip)`}>
          <g transform={`translate(${s.x} ${s.y})`} opacity={offline ? 0.45 : 1}>
            {children}
          </g>
          {/* Glossy specular sweep */}
          <path d={`M ${s.x + s.w * 0.55} ${s.y} L ${s.x + s.w * 0.85} ${s.y} L ${s.x + s.w * 0.25} ${s.y + s.h} L ${s.x - s.w * 0.05} ${s.y + s.h} Z`} fill="#ffffff" opacity={0.22} />
        </g>
        {type === 'phone' ? <rect x={-26} y={b.y + 26} width={52} height={14} rx={7} fill={C.ink} /> : null}
        {type === 'tablet' ? <circle cx={0} cy={b.y + 12} r={4} fill={C.ink} /> : null}
        {type === 'laptop' || type === 'monitor' ? <circle cx={0} cy={b.y + 10} r={3.5} fill={C.ink} /> : null}
      </g>
      {check > 0.001 ? <CheckBadge x={b.x + b.w - 4} y={b.y + 6} scale={check / scale} /> : null}
    </g>
  );
};

/** Visual confirmation: a chunky pasta badge with a hard shadow. */
export const CheckBadge: React.FC<{x: number; y: number; scale: number; tone?: 'ok' | 'warn'}> = ({x, y, scale, tone = 'ok'}) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <circle cx={6} cy={6} r={34} fill={C.ink} />
    <circle r={34} fill={tone === 'ok' ? C.pastaDeep : C.butterDeep} stroke={C.ink} strokeWidth={LINE} />
    {tone === 'ok' ? (
      <path d="M -15 1 L -4 12 L 16 -11" fill="none" stroke={C.ink} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M 0 -16 L 0 4 M 0 15 L 0 15.5" fill="none" stroke={C.ink} strokeWidth={8} strokeLinecap="round" />
    )}
  </g>
);
