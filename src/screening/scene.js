// The screening room (first screen), second version. index.html imports this after the page has loaded (desktop) or after the
// first input; until then the section shows a still of the room with the curtain closed.
//
// Parts: stage.js (no seats, big screen, camera fit) · curtain.js (red velvet) · sequence.js (the show's state machine) ·
// filmShader.js (black-and-white projection) · hologram.js (the frontman as light) · projectorButton.js (the projector is
// the button) · vintageAudio.js (sound) · projector.js (the machine, its beam, dust and noises) · countdown.js (leader, stand-in).
//
// Without WebGL the section falls back to the film in a plain <video> (black and white by CSS) with a visible play button.
// Reduced motion: black and white with still grain; no flicker, weave, stutter, slip or pop-out; the curtain fades.
// Look: A · Velvet Noir (the owner's choice of two canvas designs): deep burgundy, antique brass, off-black, warm low-key light.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from '../../vendor/jsm/environments/RoomEnvironment.js';
import { CONFIG, SCREENING, STATUS } from './config.js';
import { createStage } from './stage.js';
import { createCurtain } from './curtain.js';
import { createSequence } from './sequence.js';
import { createFilm } from './filmShader.js';
import { loadHologram, placeAt, applyPlace } from './hologram.js';
import { createProjectorButton } from './projectorButton.js';
import { createVintageAudio } from './vintageAudio.js';
import { loadProjector, createBeam, createDust, createSound } from './projector.js';
import { createLeader, createTestCard } from './countdown.js';

const params = new URLSearchParams(window.location.search);

