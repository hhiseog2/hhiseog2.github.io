// Hologram look for the musicians: Fresnel rim glow, scanlines that travel upward in world space, a fine noise wobble on the
// vertices, a bottom-to-top dissolve with a bright edge as a player arrives at the front, flicker, and the short glitch.
// One shader serves skinned bodies, rigid props, their edge lines and the mirrored floor copies (phones).
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */`
vec3 hash3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453) * 2.0 - 1.0; }
float noise3(vec3 p){
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}`;

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
attribute vec3 tint;
uniform float uTime, uGlitch, uWobble, uBase, uSign;
varying vec3 vWorld, vNormalW, vTint;
varying float vH;
${NOISE_GLSL}
void main(){
  #ifdef EDGE
    vec3 objectNormal = vec3(0.0, 1.0, 0.0);
  #else
    #include <beginnormal_vertex>
  #endif
  #include <skinbase_vertex>
  #ifndef EDGE
    #include <skinnormal_vertex>
  #endif
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 nW = normalize(mat3(modelMatrix) * objectNormal);
  #ifndef EDGE
    wp.xyz += nW * noise3(wp.xyz * 3.2 + vec3(0.0, uTime * 0.7, 0.0)) * uWobble;       // the surface never sits quite still
  #endif
  float band = floor(wp.y * 13.0);
  float r = fract(sin(band * 91.7 + floor(uTime * 60.0) * 7.31) * 43758.5453);
  wp.x += (r - 0.5) * 0.26 * uGlitch;                                                  // glitch: horizontal slices jump sideways
  vWorld = wp.xyz;
  vNormalW = nW;
  vTint = tint;
  vH = (wp.y - uBase) * uSign;                                                         // height above the pedestal top
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform float uTime, uOpacity, uReveal, uHeight, uFlicker, uGhost, uMirror, uGlitch;
varying vec3 vWorld, vNormalW, vTint;
varying float vH;
${NOISE_GLSL}
void main(){
  #ifdef EDGE
    float fres = 0.55;
  #else
    vec3 n = normalize(vNormalW);
    float fres = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 2.2);      // rim glow
  #endif
  float scan = smoothstep(0.30, 0.70, 0.5 + 0.5 * sin((vWorld.y * 46.0 - uTime * 2.6) * 6.2831853));   // fine lines, moving up
  float sweep = smoothstep(0.92, 1.0, 0.5 + 0.5 * sin((vWorld.y * 1.1 - uTime * 0.55) * 6.2831853));   // a slow bright band, moving up
  float lines = 0.62 + 0.38 * scan + 0.55 * sweep;

  // dissolve: everything under the line is solid hologram, above it only a faint ghost; the line itself burns bright
  float hn = vH / uHeight;
  float line = uReveal * 1.2 - 0.08 + noise3(vec3(vWorld.xz * 7.0, uTime * 0.9)) * 0.045;
  float solid = 1.0 - smoothstep(line - 0.012, line + 0.012, hn);
  float moving = step(0.002, uReveal) * step(uReveal, 0.998);
  float edge = exp(-abs(hn - line) * 70.0) * moving;
  float presence = mix(uGhost, 1.0, solid);

  vec3 col = vTint * (0.42 + 1.75 * fres) * lines;
  col += vec3(0.85, 1.0, 1.0) * edge * 2.2;
  col += vTint * uGlitch * 0.6;
  float alpha = (0.20 + 0.80 * fres) * lines * presence + edge;
  #ifdef EDGE
    alpha = (0.34 * presence + edge) * (0.7 + 0.3 * scan);
  #endif
  alpha *= uOpacity * uFlicker;
  if (uMirror > 0.5) alpha *= 0.15 * clamp(1.0 - hn * 0.85, 0.0, 1.0);                 // floor copy: faint, fading with height
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
}`;

/** Uniforms every hologram material shares (one clock, one flicker, one glitch). */
export function createHologramClock() {
  return { uTime: { value: 0 }, uFlicker: { value: 1 }, uGlitch: { value: 0 } };
}

/** Uniforms one musician's materials share: how far the dissolve has come, how visible they are, where their pedestal is. */
export function createMusicianState() {
  return { uReveal: { value: 1 }, uOpacity: { value: 1 }, uGhost: { value: 0.2 }, uBase: { value: 0 }, uHeight: { value: 1.9 }, uBaseMirror: { value: 0 } };
}

export function createHologramMaterial(clock, state, { edge = false, mirror = false, wobble = 0.0035 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: edge ? { EDGE: 1 } : {},
    uniforms: {
      uTime: clock.uTime, uFlicker: clock.uFlicker, uGlitch: clock.uGlitch,
      uReveal: state.uReveal, uOpacity: state.uOpacity, uGhost: state.uGhost, uHeight: state.uHeight,
      uBase: mirror ? state.uBaseMirror : state.uBase,
      uSign: { value: mirror ? -1 : 1 },
      uMirror: { value: mirror ? 1 : 0 },
      uWobble: { value: edge ? 0 : wobble },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return material;
}

/** Give a geometry the per-vertex colour the shader reads (hologram cyan, or one of the three accent colours). */
export function paint(geometry, color) {
  const c = new THREE.Color(color), n = geometry.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geometry.setAttribute('tint', new THREE.BufferAttribute(a, 3));
  return geometry;
}
