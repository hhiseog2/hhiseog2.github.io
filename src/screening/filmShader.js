// The projected film: the owner's colour clip is shown as worn black-and-white film, entirely in the screen's shader (the video
// file is never re-encoded).
//
//   holdTarget   the picture on screen changes only at film.fps (12): the video frame is copied into a render target when the
//                film-frame index changes. Every 3-6 s a 2-4 frame hold, then it snaps to the present. Sound runs on.
//   look         Rec.709 luma (no tint), S-curve, blacks 0.04 / whites 0.92, projection hot spot, gate weave per frame, a frame
//                slip every 9-14 s (never within 1 s of the cues), exposure flicker 0.94-1.04 plus a 0.5 Hz breath, 24 fps grain
//                strongest in the mid tones and sized to the screen's pixels, 0-2 drifting scratches, 0-4 specks/hairs a frame,
//                vignette and burnt edges, a 0.6 px soft focus, halation in the highlights, cue dots 7 s and 1 s before the end.
//   shared       the same film uniforms (exposure, weave, frame, grain clock) drive the beam, the room light and the 3D frontman.
//
// Everything is a function of the film's own clock, so a paused or re-sought film looks the same at the same moment.
// Photosensitivity: the exposure moves by a smoothed noise, so no frame differs from the one before by 10% or more; the runout
// flicker is +-3%; the slip only shows a thin frame line.
import * as THREE from 'three';
import { SCREENING, CONFIG } from './config.js';

const F = SCREENING.film;

// ---------------------------------------------------------------- deterministic randomness
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function range(n, [a, b]) { return a + (b - a) * hash(n); }
function smoothNoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

/** Holds and slips over a clip, from a fixed seed: the same every play. */
function schedule(duration, guards) {
  const holds = [], slips = [];
  let t = range(1, F.holdEvery), k = 2;
  while (t < duration) {
    holds.push({ start: Math.floor(t * F.fps), len: Math.round(range(k, F.holdFrames)) });
    t += range(k + 7, F.holdEvery); k += 3;
  }
  t = range(101, F.slipEvery); k = 103;
  while (t < duration) {
    if (!guards.some((g) => Math.abs(t - g) < F.slipGuardSec + F.slipFrames / F.fps)) slips.push(t);
    t += range(k, F.slipEvery); k += 5;
  }
  return { holds, slips };
}

