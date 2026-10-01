// The frontman as a figure of light (A · Velvet Noir, rq-20261001 hero redesign). He is the film's own ink drawing — cut from the
// owner's film (images/screening-frontman.webp, the frame at 11.8 s), so he is the same hand and the same scale as the saxophonist
// and the bassist — drawn on a plane just in front of the screen:
//
//   exitAt .. +0.9 s        the 2D frontman has left through the top edge; he comes back down out of it as light, swells a little
//                           toward the audience on the way, and lands on the film's stage line (a small give in the knees)
//   .. returnAt - 1.0 s     he stands there and sings: feet on the line, a contact shadow under them, a slow sway and a glow on
//                           the beat
//   .. returnAt             a dip, a spring up and out through the top edge; at returnAt the 2D feet come in at the same place
//
// Light: see-through, a warm glow round the edges, faint scanlines, a slight flicker. He is clipped to the screen's rectangle, so
// he never covers the curtain or the frame, and he stays in the beam. Everything is a function of the film's clock.
import * as THREE from 'three';
import { CONFIG, SCREENING } from './config.js';

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const BPM = 160;

// the cut-out's place in the film frame (measured when it was cut): its height and where its feet stand
const FIG = { h: 600 / 834, aspect: 296 / 600, feet: 693 / 834, cx: (0.33 * 1112 + 148) / 1112 };
const PAD = 0.18;                                  // room round the figure on its plane, for the glow

export async function loadHologram(S) {
  const tex = await new THREE.TextureLoader().loadAsync(CONFIG.images.frontman);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const fh = FIG.h * S.H, fw = fh * FIG.aspect;
  const uniforms = {
    map: { value: tex }, uOpacity: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 1 }, uTexel: { value: new THREE.Vector2(1 / 296, 1 / 600) },
    uClip: { value: new THREE.Vector4(-S.W / 2, S.bottom, S.W / 2, S.top) }, uPad: { value: PAD }, uMotion: { value: 1 },
    uGlowColor: { value: new THREE.Color('#ffcf8a') }, uTint: { value: new THREE.Color('#fff1d6') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform float uOpacity, uTime, uGlow, uPad, uMotion; uniform vec2 uTexel; uniform vec4 uClip;
      uniform vec3 uGlowColor, uTint;
      varying vec2 vUv; varying vec3 vWorld;
      float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
      float a(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(map, uv).a; }
      void main() {
        if (vWorld.x < uClip.x || vWorld.x > uClip.z || vWorld.y < uClip.y || vWorld.y > uClip.w) discard;     // only on the screen
        vec2 uv = vec2(vUv.x * (1.0 + 2.0 * uPad) - uPad, vUv.y * (1.0 + uPad));      // padding at the sides and the top, feet at the bottom edge
        vec4 t = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture2D(map, uv);
        // the halo: the figure's alpha, blurred over a few taps
        float halo = 0.0;
        for (int i = 0; i < 12; i++) {
          float ang = float(i) * 0.5236, rr = (i < 6 ? 6.0 : 13.0);
          halo += a(uv + vec2(cos(ang), sin(ang)) * uTexel * rr);
        }
        halo /= 12.0;
        float lum = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 body = mix(uTint * (0.35 + 0.75 * lum), uGlowColor, 0.18);
        float edge = clamp(halo - t.a * 0.85, 0.0, 1.0);
        float scan = 0.86 + 0.14 * step(0.5, fract(gl_FragCoord.y / 3.0));          // faint scanlines
        float flick = 1.0 - uMotion * 0.06 * h11(floor(uTime * 12.0));
        float alphaBody = t.a * 0.78 * scan;
        float alphaGlow = edge * 0.9 * uGlow + halo * 0.12 * uGlow;
        vec3 col = body * alphaBody + uGlowColor * 1.25 * alphaGlow;
        float alpha = clamp(alphaBody + alphaGlow, 0.0, 1.0) * uOpacity * flick;
        gl_FragColor = vec4(col / max(alphaBody + alphaGlow, 1e-3), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(fw * (1 + 2 * PAD), fh * (1 + PAD)), material);
  plane.frustumCulled = false;
  plane.renderOrder = 3;
  plane.geometry.translate(0, fh * (1 + PAD) / 2, 0);        // the plane's origin is at his feet
  const holder = new THREE.Group();
  holder.add(plane);
  holder.visible = false;
  // contact shadow: a soft dark ellipse on the screen at his feet
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(fw * 1.25, fh * 0.07), new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uOpacity; varying vec2 vUv; void main(){ vec2 d = (vUv - 0.5) * 2.0; float r = dot(d, d); gl_FragColor = vec4(0.08, 0.04, 0.02, uOpacity * 0.55 * smoothstep(1.0, 0.0, r)); }',
  }));
  shadow.renderOrder = 2;
  shadow.visible = false;
  // a warm pool of light where he stands
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(fw * 1.9, fh * 0.16), new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uOpacity; varying vec2 vUv; void main(){ vec2 d = (vUv - 0.5) * 2.0; float r = dot(d, d); gl_FragColor = vec4(vec3(1.0, 0.82, 0.55) * uOpacity * 0.32 * smoothstep(1.0, 0.0, r), 1.0); }',
  }));
  pool.renderOrder = 2;
  pool.visible = false;
  const stageLine = S.top - FIG.feet * S.H;                  // where the side players' feet are in the film
  const homeX = (FIG.cx - 0.5) * S.W;
  return {
    holder, plane, shadow, pool, material, uniforms, fw, fh, stageLine, homeX,
    dispose() { tex.dispose(); plane.geometry.dispose(); material.dispose(); shadow.geometry.dispose(); shadow.material.dispose(); pool.geometry.dispose(); pool.material.dispose(); holder.removeFromParent(); shadow.removeFromParent(); pool.removeFromParent(); },
  };
}

