// Everything around the players: the room (wall, wooden floor with the hologram's reflection), the projector's light beam and
// its dust, the notes and the light motes rising around the carousel, and the post-processing chain.
import * as THREE from 'three';
import { Reflector } from '../../vendor/jsm/objects/Reflector.js';
import {
  EffectComposer, RenderPass, EffectPass, SelectiveBloomEffect, ChromaticAberrationEffect, NoiseEffect, VignetteEffect,
  SMAAEffect, SMAAPreset, BlendFunction,
} from '../../vendor/postprocessing.module.min.js';
import { CONFIG, seeded } from './config.js';
import { NOISE_GLSL } from './hologramMaterial.js';

const color = (hex) => new THREE.Color(hex);

// ---------------------------------------------------------------- room

const FLOOR_VERT = /* glsl */`
uniform mat4 textureMatrix;
varying vec4 vMirror;
varying vec3 vWorld;
void main(){
  vMirror = textureMatrix * vec4(position, 1.0);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FLOOR_FRAG = /* glsl */`
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform vec3 uGlowAt, uGlowColor, uLampAt, uLampColor, uBack;
uniform float uGlow, uReflect, uBlur;
varying vec4 vMirror;
varying vec3 vWorld;
${NOISE_GLSL}
void main(){
  // dark boards running left to right: each board its own tone, a fine grain along it, a dark seam between boards
  float board = vWorld.z / 0.24;
  float id = floor(board), across = fract(board);
  float tone = 0.78 + 0.34 * fract(sin(id * 12.9898) * 43758.5453);
  float along = vWorld.x + fract(sin(id * 78.233) * 43758.5453) * 3.0;
  float grain = noise3(vec3(along * 1.6, across * 9.0 + id * 3.1, id)) * 0.5 + noise3(vec3(along * 9.0, across * 30.0, id)) * 0.18;
  float seam = smoothstep(0.0, 0.035, across) * smoothstep(1.0, 0.965, across);
  float butt = smoothstep(0.0, 0.012, abs(fract(along / 2.3) - 0.5));
  vec3 wood = color * tone * (0.82 + 0.5 * grain) * mix(0.35, 1.0, seam * butt);

  vec3 col = wood * 0.55;
  // light that reaches the floor: the hologram's cyan pool under the carousel, the lamp's warm spill by the projector
  float dh = length(vWorld.xz - uGlowAt.xz);
  col += wood * uGlowColor * uGlow * (2.6 * exp(-dh * dh / 3.2) + 0.5 * exp(-dh * dh / 14.0));
  float dl = length(vWorld.xz - uLampAt.xz);
  col += wood * uLampColor * 1.1 * exp(-dl * dl / 2.2);

  // the varnish mirrors the scene: a few taps around the mirror coordinate stand in for a rough surface
  if (uReflect > 0.5) {
    vec2 uv = vMirror.xy / vMirror.w;
    float r = uBlur * (0.6 + 0.6 * clamp(length(vWorld.xz - cameraPosition.xz) * 0.08, 0.0, 1.0));
    vec3 refl = texture2D(tDiffuse, uv).rgb * 0.24;
    refl += (texture2D(tDiffuse, uv + vec2(r, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(r, 0.0)).rgb) * 0.12;
    refl += (texture2D(tDiffuse, uv + vec2(0.0, r * 1.8)).rgb + texture2D(tDiffuse, uv - vec2(0.0, r * 1.8)).rgb) * 0.12;
    refl += (texture2D(tDiffuse, uv + vec2(r, r) * 1.5).rgb + texture2D(tDiffuse, uv - vec2(r, r) * 1.5).rgb
           + texture2D(tDiffuse, uv + vec2(r, -r) * 1.5).rgb + texture2D(tDiffuse, uv - vec2(r, -r) * 1.5).rgb) * 0.07;
    float facing = clamp(dot(normalize(cameraPosition - vWorld), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    col += refl * (0.30 + 0.55 * pow(1.0 - facing, 3.0)) * (0.75 + 0.25 * seam);
  }
  // far boards sink into the wall colour
  col = mix(col, uBack * 0.5, smoothstep(2.0, -6.0, vWorld.z) * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createFloor({ reflect, renderer, y = 0 }) {
  const geometry = new THREE.PlaneGeometry(40, 24);
  const uniforms = {
    color: { value: color(CONFIG.palette.floor) },
    tDiffuse: { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    uGlowAt: { value: new THREE.Vector3() }, uGlowColor: { value: color(CONFIG.palette.holo) }, uGlow: { value: 1 },
    uLampAt: { value: new THREE.Vector3() }, uLampColor: { value: color(CONFIG.palette.amber) },
    uBack: { value: color(CONFIG.palette.bg) },
    uReflect: { value: reflect ? 1 : 0 }, uBlur: { value: 0.006 },
  };
  let mesh, stamp = -1, frame = 0;
  if (reflect) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    mesh = new Reflector(geometry, {
      clipBias: 0.003, textureWidth: Math.max(256, Math.round(size.x * 0.5)), textureHeight: Math.max(256, Math.round(size.y * 0.5)),
      color: CONFIG.palette.floor, shader: { uniforms, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG },
    });
    // the mirror pass runs once a frame: the bloom's second look at the scene reuses it
    const mirror = mesh.onBeforeRender;
    mesh.onBeforeRender = function (r, s, c) { if (stamp === frame) return; stamp = frame; mirror.call(this, r, s, c); };
  } else {
    mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG }));
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.name = 'floor';
  const u = mesh.material.uniforms;
  return {
    mesh, reflect,
    newFrame() { frame++; },
    set({ glowAt, lampAt, glow }) { if (glowAt) u.uGlowAt.value.copy(glowAt); if (lampAt) u.uLampAt.value.copy(lampAt); if (glow !== undefined) u.uGlow.value = glow; },
    resize(w, h) { if (reflect) mesh.getRenderTarget().setSize(Math.max(256, Math.round(w * 0.5)), Math.max(256, Math.round(h * 0.5))); },
    dispose() { geometry.dispose(); if (reflect) mesh.dispose(); else mesh.material.dispose(); mesh.removeFromParent(); },
  };
}

export function createWall() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uBack: { value: color(CONFIG.palette.bg) }, uGlowAt: { value: new THREE.Vector3() }, uGlowColor: { value: color(CONFIG.palette.holo) }, uGlow: { value: 1 },
      uLampAt: { value: new THREE.Vector3() }, uLampColor: { value: color(CONFIG.palette.amber) } },
    vertexShader: /* glsl */`varying vec3 vWorld; void main(){ vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uBack, uGlowAt, uGlowColor, uLampAt, uLampColor; uniform float uGlow; varying vec3 vWorld;
      void main(){
        // dark navy panelling: a faint vertical line where two panels meet, the lit side of the groove next to it
        float p = fract(vWorld.x / 1.15), w = fwidth(vWorld.x / 1.15) * 1.5;
        float groove = 1.0 - smoothstep(0.0, 0.012 + w, p);
        float lit = smoothstep(0.012, 0.012 + w, p) * (1.0 - smoothstep(0.024, 0.024 + w, p));
        vec3 col = uBack * (0.92 + 0.10 * smoothstep(6.0, 0.0, vWorld.y));
        col *= 1.0 - 0.42 * groove;
        col += uBack * 0.35 * lit;
        float rail = smoothstep(0.0, 0.02, abs(vWorld.y - 0.95)) ;
        col *= mix(0.72, 1.0, rail);
        float dh = length(vWorld.xy - uGlowAt.xy);
        col += uGlowColor * uGlow * 0.11 * exp(-dh * dh / 9.0);
        float dl = length(vWorld.xy - uLampAt.xy);
        col += uLampColor * 0.05 * exp(-dl * dl / 5.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(44, 16), material);
  mesh.position.set(0, 7.0, -5.2);
  mesh.name = 'wall';
  return {
    mesh,
    set({ glowAt, lampAt, glow }) { const u = material.uniforms; if (glowAt) u.uGlowAt.value.copy(glowAt); if (lampAt) u.uLampAt.value.copy(lampAt); if (glow !== undefined) u.uGlow.value = glow; },
    dispose() { mesh.geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}

// ---------------------------------------------------------------- the beam and its dust

const START = 0.045;      // beam radius at the lens, as a share of its radius at the far end

export function createBeam(clock, { dustCount = 180 } = {}) {
  const random = seeded(11);
  const geometry = new THREE.CylinderGeometry(1, START, 1, 48, 12, true).translate(0, 0.5, 0);    // y = 0 at the lens, 1 at the hologram
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: clock.uTime, uFlicker: clock.uFlicker, uColor: { value: color(CONFIG.palette.amber) }, uStrength: { value: 1 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vN, vV; varying float vAlong; varying vec3 vLocal;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vAlong = position.y; vLocal = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uFlicker, uStrength; uniform vec3 uColor;
      varying vec3 vN, vV; varying float vAlong; varying vec3 vLocal;
      ${NOISE_GLSL}
      void main(){
        // a cone of light has no surface: bright where the view runs through its middle, gone toward its silhouette
        float soft = pow(abs(dot(normalize(vN), normalize(vV))), 1.7);
        float fall = mix(0.46, 0.035, pow(vAlong, 0.55)) * smoothstep(1.0, 0.62, vAlong) * smoothstep(0.0, 0.03, vAlong);
        float a = atan(vLocal.z, vLocal.x);
        float streak = 0.78 + 0.22 * noise3(vec3(a * 3.0, vAlong * 2.0 - uTime * 0.12, uTime * 0.2));
        float alpha = soft * fall * streak * (0.75 + 0.25 * uFlicker) * uStrength;
        gl_FragColor = vec4(uColor, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'beam';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  // dust: soft specks drifting inside the cone (in the cone's own unit space, so they follow it wherever it points)
  const seed = new Float32Array(dustCount * 4);
  for (let i = 0; i < dustCount; i++) { seed[i * 4] = random(); seed[i * 4 + 1] = Math.sqrt(random()); seed[i * 4 + 2] = random() * Math.PI * 2; seed[i * 4 + 3] = random(); }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
  dustGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTime: clock.uTime, uFlicker: clock.uFlicker, uColor: { value: color(CONFIG.palette.amber) }, uScale: { value: 1 }, uStrength: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 seed; uniform float uTime, uScale; varying float vAlpha;
      void main(){
        float t = fract(seed.x + uTime * (0.006 + 0.010 * seed.w));
        float ang = seed.z + uTime * (0.05 + 0.12 * seed.w) * (seed.w > 0.5 ? 1.0 : -1.0);
        float rad = mix(${START.toFixed(3)}, 1.0, t) * seed.y * 0.92;
        vec3 p = vec3(cos(ang) * rad, t, sin(ang) * rad);
        p.y += sin(uTime * 0.4 + seed.w * 40.0) * 0.006;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.010 + 0.022 * seed.w) / -mv.z;
        vAlpha = (0.25 + 0.75 * fract(seed.w * 7.31)) * smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.75, t) * (0.6 + 0.4 * sin(uTime * (1.0 + seed.w * 2.0) + seed.z * 5.0));
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uFlicker, uStrength; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(uColor, a * a * vAlpha * 0.55 * (0.7 + 0.3 * uFlicker) * uStrength); }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 3;
  mesh.add(dust);
  const Y = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  return {
    mesh, dust,
    /** from the lens to a disc of the given radius around the hologram */
    aim(from, to, radius) {
      dir.copy(to).sub(from);
      const length = dir.length();
      mesh.position.copy(from);
      mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
      mesh.scale.set(radius, length, radius);
    },
    resize(pixelHeight) { dustMat.uniforms.uScale.value = pixelHeight; },
    /** share of the dust that is drawn (quality step) */
    setShare(share) { dustGeo.setDrawRange(0, Math.max(1, Math.round(dustCount * share))); },
    dispose() { geometry.dispose(); material.dispose(); dustGeo.dispose(); dustMat.dispose(); mesh.removeFromParent(); },
  };
}

// ---------------------------------------------------------------- motes and notes

export function createMotes(clock, count = 120) {
  const seed = new Float32Array(count * 4), tint = new Float32Array(count * 3), random = seeded(23);
  const palette = CONFIG.palette.motes.map(color);
  for (let i = 0; i < count; i++) {
    seed[i * 4] = random() * Math.PI * 2; seed[i * 4 + 1] = 0.35 + random() * 1.25; seed[i * 4 + 2] = random(); seed[i * 4 + 3] = random();
    palette[i % palette.length].toArray(tint, i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: clock.uTime, uFlicker: clock.uFlicker, uScale: { value: 1 }, uRadius: { value: CONFIG.orbit.radius }, uHeight: { value: 2.6 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 seed; attribute vec3 tint; uniform float uTime, uScale, uRadius, uHeight; varying float vAlpha; varying vec3 vTint;
      void main(){
        float t = fract(seed.z + uTime * (0.035 + 0.05 * seed.w));                // each mote rises, fades and starts again below
        float ang = seed.x + uTime * 0.06 * (seed.w - 0.5);
        vec3 p = vec3(cos(ang) * uRadius * seed.y, t * uHeight, sin(ang) * uRadius * seed.y);
        p.x += sin(uTime * 0.7 + seed.w * 30.0) * 0.04;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.012 + 0.026 * seed.w) / -mv.z;
        vAlpha = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.55, t) * (0.55 + 0.45 * sin(uTime * 2.0 + seed.x * 9.0));
        vTint = tint;
      }`,
    fragmentShader: /* glsl */`
      uniform float uFlicker; varying float vAlpha; varying vec3 vTint;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vTint, a * a * vAlpha * 0.8 * uFlicker); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'motes';
  return {
    points,
    resize(pixelHeight, radius) { material.uniforms.uScale.value = pixelHeight; material.uniforms.uRadius.value = radius; },
    setShare(share) { geometry.setDrawRange(0, Math.max(1, Math.round(count * share))); },
    dispose() { geometry.dispose(); material.dispose(); points.removeFromParent(); },
  };
}

function noteTexture() {
  // an eighth note drawn as a shape (no font, no text in the scene)
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = g.strokeStyle = '#fff';
  g.save(); g.translate(34, 70); g.rotate(-0.42); g.beginPath(); g.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2); g.fill(); g.restore();
  g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(48, 66); g.lineTo(48, 14); g.stroke();
  g.lineWidth = 7;
  g.beginPath(); g.moveTo(48, 14); g.bezierCurveTo(60, 22, 76, 28, 70, 50); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function createNotes(clock, count = 30) {
  const LIFE = 2.6;
  const pos = new Float32Array(count * 3), tint = new Float32Array(count * 3), data = new Float32Array(count * 3);   // data: alpha, size, tilt
  const born = new Float32Array(count).fill(-1e3), strength = new Float32Array(count), drift = new Float32Array(count * 2), origin = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('data', new THREE.BufferAttribute(data, 3).setUsage(THREE.DynamicDrawUsage));
  const map = noteTexture();
  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uScale: { value: 1 }, uFlicker: clock.uFlicker },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 tint, data; uniform float uScale; varying vec3 vTint; varying float vAlpha, vTilt;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * data.y / -mv.z;
        vTint = tint; vAlpha = data.x; vTilt = data.z;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uFlicker; varying vec3 vTint; varying float vAlpha, vTilt;
      void main(){
        vec2 p = gl_PointCoord - 0.5; float c = cos(vTilt), s = sin(vTilt);
        p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
        float a = texture2D(uMap, vec2(p.x, 1.0 - p.y)).a * vAlpha * uFlicker;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vTint * 1.5, a);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'notes';
  points.renderOrder = 4;
  const colors = CONFIG.palette.notes.map(color), random = seeded(37);
  let next = 0, turn = 0;
  return {
    points,
    /** a note leaves the instrument; the three colours take turns */
    emit(at, time, amount) {
      const i = next; next = (next + 1) % count;
      origin[i * 3] = at.x; origin[i * 3 + 1] = at.y; origin[i * 3 + 2] = at.z;
      born[i] = time; strength[i] = amount;
      drift[i * 2] = (random() - 0.5) * 0.5; drift[i * 2 + 1] = random() * Math.PI * 2;
      colors[turn++ % 3].toArray(tint, i * 3);
      geometry.attributes.tint.needsUpdate = true;
    },
    update(time, scale = 1) {
      for (let i = 0; i < count; i++) {
        const age = time - born[i], t = age / LIFE;
        if (t < 0 || t > 1) { data[i * 3] = 0; continue; }
        pos[i * 3] = origin[i * 3] + (drift[i * 2] * t + Math.sin(age * 2.2 + drift[i * 2 + 1]) * 0.07) * scale;
        pos[i * 3 + 1] = origin[i * 3 + 1] + (0.12 + 0.95 * t) * scale;
        pos[i * 3 + 2] = origin[i * 3 + 2] + 0.12 * t * scale;
        data[i * 3] = strength[i] * Math.min(1, t * 6) * (1 - t) * (1 - t) * 1.6;
        data[i * 3 + 1] = (0.11 + 0.07 * t) * scale;
        data[i * 3 + 2] = Math.sin(age * 1.7 + drift[i * 2 + 1]) * 0.35;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.data.needsUpdate = true;
    },
    resize(pixelHeight) { material.uniforms.uScale.value = pixelHeight; },
    dispose() { geometry.dispose(); material.dispose(); map.dispose(); points.removeFromParent(); },
  };
}

// ---------------------------------------------------------------- post-processing (pmndrs postprocessing)

export function createPost(renderer, scene, camera, { bloom: withBloom, smaa: withSmaa }) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null, aberration = null;
  if (withBloom) {
    // bloom only on what is meant to glow: the hologram and the lens
    bloom = new SelectiveBloomEffect(scene, camera, { intensity: 1.35, luminanceThreshold: 0.12, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.72 });
    bloom.ignoreBackground = true;
    composer.addPass(new EffectPass(camera, bloom));
    aberration = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: false, modulationOffset: 0 });
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.16;
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.62 });
    composer.addPass(new EffectPass(camera, aberration, grain, vignette));
  }
  // the last pass also turns the linear picture into screen colours, so there is always one (empty on the lowest step)
  composer.addPass(withSmaa ? new EffectPass(camera, new SMAAEffect({ preset: withBloom ? SMAAPreset.MEDIUM : SMAAPreset.LOW })) : new EffectPass(camera));
  return {
    composer,
    select(objects) { if (bloom) bloom.selection.set(objects); },
    /** 0 = clean, 1 = the glitch: the colour channels pull apart for that instant */
    glitch(amount) { if (aberration) aberration.offset.set(0.0042 * amount, 0.0016 * amount); },
    render(dt) { composer.render(dt); },
    setSize(w, h) { composer.setSize(w, h, false); },      // the canvas keeps its CSS size (100% of the first screen)
    dispose() { composer.dispose(); },
  };
}
