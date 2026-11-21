import React from 'react';
import {C, FONT_DISPLAY, FONT_MONO} from '../theme';
import {LoopMark} from './Hub';

/** Screen-local UI fragments: deliberately simple, legible at small sizes. */

export const ScreenCode: React.FC<{w: number; h: number; code: string; reveal?: number}> = ({w, h, code, reveal = 1}) => {
  const shown = code.slice(0, Math.round(code.length * reveal));
  return (
    <g>
      <text x={w / 2} y={h * 0.3} textAnchor="middle" fontFamily="Manrope" fontWeight={800} fontSize={Math.min(24, w * 0.12)} fill={C.muted} letterSpacing="2">
        CODE
      </text>
      <rect x={w * 0.08} y={h * 0.36} width={w * 0.84} height={Math.min(70, h * 0.18)} rx={18} fill={C.white} stroke={C.ink} strokeWidth={3.5} />
      <text x={w / 2} y={h * 0.36 + Math.min(70, h * 0.18) * 0.66} textAnchor="middle" fontFamily={FONT_MONO} fontWeight={700} fontSize={Math.min(34, w * 0.15)} fill={C.ink} letterSpacing="2">
        {shown}
      </text>
      <QRBlock x={w / 2 - Math.min(56, w * 0.3)} y={h * 0.6} size={Math.min(112, w * 0.6)} />
    </g>
  );
};

/** Abstract QR: fixed pseudo-random modules (decorative, not scannable). */
export const QRBlock: React.FC<{x: number; y: number; size: number}> = ({x, y, size}) => {
  const n = 9;
  const cell = size / n;
  const on = (i: number, j: number) => ((i * 7 + j * 13 + i * j * 3) % 5 < 2 ? 1 : 0);
  const finder = (fx: number, fy: number) => (
    <g key={`${fx}-${fy}`}>
      <rect x={x + fx * cell} y={y + fy * cell} width={cell * 3} height={cell * 3} fill={C.ink} />
      <rect x={x + fx * cell + cell * 0.6} y={y + fy * cell + cell * 0.6} width={cell * 1.8} height={cell * 1.8} fill={C.white} />
      <rect x={x + fx * cell + cell} y={y + fy * cell + cell} width={cell} height={cell} fill={C.ink} />
    </g>
  );
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const inFinder = (i < 3 && j < 3) || (i > 5 && j < 3) || (i < 3 && j > 5);
      if (!inFinder && on(i, j)) cells.push(<rect key={`${i}-${j}`} x={x + i * cell} y={y + j * cell} width={cell} height={cell} fill={C.ink} />);
    }
  return (
    <g>
      <rect x={x - 8} y={y - 8} width={size + 16} height={size + 16} rx={10} fill={C.white} stroke={C.ink} strokeWidth={3} />
      {cells}
      {finder(0, 0)}
      {finder(6, 0)}
      {finder(0, 6)}
    </g>
  );
};

export const ScreenStatus: React.FC<{w: number; h: number; label: string; tone?: 'ok' | 'wait' | 'off'; sub?: string}> = ({
  w,
  h,
  label,
  tone = 'ok',
  sub,
}) => {
  const fill = tone === 'ok' ? C.pastaDeep : tone === 'wait' ? C.yellow : C.offline;
  const s = Math.min(w, h);
  return (
    <g>
      <circle cx={w / 2} cy={h * 0.42} r={s * 0.22} fill={fill} stroke={C.ink} strokeWidth={4} />
      <g transform={`translate(${w / 2} ${h * 0.43})`}>
        <LoopMark size={(s * 0.22) / 60} width={8} />
      </g>
      <text x={w / 2} y={h * 0.42 + s * 0.22 + s * 0.17} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize={s * 0.12} fill={C.ink}>
        {label}
      </text>
      {sub ? (
        <text x={w / 2} y={h * 0.42 + s * 0.22 + s * 0.29} textAnchor="middle" fontFamily="Manrope" fontWeight={600} fontSize={s * 0.075} fill={C.muted}>
          {sub}
        </text>
      ) : null}
    </g>
  );
};

/** Received-feed rows that stack as items land. */
export const ScreenFeed: React.FC<{w: number; h: number; items: Array<{kind: 'text' | 'image' | 'video'; appear: number; label?: string}>; title?: string}> = ({
  w,
  h,
  items,
  title = 'Received',
}) => {
  const pad = w * 0.07;
  const rowH = Math.min(70, h * 0.2);
  return (
    <g>
      <text x={pad} y={pad + 22} fontFamily="Manrope" fontWeight={800} fontSize={22} fill={C.ink}>
        {title}
      </text>
      {items.map((it, i) => {
        if (it.appear <= 0.001) return null;
        const y = pad + 44 + i * (rowH + 12);
        const fill = it.kind === 'text' ? C.butter : it.kind === 'image' ? C.sand : C.apricot;
        return (
          <g key={i} transform={`translate(${(1 - Math.min(1, it.appear)) * 40} ${y}) scale(1 ${Math.min(1.08, it.appear)})`} opacity={Math.min(1, it.appear * 1.5)}>
            <rect x={pad} y={0} width={w - pad * 2} height={rowH} rx={14} fill={C.white} stroke={C.ink} strokeWidth={3} />
            <rect x={pad + 10} y={10} width={rowH - 20} height={rowH - 20} rx={8} fill={fill} stroke={C.ink} strokeWidth={2.5} />
            {it.kind === 'video' ? <path d={`M ${pad + rowH / 2 - 6} ${rowH / 2 - 9} L ${pad + rowH / 2 + 9} ${rowH / 2} L ${pad + rowH / 2 - 6} ${rowH / 2 + 9} Z`} fill={C.ink} /> : null}
            {it.kind === 'image' ? <circle cx={pad + rowH / 2} cy={rowH / 2} r={7} fill={C.yellow} stroke={C.ink} strokeWidth={2} /> : null}
            {it.kind === 'text' ? <text x={pad + rowH / 2} y={rowH / 2 + 7} textAnchor="middle" fontFamily={FONT_DISPLAY} fontSize={20} fill={C.ink}>T</text> : null}
            <text x={pad + rowH + 8} y={rowH / 2 + 7} fontFamily="Manrope" fontWeight={700} fontSize={Math.min(20, w * 0.05)} fill={C.ink}>
              {it.label ?? (it.kind === 'text' ? 'Copied text' : it.kind === 'image' ? 'photo.jpg' : 'clip.mp4')}
            </text>
          </g>
        );
      })}
    </g>
  );
};