/** Where he is at film time t. Returns { visible, phase, x, y (feet), z, sx, sy, opacity, ground (0..1), ripple } */
export function placeAt(t, holo, S, motion = true) {
  const P = SCREENING.popout;
  const res = { visible: false, phase: 'screen', ripple: -1, ground: 0 };
  if (!motion) return res;
  if (t >= P.returnAt - 0.1 && t < P.returnAt - 0.1 + CONFIG.ripple) res.ripple = (t - (P.returnAt - 0.1)) / CONFIG.ripple;
  if (t < P.exitAt || t >= P.returnAt) return res;
  const land = P.exitAt + 0.9, leave = P.returnAt - 1.0;
  const above = S.top + holo.fh * 0.15;                     // feet start just over the top edge (clipped away)
  const exitX = P.exitX * S.W, retX = P.returnX * S.W;
  let x, y, z = 0.05, sx = 1, sy = 1, opacity = 1, phase;
  if (t < land) {
    const u = (t - P.exitAt) / 0.9;
    x = THREE.MathUtils.lerp(exitX, holo.homeX, easeOut(u));
    y = THREE.MathUtils.lerp(above, holo.stageLine, easeIn(Math.min(1, u * 1.05)));
    z = 0.05 + 0.45 * Math.sin(Math.PI * Math.min(1, u)) ;  // swells toward the audience on the way down
    const s = 1 + 0.07 * Math.sin(Math.PI * u);
    sx = s; sy = s;
    opacity = smooth(0, 0.25, u);
    phase = 'exit';
  } else if (t < leave) {
    const k = t - land, beat = k * BPM / 60;
    const give = Math.exp(-k / 0.09) * Math.sin(k * 26) * 0.06;            // the knees take the landing
    x = holo.homeX; y = holo.stageLine; z = 0.05;
    sy = 1 - Math.max(0, give); sx = 1 + Math.max(0, give) * 0.6;
    phase = k < 0.35 ? 'land' : 'solo';
    res.sway = 0.025 * Math.sin(Math.PI * beat / 2);
    res.glow = 0.85 + 0.15 * Math.pow(Math.cos(Math.PI * beat), 2);
  } else {
    const u = (t - leave) / 1.0;
    const dip = u < 0.15 ? Math.sin(Math.PI * u / 0.15) * 0.06 : 0;
    const up = smooth(0.12, 1, u);
    x = THREE.MathUtils.lerp(holo.homeX, retX, up);
    y = THREE.MathUtils.lerp(holo.stageLine, above + holo.fh * 0.4, easeIn(up));
    z = 0.05 + 0.3 * Math.sin(Math.PI * up);
    sy = 1 - dip + 0.06 * up; sx = 1 + dip * 0.5;
    opacity = 1 - smooth(0.75, 1, u);
    phase = 'return';
  }
  res.visible = true;
  Object.assign(res, { phase, x, y, z, sx, sy, opacity });
  res.ground = 1 - smooth(0, holo.fh * 0.25, y - holo.stageLine);
  return res;
}

export function applyPlace(holo, place, time) {
  holo.holder.visible = holo.shadow.visible = holo.pool.visible = place.visible;
  if (!place.visible) return;
  holo.holder.position.set(place.x, place.y, place.z);
  holo.holder.scale.set(place.sx, place.sy, 1);
  holo.holder.rotation.z = place.sway || 0;
  holo.uniforms.uOpacity.value = place.opacity;
  holo.uniforms.uGlow.value = place.glow || 1;
  holo.uniforms.uTime.value = time;
  holo.shadow.position.set(place.x, holo.stageLine + holo.fh * 0.005, 0.02);
  holo.shadow.material.uniforms.uOpacity.value = place.ground * place.opacity;
  holo.pool.position.set(place.x, holo.stageLine + holo.fh * 0.02, 0.025);
  holo.pool.material.uniforms.uOpacity.value = place.ground * place.opacity;
}
