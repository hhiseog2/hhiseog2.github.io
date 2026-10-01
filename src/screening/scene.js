// The screening room (first screen), second version. index.html imports this after the page has loaded (desktop) or after the
// first input; until then the section shows a still of the room with the curtain closed.
//
// Parts: stage.js (no seats, big screen, camera fit) · curtain.js (red velvet) · sequence.js (the show's state machine) ·
// filmShader.js (black-and-white projection) · popout.js + toonInk.js (the 3D frontman) · projectorButton.js (the projector is
// the button) · vintageAudio.js (sound) · projector.js (the machine, its beam, dust and noises) · countdown.js (leader, stand-in).
//
// Without WebGL the section falls back to the film in a plain <video> (black and white by CSS) with a visible play button.
// Reduced motion: black and white with still grain; no flicker, weave, stutter, slip or pop-out; the curtain fades.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from '../../vendor/jsm/environments/RoomEnvironment.js';
import { CONFIG, SCREENING, STATUS } from './config.js';
import { createStage } from './stage.js';
import { createCurtain } from './curtain.js';
import { createSequence } from './sequence.js';
import { createFilm } from './filmShader.js';
import { createInk } from './toonInk.js';
import { loadFrontman, placeAt, applyPlace, createPuffs } from './popout.js';
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
  scene.environmentIntensity = 0.12;

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

  // light: a dim room, the screen's own light toward the audience, the projector's beam light, a soft key on the projector
  const ambient = new THREE.AmbientLight(0xffffff, 0.08);
  const screenLight = new THREE.SpotLight(0xffffff, 0, 30, 1.25, 1.0, 1.4);
  screenLight.position.set(0, S.centre.y, 0.05); screenLight.target.position.set(0, S.centre.y - 0.6, 8);
  const beamSpot = new THREE.SpotLight(0xffffff, 0, 30, 0.3, 0.35, 1.0);
  const keyLight = new THREE.SpotLight(0xffffff, 30, 14, 0.5, 0.7, 1.0);
  scene.add(ambient, screenLight, screenLight.target, beamSpot, beamSpot.target, keyLight, keyLight.target);

  // ---------- models ----------
  const draco = new DRACOLoader().setDecoderPath(CONFIG.draco);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);       // keeps what is in front of the screen
  const ink = createInk({ film: film.shared, clipPlane });
  let projector = null, fm = null;
  try {
    [projector, fm] = await Promise.all([
      loadProjector(loader),
      loadFrontman(loader, ink).catch((e) => { console.warn('screening: no 3D frontman —', e && e.message); return null; }),
    ]);
  } catch (e) { console.warn('screening: the room could not load —', e && e.message); }
  draco.dispose();
  if (!projector || !alive) { renderer.dispose(); return goPlain(); }
  const rig = new THREE.Group();
  rig.add(projector.root);
  scene.add(rig);
  if (fm) scene.add(fm.holder);
  const puffs = createPuffs();
  puffs.sprites.forEach((s) => scene.add(s));
  const beam = createBeam();
  const dust = createDust(Math.round(CONFIG.performance.dust * (mobile ? 0.5 : 1)));
  scene.add(beam.mesh, dust.points);
  btn = createProjectorButton(stageEl, button);

  // ---------- the frontman's shadow on the screen: his silhouette seen from the lens, framed to the screen ----------
  const shadowSize = mobile ? CONFIG.performance.shadowMap.mobile : CONFIG.performance.shadowMap.desktop;
  const shadowRT = new THREE.WebGLRenderTarget(shadowSize, Math.round(shadowSize / SCREENING.clip.aspect), { depthBuffer: true });
  const shadowCam = new THREE.PerspectiveCamera();
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  if (fm) fm.holder.traverse((o) => { if (o.isMesh && o.material !== fm.materials[fm.materials.length - 1]) o.layers.enable(2); });
  shadowCam.layers.set(2);
  film.uniforms.uShadow.value = shadowRT.texture;

  // ---------- layout ----------
  let width = 0, height = 0, fit = null;
  const lens = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * S.W / 2, S.centre.y + y * S.H / 2, 0.01));
  function layout() {
    fit = stage.fit(camera, width, height, mobile);
    rig.position.copy(fit.projectorAt);
    rig.scale.setScalar(fit.projectorSize);
    const dy = S.centre.y - (fit.projectorAt.y + 0.212 * fit.projectorSize), dz = -fit.projectorAt.z;
    rig.rotation.set(0, Math.PI / 2, Math.atan2(dy, -dz) * 0.95, 'YZX');
    scene.updateMatrixWorld(true);
    projector.lens(lens);
    beam.aim(lens, corners);
    dust.aim(beam.corners.from, corners);
    beamSpot.position.copy(lens); beamSpot.target.position.copy(S.centre);
    beamSpot.angle = Math.atan2(Math.hypot(S.W, S.H) / 2, lens.z) * 1.05;
    keyLight.position.set(fit.projectorAt.x + 0.9, fit.projectorAt.y + 3.0, fit.projectorAt.z + 1.8); keyLight.target.position.copy(fit.projectorAt);
    // shadow camera: at the lens, looking straight at the screen, its frustum exactly the screen
    shadowCam.position.copy(lens); shadowCam.rotation.set(0, 0, 0); shadowCam.updateMatrixWorld();
    const n = 0.05, d = lens.z;
    shadowCam.projectionMatrix.makePerspective((-S.W / 2 - lens.x) * n / d, (S.W / 2 - lens.x) * n / d, (S.top - lens.y) * n / d, (S.bottom - lens.y) * n / d, n, 40);
    shadowCam.projectionMatrixInverse.copy(shadowCam.projectionMatrix).invert();
    btn.place(projector.root, camera, width, height);
    ink.uniforms.uRes.value.set(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
    // 1.5-2.5 CSS px whatever the distance (the hull is pushed out in clip space)
    ink.uniforms.uOutlinePx.value = THREE.MathUtils.clamp(1.5 + width / 1280, CONFIG.performance.outlinePx[0], CONFIG.performance.outlinePx[1]) * renderer.getPixelRatio();
    ink.uniforms.uHatchPx.value = 4.5 * renderer.getPixelRatio();
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
    keyLight.intensity = 30 * (1 - 0.5 * lv.beam);
    // the frontman
    const playing = seq.state === 'PLAYING' || seq.state === 'RUNOUT';
    const place = fm ? placeAt(playing ? t : -1, fit, S, fm, motion) : { visible: false, puffs: [-1, -1], ripple: -1 };
    if (fm) {
      applyPlace(fm, place);
      ink.uniforms.uFilmness.value = place.filmness;
      ink.uniforms.uRim.value = 0.35 * film.luminance * lv.bright;
    }
    const puffSize = S.H * 0.32;
    puffs.set(0, place.exitPt || v3.set(0, 0, 0), playing ? place.puffs[0] : -1, puffSize);
    puffs.set(1, place.retPt || v3.set(0, 0, 0), playing ? place.puffs[1] : -1, puffSize * 0.75);
    film.uniforms.uRipple.value.set(0.5 + P.returnX, 0.97, playing && place.ripple >= 0 ? place.ripple : -1);
    // his shadow on the film, only while he is out and the beam is on
    const shadowOn = !!(fm && place.visible && lv.beam > 0.2 && motion);
    film.uniforms.uShadowOn.value = shadowOn ? 1 : 0;
    if (shadowOn) {
      const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(shadowRT);
      renderer.setClearColor(0x000000, 1); renderer.clear();
      scene.overrideMaterial = shadowMat;
      const planes = renderer.clippingPlanes; renderer.clippingPlanes = [];
      renderer.render(scene, shadowCam);
      renderer.clippingPlanes = planes;
      scene.overrideMaterial = null;
      renderer.setRenderTarget(null);
      renderer.setClearColor(prevClear, prevAlpha);
    }
    lastPlace = place;
    renderer.render(scene, camera);
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
    projector.dispose(); if (fm) fm.dispose();
    [stage, curtain, film, leader, beam, dust, puffs, ink].forEach((x) => x && x.dispose && x.dispose());
    shadowRT.dispose(); shadowMat.dispose(); envMap.dispose();
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
      player: lastPlace ? { visible: lastPlace.visible, phase: lastPlace.phase, filmness: lastPlace.filmness,
        position: lastPlace.position ? lastPlace.position.toArray().map((x) => +x.toFixed(3)) : null, scale: lastPlace.scale ? +lastPlace.scale.toFixed(3) : null } : null,
      model: !!fm, seats: SCREENING.stage.seats, seatNames: (() => { let n = 0; scene.traverse((o) => { if (/seat/i.test(o.name)) n++; }); return n; })(),
      fit: fit ? { share: +fit.share.toFixed(3), headroom: fit.headroom } : null, label: button.getAttribute('aria-label'),
    }),
    /** the screen's rectangle on the canvas, in CSS px: [x, y, w, h] */
    screenRect() {
      v3.set(-S.W / 2, S.top, 0).project(camera); const x0 = (v3.x * 0.5 + 0.5) * width, y0 = (0.5 - v3.y * 0.5) * height;
      v3.set(S.W / 2, S.bottom, 0).project(camera); const x1 = (v3.x * 0.5 + 0.5) * width, y1 = (0.5 - v3.y * 0.5) * height;
      return [x0, y0, x1 - x0, y1 - y0];
    },
    /** where the frontman is on the canvas: [x, y top, y bottom] in CSS px, or null */
    playerRect() {
      if (!fm || !fm.holder.visible) return null;
      const b = new THREE.Box3().setFromObject(fm.holder), pts = [];
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
  if (fm) { fm.holder.visible = true; fm.holder.position.set(0, S.centre.y, 2); }
  puffs.sprites.forEach((s) => { s.visible = true; });
  film.uniforms.uShadowOn.value = 1;
  await renderer.compileAsync(scene, camera);
  const warm = new THREE.WebGLRenderTarget(64, 64);                         // warm every texture up, off screen
  renderer.setRenderTarget(warm); renderer.render(scene, camera); renderer.setRenderTarget(null); warm.dispose();
  if (fm) fm.holder.visible = false;
  puffs.sprites.forEach((s) => { s.visible = false; });
  film.uniforms.uShadowOn.value = 0;
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