export function createFilm(renderer, { mobile, video, texture = null, ready = null, duration = 15.072 }) {
  const shared = {
    uExposure: { value: 1 }, uWeave: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uGrainT: { value: 0 }, uFilmOn: { value: 0 },
  };
  // ---------- hold target: the frame on screen ----------
  const vw = video.videoWidth || 1112, vh = video.videoHeight || 834;
  const maxW = mobile ? F.holdMaxWidth.mobile : F.holdMaxWidth.desktop;
  const hw = Math.min(vw, maxW), hh = Math.round(hw * vh / vw);
  const holdTarget = new THREE.WebGLRenderTarget(hw, hh, { depthBuffer: false, colorSpace: THREE.SRGBColorSpace });
  // the source: the <video>, or the drawn stand-in film (countdown.js createTestCard) when there is no video
  const videoTexture = texture || new THREE.VideoTexture(video);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  const isReady = ready || (() => video.readyState >= 2);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: videoTexture, depthTest: false, depthWrite: false }));
  const copyScene = new THREE.Scene(); copyScene.add(quad);
  const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // luminance probe: the held frame scaled to 8 x 8 and read back once per film frame
  const probe = new THREE.WebGLRenderTarget(8, 8, { depthBuffer: false });
  const probeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: holdTarget.texture, depthTest: false }));
  const probeScene = new THREE.Scene(); probeScene.add(probeQuad);
  const probeBuf = new Uint8Array(8 * 8 * 4);

  const uniforms = {
    ...shared,
    uSrc: { value: holdTarget.texture }, uLeader: { value: null }, uMode: { value: 0 }, uBright: { value: 0 }, uTime: { value: 0 },
    uOff: { value: new THREE.Color(CONFIG.palette.screenOff) }, uTexel: { value: new THREE.Vector2(1 / hw, 1 / hh) },
    uRes: { value: new THREE.Vector2(800, 600) }, uSlip: { value: 0 }, uSeed: { value: 0 }, uCue: { value: 0 },
    uRipple: { value: new THREE.Vector3(0.5, 1.0, -1) }, uShadow: { value: null }, uShadowOn: { value: 0 }, uMotion: { value: 1 },
    uBlacks: { value: F.blacks }, uWhites: { value: F.whites }, uLuma: { value: 0.6 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D uSrc; uniform sampler2D uLeader; uniform sampler2D uShadow;
      uniform float uMode, uBright, uTime, uSlip, uSeed, uCue, uShadowOn, uMotion, uBlacks, uWhites, uExposure, uFrame, uGrainT, uFilmOn;
      uniform vec3 uOff, uRipple; uniform vec2 uWeave, uTexel, uRes;
      varying vec2 vUv;
      float h1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      float sampleL(sampler2D t, vec2 uv) { return luma(texture2D(t, uv).rgb); }
      void main() {
        if (uBright <= 0.001) { gl_FragColor = vec4(uOff, 1.0);
          #include <colorspace_fragment>
          return; }
        vec2 uv = vUv + uWeave * uMotion;
        // ripple where the frontman went back in
        float ring = 0.0;
        if (uRipple.z >= 0.0) {
          vec2 d = (vUv - uRipple.xy) * vec2(4.0 / 3.0, 1.0);
          float r = length(d), front = uRipple.z * 0.45;
          float wave = sin((r - front) * 90.0) * exp(-abs(r - front) * 16.0) * (1.0 - uRipple.z);
          uv += normalize(d + 1e-5) * wave * 0.005; ring = wave * 0.12;
        }
        // frame slip: the picture rides up, the black frame line passes, then it settles
        float frameLine = 0.0;
        float yy = uv.y - uSlip;
        if (yy < 0.0) { frameLine = step(-0.03, yy); yy = fract(yy); }
        uv.y = yy;
        float L;
        if (uMode < 0.5) L = 0.86;                                            // bare light (opening, runout)
        else if (uMode < 1.5) L = sampleL(uLeader, uv);                       // countdown leader
        else {                                                                // the film, softened (4 taps, 0.6 px)
          vec2 o = uTexel * 0.6;
          L = 0.25 * (sampleL(uSrc, uv + vec2(o.x, o.y)) + sampleL(uSrc, uv - vec2(o.x, o.y)) + sampleL(uSrc, uv + vec2(o.x, -o.y)) + sampleL(uSrc, uv + vec2(-o.x, o.y)));
          // halation: highlights bleed a little
          vec2 b = uTexel * 3.0;
          float hi = max(0.0, 0.25 * (sampleL(uSrc, uv + vec2(b.x, 0.0)) + sampleL(uSrc, uv - vec2(b.x, 0.0)) + sampleL(uSrc, uv + vec2(0.0, b.y)) + sampleL(uSrc, uv - vec2(0.0, b.y))) - 0.78);
          L += hi * 0.35;
        }
        // S-curve, then printed into the film's range
        L = clamp(L, 0.0, 1.0);
        L = L * L * (3.0 - 2.0 * L) * 0.65 + L * 0.35;
        L = mix(uBlacks, uWhites, L);
        // projection: a hot spot in the middle, falling off to the corners
        vec2 c = vUv - 0.5;
        float spot = 1.06 - 0.42 * dot(c * vec2(1.15, 1.0), c * vec2(1.15, 1.0)) * 2.2;
        L *= spot * uExposure;
        // burnt, uneven edges
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float burn = smoothstep(0.0, 0.035 + 0.02 * h2(floor(vUv * vec2(9.0, 7.0)) + uSeed), edge);
        L *= mix(0.55, 1.0, burn);
        if (uFilmOn > 0.5) {
          // grain: 24 fps, sized to the screen's pixels, strongest in the mid tones
          vec2 gp = floor(vUv * uRes / 1.6);
          float g = h2(gp + uGrainT * 17.0) - 0.5;
          L += g * 0.16 * (4.0 * L * (1.0 - L) + 0.15);
          // scratches: 0-2 thin vertical lines, drifting
          for (int i = 0; i < 2; i++) {
            float fi = float(i);
            float bucket = floor(uTime / (0.6 + fi * 0.9) + fi * 3.1);
            float alive = step(0.55, h1(bucket * 3.7 + fi));
            float x0 = h1(bucket * 9.1 + fi * 2.0) + (uTime - bucket * (0.6 + fi * 0.9)) * (h1(bucket + 4.0) - 0.5) * 0.02;
            float w = (0.6 + h1(bucket * 2.3) * 0.9) * uTexel.x;
            float line = (1.0 - smoothstep(w * 0.5, w * 1.5, abs(vUv.x - fract(x0)))) * alive;
            L += line * (h1(bucket + fi * 7.0) > 0.5 ? 0.25 : -0.3);
          }
          // dust and hairs: 0-4 a frame, one frame each; now and then a dark blotch
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float on = step(0.5, h1(uFrame * 13.0 + fi * 7.0));
            vec2 p = vec2(h1(uFrame * 3.1 + fi), h1(uFrame * 5.7 + fi * 3.0));
            vec2 d = (vUv - p) * vec2(4.0 / 3.0, 1.0);
            float r = (0.002 + 0.004 * h1(uFrame + fi * 11.0));
            float speck = 1.0 - smoothstep(r * 0.6, r, length(d));
            float hair = (1.0 - smoothstep(0.0006, 0.0014, abs(length(d - vec2(0.012, 0.0)) - 0.012))) * step(0.85, h1(uFrame * 2.0 + fi)) * step(d.x, 0.01);
            L = mix(L, h1(uFrame + fi) > 0.4 ? 0.06 : 0.95, clamp((speck + hair) * on, 0.0, 1.0) * 0.85);
          }
          float blot = step(0.97, h1(uFrame * 0.77));
          vec2 bp = vec2(h1(uFrame * 1.3), h1(uFrame * 2.9));
          L *= 1.0 - blot * (1.0 - smoothstep(0.01, 0.03, length((vUv - bp) * vec2(1.6, 1.0)))) * 0.7;
          // cue dot, top right, 7 s and 1 s before the end
          float dot = 1.0 - smoothstep(0.016, 0.02, length((vUv - vec2(0.9, 0.86)) * vec2(4.0 / 3.0, 1.0)));
          float ringC = dot * (1.0 - (1.0 - smoothstep(0.009, 0.012, length((vUv - vec2(0.9, 0.86)) * vec2(4.0 / 3.0, 1.0)))));
          L = mix(L, 0.05, ringC * uCue);
        }
        L = mix(L, 0.02, frameLine);
        L += ring;
        // the frontman's shadow, when he hangs in the beam
        if (uShadowOn > 0.5) L *= 1.0 - 0.78 * texture2D(uShadow, vUv).r;
        L = clamp(L, 0.0, 1.0);
        vec3 col = mix(uOff, vec3(L), uBright);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  let sched = schedule(duration, []);
  let lastCopied = -1, shownFrame = -1, luminance = 0.6;
  return {
    material, uniforms, shared, holdTarget, videoTexture,
    get luminance() { return luminance; },
    setGuards(guards, dur = duration) { duration = dur; sched = schedule(duration, guards); },
    /** which film frame is on screen at clip time t (holds keep an earlier one) */
    frameAt(t) {
      const raw = Math.floor(t * F.fps);
      for (const h of sched.holds) if (raw >= h.start && raw < h.start + h.len) return h.start;
      return raw;
    },
    /**
     * mode: 'off' | 'light' | 'leader' | 'film' | 'runout'
     * t: film time (or the state's time for leader/runout), clock: wall clock seconds, motion: false = reduced motion
     */
    update({ mode, bright, t, clock, motion, leaderTexture, screenPx }) {
      uniforms.uBright.value = bright;
      uniforms.uMode.value = mode === 'leader' ? 1 : mode === 'film' ? 2 : 0;
      uniforms.uLeader.value = leaderTexture || null;
      uniforms.uMotion.value = motion ? 1 : 0;
      uniforms.uFilmOn.value = mode === 'off' ? 0 : 1;
      shared.uFilmOn.value = mode === 'off' ? 0 : 1;
      if (screenPx) uniforms.uRes.value.set(screenPx[0], screenPx[1]);
      let frame;
      if (mode === 'film') frame = motion ? this.frameAt(t) : Math.floor(t * 60);          // reduced motion: no stutter
      else frame = Math.floor(clock * F.fps);
      shownFrame = frame;
      uniforms.uFrame.value = shared.uFrame.value = motion ? frame : 0;
      // exposure: smoothed noise per film frame (never a 10% jump) and a slow 0.5 Hz breath
      let exp = 1;
      if (motion && mode !== 'off') {
        const n = smoothNoise(frame * 0.35);
        exp = Math.min(F.flicker[1], Math.max(F.flicker[0], F.flicker[0] + (F.flicker[1] - F.flicker[0]) * n)) * (1 + 0.02 * Math.sin(Math.PI * clock));
        if (mode === 'runout' || mode === 'light') exp = 1 + 0.03 * (smoothNoise(frame * 0.8) - 0.5) * 2;
      }
      uniforms.uExposure.value = shared.uExposure.value = exp;
      // weave per film frame, a little smoothed
      if (motion && mode !== 'off') {
        const wx = (hash(frame * 2.1) - 0.5) * 2 * F.weave[0], wy = (hash(frame * 3.3) - 0.5) * 2 * F.weave[1];
        const px = (hash((frame - 1) * 2.1) - 0.5) * 2 * F.weave[0], py = (hash((frame - 1) * 3.3) - 0.5) * 2 * F.weave[1];
        shared.uWeave.value.set(wx * 0.65 + px * 0.35, wy * 0.65 + py * 0.35);
      } else shared.uWeave.value.set(0, 0);
      uniforms.uWeave.value = shared.uWeave.value;
      // grain clock (24 fps; still under reduced motion)
      uniforms.uGrainT.value = shared.uGrainT.value = motion ? Math.floor(clock * F.grainFps) : 0;
      uniforms.uTime.value = motion ? clock : 0;
      uniforms.uSeed.value = motion ? Math.floor(clock * F.fps) % 7 : 0;
      // slip (film only)
      let slip = 0;
      if (motion && mode === 'film') {
        for (const s of sched.slips) {
          const k = (t - s) * F.fps / F.slipFrames;
          if (k >= 0 && k < 1) slip = Math.sin(Math.PI * k) * 0.06;
        }
      }
      uniforms.uSlip.value = slip;
      // cue dots: 4 film frames, 7 s and 1 s before the end
      let cue = 0;
      if (mode === 'film' && motion) for (const c of F.cueMarks) { const d = duration - c; if (t >= d && t < d + 4 / F.fps) cue = 1; }
      uniforms.uCue.value = cue;
      // copy the video into the hold target when the frame on screen changes
      if (mode === 'film' && frame !== lastCopied && isReady()) {
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(holdTarget); renderer.render(copyScene, copyCam);
        renderer.setRenderTarget(probe); renderer.render(probeScene, copyCam);
        renderer.readRenderTargetPixels(probe, 0, 0, 8, 8, probeBuf);
        renderer.setRenderTarget(prev);
        let sum = 0;
        for (let i = 0; i < 64; i++) sum += 0.2126 * probeBuf[i * 4] + 0.7152 * probeBuf[i * 4 + 1] + 0.0722 * probeBuf[i * 4 + 2];
        luminance = sum / 64 / 255;
        lastCopied = frame;
      } else if (mode !== 'film') {
        luminance = mode === 'off' ? 0 : mode === 'leader' ? 0.62 : 0.84;
      }
      uniforms.uLuma.value = luminance;
      return { frame, exposure: exp, luminance };
    },
    get shownFrame() { return shownFrame; },
    forceCopy() { lastCopied = -1; },
    dispose() { holdTarget.dispose(); probe.dispose(); videoTexture.dispose(); quad.geometry.dispose(); quad.material.dispose(); probeQuad.geometry.dispose(); probeQuad.material.dispose(); material.dispose(); },
  };
}
