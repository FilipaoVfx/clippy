/**
 * ConnectionCurve: the strand between this device and one peer slot.
 * Holds a stable id, its endpoints, a state and the animated uniforms.
 *
 * States: connecting -> connected <-> transmitting, disconnected, reconnecting.
 */
import { Vector3 } from '/vendor/three.min.js';
import { PastaStrand } from './pasta-strand.js';

/**
 * Path from a to b: a sagging arc with one loop, the brand's knot.
 * The loop rises toward the camera so the strand visibly crosses itself.
 */
export function connectionPoints(a, b, { sag = 1.2, loopAt = 0.32, loopRadius = 0.5, flip = 1, z = -0.4 } = {}) {
  const pts = [];
  const chord = b.clone().sub(a);
  const tan = chord.clone().normalize();
  const n = new Vector3(-tan.y, tan.x, 0).multiplyScalar(flip);
  const base = (t) => a.clone().addScaledVector(chord, t).add(new Vector3(0, -sag * 4 * t * (1 - t), z * Math.sin(Math.PI * t)));

  [0, 0.12, 0.22].forEach((t) => pts.push(base(t)));
  const c = base(loopAt).addScaledVector(n, loopRadius);
  const steps = 7;
  for (let i = 1; i < steps; i += 1) {
    const th = (i / steps) * Math.PI * 2;
    const p = c.clone()
      .addScaledVector(n, -Math.cos(th) * loopRadius)
      .addScaledVector(tan, Math.sin(th) * loopRadius + (i / steps - 0.5) * loopRadius * 0.9);
    p.z += Math.sin(th) * loopRadius * 0.9;
    pts.push(p);
  }
  [0.46, 0.62, 0.78, 0.9, 1].forEach((t) => pts.push(base(t)));
  return pts;
}

export class ConnectionCurve {
  constructor({ id, from, to, radius, detail, seed, flip = 1 }) {
    this.id = id;
    this.state = 'connecting';
    this.from = from.clone();
    this.to = to.clone();
    this.flip = flip;
    this.strand = new PastaStrand({
      points: connectionPoints(from, to, this.shape(from, to)),
      radius,
      detail,
      seed,
      wobble: 0.1,
      freq: 5.5,
      speed: 1.3,
    });
    this.strand.set('uProgress', 0);
    this.group = this.strand.group;
  }

  /** Endpoints moved (resize): rebuild once, keep animation state. */
  setEnds(from, to) {
    if (from.equals(this.from) && to.equals(this.to)) return;
    this.from.copy(from);
    this.to.copy(to);
    this.strand.setPoints(connectionPoints(from, to, this.shape(from, to)));
  }

  shape(from, to) {
    const span = from.distanceTo(to);
    return { flip: this.flip, sag: Math.min(2.4, span * 0.14), loopRadius: Math.min(0.62, span * 0.05) };
  }

  pointAt(u, time, target) {
    return this.strand.pointAt(u, time, target);
  }

  dispose() {
    this.strand.dispose();
  }
}
