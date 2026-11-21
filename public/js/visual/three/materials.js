/**
 * Shared materials. Strands use one small toon shader that also does the
 * wobble, growth and pulses on the GPU, so geometry is built once per layout
 * and never per frame. Devices use MeshToonMaterial with an ink back-face hull.
 */
import {
  BackSide,
  Color,
  DataTexture,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  Vector3,
} from '/vendor/three.min.js';

export const PALETTE = Object.freeze({
  ivory: '#f7f2ea',
  cream: '#fff8ed',
  pasta: '#ffc857',
  golden: '#ffb52e',
  orange: '#ff963d',
  peach: '#f5c6a5',
  charcoal: '#191919',
  muted: '#a5a09a',
  body: '#efe8de',
  bodyShade: '#d9cfc2',
  screen: '#2a2623',
  online: '#2fc46b',
  waiting: '#ffb52e',
  offline: '#a5a09a',
});

const STRAND_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform float uFreq;
uniform float uSpeed;
uniform float uSeed;
uniform float uFree;
uniform float uOutline;
uniform vec3 uWobbleDir;
varying vec3 vNormal;
varying float vU;
void main() {
  vU = uv.x;
  // Pinned at both ends, or only at the start for a loose (searching) strand.
  float env = mix(sin(3.14159265 * uv.x), uv.x, uFree);
  vec3 disp = uWobbleDir * sin(uv.x * uFreq + uTime * uSpeed + uSeed) * uWobble * env;
  vec3 p = position + disp + normal * uOutline;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const STRAND_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShade;
uniform vec3 uHi;
uniform vec3 uInk;
uniform vec3 uGlowColor;
uniform float uProgress;
uniform float uFrom;
uniform float uGlow;
uniform float uOpacity;
uniform float uPulse;
uniform float uPulseAmp;
uniform float uDim;
uniform float uIsOutline;
varying vec3 vNormal;
varying float vU;
void main() {
  if (vU > uProgress || vU < uFrom) discard;
  vec3 col;
  if (uIsOutline > 0.5) {
    col = mix(uInk, vec3(0.45), uDim * 0.6);
  } else {
    vec3 n = normalize(vNormal);
    float d = dot(n, normalize(vec3(-0.35, 0.72, 0.6)));
    col = d > 0.42 ? uColor : (d > -0.12 ? mix(uShade, uColor, 0.45) : uShade);
    if (d > 0.88) col = uHi;
    col = mix(col, uGlowColor, uGlow * 0.6);
    float pulse = uPulseAmp * smoothstep(0.1, 0.0, abs(vU - uPulse));
    col = mix(col, vec3(1.0, 0.97, 0.86), clamp(pulse, 0.0, 1.0));
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(grey * 0.9 + 0.08), uDim);
  }
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;

/** Uniform set shared by a strand's fill and outline passes. */
export function strandUniforms({ color = PALETTE.pasta, seed = 0, wobble = 0.12, freq = 6, speed = 1.1, free = false } = {}) {
  const base = new Color(color);
  const shade = base.clone().lerp(new Color(PALETTE.golden), 0.55).multiplyScalar(0.86);
  const hi = base.clone().lerp(new Color('#fffbe8'), 0.72);
  return {
    uTime: { value: 0 },
    uWobble: { value: wobble },
    uFreq: { value: freq },
    uSpeed: { value: speed },
    uSeed: { value: seed },
    uFree: { value: free ? 1 : 0 },
    uWobbleDir: { value: new Vector3(0, 1, 0) },
    uColor: { value: base },
    uShade: { value: shade },
    uHi: { value: hi },
    uInk: { value: new Color(PALETTE.charcoal) },
    uGlowColor: { value: new Color(PALETTE.orange) },
    uProgress: { value: 1 },
    uFrom: { value: 0 },
    uGlow: { value: 0 },
    uOpacity: { value: 1 },
    uPulse: { value: -1 },
    uPulseAmp: { value: 0 },
    uDim: { value: 0 },
  };
}

export function strandMaterials(uniforms, outlineWidth) {
  const fill = new ShaderMaterial({
    uniforms: { ...uniforms, uIsOutline: { value: 0 }, uOutline: { value: 0 } },
    vertexShader: STRAND_VERTEX,
    fragmentShader: STRAND_FRAGMENT,
    transparent: true,
  });
  const outline = new ShaderMaterial({
    uniforms: { ...uniforms, uIsOutline: { value: 1 }, uOutline: { value: outlineWidth } },
    vertexShader: STRAND_VERTEX,
    fragmentShader: STRAND_FRAGMENT,
    side: BackSide,
    transparent: true,
  });
  return { fill, outline };
}

/** Three-step ramp: flat cartoon shading instead of smooth gradients. */
function toonRamp() {
  const tex = new DataTexture(new Uint8Array([90, 180, 255]), 3, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Materials every device node shares (never disposed per node). */
export function deviceMaterials() {
  const ramp = toonRamp();
  return {
    ramp,
    body: new MeshToonMaterial({ color: PALETTE.body, gradientMap: ramp }),
    bodyDim: new MeshToonMaterial({ color: '#d8d3cc', gradientMap: ramp }),
    screen: new MeshBasicMaterial({ color: PALETTE.screen }),
    screenDim: new MeshBasicMaterial({ color: '#57524d' }),
    glyph: new MeshBasicMaterial({ color: PALETTE.pasta }),
    glyphDim: new MeshBasicMaterial({ color: '#8d877f' }),
    ink: new MeshBasicMaterial({ color: PALETTE.charcoal, side: BackSide }),
    inkDim: new MeshBasicMaterial({ color: '#77716b', side: BackSide }),
    online: new MeshBasicMaterial({ color: PALETTE.online }),
    waiting: new MeshBasicMaterial({ color: PALETTE.waiting }),
    offline: new MeshBasicMaterial({ color: PALETTE.offline }),
    ring: new MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0, depthWrite: false }),
    particleText: new MeshBasicMaterial({ color: '#fff1c2' }),
    particleMedia: new MeshBasicMaterial({ color: PALETTE.orange }),
    particleInk: new MeshBasicMaterial({ color: PALETTE.charcoal, side: BackSide }),
  };
}

export function disposeMaterials(set) {
  Object.values(set).forEach((m) => m?.dispose?.());
}
