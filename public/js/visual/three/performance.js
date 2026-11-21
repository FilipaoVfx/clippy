/**
 * Quality profiles and a frame-time governor.
 *
 * The starting profile comes from several weak hints (viewport, pixel ratio,
 * pointer, memory, cores), none trusted alone. The governor then measures
 * real frame times and steps down when the device can't keep up.
 */

export const PROFILES = Object.freeze({
  low: Object.freeze({
    name: 'low', pixelRatio: 1.5, antialias: false,
    tubular: 70, radial: 8, ambient: 3, idleDevices: 2,
    particles: 24, media: 10, ambientParticles: 4,
  }),
  medium: Object.freeze({
    name: 'medium', pixelRatio: 1.5, antialias: true,
    tubular: 120, radial: 12, ambient: 5, idleDevices: 4,
    particles: 48, media: 20, ambientParticles: 8,
  }),
  high: Object.freeze({
    name: 'high', pixelRatio: 2, antialias: true,
    tubular: 180, radial: 14, ambient: 6, idleDevices: 4,
    particles: 96, media: 40, ambientParticles: 12,
  }),
});

const ORDER = ['low', 'medium', 'high'];

export function pickProfile(env = {}) {
  const { width = 1280, dpr = 1, cores = 4, memory = 4, coarse = false, saveData = false } = env;
  if (saveData) return PROFILES.low;
  let score = 0;
  if (width >= 1200) score += 1;
  if (!coarse) score += 1;
  if (cores >= 8) score += 1;
  if (memory >= 8) score += 1;
  if (cores <= 2 || memory <= 2) score -= 2;
  if (coarse && width < 760) score -= 1;
  if (dpr > 2.5 && coarse) score -= 1;
  if (score >= 3) return PROFILES.high;
  if (score >= 1) return PROFILES.medium;
  return PROFILES.low;
}

export function lowerProfile(profile) {
  const i = ORDER.indexOf(profile.name);
  return i > 0 ? PROFILES[ORDER[i - 1]] : null;
}

/**
 * Average frame time over a window; asks for a downgrade when frames stay
 * slower than ~40 fps. One step at a time, with a cool-down between steps.
 */
export class FrameGovernor {
  constructor({ window = 90, slowMs = 25, coolDownMs = 4000 } = {}) {
    this.window = window;
    this.slowMs = slowMs;
    this.coolDownMs = coolDownMs;
    this.samples = new Float32Array(window);
    this.n = 0;
    this.lastStep = -Infinity;
  }

  reset() {
    this.n = 0;
  }

  /** @returns {boolean} true when a downgrade is due */
  sample(dtMs, now) {
    // Long gaps (tab switch, debugger) say nothing about rendering speed.
    if (dtMs > 250) return false;
    this.samples[this.n % this.window] = dtMs;
    this.n += 1;
    if (this.n < this.window || now - this.lastStep < this.coolDownMs) return false;
    let sum = 0;
    for (let i = 0; i < this.window; i += 1) sum += this.samples[i];
    if (sum / this.window > this.slowMs) {
      this.lastStep = now;
      this.n = 0;
      return true;
    }
    return false;
  }
}
