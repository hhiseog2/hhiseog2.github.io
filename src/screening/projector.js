// The projector and what comes out of it:
//   loadProjector()  public/models/projector.glb (shared with the first screen), repainted in the site's ink and pale metal
//   createBeam()     the light: a four-sided cone from the lens to the screen's corners, soft at its edges (faces seen edge-on fade)
//   createDust()     specks drifting inside the beam, lit only while the beam is on
//   createSound()    the machine's own noises made with Web Audio: a lamp click and a reel clatter that speeds up with the reels
import * as THREE from 'three';
import { CONFIG } from './config.js';

export async function loadProjector(loader) {
  const gltf = await loader.loadAsync(CONFIG.models.projector);
  const root = gltf.scene;
  const need = (name) => { const o = root.getObjectByName(name); if (!o) throw new Error('projector.glb has no "' + name + '"'); return o; };
  const reels = [need('reel_front'), need('reel_rear')];
  const glass = need('lens_glass'), beamOrigin = need('beam_origin');
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.name === 'painted_metal') m.color.set(CONFIG.palette.paint);
    if (m.name === 'brass') m.color.set(CONFIG.palette.metal);
    if (m.aoMap) m.aoMapIntensity = 1.0;
  });
  const glassMesh = glass.isMesh ? glass : glass.children.find((c) => c.isMesh);
  const lens = new THREE.MeshBasicMaterial({ color: 0x222222 });
  if (glassMesh.material && glassMesh.material.dispose) glassMesh.material.dispose();
  glassMesh.material = lens;
  const warm = new THREE.Color(CONFIG.palette.beam), dark = new THREE.Color(0x202020);
  let reelAngle = 0;
  const tmp = new THREE.Vector3();
  return {
    root,
    hit: root,                         // what a click on the canvas is tested against
    lens(target = tmp) { return beamOrigin.getWorldPosition(target); },
    /** dt: seconds since the last frame, speed: 0..1 reel speed, lamp: 0..1 lamp brightness */
    update(dt, speed, lamp) {
      reelAngle += dt * speed * 9.0;
      reels[0].rotation.z = -reelAngle;
      reels[1].rotation.z = -reelAngle * 1.5;
      lens.color.copy(dark).lerp(warm, lamp).multiplyScalar(1 + lamp);
    },
    dispose() {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        const m = o.material;
        for (const k of ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k] && m[k].dispose) m[k].dispose();
        if (m.dispose) m.dispose();
      });
      lens.dispose();
      root.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------- beam

const ROWS = 10;

