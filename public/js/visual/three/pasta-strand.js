/**
 * PastaStrand: a smooth cartoon tube along a Catmull-Rom path, with an ink
 * outline pass. The GPU does wobble, growth (uProgress) and pulses; pointAt()
 * mirrors the same wobble on the CPU so particles ride the visible tube.
 */
import {
  CatmullRomCurve3,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from '/vendor/three.min.js';
import { strandMaterials, strandUniforms } from './materials.js';

const Z = new Vector3(0, 0, 1);

export class PastaStrand {
  /**
   * @param {object} o
   * @param {Vector3[]} o.points path control points (world units)
   * @param {number} o.radius tube radius
   * @param {{tubular:number, radial:number}} o.detail segment counts
   * @param {boolean} [o.free] loose end that wiggles (no device at the end)
   */
  constructor({ points, radius, detail, color, seed = 0, wobble = 0.12, freq = 6, speed = 1.1, free = false }) {
    this.radius = radius;
    this.detail = detail;
    this.free = free;
    this.uniforms = strandUniforms({ color, seed, wobble, freq, speed, free });
    const { fill, outline } = strandMaterials(this.uniforms, radius * 0.32);
    this.materials = [fill, outline];
    this.group = new Group();
    this.fill = new Mesh(undefined, fill);
    this.outline = new Mesh(undefined, outline);
    this.fill.renderOrder = 2;
    this.outline.renderOrder = 1;
    this.group.add(this.outline, this.fill);

    if (free) {
      // A rounded tip for the loose end. Its uv.x is 0 so the shader neither
      // trims nor wobbles it; pointAt() moves it to the visible tip instead.
      const cap = new SphereGeometry(radius, 14, 10);
      cap.setAttribute('uv', new Float32BufferAttribute(new Float32Array(cap.attributes.uv.count * 2), 2));
      this.capGeometry = cap;
      this.cap = new Mesh(cap, fill);
      this.capOutline = new Mesh(cap, outline);
      this.capOutline.scale.setScalar(1.32);
      this.group.add(this.capOutline, this.cap);
    }

    this._tmp = new Vector3();
    this.setPoints(points);
  }

  /** Rebuild the tube. Only on layout changes (resize, new slot), never per frame. */
  setPoints(points) {
    this.curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    this.geometry?.dispose();
    this.geometry = new TubeGeometry(this.curve, this.detail.tubular, this.radius, this.detail.radial, false);
    this.fill.geometry = this.geometry;
    this.outline.geometry = this.geometry;

    const chord = points[points.length - 1].clone().sub(points[0]).normalize();
    const dir = chord.clone().cross(Z).normalize().multiplyScalar(0.85).add(new Vector3(0, 0, 0.5)).normalize();
    this.uniforms.uWobbleDir.value.copy(dir);
  }

  /** Same displacement as the vertex shader, for particles and the tip. */
  pointAt(u, time, target = new Vector3()) {
    const t = Math.min(1, Math.max(0, u));
    this.curve.getPointAt(t, target);
    const env = this.free ? t : Math.sin(Math.PI * t);
    const un = this.uniforms;
    const k = Math.sin(t * un.uFreq.value + time * un.uSpeed.value + un.uSeed.value) * un.uWobble.value * env;
    return target.addScaledVector(un.uWobbleDir.value, k);
  }

  update(time) {
    this.uniforms.uTime.value = time;
    if (this.cap) {
      const tip = this.pointAt(this.uniforms.uProgress.value, time, this._tmp);
      this.cap.position.copy(tip);
      this.capOutline.position.copy(tip);
      const visible = this.uniforms.uProgress.value > 0.02;
      this.cap.visible = visible;
      this.capOutline.visible = visible;
    }
  }

  set(name, value) {
    this.uniforms[name].value = value;
  }

  get(name) {
    return this.uniforms[name].value;
  }

  dispose() {
    this.geometry?.dispose();
    this.capGeometry?.dispose();
    this.materials.forEach((m) => m.dispose());
    this.group.removeFromParent();
  }
}
