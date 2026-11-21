import React from 'react';
import {C, LINE} from '../theme';

export type PacketKind = 'text' | 'image' | 'video';

/**
 * A data card riding a strand. Text, image and video each have a distinct
 * silhouette so the viewer reads the payload without any label.
 */
export const Packet: React.FC<{x: number; y: number; kind: PacketKind; scale?: number; tilt?: number; progress?: number}> = ({
  x,
  y,
  kind,
  scale = 1,
  tilt = 0,
  progress,
}) => {
  if (scale <= 0.001) return null;
  const w = 150;
  const h = 106;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale})`}>
      <rect x={-w / 2 + 9} y={-h / 2 + 9} width={w} height={h} rx={20} fill={C.ink} />
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={20} fill={C.white} stroke={C.ink} strokeWidth={LINE} />
      {kind === 'text' ? (
        <g>
          <text x={-w / 2 + 20} y={-8} fontFamily="'Russo One'" fontSize={34} fill={C.ink}>
            Aa
          </text>
          <rect x={-w / 2 + 20} y={10} width={108} height={10} rx={5} fill={C.yellow} stroke={C.ink} strokeWidth={2.5} />
          <rect x={-w / 2 + 20} y={28} width={72} height={10} rx={5} fill={C.apricotDeep} stroke={C.ink} strokeWidth={2.5} />
        </g>
      ) : null}
      {kind === 'image' ? (
        <g>
          <rect x={-w / 2 + 14} y={-h / 2 + 14} width={w - 28} height={h - 28} rx={10} fill={C.sand} stroke={C.ink} strokeWidth={3} />
          <circle cx={30} cy={-16} r={12} fill={C.yellow} stroke={C.ink} strokeWidth={3} />
          <path d={`M ${-w / 2 + 16} 34 L -24 -8 L 6 20 L 24 4 L ${w / 2 - 16} 34 Z`} fill={C.pastaDeep} stroke={C.ink} strokeWidth={3} strokeLinejoin="round" />
        </g>
      ) : null}
      {kind === 'video' ? (
        <g>
          <rect x={-w / 2 + 14} y={-h / 2 + 14} width={w - 28} height={h - 40} rx={10} fill={C.apricot} stroke={C.ink} strokeWidth={3} />
          <path d="M -12 -26 L 16 -10 L -12 6 Z" fill={C.peachDeep} stroke={C.ink} strokeWidth={3} strokeLinejoin="round" />
          <rect x={-w / 2 + 16} y={30} width={w - 32} height={8} rx={4} fill="#e6dfd8" stroke={C.ink} strokeWidth={2} />
          <rect x={-w / 2 + 16} y={30} width={(w - 32) * (progress ?? 0.5)} height={8} rx={4} fill={C.yellow} stroke={C.ink} strokeWidth={2} />
        </g>
      ) : null}
    </g>
  );
};
