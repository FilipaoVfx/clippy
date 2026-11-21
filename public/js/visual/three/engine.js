/**
 * Visual engine: one renderer, one scene, one camera, behind the HTML.
 *
 * It only *represents* state. sync(state) reconciles objects to the reducer's
 * state (idempotent, safe to call any time); play(effect) runs a one-off
 * animation for something that just happened. It never touches sockets,
 * codes or content.
 */
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from '/vendor/three.min.js';
import { deviceMaterials, disposeMaterials, PALETTE } from './materials.js';
import { DeviceNode, deviceGeometries } from './device-node.js';
import { ConnectionCurve } from './connection-curve.js';
import { PastaStrand } from './pasta-strand.js';
import { ParticleSystem } from './particle-system.js';
import { FrameGovernor, lowerProfile } from './performance.js';

/** Smooth path a -> b, bowed sideways, with one loop that rises toward the camera. */
function ambientPath(a, b, { bow, toward, loopAt, loopRadius, seed }) {
  const chord = b.clone().sub(a);
  const tan = chord.clone().normalize();
  let n = new Vector3(-tan.y, tan.x, 0);
  // Bow toward the requested x direction (the content), or downward if 0.
  const wantX = toward || 0;
  if ((wantX !== 0 && Math.sign(n.x) !== Math.sign(wantX)) || (wantX === 0 && n.y > 0)) n = n.negate();
  const base = (t) => a.clone().addScaledVector(chord, t).addScaledVector(n, bow * Math.sin(Math.PI * t));
  const pts = [];
  const before = [0, 0.14, loopAt - 0.14].filter((t) => t > -0.01 && t < loopAt - 0.05);
  before.forEach((t) => pts.push(base(t)));
  const c = base(loopAt).addScaledVector(n, loopRadius);
  const steps = 8;
  const dir = seed % 2 === 0 ? 1 : -1;
  for (let i = 1; i < steps; i += 1) {
    const th = (i / steps) * Math.PI * 2;
    const p = c.clone()
      .addScaledVector(n, -Math.cos(th) * loopRadius)
      .addScaledVector(tan, dir * Math.sin(th) * loopRadius + (i / steps - 0.5) * loopRadius * 1.2);
    p.z += Math.sin(th) * loopRadius;
    pts.push(p);
  }
  [loopAt + 0.16, (loopAt + 1) / 2 + 0.08, 0.86, 1].filter((t) => t <= 1).forEach((t) => pts.push(base(t)));
  return pts;
}

const FOV = 32;
const CAM_Z = 24;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function localDeviceType() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const minSide = Math.min(screen.width, screen.height);
  if (coarse) return minSide >= 700 ? 'tablet' : 'smartphone';
  return screen.width >= 1800 ? 'desktop' : 'laptop';
}

export class Engine {
  constructor(canvas, { profile, onLive = () => {}, onLost = () => {} }) {
    this.canvas = canvas;
    this.profile = profile;
    this.onLive = onLive;
    this.onLost = onLost;
    this.time = 0;
    this.frames = 0;
    this.running = false;
    this.destroyed = false;
    this.raf = 0;
    this.anims = [];
    this.state = null;
    this.peers = new Map(); // slot -> { node, link }
    this.self = null;
    this.searching = null;
    this.ambient = [];
    this.idleDevices = [];
    this.prScale = 1;
    this.pointer = new Vector2(0, 0);
    this.pointerTarget = new Vector2(0, 0);
    this.hoverSlot = -1;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.governor = new FrameGovernor();
    this.listeners = [];
    this._v = new Vector3();
    this._w = new Vector3();
  }

  // ── setup ────────────────────────────────────────────────

  init() {
    const p = this.profile;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: p.antialias,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_Z);

    this.scene.add(new HemisphereLight(PALETTE.cream, PALETTE.bodyShade, 1.7));
    const key = new DirectionalLight('#ffffff', 2.3);
    key.position.set(-4, 6, 8);
    this.scene.add(key);

    this.mats = deviceMaterials();
    this.geo = deviceGeometries();
    this.geo.dot = new IcosahedronGeometry(1, 1);
    this.geo.cube = new BoxGeometry(1.5, 1.5, 1.5);

