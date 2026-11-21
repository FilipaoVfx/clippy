/**
 * ParticleSystem: a fixed pool of instanced particles that ride strands.
 * Nothing is allocated per frame; spawns beyond capacity are dropped.
 */
import { DynamicDrawUsage, InstancedMesh, Matrix4, Vector3 } from '/vendor/three.min.js';

export class ParticleSystem {
  /**
   * @param {object} o
   * @param {import('three').BufferGeometry} o.geometry
   * @param {import('three').Material} o.material
   * @param {number} o.capacity hard cap for this pool
   * @param {import('three').Material} [o.outline] ink hull material
   */
  constructor({ geometry, material, capacity, outline }) {
    this.capacity = capacity;
    this.limit = capacity; // lowered by the quality governor
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
    if (outline) {
      this.hull = new InstancedMesh(geometry, outline, capacity);
      this.hull.instanceMatrix = this.mesh.instanceMatrix; // same transforms
      this.hull.frustumCulled = false;
      this.hull.count = 0;
      this.hull.renderOrder = 3;
    }
    this.items = Array.from({ length: capacity }, () => ({
      path: null, u: 0, dir: 1, speed: 0, accel: 0, size: 1, delay: 0, age: 0, hullScale: 1,
    }));
    this.active = 0;
    this._m = new Matrix4();
    this._p = new Vector3();
  }

  /** path must expose pointAt(u, time, target). */
  spawn(path, { u = 0, dir = 1, speed = 0.4, accel = 0, size = 0.16, delay = 0 } = {}) {
    if (this.active >= this.limit) return false;
    const it = this.items[this.active];
    it.path = path;
    it.u = u;
    it.dir = dir;
    it.speed = speed;
    it.accel = accel;
    it.size = size;
    it.delay = delay;
    it.age = 0;
    this.active += 1;
    return true;
  }

  /** Remove particles riding a given path (link retracted or removed). */
  clearPath(path) {
    for (let i = this.active - 1; i >= 0; i -= 1) {
      if (this.items[i].path === path) this.kill(i);
    }
  }

  clear() {
    this.active = 0;
    this.mesh.count = 0;
    if (this.hull) this.hull.count = 0;
  }

  kill(i) {
    const last = this.active - 1;
    if (i !== last) {
      const tmp = this.items[i];
      this.items[i] = this.items[last];
      this.items[last] = tmp;
    }
    this.items[last].path = null;
    this.active = last;
  }

  update(dt, time) {
    let drawn = 0;
    for (let i = this.active - 1; i >= 0; i -= 1) {
      const it = this.items[i];
      if (it.delay > 0) {
        it.delay -= dt;
        continue;
      }
      it.age += dt;
      it.speed += it.accel * dt;
      it.u += it.dir * it.speed * dt;
      if (it.u > 1 || it.u < 0) {
        this.kill(i);
      }
    }
    for (let i = 0; i < this.active; i += 1) {
      const it = this.items[i];
      if (it.delay > 0) continue;
      it.path.pointAt(it.u, time, this._p);
      // Grow in at the start and shrink near the far end, so particles never pop.
      const edge = Math.min(1, it.age / 0.15, (it.dir > 0 ? 1 - it.u : it.u) / 0.06);
      const s = it.size * Math.max(0.05, edge);
      this._m.makeScale(s, s, s).setPosition(this._p);
      this.mesh.setMatrixAt(drawn, this._m);
      drawn += 1;
    }
    this.mesh.count = drawn;
    if (this.hull) this.hull.count = drawn;
    this.mesh.instanceMatrix.needsUpdate = drawn > 0;
  }

  dispose() {
    this.mesh.dispose();
    this.hull?.dispose();
    this.mesh.removeFromParent();
    this.hull?.removeFromParent();
  }
}