export async function activate(section) {
  if (section.__screening) return section.__screening;
  section.__screening = { pending: true };
  const stageEl = section.querySelector('.screening-stage');
  const button = section.querySelector('.screening-projector');
  const pauseBtn = section.querySelector('.screening-pause');
  const muteBtn = section.querySelector('.screening-mute');
  const status = section.querySelector('.screening-status');
  const video = section.querySelector('.screening-video');
  const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduce = () => reduceMq.matches;
  const mobile = window.matchMedia('(max-width: ' + SCREENING.stage.mobileBreakpoint + 'px)').matches;
  const P = SCREENING.popout;

  // ---------- the film: the clip, or the drawn stand-in (no file, a load error, or ?fallback=1) ----------
  let media = video, card = null;
  video.innerHTML = '';
  for (const f of SCREENING.clip.formats) {
    const el = document.createElement('source');
    el.src = CONFIG.media(f); el.type = 'video/' + f;
    video.appendChild(el);
  }
  const cardClip = { member: P.member, out: P.exitAt, back: P.returnAt, screenPos: [P.exitX, 0.5 - P.exitScale], screenScale: P.exitScale };
  function useCard(why) {
    if (card) return;
    console.warn('screening: stand-in film (' + why + ')');
    card = createTestCard(cardClip);
    media = card;
    section.dataset.film = 'stand-in';
    card.addEventListener('ended', () => seq && seq.ended_());
  }
  if (params.get('fallback') === '1') useCard('?fallback=1');
  video.addEventListener('error', () => { if (video.error) useCard('the film failed: ' + video.error.code); });

  // ---------- state and status ----------
  let seq = null, alive = true, plain = false;
  const say = (key) => { const text = STATUS[key] || ''; if (status.textContent !== text) status.textContent = text; };
  const audio = createVintageAudio(video);
  const sound = createSound();
  let lastState = 'IDLE', showOver = false;
  function onState(next, err) {
    if (next === 'play-failed') {
      if (err && err.name === 'NotAllowedError' && !media.muted) { media.muted = true; audio.muted = true; sound.muted = true; say('blocked'); media.play().catch(() => {}); sync(); }
      return;
    }
    if (next === 'OPENING') { say('opening'); audio.curtain(reduce() ? SCREENING.curtain.fadeSec : SCREENING.curtain.openSec, true); }
    if (next === 'COUNTDOWN') say('countdown');
    if (next === 'PLAYING') { say('playing'); audio.playing(true); }
    if (next === 'RUNOUT') { say('ending'); audio.playing(false); }
    if (next === 'CLOSING') audio.curtain(reduce() ? SCREENING.curtain.fadeSec : SCREENING.curtain.closeSec, false);
    if (next === 'IDLE') { showOver = lastState === 'CLOSING'; say(showOver ? 'over' : 'idle'); sound.stop(); }
    lastState = next;
    sync();
  }
  function sync() {
    if (!seq) return;
    const st = seq.state, busy = st === 'OPENING' || st === 'COUNTDOWN' || st === 'RUNOUT' || st === 'CLOSING';
    if (btn) btn.label(st, seq.paused);
    pauseBtn.setAttribute('aria-pressed', seq.paused ? 'true' : 'false');
    pauseBtn.setAttribute('aria-disabled', st === 'PLAYING' ? 'false' : 'true');
    muteBtn.setAttribute('aria-pressed', media.muted ? 'true' : 'false');
    stageEl.dataset.state = st.toLowerCase();
    stageEl.dataset.paused = seq.paused ? 'true' : 'false';
    stageEl.dataset.busy = busy ? 'true' : 'false';
    wake();
  }
  function press() {
    sound.unlock(); audio.unlock();
    if (seq.state === 'IDLE') {
      // inside the gesture: let the element play with sound later
      if (media === video && video.paused) { const p = video.play(); if (p && p.then) p.then(() => { if (seq.state !== 'PLAYING') { video.pause(); video.currentTime = 0; } }).catch(() => {}); }
      if (!plain) sound.click();
    }
    const r = seq.press();
    if (r === 'pause') say('paused');
    if (r === 'resume') say('playing');
    if (r === 'ignored-start') say('waitStart');
    if (r === 'ignored-end') say('waitEnd');
    sync();
  }
  media.addEventListener('ended', () => { if (!seq) return; if (plain) { seq.jump('IDLE'); say('over'); sync(); } else seq.ended_(); });
  let btn = null, wake = () => {};

  // ---------- WebGL, or the plain film ----------
  const canvas = document.createElement('canvas');
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  plain = !gl || params.get('screening') === 'plain';
  function bindButtons() {
    button.addEventListener('click', () => { if (button.getAttribute('aria-disabled') === 'true') { say(seq.state === 'OPENING' || seq.state === 'COUNTDOWN' ? 'waitStart' : 'waitEnd'); return; } press(); });
    pauseBtn.addEventListener('click', () => { if (pauseBtn.getAttribute('aria-disabled') !== 'true') press(); });
    muteBtn.addEventListener('click', () => {
      media.muted = !media.muted; audio.muted = media.muted; sound.muted = media.muted;
      if (!media.muted && status.textContent === STATUS.blocked) say(seq.state === 'PLAYING' ? 'playing' : 'idle');
      sync();
    });
  }
  const goPlain = () => {
    plain = true;
    if (video.dataset.poster) video.poster = video.dataset.poster;
    stageEl.dataset.scene = 'plain';
    // without the 3D room there is no curtain or countdown: the press plays the film
    seq = createSequence({ media, reduce: () => true, onState });
    const press0 = seq.press;
    seq.press = () => { if (seq.state === 'IDLE') { seq.jump('PLAYING'); media.currentTime = 0; media.play().catch(() => {}); return 'start'; } return press0(); };
    section.__screening = { plain: true, state: () => ({ state: seq.state, paused: seq.paused, plain: true, time: media.currentTime }), press, media: () => media };
    bindButtons(); sync(); say('idle');
    if (section.dataset.pending === 'play') { delete section.dataset.pending; press(); }
    return section.__screening;
  };
  if (plain) return goPlain();

  // ---------- renderer, stage, curtain ----------
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(new THREE.Color(CONFIG.palette.wall), 1);
  renderer.localClippingEnabled = true;
  canvas.className = 'screening-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envMap = pmrem.fromScene(roomEnv, 0.04).texture;
  roomEnv.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.18;

  const stage = createStage();
  const S = stage.S;
  scene.add(stage.group);
  const curtain = createCurtain(S, mobile);
  scene.add(curtain.group);
  curtain.setFade(reduce());

  // the screen: the film shader on a plane at z = 0
  const film = createFilm(renderer, { mobile, video, texture: card ? card.texture : null, ready: card ? () => true : null });
  film.setGuards([P.exitAt, P.returnAt], 15.072);
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(S.W, S.H), film.material);
  screenMesh.position.copy(S.centre);
  scene.add(screenMesh);
  const leader = createLeader();

  // light: a dim, warm room — the screen's own light toward the audience, the projector's beam light, a soft warm key on the
  // projector (low-key: most of the room stays in shadow)
  const ambient = new THREE.AmbientLight(0xffe2c4, 0.06);
  const screenLight = new THREE.SpotLight(0xfff2dc, 0, 30, 1.25, 1.0, 1.4);
  screenLight.position.set(0, S.centre.y, 0.05); screenLight.target.position.set(0, S.centre.y - 0.6, 8);
  const beamSpot = new THREE.SpotLight(0xffe0b0, 0, 30, 0.3, 0.35, 1.0);
  const keyLight = new THREE.SpotLight(0xffd6a8, 55, 14, 0.5, 0.7, 1.0);
  const rimLight = new THREE.DirectionalLight(0xffc98a, 0.9);         // a warm edge on the projector from behind, off the screen
  scene.add(ambient, screenLight, screenLight.target, beamSpot, beamSpot.target, keyLight, keyLight.target, rimLight, rimLight.target);

  // ---------- models ----------
  const draco = new DRACOLoader().setDecoderPath(CONFIG.draco);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let projector = null, holo = null;
  try {
    [projector, holo] = await Promise.all([
      loadProjector(loader),
      loadHologram(S).catch((e) => { console.warn('screening: no hologram frontman —', e && e.message); return null; }),
    ]);
  } catch (e) { console.warn('screening: the room could not load —', e && e.message); }
  draco.dispose();
  if (!projector || !alive) { renderer.dispose(); return goPlain(); }
  const rig = new THREE.Group();
  rig.add(projector.root);
  scene.add(rig);
  if (holo) scene.add(holo.holder, holo.shadow, holo.pool);
  const beam = createBeam();
  const dust = createDust(Math.round(CONFIG.performance.dust * (mobile ? 0.5 : 1)));
  scene.add(beam.mesh, dust.points);
  btn = createProjectorButton(stageEl, button);

  // ---------- film grain and a vignette over the whole picture ----------
  const grade = (() => {
    const uniforms = { uTime: { value: 0 }, uGrain: { value: mobile ? 0.012 : 0.016 } };     // a faint grain
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform float uTime, uGrain; varying vec2 vUv;
        float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          vec2 c = vUv - 0.5; float v = smoothstep(0.35, 0.85, length(c * vec2(1.0, 1.2)));
          float g = h2(floor(gl_FragCoord.xy / 1.5) + uTime * 37.0) - 0.5;
          // two layers over the picture: the vignette's dark, then the grain over what is left of it
          float av = v * 0.62, ag = abs(g) * uGrain * 2.0 * (1.0 - av);
          vec3 c2 = (vec3(0.02, 0.012, 0.008) * av + vec3(g > 0.0 ? 1.0 : 0.0) * ag) / max(av + ag, 1e-4);
          gl_FragColor = vec4(c2, av + ag);
        }`,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(mesh);
    return { scene: sc, camera: new THREE.Camera(), uniforms, dispose() { geo.dispose(); material.dispose(); } };
  })();
  renderer.autoClear = false;

  // ---------- layout ----------
  let width = 0, height = 0, fit = null;
  const lens = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * S.W / 2, S.centre.y + y * S.H / 2, 0.01));
  function layout() {
    fit = stage.fit(camera, width, height, mobile);
    rig.position.copy(fit.projectorAt);
    rig.scale.setScalar(fit.projectorSize);
    const dy = S.centre.y - (fit.projectorAt.y + 0.212 * fit.projectorSize), dz = -fit.projectorAt.z;
    // three-quarter view: turned 35 degrees off the screen axis so the body and both reels read, the lens still tipped up at it
    rig.rotation.set(0, Math.PI / 2 - 0.62, Math.atan2(dy, -dz) * 0.9, 'YZX');
    scene.updateMatrixWorld(true);
    // fit what the eye sees (the box from the model's own vertices): whole inside the canvas, under the screen, centred
    {
      const rectOf = () => {
        const b = new THREE.Box3().setFromObject(projector.root, true), pts = [];
        for (let i = 0; i < 8; i++) { v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera); pts.push([(v3.x * 0.5 + 0.5) * width, (0.5 - v3.y * 0.5) * height]); }
        return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
      };
      v3.set(0, S.bottom, 0).project(camera);
      const screenBottomPx = (0.5 - v3.y * 0.5) * height;
      const dist = camera.position.z - rig.position.z, tvv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const toWorld = (px) => px / height * 2 * dist * tvv;
      for (let k = 0; k < 6; k++) {
        scene.updateMatrixWorld(true);
        const [x0, y0, x1, y1] = rectOf();
        rig.position.x -= toWorld((x0 + x1) / 2 - width / 2);
        if (y1 > height * 0.97) rig.position.y += toWorld(y1 - height * 0.97);
        else if (y0 < screenBottomPx + 6) { const f = Math.max(0.6, (y1 - screenBottomPx - 6) / (y1 - y0)); rig.scale.multiplyScalar(f); fit.projectorSize *= f; }
        else break;
      }
      fit.projectorAt.copy(rig.position);
      scene.updateMatrixWorld(true);
    }
    projector.lens(lens);
    beam.aim(lens, corners);
    dust.aim(beam.corners.from, corners);
    beamSpot.position.copy(lens); beamSpot.target.position.copy(S.centre);
    beamSpot.angle = Math.atan2(Math.hypot(S.W, S.H) / 2, lens.z) * 1.05;
    keyLight.position.set(fit.projectorAt.x + 0.9, fit.projectorAt.y + 3.0, fit.projectorAt.z + 1.8); keyLight.target.position.copy(fit.projectorAt);
    rimLight.position.set(fit.projectorAt.x - 1.2, fit.projectorAt.y + 2.0, fit.projectorAt.z - 3.0); rimLight.target.position.copy(fit.projectorAt);
    btn.place(projector.root, camera, width, height);
    const pixels = height * renderer.getPixelRatio() / (2 * fit.tv);
    dust.uniforms.uScale.value = pixels * 0.012;
  }
  function resize(force) {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (!w || !h || (!force && w === width && h === height)) return;
    width = w; height = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.performance.maxDpr));
    renderer.setSize(w, h, false);
    layout();
  }

  // ---------- one frame ----------
  let last = 0, raf = 0, visible = false, clock = 0, held = false, lastPlace = null, lv = null, frameInfo = null;
  const stats = { frames: 0, fps: 0, acc: 0, n: 0 };
  const screenPx = [0, 0];
  const v3 = new THREE.Vector3();
  function screenPixels() {
    v3.set(-S.W / 2, S.top, 0).project(camera); const x0 = v3.x, y0 = v3.y;
    v3.set(S.W / 2, S.bottom, 0).project(camera);
    screenPx[0] = Math.abs(v3.x - x0) / 2 * width * renderer.getPixelRatio(); screenPx[1] = Math.abs(v3.y - y0) / 2 * height * renderer.getPixelRatio();
    return screenPx;
  }
  function frame(dt) {
    const motion = !reduce();
    if (!held) lv = seq.update(dt); else lv = seq.update(0);
    clock += motion ? dt : 0;
    const t = media.currentTime || 0;
    // curtain
    curtain.set(lv.curtain, lv.curtainVel, lv.sway);
    // projector: lamp, reels, the idle breath, hover and the press bounce
    const idle = seq.state === 'IDLE';
    const hover = btn.hover && idle ? 1 : 0;
    projector.update(dt, lv.reel, Math.max(lv.lamp, hover * 0.45), { hover, twitch: lv.breathe });
    const bounce = motion ? btn.press() : 0;
    rig.scale.set(fit.projectorSize * (1 + 0.02 * bounce), fit.projectorSize * (1 - 0.035 * bounce), fit.projectorSize * (1 + 0.02 * bounce));
    if (lv.reel > 0 && !seq.paused) sound.run(Math.min(1, lv.reel)); else sound.run(0);
    // the screen
    const mode = lv.source === 'film' ? 'film' : lv.source === 'leader' ? 'leader' : lv.source === 'off' ? 'off' : 'light';
    if (mode === 'leader') leader.draw(lv.leaderT);
    if (card && mode === 'film') card.draw();
    frameInfo = film.update({ mode, bright: lv.bright, t, clock, motion, leaderTexture: leader.texture, screenPx: screenPixels() });
    // the room breathes with the film: beam, dust, screen light, beam light
    const exposure = film.shared.uExposure.value;
    beam.uniforms.uIntensity.value = lv.beam * exposure; beam.uniforms.uTime.value = clock;
    dust.uniforms.uIntensity.value = lv.beam * exposure; dust.uniforms.uTime.value = clock;
    screenLight.intensity = 22 * lv.bright * film.luminance * exposure;
    beamSpot.intensity = 14 * lv.beam * exposure;
    keyLight.intensity = 55 * (1 - 0.4 * lv.beam);
    rimLight.intensity = 0.6 + 1.2 * lv.bright;
    // the frontman, as light: lands on the film's stage line, stays on the screen
    const playing = seq.state === 'PLAYING' || seq.state === 'RUNOUT';
    const place = holo ? placeAt(playing ? t : -1, holo, S, motion) : { visible: false, ripple: -1 };
    if (holo) { applyPlace(holo, place, clock); holo.uniforms.uMotion.value = motion ? 1 : 0; }
    film.uniforms.uRipple.value.set(0.5 + P.returnX, 0.97, playing && place.ripple >= 0 ? place.ripple : -1);
    lastPlace = place;
    renderer.clear();
    renderer.render(scene, camera);
    grade.uniforms.uTime.value = motion ? Math.floor(clock * 24) : 0;
    renderer.render(grade.scene, grade.camera);
    stats.frames++;
  }
  function needsLoop() { return alive && visible && !document.hidden && (seq.state !== 'IDLE' || !reduce()); }
  function tick(now) {
    raf = 0;
    if (!alive) return;
    resize();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (dt > 0) { stats.acc += dt; stats.n++; if (stats.acc >= 0.5) { stats.fps = stats.n / stats.acc; stats.acc = 0; stats.n = 0; } }
    frame(dt);
    if (needsLoop()) raf = requestAnimationFrame(tick); else last = 0;
  }
  wake = function () { if (!alive || raf || !visible || document.hidden) return; raf = requestAnimationFrame(tick); };
  function drawOnce() { if (alive && visible && !document.hidden) { resize(); frame(0); } }

  // ---------- page wiring ----------
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
  const ro = new ResizeObserver(() => { if (!raf) drawOnce(); });
  const onVisibility = () => { if (!document.hidden) wake(); };
  const onMotion = () => { curtain.setFade(reduce()); wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  reduceMq.addEventListener('change', onMotion);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); destroy(); goPlain(); });

  function destroy() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    reduceMq.removeEventListener('change', onMotion);
    audio.dispose(); sound.dispose();
    projector.dispose(); if (holo) holo.dispose();
    [stage, curtain, film, leader, beam, dust, grade].forEach((x) => x && x.dispose && x.dispose());
    envMap.dispose();
    renderer.dispose();
    canvas.remove();
  }

  seq = createSequence({ media: { get currentTime() { return media.currentTime; }, set currentTime(v) { media.currentTime = v; }, play: () => media.play(), pause: () => media.pause() }, reduce, onState });

  const api = {
    destroy, press,
    clip: () => P, media: () => media, phase: () => (lastPlace ? lastPlace.phase : 'screen'),
    seek(t) { media.currentTime = Math.max(0, t); drawOnce(); },
    changed() { film.setGuards([P.exitAt, P.returnAt], 15.072); drawOnce(); },
    state: () => ({
      state: seq.state, paused: seq.paused, t: +seq.t.toFixed(3), time: +(media.currentTime || 0).toFixed(3), muted: media.muted,
      film: card ? 'stand-in' : 'video', reduced: reduce(), mobile, dpr: renderer.getPixelRatio(), size: [width, height],
      fps: Math.round(stats.fps), frames: stats.frames, running: !!raf, visible,
      curtain: lv ? +lv.curtain.toFixed(3) : null, beam: lv ? +lv.beam.toFixed(3) : 0, shownFrame: frameInfo ? frameInfo.frame : null,
      exposure: +film.shared.uExposure.value.toFixed(4), luminance: +film.luminance.toFixed(3), vintage: audio.routed,
      player: lastPlace ? { visible: lastPlace.visible, phase: lastPlace.phase, ground: lastPlace.ground,
        position: lastPlace.visible ? [lastPlace.x, lastPlace.y, lastPlace.z].map((x) => +x.toFixed(3)) : null, scale: lastPlace.visible ? +lastPlace.sy.toFixed(3) : null } : null,
      model: !!holo, stageLine: holo ? +holo.stageLine.toFixed(3) : null, seats: SCREENING.stage.seats, seatNames: (() => { let n = 0; scene.traverse((o) => { if (/seat/i.test(o.name)) n++; }); return n; })(),
      fit: fit ? { share: +fit.share.toFixed(3), headroom: fit.headroom } : null, label: button.getAttribute('aria-label'),
    }),
    /** the screen's rectangle on the canvas, in CSS px: [x, y, w, h] */
    screenRect() {
      v3.set(-S.W / 2, S.top, 0).project(camera); const x0 = (v3.x * 0.5 + 0.5) * width, y0 = (0.5 - v3.y * 0.5) * height;
      v3.set(S.W / 2, S.bottom, 0).project(camera); const x1 = (v3.x * 0.5 + 0.5) * width, y1 = (0.5 - v3.y * 0.5) * height;
      return [x0, y0, x1 - x0, y1 - y0];
    },
    /** the film's stage line on the canvas, in CSS px */
    stageLineY() { if (!holo) return null; v3.set(0, holo.stageLine, 0).project(camera); return (0.5 - v3.y * 0.5) * height; },
    /** the projector's box on the canvas, in CSS px: [x0, y0, x1, y1] */
    projectorRect() {
      const b = new THREE.Box3().setFromObject(projector.root, true), pts = [];
      for (let i = 0; i < 8; i++) { v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera); pts.push([(v3.x * 0.5 + 0.5) * width, (0.5 - v3.y * 0.5) * height]); }
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    },
    /** where the frontman is on the canvas: [x0, y0, x1, y1] in CSS px, or null */
    playerRect() {
      if (!holo || !holo.holder.visible) return null;
      // the figure itself (its plane less the glow padding)
      const b = new THREE.Box3().setFromObject(holo.holder), pts = [];
      const padX = (b.max.x - b.min.x) * 0.18 / 1.36, padY = (b.max.y - b.min.y) * 0.18 / 1.18;
      b.min.x += padX; b.max.x -= padX; b.max.y -= padY;
      for (let i = 0; i < 8; i++) { v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera); pts.push([(v3.x * 0.5 + 0.5) * width, (0.5 - v3.y * 0.5) * height]); }
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    },
    /** the world x of the exit / return points as a share of the screen width from its centre */
    cuePoints: () => ({ exitX: P.exitX, returnX: P.returnX }),
    hold(on) { held = !!on; },
    jump(next, at = 0) {
      if (next === 'PLAYING') { seq.jump('PLAYING', 0); media.currentTime = at; } else seq.jump(next, at);
      drawOnce();
    },
  };

  // ---------- show it: everything compiled first (the frontman too, so he never shows as an unlit white shape) ----------
  stageEl.insertBefore(canvas, stageEl.firstChild);
  resize(true);
  if (holo) { holo.holder.visible = holo.shadow.visible = holo.pool.visible = true; holo.uniforms.uOpacity.value = 0.001; }
  await renderer.compileAsync(scene, camera);
  const warm = new THREE.WebGLRenderTarget(64, 64);                         // warm every texture up, off screen
  renderer.setRenderTarget(warm); renderer.render(scene, camera); renderer.setRenderTarget(null); warm.dispose();
  if (holo) holo.holder.visible = holo.shadow.visible = holo.pool.visible = false;
  if (!alive) return api;
  visible = true;
  frame(0);
  stageEl.dataset.scene = '3d';
  const poster = stageEl.querySelector('.screening-poster');
  if (poster) poster.setAttribute('aria-hidden', 'true');
  io.observe(section);
  ro.observe(stageEl);
  section.__screening = api;
  bindButtons();
  say('idle');
  sync();
  if (params.get('debug') === 'cues') import('./debugCues.js').then((m) => m.mountCueDebugger(section, api));
  if (section.dataset.pending === 'play') { delete section.dataset.pending; press(); }
  return api;
}
