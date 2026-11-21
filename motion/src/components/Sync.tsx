import React from 'react';
import {interpolateColors} from 'remotion';
import {C, FONT_DISPLAY, FONT_MONO} from '../theme';

export type SyncState = 'syncing' | 'synced' | 'reconnecting' | 'resumed';

const LOOK: Record<SyncState, {bg: string; label: string}> = {
  syncing: {bg: C.butter, label: 'Syncing'},
  synced: {bg: C.pasta, label: 'Synced'},
  reconnecting: {bg: C.peach, label: 'Reconnecting'},
  resumed: {bg: C.pasta, label: 'Resumed'},
};

/** Small synchronization indicator: a brutalist pill with a live icon. */
export const SyncIndicator: React.FC<{
  x: number;
  y: number;
  state: SyncState;
  appear: number;
  frame: number;
  detail?: string;
  size?: number;
}> = ({x, y, state, appear, frame, detail, size = 1}) => {
  if (appear <= 0.001) return null;
  const look = LOOK[state];
  const spinning = state === 'syncing' || state === 'reconnecting';
  const settled = state === 'synced' || state === 'resumed';
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${appear * size}) rotate(${(1 - Math.min(1, appear)) * -8}deg)`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 24px 12px 14px',
        background: look.bg,
        border: `5px solid ${C.ink}`,
        borderRadius: 999,
        boxShadow: `8px 8px 0 ${C.ink}`,
        whiteSpace: 'nowrap',
      }}
    >
      <svg width={44} height={44} viewBox="-22 -22 44 44">
        <circle r={19} fill={settled ? C.pastaDeep : interpolateColors(state === 'reconnecting' ? 1 : 0, [0, 1], [C.yellow, C.peachDeep])} stroke={C.ink} strokeWidth={4} />
        {settled ? (
          <path d="M -9 0 L -3 7 L 10 -7" fill="none" stroke={C.ink} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <g transform={`rotate(${spinning ? frame * 9 : 0})`} fill="none" stroke={C.ink} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M -10 -2 A 10 10 0 0 1 8 -6" />
            <path d="M 8 -12 L 9 -5 L 2 -4" />
            <path d="M 10 2 A 10 10 0 0 1 -8 6" />
            <path d="M -8 12 L -9 5 L -2 4" />
          </g>
        )}
      </svg>
      <span style={{fontFamily: FONT_DISPLAY, fontSize: 32, color: C.ink, letterSpacing: '-0.01em'}}>{look.label}</span>
      {detail ? (
        <span style={{fontFamily: FONT_MONO, fontSize: 22, fontWeight: 700, color: C.inkSoft, opacity: 0.8}}>{detail}</span>
      ) : null}
    </div>
  );
};