    this.ambientGroup = new Group();
    this.networkGroup = new Group();
    this.scene.add(this.ambientGroup, this.networkGroup);

    this.textParticles = new ParticleSystem({
      geometry: this.geo.dot, material: this.mats.particleText, capacity: 96, outline: this.mats.particleInk,
    });
    this.mediaParticles = new ParticleSystem({
      geometry: this.geo.cube, material: this.mats.particleMedia, capacity: 40, outline: this.mats.particleInk,
    });
    // Idle drift lives inside the ambient group, so hiding the group hides it too.
    this.ambientParticles = new ParticleSystem({
      geometry: this.geo.dot, material: this.mats.particleText, capacity: 12, outline: this.mats.particleInk,
    });
    this.scene.add(this.textParticles.hull, this.textParticles.mesh, this.mediaParticles.hull, this.mediaParticles.mesh);
    this.ambientGroup.add(this.ambientParticles.hull, this.ambientParticles.mesh);
    this.applyProfileLimits();

    this.selfType = localDeviceType();
    this.layout();
    this.buildAmbient();
    this.bindLifecycle();
    return this;
  }

  applyProfileLimits() {
    this.textParticles.limit = Math.min(this.textParticles.capacity, this.profile.particles);
    this.mediaParticles.limit = Math.min(this.mediaParticles.capacity, this.profile.media);
    this.ambientParticles.limit = Math.min(this.ambientParticles.capacity, this.profile.ambientParticles);
  }

  listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  bindLifecycle() {
    let resizeTimer = 0;
    const relayout = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.relayout(), 120);
    };
    this.listen(window, 'resize', relayout);
    const main = document.getElementById('main');
    if (main && 'ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(relayout);
      this.resizeObserver.observe(main);
    }
    this.listeners.push(() => clearTimeout(resizeTimer));

    this.listen(document, 'visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.listen(window, 'pagehide', () => this.stop());
    this.listen(window, 'pageshow', () => this.start());

    this.listen(this.canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.liveAnnounced = false;
      this.stop();
      this.onLost();
    });
    this.listen(this.canvas, 'webglcontextrestored', () => {
      // three.js re-initialises its GL state and re-uploads buffers lazily.
      this.contextLost = false;
      this.relayout();
      this.start();
    });

    if (!this.coarse) {
      this.listen(window, 'pointermove', (e) => {
        this.pointerTarget.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
      }, { passive: true });
    }
  }

  // ── layout ───────────────────────────────────────────────

  layout() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.profile.pixelRatio) * this.prScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const halfH = Math.tan((FOV * Math.PI) / 360) * CAM_Z;
    const halfW = halfH * this.camera.aspect;
    const perPx = (2 * halfW) / w;
    const main = document.getElementById('main')?.getBoundingClientRect();
    const gutterPx = main ? Math.max(0, main.left - rect.left) : 0;
    const wide = gutterPx >= 140 && w >= 900;
    const gutter = gutterPx * perPx;

    let selfPos;
    let slots;
    let scale;
    if (wide) {
      const gx = halfW - gutter / 2;
      scale = Math.min(0.9, Math.max(0.5, gutter / 2.9));
      selfPos = new Vector3(-gx, -halfH * 0.08, 0);
      slots = [
        new Vector3(gx, halfH * 0.2, 0),
        new Vector3(gx + gutter * 0.08, -halfH * 0.42, 0),
        new Vector3(gx - gutter * 0.1, halfH * 0.66, 0),
        new Vector3(gx - gutter * 0.06, -halfH * 0.84, 0),
      ];
    } else {
      // Narrow screens: a compact band across the top, behind the header.
      scale = Math.min(0.62, Math.max(0.36, halfW * 0.12));
      const y = halfH * 0.5;
      selfPos = new Vector3(-halfW * 0.7, y, 0);
      slots = [
        new Vector3(halfW * 0.7, y + halfH * 0.08, 0),
        new Vector3(halfW * 0.38, y - halfH * 0.2, 0),
        new Vector3(halfW * 0.82, y - halfH * 0.32, 0),
        new Vector3(halfW * 0.5, y + halfH * 0.3, 0),
      ];
    }
    this.view = { w, h, halfW, halfH, gutter, wide, perPx, selfPos, slots, scale, mainLeft: main ? main.left - rect.left : w * 0.2 };
  }

  relayout() {
    if (this.destroyed) return;
    const before = this.view;
    this.layout();
    const v = this.view;
    if (before && before.w === v.w && before.h === v.h && before.gutter === v.gutter) return;
    this.buildAmbient();
    if (this.self) this.self.place(v.selfPos, v.scale, 1);
    for (const [slot, peer] of this.peers) {
      peer.node.place(v.slots[slot], v.scale, -1);
      peer.link.setEnds(this.self.port(this._v), peer.node.port(this._w));
    }
    if (this.searching) this.searching.setPoints(this.searchPoints());
  }

  // ── ambient (idle) world ─────────────────────────────────

  buildAmbient() {
    this.ambientParticles.clear();
    this.ambient.forEach((s) => s.dispose());
    this.idleDevices.forEach((d) => d.dispose());
    this.ambient = [];
    this.idleDevices = [];
    const v = this.view;
    const n = v.wide ? this.profile.ambient : Math.min(2, this.profile.ambient);
    const detail = { tubular: this.profile.tubular, radial: this.profile.radial };
    const radius = v.wide ? 0.3 : 0.22;

    for (let i = 0; i < n; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const pts = v.wide ? this.ambientWide(side, k) : this.ambientNarrow(i);
      const strand = new PastaStrand({
        points: pts,
        radius: radius * (1 - k * 0.12),
        detail,
        color: i % 3 === 2 ? PALETTE.golden : PALETTE.pasta,
        seed: i * 1.7,
        wobble: 0.16,
        freq: 4 + (i % 3),
        speed: 0.5 + (i % 4) * 0.08,
      });
      strand.group.position.z = -1.2 - k * 1.4;
      this.ambientGroup.add(strand.group);
      this.ambient.push(strand);
    }

    // Discreet devices resting on the strands: no status light, never "connected".
    const count = v.wide ? Math.min(this.profile.idleDevices, this.ambient.length) : 0;
    for (let i = 0; i < count; i += 1) {
      const strand = this.ambient[i];
      const node = new DeviceNode('generic', this.geo, this.mats, { seed: i * 2.1 });
      const at = strand.pointAt(v.wide ? 0.82 : 0.78, 0, new Vector3());
      at.z += strand.group.position.z + 0.4;
      node.place(at, v.scale * (v.wide ? 0.78 : 0.7), i % 2 === 0 ? 1 : -1);
      node.show();
      this.ambientGroup.add(node.group);
      this.idleDevices.push(node);
    }
    this.setAmbientVisible(!this.state || this.state.phase === 'idle', true);
  }

  /**
   * Decorative strands enter and leave through the side and bottom edges
   * (never the top, where the header lives), bow toward the content and tie
   * one loop: the same knot as the logo.
   */
  ambientWide(side, k) {
    const { halfW, halfH, gutter } = this.view;
    const edge = side * (halfW + 2.2);
    const routes = [
      [new Vector3(edge, halfH * 0.5, 0), new Vector3(side * (halfW - gutter * 0.55), -halfH - 2, 0), 0.45],
      [new Vector3(edge, -halfH * 0.05, 0), new Vector3(edge, -halfH * 0.9, 0), 0.5],
      [new Vector3(edge, halfH * 0.72, 0), new Vector3(edge, halfH * 0.18, 0), 0.4],
    ];
    const [a, b, loopAt] = routes[k % routes.length];
    return ambientPath(a, b, { bow: gutter * (0.75 - k * 0.12), toward: -side, loopAt, loopRadius: 0.95 - k * 0.15, seed: k + (side > 0 ? 3 : 0) });
  }

  /** Narrow screens: short C-shaped strands hugging the side edges, clear of the title. */
  ambientNarrow(i) {
    const { halfW, halfH } = this.view;
    const side = i % 2 === 0 ? -1 : 1;
    const top = halfH * (i < 2 ? 0.55 : -0.05);
    const a = new Vector3(side * (halfW + 1.5), top, 0);
    const b = new Vector3(side * (halfW + 1.5), top - halfH * 0.75, 0);
    return ambientPath(a, b, { bow: halfW * 0.42, toward: -side, loopAt: 0.45, loopRadius: 0.5, seed: i });
  }

  /** The scenery withdraws into the edges for a session and grows back after. */
  setAmbientVisible(on, instant = false) {
    if (this.ambientOn === on && !instant) return;
    this.ambientOn = on;
    const from = this.ambient[0]?.get('uProgress') ?? (on ? 0 : 1);
    const to = on ? 1 : 0;
    if (on) this.ambientGroup.visible = true;
    const apply = (v) => {
      this.ambient.forEach((s) => s.set('uProgress', v));
      this.idleDevices.forEach((d) => {
        d.group.scale.setScalar(Math.max(0.0001, d.scale * Math.min(1, v * 1.6 - 0.6)));
        d.hold = true;
      });
    };
    if (instant) {
      apply(to);
      this.idleDevices.forEach((d) => { d.hold = false; });
      this.ambientGroup.visible = on;
      return;
    }
    if (!on) this.ambientParticles.clear();
    this.tween(on ? 0.9 : 0.55, (t) => apply(from + (to - from) * easeInOut(t)), () => {
      this.idleDevices.forEach((d) => { d.hold = false; });
      if (!on) this.ambientGroup.visible = false;
    });
  }

  // ── network ──────────────────────────────────────────────

  /** A loose strand from this device toward the code panel, still looking for a peer. */
  searchPoints() {
    const v = this.view;
    const a = this.self.port(new Vector3());
    const b = v.wide ? new Vector3(-v.halfW * 0.3, a.y + v.halfH * 0.12, 0) : new Vector3(0, a.y - v.halfH * 0.12, 0);
    return ambientPath(a, b, { bow: v.wide ? 1.1 : 0.6, toward: 0, loopAt: 0.28, loopRadius: v.wide ? 0.6 : 0.4, seed: 1 });
  }

  ensureSelf() {
    if (this.self) return false;
    const v = this.view;
    this.self = new DeviceNode(this.selfType, this.geo, this.mats, { seed: 0.4 });
    this.self.place(v.selfPos, v.scale, 1);
    this.self.show();
    this.networkGroup.add(this.self.group);
    return true;
  }

  ensurePeer(slot) {
    if (this.peers.has(slot)) return false;
    const v = this.view;
    const node = new DeviceNode('generic', this.geo, this.mats, { seed: 1.3 + slot });
    node.place(v.slots[slot], v.scale, -1);
    node.show();
    const link = new ConnectionCurve({
      id: `link-${slot}`,
      from: this.self.port(new Vector3()),
      to: node.port(new Vector3()),
      radius: v.wide ? 0.26 : 0.18,
      detail: { tubular: this.profile.tubular, radial: this.profile.radial },
      seed: slot * 2.3,
      flip: slot % 2 === 0 ? 1 : -1,
    });
    link.strand.set('uProgress', 1);
    link.group.position.z = -0.3;
    this.networkGroup.add(link.group, node.group);
    this.peers.set(slot, { node, link });
    return true;
  }

  removePeer(slot) {
    const peer = this.peers.get(slot);
    if (!peer) return;
    this.textParticles.clearPath(peer.link);
    this.mediaParticles.clearPath(peer.link);
    peer.link.dispose();
    peer.node.dispose();
    this.peers.delete(slot);
  }

  clearNetwork() {
    for (const slot of [...this.peers.keys()]) this.removePeer(slot);
    this.searching?.dispose();
    this.searching = null;
    this.self?.dispose();
    this.self = null;
    this.textParticles.clear();
    this.mediaParticles.clear();
  }

  /** Reconcile scene objects with the reducer state. Idempotent. */
  sync(state) {
    this.state = state;
    if (state.phase === 'idle') {
      if (this.self && !this.exiting) this.exitNetwork();
      this.setAmbientVisible(true);
      return;
    }
    if (this.exiting) {
      this.exiting = false;
      this.clearNetwork();
    }
    this.setAmbientVisible(false);
    this.ensureSelf();

    const selfStatus = state.self === 'reconnecting' ? 'reconnecting'
      : state.self === 'offline' ? 'disconnected'
        : state.phase === 'waiting' ? 'waiting' : 'connected';
    this.self.setStatus(selfStatus);

    // Searching strand while waiting for the first peer.
    const anyPeer = state.peers.length > 0;
    if (state.phase === 'waiting' && !anyPeer && !this.searching) {
      this.searching = new PastaStrand({
        points: this.searchPoints(),
        radius: this.view.wide ? 0.26 : 0.18,
        detail: { tubular: Math.round(this.profile.tubular * 0.6), radial: this.profile.radial },
        free: true,
        wobble: 0.35,
        freq: 4,
        speed: 2.2,
        seed: 0.8,
      });
      this.searching.set('uProgress', 0.8);
      this.searching.group.position.z = -0.3;
      this.networkGroup.add(this.searching.group);
    } else if (anyPeer && this.searching) {
      const s = this.searching;
      this.searching = null;
      this.tween(0.35, (t) => s.set('uOpacity', 1 - t), () => s.dispose());
    }

    const offline = state.self !== 'online';
    for (const peer of state.peers) {
      this.ensurePeer(peer.slot);
      const { node, link } = this.peers.get(peer.slot);
      const dim = peer.status === 'disconnected';
      node.setStatus(dim ? 'disconnected' : offline ? 'reconnecting' : 'connected');
      link.state = dim ? 'disconnected' : offline ? 'reconnecting' : 'connected';
      if (!link.animating) {
        link.strand.set('uProgress', dim ? 0.42 : 1);
        link.strand.set('uDim', dim ? 1 : offline ? 0.55 : 0);
        link.strand.set('uOpacity', dim ? 0.6 : 1);
      }
    }
    const wanted = new Set(state.peers.map((p) => p.slot));
    for (const slot of [...this.peers.keys()]) if (!wanted.has(slot)) this.removePeer(slot);
  }

  exitNetwork() {
    this.exiting = true;
    const nodes = [this.self, ...[...this.peers.values()].map((p) => p.node)];
    const links = [...this.peers.values()].map((p) => p.link);
    if (this.searching) links.push({ strand: this.searching });
    const start = this.time;
    nodes.forEach((n) => { n.appearAt = null; });
    this.tween(0.45, (t) => {
      links.forEach((l) => l.strand.set('uProgress', 1 - t));
      nodes.forEach((n) => { n.group.scale.setScalar(Math.max(0.0001, n.scale * (1 - easeOut(t)))); });
    }, () => {
      if (this.exiting && this.time >= start) {
        this.exiting = false;
        this.clearNetwork();
      }
    });
  }

  /** One-off animation for something that just happened. */
  play(effect) {
    const now = this.time;
    switch (effect.type) {
      case 'session':
        // sync() already reconciled the objects; just bring this device in.
        this.self?.appear(now);
        break;

      case 'connect': {
        const peer = this.peers.get(effect.slot);
        if (!peer) break;
        const { node, link } = peer;
        node.appear(now + 0.55);
        link.animating = true;
        link.state = 'connecting';
        const from = effect.revived ? link.strand.get('uProgress') : 0;
        link.strand.set('uProgress', from); // before the next frame, so it never flashes full
        link.strand.set('uDim', 0);
        link.strand.set('uOpacity', 1);
        this.tween(0.9, (t) => link.strand.set('uProgress', from + (1 - from) * easeInOut(t)), () => {
          link.animating = false;
          link.state = 'connected';
          this.confirm(effect.slot);
        });
        break;
      }

      case 'disconnect': {
        const peer = this.peers.get(effect.slot);
        if (!peer) break;
        const { link } = peer;
        this.textParticles.clearPath(link);
        this.mediaParticles.clearPath(link);
        link.animating = true;
        const from = link.strand.get('uProgress');
        this.tween(0.7, (t) => {
          link.strand.set('uProgress', from + (0.42 - from) * easeOut(t));
          link.strand.set('uDim', t);
          link.strand.set('uOpacity', 1 - 0.4 * t);
        }, () => { link.animating = false; });
        break;
      }

      case 'transfer':
        this.transfer(effect.direction, effect.contentType);
        break;

      case 'complete':
        this.completePulse(effect.direction, effect.confirmation);
        break;

      case 'abort':
        this.textParticles.clear();
        this.mediaParticles.clear();
        this.forLinks((link) => {
          this.tween(0.5, (t) => link.strand.set('uDim', Math.sin(t * Math.PI) * 0.8));
        });
        break;

      case 'self-online':
        if (this.self) this.self.pop(now);
        this.forLinks((link) => this.flash(link, 0.8));
        break;

      case 'self-reconnecting':
      case 'self-offline':
        this.textParticles.clear();
        this.mediaParticles.clear();
        break;

      case 'reset':
      default:
        break;
    }
  }

  forLinks(fn) {
    for (const { link } of this.peers.values()) if (link.state !== 'disconnected') fn(link);
  }

  flash(link, strength = 1) {
    this.tween(0.9, (t) => link.strand.set('uGlow', strength * (1 - t)));
  }

  /** Connection confirmed: glow, burst of fast particles, nodes pop with a ring. */
  confirm(slot) {
    const peer = this.peers.get(slot);
    if (!peer) return;
    this.flash(peer.link, 1);
    peer.node.pop(this.time);
    this.self?.pop(this.time + 0.15);
    for (let i = 0; i < 6; i += 1) {
      this.textParticles.spawn(peer.link, { u: 0, dir: 1, speed: 0.5, accel: 2.2, size: 0.14, delay: i * 0.06 });
    }
  }

  transfer(direction, contentType) {
    const media = contentType !== 'text';
    const system = media ? this.mediaParticles : this.textParticles;
    const count = contentType === 'video' ? 10 : media ? 5 : 6;
    const out = direction === 'out';
    this.forLinks((link) => {
      link.state = 'transmitting';
      this.tween(1.6, (t) => link.strand.set('uGlow', 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.4))));
      for (let i = 0; i < count; i += 1) {
        system.spawn(link, {
          u: out ? 0 : 1,
          dir: out ? 1 : -1,
          speed: 0.25,
          accel: 1.4,
          size: media ? 0.13 : 0.15,
          delay: i * (contentType === 'video' ? 0.12 : 0.08),
        });
      }
    });
  }

  completePulse(direction, confirmation) {
    const out = direction === 'out';
    const amp = confirmation === 'complete' ? 1 : 0.75;
    this.forLinks((link) => {
      this.tween(0.65, (t) => {
        link.strand.set('uPulse', out ? t * 1.1 : 1 - t * 1.1);
        link.strand.set('uPulseAmp', amp * Math.sin(Math.PI * Math.min(1, t * 1.05)));
      }, () => {
        link.strand.set('uPulseAmp', 0);
        if (link.state === 'transmitting') link.state = 'connected';
      });
    });
    if (out) {
      for (const { node, link } of this.peers.values()) if (link.state !== 'disconnected') node.pop(this.time + 0.55);
    } else {
      this.self?.pop(this.time + 0.5);
    }
  }

  // ── loop ─────────────────────────────────────────────────

  tween(duration, step, done) {
    this.anims.push({ start: this.time, duration, step, done });
  }

  start() {
    if (this.running || this.destroyed || this.contextLost || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.governor.reset();
    const tick = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dtMs = now - this.last;
      this.last = now;
      this.frame(Math.min(0.05, Math.max(0, dtMs / 1000)));
      if (this.governor.sample(dtMs, now)) this.degrade();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  degrade() {
    const next = lowerProfile(this.profile);
    if (next) {
      this.profile = next;
      this.applyProfileLimits();
      this.ambient.forEach((s, i) => { s.group.visible = i < next.ambient; });
    } else if (this.prScale > 0.75) {
      this.prScale = 0.75;
    } else {
      return;
    }
    this.layout();
  }

  frame(dt) {
    this.time += dt;
    const t = this.time;

    if (this.anims.length) {
      const pending = this.anims;
      this.anims = [];
      for (const a of pending) {
        const k = Math.min(1, Math.max(0, (t - a.start) / a.duration));
        a.step(k);
        if (k >= 1) a.done?.();
        else this.anims.push(a);
      }
    }

    // Subtle parallax (mouse only), eased so it never chases the cursor.
    this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-dt * 2.5));
    this.camera.position.x = this.pointer.x * 0.35;
    this.camera.position.y = this.pointer.y * 0.22;
    this.camera.lookAt(0, 0, 0);

    if (this.ambientGroup.visible) this.ambient.forEach((s) => s.update(t));
    this.idleDevices.forEach((d) => d.update(t));
    this.searching?.update(t);
    if (this.searching) this.searching.set('uProgress', 0.8 + Math.sin(t * 1.4) * 0.1);
    this.self?.update(t);
    for (const { node, link } of this.peers.values()) {
      node.update(t);
      link.strand.update(t);
      if (link.state === 'reconnecting') link.strand.set('uGlow', (Math.sin(t * 5) * 0.5 + 0.5) * 0.35);
    }
    this.hover();

    // Idle: a few slow particles drift along the ambient strands.
    if (this.ambientGroup.visible) {
      if (this.ambientOn && this.frames % 40 === 0 && this.ambient.length) {
        const s = this.ambient[(this.frames / 40) % this.ambient.length | 0];
        if (s.group.visible) {
          const z = s.group.position.z;
          this.ambientParticles.spawn({ pointAt: (u, time, target) => s.pointAt(u, time, target).setZ(target.z + z) }, {
            u: 0.02, dir: 1, speed: 0.07, size: 0.11,
          });
        }
      }
      this.ambientParticles.update(dt, t);
    }

    this.textParticles.update(dt, t);
    this.mediaParticles.update(dt, t);
    this.renderer.render(this.scene, this.camera);
    this.frames += 1;
    if (!this.liveAnnounced) {
      this.liveAnnounced = true;
      this.onLive();
    }
  }

  /** Mouse over a peer device highlights its strand (no raycasting needed). */
  hover() {
    if (this.coarse || this.peers.size === 0) return;
    let found = -1;
    for (const [slot, { node }] of this.peers) {
      this._v.copy(node.group.position).project(this.camera);
      if (Math.hypot(this._v.x - this.pointer.x, this._v.y - this.pointer.y) < 0.09) found = slot;
    }
    if (found === this.hoverSlot) return;
    const prev = this.peers.get(this.hoverSlot);
    if (prev && !prev.link.animating) prev.link.strand.set('uGlow', 0);
    this.hoverSlot = found;
    const peer = this.peers.get(found);
    if (peer && peer.link.state === 'connected') peer.link.strand.set('uGlow', 0.4);
  }

  // ── teardown ─────────────────────────────────────────────

  debug() {
    const info = this.renderer?.info;
    return {
      profile: this.profile.name,
      running: this.running,
      frames: this.frames,
      wide: this.view?.wide,
      phase: this.state?.phase ?? 'idle',
      self: this.self ? { type: this.self.type, status: this.self.status } : null,
      searching: Boolean(this.searching),
      peers: [...this.peers.entries()].map(([slot, p]) => ({
        slot, node: p.node.status, link: p.link.state, progress: +p.link.strand.get('uProgress').toFixed(2),
      })),
      ambient: this.ambientGroup?.visible ? this.ambient.length : 0,
      particles: { text: this.textParticles?.active ?? 0, media: this.mediaParticles?.active ?? 0, ambient: this.ambientParticles?.active ?? 0 },
      drawCalls: info?.render.calls ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      listeners: this.listeners.length,
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.listeners.forEach((off) => off());
    this.listeners = [];
    this.resizeObserver?.disconnect();
    this.clearNetwork();
    this.ambient.forEach((s) => s.dispose());
    this.idleDevices.forEach((d) => d.dispose());
    this.textParticles.dispose();
    this.mediaParticles.dispose();
    this.ambientParticles.dispose();
    Object.values(this.geo).forEach((g) => g.dispose());
    disposeMaterials(this.mats);
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* already lost */ }
    this.scene = null;
  }
}
