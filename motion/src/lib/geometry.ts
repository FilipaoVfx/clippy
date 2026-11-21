import {getLength, getPointAtLength, getTangentAtLength} from '@remotion/paths';

export type Pt = {x: number; y: number};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Catmull-Rom through every point, emitted as cubic Béziers. */
export function smoothPath(pts: Pt[], tension = 1): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = {x: p1.x + ((p2.x - p0.x) / 6) * tension, y: p1.y + ((p2.y - p0.y) / 6) * tension};
    const c2 = {x: p2.x - ((p3.x - p1.x) / 6) * tension, y: p2.y - ((p3.y - p1.y) / 6) * tension};
    d += ` C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export type StrandShape = {
  /** Perpendicular sag at the middle, in px (positive bends "down" relative to a→b). */
  sag?: number;
  /** Amplitude of the living wobble, in px. */
  wiggle?: number;
  /** Where along the strand a pasta loop curls (0..1); omit for none. */
  curlAt?: number;
  curlRadius?: number;
  /** Flip the loop to the other side of the strand. */
  curlFlip?: boolean;
  seed?: number;
  segments?: number;
};

/**
 * The spaghetti strand: a sagging, gently breathing curve with an optional
 * single loop (the Pastty mark) tied into it. `time` is in frames.
 */
export function strandPoints(a: Pt, b: Pt, time: number, shape: StrandShape = {}): Pt[] {
  const {sag = 60, wiggle = 14, curlAt, curlRadius = 46, curlFlip = false, seed = 0, segments = 8} = shape;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = {x: dx / len, y: dy / len};
  // Normal that points "down" on screen for a left→right strand.
  let nrm = {x: -dir.y, y: dir.x};
  if (nrm.y < 0) nrm = {x: -nrm.x, y: -nrm.y};

  const at = (t: number): Pt => {
    const env = Math.sin(Math.PI * t);
    const breathe =
      wiggle * env * Math.sin(t * Math.PI * 2.2 + time * 0.07 + seed) +
      wiggle * 0.45 * env * Math.sin(t * Math.PI * 4.1 - time * 0.05 + seed * 1.7);
    const off = sag * env + breathe;
    return {x: a.x + dx * t + nrm.x * off, y: a.y + dy * t + nrm.y * off};
  };

  const pts: Pt[] = [];
  let curled = curlAt === undefined;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    if (!curled && curlAt !== undefined && t >= curlAt) {
      curled = true;
      const base = at(curlAt);
      // Local tangent, so the loop follows the strand's real direction.
      const ahead = at(Math.min(1, curlAt + 0.02));
      const tl = Math.hypot(ahead.x - base.x, ahead.y - base.y) || 1;
      const tan = {x: (ahead.x - base.x) / tl, y: (ahead.y - base.y) / tl};
      const side = curlFlip ? 1 : -1;
      const n = {x: -tan.y * side, y: tan.x * side};
      const r = curlRadius * (1 + 0.06 * Math.sin(time * 0.09 + seed));
      const center = {x: base.x + n.x * r, y: base.y + n.y * r};
      // Walk once around the circle, drifting forward so it reads as a loop.
      const steps = 7;
      for (let k = 0; k <= steps; k++) {
        const th = (k / steps) * Math.PI * 2;
        const drift = (k / steps) * r * 0.9;
        // θ=0 sits on `base`; the walk goes ahead, over, back and down.
        pts.push({
          x: center.x + r * (-n.x * Math.cos(th) + tan.x * Math.sin(th)) + tan.x * drift,
          y: center.y + r * (-n.y * Math.cos(th) + tan.y * Math.sin(th)) + tan.y * drift,
        });
      }
      if (t === curlAt) continue;
    }
    pts.push(at(t));
  }
  return pts;
}

export function strandPath(a: Pt, b: Pt, time: number, shape?: StrandShape) {
  return smoothPath(strandPoints(a, b, time, shape));
}

export type Measured = {
  d: string;
  length: number;
  point: (f: number) => Pt;
  angle: (f: number) => number;
};

export function measure(d: string): Measured {
  const length = getLength(d);
  return {
    d,
    length,
    point: (f) => getPointAtLength(d, clamp(f) * length),
    angle: (f) => {
      const t = getTangentAtLength(d, clamp(f, 0.001, 0.999) * length);
      return (Math.atan2(t.y, t.x) * 180) / Math.PI;
    },
  };
}

/** Integrates a per-frame speed so particles accelerate without jumping. */
export function accumulate(frame: number, speedAt: (f: number) => number): number {
  let sum = 0;
  for (let f = 0; f < frame; f++) sum += speedAt(f);
  return sum;
}