export function createBeam() {
  const geometry = new THREE.BufferGeometry();
  const count = 4 * (ROWS + 1) * 2;
  const pos = new Float32Array(count * 3), along = new Float32Array(count), idx = [];
  for (let side = 0; side < 4; side++) {
    for (let r = 0; r <= ROWS; r++) {
      const base = (side * (ROWS + 1) + r) * 2;
      along[base] = along[base + 1] = r / ROWS;
      if (r < ROWS) {
        const a = base, b = base + 1, c = base + 2, d = base + 3;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('along', new THREE.BufferAttribute(along, 1));
  geometry.setIndex(idx);
  const uniforms = { uIntensity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(CONFIG.palette.beam) } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute float along;
      varying float vAlong; varying vec3 vNormalW; varying vec3 vView;
      void main() {
        vAlong = along;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform float uTime; uniform vec3 uColor;
      varying float vAlong; varying vec3 vNormalW; varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormalW), normalize(vView)));
        float soft = pow(facing, 1.8);                                     // edge-on faces fade: a soft edge
        float along = mix(1.0, 0.3, vAlong) * smoothstep(0.0, 0.05, vAlong);
        float flick = 0.92 + 0.08 * sin(uTime * 41.0) * sin(uTime * 23.0);
        float a = uIntensity * soft * along * 0.42 * flick;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const corners = { from: [], to: [] };
  return {
    mesh, uniforms, corners,
    /** from: lens position, to: the screen's four corners (world) in order round the rectangle */
    aim(from, to, apex = 0.035) {
      const axis = new THREE.Vector3().subVectors(new THREE.Vector3().addVectors(to[0], to[2]).multiplyScalar(0.5), from).normalize();
      const right = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, axis);
      const near = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => from.clone().addScaledVector(right, x * apex * 1.33).addScaledVector(up, y * apex));
      corners.from = near; corners.to = to;
      const p = geometry.attributes.position.array, v = new THREE.Vector3();
      for (let side = 0; side < 4; side++) {
        const a0 = near[side], a1 = near[(side + 1) % 4], b0 = to[side], b1 = to[(side + 1) % 4];
        for (let r = 0; r <= ROWS; r++) {
          const t = r / ROWS, base = (side * (ROWS + 1) + r) * 2;
          v.lerpVectors(a0, b0, t).toArray(p, base * 3);
          v.lerpVectors(a1, b1, t).toArray(p, (base + 1) * 3);
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// ---------------------------------------------------------------- dust

export function createDust(count) {
  const geometry = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const uniforms = {
    uIntensity: { value: 0 }, uTime: { value: 0 }, uScale: { value: 300 },
    uA: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, uB: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uColor: { value: new THREE.Color(CONFIG.palette.beam) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec4 seed;
      uniform float uTime; uniform float uScale; uniform vec3 uA[4]; uniform vec3 uB[4];
      varying float vLight;
      void main() {
        // a place inside the beam: along it (v) and across it (u, w), drifting slowly
        float v = fract(seed.x + uTime * (0.004 + 0.01 * seed.w));
        float u = clamp(0.08 + 0.84 * fract(seed.y + 0.03 * sin(uTime * 0.4 + seed.z * 6.28)), 0.0, 1.0);
        float w = clamp(0.08 + 0.84 * fract(seed.z + 0.03 * cos(uTime * 0.33 + seed.y * 6.28)), 0.0, 1.0);
        v = 0.12 + 0.8 * v;
        vec3 a = mix(mix(uA[0], uA[1], u), mix(uA[3], uA[2], u), w);
        vec3 b = mix(mix(uB[0], uB[1], u), mix(uB[3], uB[2], u), w);
        vec4 mv = modelViewMatrix * vec4(mix(a, b, v), 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.8 + 1.6 * seed.w) * uScale / -mv.z;
        vLight = (0.35 + 0.65 * abs(sin(uTime * (0.6 + seed.w) + seed.x * 30.0))) * (1.0 - 0.55 * v);
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform vec3 uColor;
      varying float vLight;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(c)) * vLight * uIntensity;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return {
    points, uniforms,
    aim(from, to) { from.forEach((p, i) => uniforms.uA.value[i].copy(p)); to.forEach((p, i) => uniforms.uB.value[i].copy(p)); },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// ---------------------------------------------------------------- sound

export function createSound() {
  let ctx = null, clatter = null, gain = null, muted = false;
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    return ctx;
  }
  function noiseBuffer(seconds, shape) {
    const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * shape(i / n);
    return b;
  }
  return {
    /** call from the click itself: browsers only let sound start inside a gesture */
    unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    click() {
      const c = ensure(); if (!c || muted) return;
      const src = c.createBufferSource(), g = c.createGain(), hp = c.createBiquadFilter();
      src.buffer = noiseBuffer(0.035, (x) => Math.exp(-x * 9));
      hp.type = 'highpass'; hp.frequency.value = 1800;
      g.gain.value = 0.06;
      src.connect(hp).connect(g).connect(c.destination);
      src.start();
    },
    /** the clatter: four shutter ticks per loop; speed 0..1 sets how fast it runs */
    run(speed, level = 0.022) {
      const c = ensure(); if (!c) return;
      if (!clatter && speed > 0) {
        clatter = c.createBufferSource();
        clatter.buffer = noiseBuffer(0.24, (x) => Math.exp(-((x * 4) % 1) * 14) * (0.6 + 0.4 * ((Math.floor(x * 4) % 2))));
        clatter.loop = true;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
        clatter.connect(bp).connect(gain);
        clatter.start();
      }
      if (clatter) clatter.playbackRate.value = 0.25 + 0.75 * speed;
      if (gain) gain.gain.setTargetAtTime(muted ? 0 : level * speed, c.currentTime, 0.05);
    },
    stop() {
      if (clatter) { try { clatter.stop(); } catch (e) { /* already stopped */ } clatter.disconnect(); clatter = null; }
      if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    set muted(v) { muted = v; if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03); },
    get muted() { return muted; },
    dispose() { this.stop(); if (ctx) ctx.close(); ctx = null; },
  };
}
