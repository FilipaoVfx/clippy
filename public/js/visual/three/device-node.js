/**
 * DeviceNode: a stylised device (desktop, laptop, smartphone, tablet or the
 * generic "puck" used for peers), with a status light, an ink outline, a gentle
 * float and a pop-in entrance. Geometry is cached per type and shared.
 */
import {
  ExtrudeGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '/vendor/three.min.js';

function roundedRect(w, h, r) {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function slab(w, h, d, r) {
  const b = Math.min(d * 0.35, 0.1);
  const g = new ExtrudeGeometry(roundedRect(w - 2 * b, h - 2 * b, Math.max(0.01, r - b)), {
    depth: Math.max(0.01, d - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 3,
    curveSegments: 8,
  });
  g.center();
  return g;
}

// Part = [geometry key, material key, position, rotation x, outline?]
const SPECS = {
  smartphone: { w: 1.05, h: 2.0, port: [0.42, -0.1], light: [0.3, 0.82] },
  tablet: { w: 1.7, h: 2.2, port: [0.7, -0.1], light: [0.62, 0.95] },
  laptop: { w: 2.4, h: 2.0, port: [1.0, -0.3], light: [0.95, 1.38] },
  desktop: { w: 2.6, h: 2.6, port: [1.1, 0.0], light: [1.12, 1.55] },
  generic: { w: 1.6, h: 1.6, port: [0.65, -0.1], light: [0.55, 0.55] },
};

export const DEVICE_TYPES = Object.freeze(Object.keys(SPECS));

/** Geometry cache shared by every node; disposed once by the engine. */
export function deviceGeometries() {
  const g = {
    phone: slab(1.05, 2.0, 0.22, 0.24),
    phoneScreen: new ShapeGeometry(roundedRect(0.85, 1.72, 0.14)),
    tablet: slab(1.7, 2.2, 0.2, 0.22),
    tabletScreen: new ShapeGeometry(roundedRect(1.46, 1.96, 0.12)),
    lid: slab(2.3, 1.5, 0.14, 0.14),
    lidScreen: new ShapeGeometry(roundedRect(2.04, 1.24, 0.08)),
    base: slab(2.45, 1.5, 0.14, 0.16),
    monitor: slab(2.6, 1.7, 0.18, 0.16),
    monitorScreen: new ShapeGeometry(roundedRect(2.34, 1.44, 0.08)),
    neck: slab(0.34, 0.6, 0.16, 0.06),
    foot: slab(1.2, 0.6, 0.12, 0.2),
    puck: slab(1.6, 1.6, 0.7, 0.34),
    puckScreen: new ShapeGeometry(roundedRect(1.12, 1.12, 0.16)),
    bar: new PlaneGeometry(1, 0.1),
    light: new SphereGeometry(0.12, 12, 8),
    ring: new TorusGeometry(1, 0.05, 6, 40),
  };
  return g;
}

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

export class DeviceNode {
  constructor(type, geo, mats, { seed = 0 } = {}) {
    this.type = SPECS[type] ? type : 'generic';
    this.spec = SPECS[this.type];
    this.geo = geo;
    this.mats = mats;
    this.seed = seed;
    this.status = 'idle'; // idle | waiting | connected | reconnecting | disconnected
    this.group = new Group();
    this.body = new Group();
    this.group.add(this.body);
    this.parts = []; // [{ mesh, kind }] for dimming
    this.side = 1; // +1 port on the right (left node), -1 on the left
    this.scale = 1;
    this.appearAt = null; // scene time it pops in; null = hidden
    this.popAt = -1;
    this.build();
  }

  add(geoKey, kind, x = 0, y = 0, z = 0, rx = 0, outline = true) {
    const mesh = new Mesh(this.geo[geoKey], this.mats[kind]);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    this.body.add(mesh);
    this.parts.push({ mesh, kind });
    if (outline) {
      const hull = new Mesh(this.geo[geoKey], this.mats.ink);
      hull.position.copy(mesh.position);
      hull.rotation.copy(mesh.rotation);
      hull.scale.setScalar(1.06);
      this.body.add(hull);
      this.parts.push({ mesh: hull, kind: 'ink' });
    }
    return mesh;
  }

  bars(x, y, z, width, rows = 3) {
    for (let i = 0; i < rows; i += 1) {
      const bar = this.add('bar', 'glyph', x - width * 0.08 * (i % 2), y - i * 0.22, z, 0, false);
      bar.scale.x = width * (i === 0 ? 0.75 : i === 1 ? 1 : 0.5);
    }
  }

  build() {
    switch (this.type) {
      case 'smartphone':
        this.add('phone', 'body');
        this.add('phoneScreen', 'screen', 0, 0, 0.115, 0, false);
        this.bars(0, 0.3, 0.125, 0.55);
        break;
      case 'tablet':
        this.add('tablet', 'body');
        this.add('tabletScreen', 'screen', 0, 0, 0.105, 0, false);
        this.bars(0, 0.35, 0.115, 0.95);
        break;
      case 'laptop':
        this.add('lid', 'body', 0, 0.55, -0.2, -0.18);
        this.add('lidScreen', 'screen', 0, 0.56, -0.12, -0.18, false);
        this.bars(0, 0.85, -0.06, 1.3);
        this.add('base', 'body', 0, -0.3, 0.45, -Math.PI / 2 + 0.06);
        break;
      case 'desktop':
        this.add('monitor', 'body', 0, 0.45, 0);
        this.add('monitorScreen', 'screen', 0, 0.45, 0.095, 0, false);
        this.bars(0, 0.8, 0.105, 1.5);
        this.add('neck', 'body', 0, -0.6, -0.08);
        this.add('foot', 'body', 0, -0.95, 0.05, -Math.PI / 2 + 0.1);
        break;
      default:
        this.add('puck', 'body');
        this.add('puckScreen', 'screen', 0, 0.02, 0.355, 0, false);
        this.bars(0, 0.25, 0.365, 0.7);
    }
    const [lx, ly] = this.spec.light;
    this.light = new Mesh(this.geo.light, this.mats.waiting);
    this.light.position.set(lx, ly, 0.4);
    this.body.add(this.light);
    this.ring = new Mesh(this.geo.ring, this.mats.ring.clone());
    this.ring.visible = false;
    this.group.add(this.ring);
    this.group.rotation.x = this.type === 'laptop' ? 0.32 : 0.12;
    this.group.scale.setScalar(0.0001);
  }

  /** side: +1 when the node sits left and connects to its right. */
  place(position, scale, side) {
    this.group.position.copy(position);
    this.scale = scale;
    this.side = side;
    this.group.rotation.y = side * 0.38;
  }

  /** World-space point where a strand enters the device (hidden inside it). */
  port(target = new Vector3()) {
    const [px, py] = this.spec.port;
    return target.set(px * this.side * this.scale, py * this.scale, -0.1).add(this.group.position);
  }

  appear(time) {
    this.appearAt = time;
  }

  /** Fully visible right away (state replay, layout rebuilds). */
  show() {
    this.appearAt = -Infinity;
  }

  pop(time) {
    this.popAt = time;
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    const dim = status === 'disconnected';
    for (const { mesh, kind } of this.parts) {
      const key = dim ? `${kind}Dim` : kind;
      mesh.material = this.mats[key] || this.mats[kind];
    }
    this.light.material = status === 'connected' ? this.mats.online
      : status === 'disconnected' ? this.mats.offline : this.mats.waiting;
  }

  update(time) {
    // Entrance: a short overshoot pop, then a gentle float.
    let s = 1;
    if (this.appearAt !== null) {
      const t = Math.min(1, (time - this.appearAt) / 0.65);
      s = t >= 1 ? 1 : Math.max(0.0001, easeOutBack(t));
    } else {
      s = 0.0001;
    }
    if (this.popAt >= 0) {
      const t = (time - this.popAt) / 0.45;
      if (t >= 0 && t < 1) s *= 1 + Math.sin(t * Math.PI) * 0.12;
    }
    if (!this.hold) this.group.scale.setScalar(this.scale * s);

    const dim = this.status === 'disconnected';
    this.body.position.y = dim ? -0.15 : Math.sin(time * 0.9 + this.seed) * 0.07;
    this.body.rotation.z = dim ? -this.side * 0.12 : Math.sin(time * 0.6 + this.seed) * 0.025;

    // Reconnecting: the light blinks. Connected confirmation: a ring flash.
    this.light.visible = this.status !== 'idle' && (this.status !== 'reconnecting' || Math.sin(time * 9) > -0.2);
    const ringT = this.popAt >= 0 ? (time - this.popAt) / 0.7 : 1;
    this.ring.visible = ringT >= 0 && ringT < 1;
    if (this.ring.visible) {
      this.ring.scale.setScalar((this.spec.w * 0.55) * (0.8 + ringT * 0.7));
      this.ring.material.opacity = (1 - ringT) * 0.9;
    }
  }

  dispose() {
    this.ring.material.dispose();
    this.group.removeFromParent();
  }
}
