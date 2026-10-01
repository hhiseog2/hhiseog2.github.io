// The screening room (#screening). index.html imports this once the section comes near the viewport (or the projector is pressed
// before that); until then the section shows a still picture of the room.
//
//   off      the projector waits under a dim light, the screen is dark cloth. "Play the screening" sits on the projector.
//   warm     press: the lamp flickers on (0.3 s), the reels come up to speed (1.2 s), the beam and the screen brighten (2 s)
//   count    the 3, 2, 1 leader (3 s)
//   play     the film with its sound; at the clip's cues the player jumps out of the screen and back (popout.js)
//   cool     the film ends: the beam dies away and the room is back to `off`
// Pressing the projector while it runs pauses or resumes, as do the Pause and Mute buttons under the screen.
//
// Without WebGL the section falls back to the film itself in a plain <video>; with reduced motion the lamp does not flicker,
// there is no countdown and nobody leaves the screen: the film just plays.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from '../../vendor/jsm/environments/RoomEnvironment.js';
import { CONFIG, SCREENING, LABEL } from './config.js';
import { loadProjector, createBeam, createDust, createSound } from './projector.js';
import { createLeader, createTestCard } from './countdown.js';
import { loadPlayer, placeAt, applyPlace, toonGradient } from './popout.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const params = new URLSearchParams(window.location.search);

const STATUS = {
  warm: 'The projector is warming up.',
  count: 'Starting in three, two, one.',
  play: 'Now playing.',
  paused: 'Paused.',
  ended: 'The reel has ended. Press the projector to play it again.',
  blocked: 'Your browser held back the sound. Press Mute to turn it on.',
};

function layoutFor(aspect) {
  // the camera sits a little behind and above the projector, looking at the screen: the screen in the upper part of the picture,
  // the projector below it among the seats, the air between them free for the player
  if (aspect >= 1.3) return { fov: 36, eye: [0, 2.6, 7.6], look: [0, 0.95, -6] };
  if (aspect >= 0.95) return { fov: 40, eye: [0, 2.7, 7.8], look: [0, 1.0, -6] };
  return { fov: 48, eye: [0, 2.8, 8.2], look: [0, 1.1, -6] };
}

function curtainTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 8;
  const g = c.getContext('2d');
  for (let x = 0; x < 256; x++) {
    const v = Math.round(34 + 22 * Math.pow(0.5 + 0.5 * Math.sin(x / 256 * Math.PI * 14), 1.6));
    g.fillStyle = `rgb(${v},${v},${v + 1})`;
    g.fillRect(x, 0, 1, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function screenMaterial() {
  const uniforms = {
    uLeader: { value: null }, uFilm: { value: null }, uMode: { value: 0 }, uBright: { value: 0 }, uTime: { value: 0 },
    uOff: { value: new THREE.Color(CONFIG.palette.screenOff) }, uRipple: { value: new THREE.Vector3(0.5, 0.5, -1) }, uFlicker: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D uLeader; uniform sampler2D uFilm; uniform float uMode; uniform float uBright; uniform float uTime;
      uniform vec3 uOff; uniform vec3 uRipple; uniform float uFlicker;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        float ring = 0.0;
        if (uRipple.z >= 0.0) {                                   // rings where the player went back into the film
          vec2 d = (vUv - uRipple.xy) * vec2(4.0 / 3.0, 1.0);
          float r = length(d), front = uRipple.z * 0.55;
          float wave = sin((r - front) * 80.0) * exp(-abs(r - front) * 14.0) * (1.0 - uRipple.z);
          uv += normalize(d + 1e-5) * wave * 0.006;
          ring = wave * 0.22;
        }
        vec3 film = uMode < 0.5 ? texture2D(uLeader, uv).rgb : uMode < 1.5 ? texture2D(uFilm, uv).rgb : vec3(0.93, 0.92, 0.89);   // 2: bare light, no film yet
        float flick = 1.0 - uFlicker * 0.05 * (0.5 + 0.5 * sin(uTime * 53.0) * sin(uTime * 17.0));
        float vig = 1.0 - 0.28 * pow(length(vUv - 0.5) * 1.35, 2.0);
        vec3 lit = film * flick * vig + ring;
        gl_FragColor = vec4(mix(uOff, lit, uBright), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return { material, uniforms };
}

function grainPass() {
  const uniforms = { uTime: { value: 0 }, uAmount: { value: 0.07 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uAmount; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 61.7) * 43758.5453); }
      void main() {
        float n = hash(floor(gl_FragCoord.xy / 1.5)) - 0.5;
        gl_FragColor = vec4(vec3(n > 0.0 ? 1.0 : 0.0), abs(n) * uAmount * 2.0);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, camera: new THREE.Camera(), uniforms, dispose() { geometry.dispose(); material.dispose(); } };
}

export async function activate(section) {
  if (section.__screening) return section.__screening;
  section.__screening = { pending: true };
  // the section's place on the page comes from the config (default: right under the first screen)
  const after = document.querySelector(SCREENING.sectionAfter);
  if (after && after.nextElementSibling !== section) after.after(section);

  const stage = section.querySelector('.screening-stage');
  const button = section.querySelector('.screening-projector');
  const pauseBtn = section.querySelector('.screening-pause');
  const muteBtn = section.querySelector('.screening-mute');
  const status = section.querySelector('.screening-status');
  const video = section.querySelector('.screening-video');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: ' + CONFIG.performance.mobileBreakpoint + 'px)').matches;

  let clipIndex = 0, filmTexture = null, plain = false;
  const clip = () => SCREENING.clips[clipIndex];
  // the film: the clip's video, or the drawn stand-in when it has none, cannot load, or ?fallback=1
  let media = video, card = null;
  function useCard(why) {
    if (card) return;
    console.warn('screening: stand-in film (' + why + ')');
    card = createTestCard(clip());
    media = card;
    section.dataset.film = 'stand-in';
    wireMedia();
  }
  const sources = clip().src ? clip().formats.map((f) => ({ src: CONFIG.media(clip(), f), type: 'video/' + f })) : [];
  video.innerHTML = '';
  for (const s of sources) {
    const el = document.createElement('source');
    el.src = s.src; el.type = s.type;
    el.addEventListener('error', () => { if (!video.currentSrc || video.networkState === 3) useCard('the film did not load'); });
    video.appendChild(el);
  }

  // ---------- sequence state ----------
  let state = 'off', seqT = 0, paused = false, alive = true, ended = false;
  const sound = createSound();
  const setStatus = (key) => { status.textContent = key ? STATUS[key] : ''; };
  function setPressed() {
    const running = state !== 'off' && state !== 'cool' && !paused;
    button.setAttribute('aria-pressed', running ? 'true' : 'false');
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseBtn.setAttribute('aria-disabled', state === 'off' || state === 'cool' ? 'true' : 'false');
    muteBtn.setAttribute('aria-pressed', media.muted ? 'true' : 'false');
    stage.dataset.state = state;
    stage.dataset.paused = paused ? 'true' : 'false';
  }
  function go(next) {
    state = next; seqT = 0;
    if (next === 'play') {
      media.currentTime = 0;
      const p = media.play();
      if (p && p.catch) p.catch((e) => {
        if (e && e.name === 'NotAllowedError' && !media.muted) { media.muted = true; setStatus('blocked'); media.play().catch(() => {}); setPressed(); }
      });
    }
    if (next === 'cool') sound.stop();
    if (next !== 'off') setStatus(next === 'cool' ? 'ended' : next);
    setPressed();
    wake();
  }
  function prime() {
    // inside the click: let this element play with sound later (some browsers only allow it from a gesture)
    if (media === video && video.paused) {
      const p = video.play();
      if (p && p.then) p.then(() => { if (state === 'warm' || state === 'count') { video.pause(); video.currentTime = 0; } }).catch(() => {});
    }
  }
  function press() {
    sound.unlock();
    if (state === 'off' || state === 'cool') {
      paused = false; ended = false;
      prime();
      if (!plain) sound.click();
      go(reduce.matches || plain ? 'play' : 'warm');
      return;
    }
    setPaused(!paused);
  }
  function setPaused(p) {
    if (state === 'off' || state === 'cool') return;
    paused = p;
    if (state === 'play') { if (paused) media.pause(); else media.play().catch(() => {}); }
    if (paused) sound.stop();
    setStatus(paused ? 'paused' : state);
    setPressed();
    wake();
  }
  function onEnded() { if (state === 'play') { ended = true; go(plain ? 'off' : 'cool'); if (plain) setStatus('ended'); } }
  function onSeeked() { wake(); }
  function wireMedia() {
    media.addEventListener('ended', onEnded);
    media.addEventListener('seeked', onSeeked);
    if (filmTexture) setFilm();
  }
  video.addEventListener('ended', onEnded);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('error', () => { if (video.error) useCard('the film failed: ' + video.error.code); });
  if (params.get('fallback') === '1' || !sources.length) useCard(sources.length ? '?fallback=1' : 'no film for this clip');

  // ---------- WebGL, or the plain film ----------
  const canvas = document.createElement('canvas');
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }) || canvas.getContext('webgl', { antialias: true, alpha: false }); } catch (e) { gl = null; }
  plain = !gl || params.get('screening') === 'plain';

  function bindButtons() {
    button.addEventListener('click', press);
    pauseBtn.addEventListener('click', () => { if (pauseBtn.getAttribute('aria-disabled') !== 'true') setPaused(!paused); });
    muteBtn.addEventListener('click', () => {
      media.muted = !media.muted;
      sound.muted = media.muted;
      if (!media.muted && status.textContent === STATUS.blocked) setStatus(state === 'play' ? 'play' : '');
      setPressed();
    });
  }
  let wake = () => {};

  // the film's own still is only needed where the plain <video> is shown (a poster attribute would load with the page)
  const showPoster = () => { if (video.dataset.poster) video.poster = video.dataset.poster; };
  if (plain) {
    showPoster();
    stage.dataset.scene = 'plain';
    section.__screening = { plain: true, state: () => ({ state, paused, plain: true, time: media.currentTime }), press, media: () => media };
    bindButtons();
    if (section.dataset.pending === 'play') { delete section.dataset.pending; press(); }
    setPressed();
    return section.__screening;
  }

  // ---------- renderer and room ----------
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(new THREE.Color(CONFIG.palette.wall), 1);
  renderer.autoClear = false;
  canvas.className = 'screening-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envMap = pmrem.fromScene(roomEnv, 0.04).texture;
  roomEnv.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.3;

  const P = CONFIG.palette, S = CONFIG.screen;
  const screenCentre = new THREE.Vector3().fromArray(S.centre);
  const lambert = (c) => new THREE.MeshLambertMaterial({ color: new THREE.Color(c) });
  const disposables = [];
  const keep = (...xs) => { disposables.push(...xs); return xs[0]; };
  const wallMat = keep(lambert(P.wall)), floorMat = keep(lambert(P.floor)), seatMat = keep(lambert(P.seat)), frameMat = keep(lambert(P.ink));
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 14)), wallMat);
  wall.position.set(0, 5, screenCentre.z - 0.08);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(26, 22)), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 2);
  const curtainMap = keep(curtainTexture());
  const curtainMat = keep(new THREE.MeshLambertMaterial({ map: curtainMap }));
  const curtains = [-1, 1].map((sx) => {
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.2, 6.5)), curtainMat);
    m.position.set(sx * (S.width / 2 + 1.75), 3.25, screenCentre.z + 0.05);
    return m;
  });
  const valance = new THREE.Mesh(keep(new THREE.PlaneGeometry(S.width + 7, 1.2)), curtainMat);
  valance.position.set(0, screenCentre.y + S.height / 2 + 0.85, screenCentre.z + 0.06);
  const border = new THREE.Group();
  const bar = (w, h, x, y) => { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.08)), frameMat); m.position.set(x, y, 0); border.add(m); };
  const fw = 0.14;
  bar(S.width + fw * 2, fw, 0, S.height / 2 + fw / 2); bar(S.width + fw * 2, fw, 0, -S.height / 2 - fw / 2);
  bar(fw, S.height, S.width / 2 + fw / 2, 0); bar(fw, S.height, -S.width / 2 - fw / 2, 0);
  border.position.copy(screenCentre);
  const scr = screenMaterial();
  keep(scr.material);
  const screenMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(S.width, S.height)), scr.material);
  screenMesh.position.copy(screenCentre);
  // rows of seats between the projector and the screen (only their backs are seen)
  const seatGeo = keep(new THREE.BoxGeometry(0.53, 0.86, 0.12));
  const seatSpots = [];
  for (const z of [1.15, 0.05, -1.05, -2.15, -3.25]) for (let x = -5.25; x <= 5.26; x += 0.55) if (Math.abs(x) > 0.5) seatSpots.push([x, z]);
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, seatSpots.length);
  const m4 = new THREE.Matrix4();
  seatSpots.forEach(([x, z], i) => { m4.makeTranslation(x, 0.43, z); seats.setMatrixAt(i, m4); });
  const standMat = keep(lambert('#232325'));
  const stand = new THREE.Mesh(keep(new THREE.BoxGeometry(0.62, 1, 0.62)), standMat);
  scene.add(wall, floor, ...curtains, valance, border, screenMesh, seats, stand);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const screenLight = new THREE.PointLight(new THREE.Color(P.paper), 0, 16, 1.6);
  screenLight.position.set(screenCentre.x, screenCentre.y, screenCentre.z + 1.2);
  const keyLight = new THREE.SpotLight(new THREE.Color(P.paper), 30, 12, 0.55, 0.7, 1.2);
  const beamLight = new THREE.DirectionalLight(new THREE.Color(P.beam), 0);
  scene.add(ambient, screenLight, keyLight, keyLight.target, beamLight, beamLight.target);

  // ---------- models ----------
  const draco = new DRACOLoader().setDecoderPath(CONFIG.draco);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gradient = keep(toonGradient());
  const members = [...new Set(SCREENING.clips.map((c) => c.member))];
  const [projector, ...players] = await Promise.all([
    loadProjector(loader),
    ...members.map((m) => loadPlayer(m, loader, gradient).catch((e) => { console.warn('screening: no 3D ' + m + ' —', e && e.message); return null; })),
  ]).catch((e) => { console.warn('screening: the room could not load —', e && e.message); return [null]; });
  draco.dispose();
  if (!projector || !alive) {
    plain = true;
    showPoster();
    stage.dataset.scene = 'plain';
    renderer.dispose();
    section.__screening = { plain: true, state: () => ({ state, paused, plain: true }), press, media: () => media };
    bindButtons();
    setPressed();
    if (section.dataset.pending === 'play') { delete section.dataset.pending; press(); }
    return section.__screening;
  }
  const rig = new THREE.Group();
  rig.add(projector.root);
  scene.add(rig);
  const player = Object.fromEntries(members.map((m, i) => [m, players[i]]));
  for (const p of players) if (p) scene.add(p.holder);

  const beam = createBeam();
  const dust = createDust(Math.round(CONFIG.performance.dust * (mobile ? 0.5 : 1)));
  scene.add(beam.mesh, dust.points);
  const leader = createLeader();
  disposables.push(beam, dust, leader);
  scr.uniforms.uLeader.value = leader.texture;
  function setFilm() {
    if (filmTexture && filmTexture !== (card && card.texture)) filmTexture.dispose();
    filmTexture = card ? card.texture : new THREE.VideoTexture(video);
    filmTexture.colorSpace = THREE.SRGBColorSpace;
    scr.uniforms.uFilm.value = filmTexture;
  }
  setFilm();
  const grain = mobile ? null : grainPass();

  // ---------- layout ----------
  let width = 0, height = 0;
  const lens = new THREE.Vector3(), box = new THREE.Box3(), v3 = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(screenCentre.x + x * S.width / 2, screenCentre.y + y * S.height / 2, screenCentre.z + 0.01));
  function placeRoom() {
    const [px, py, pz] = CONFIG.projectorAt;
    rig.position.set(px, py, pz);
    rig.scale.setScalar(CONFIG.projectorSize);
    const dx = screenCentre.x - px, dz = screenCentre.z - pz, dy = screenCentre.y - (py + 0.212 * CONFIG.projectorSize);
    rig.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)) * 0.9, 'YZX');
    stand.scale.set(1, py, 1); stand.position.set(px, py / 2, pz);
    scene.updateMatrixWorld(true);
    projector.lens(lens);
    beam.aim(lens, corners);
    dust.aim(beam.corners.from, corners);
    keyLight.position.set(px + 1.2, py + 3.4, pz + 2.2); keyLight.target.position.set(px, py + 0.3, pz);
    beamLight.position.copy(lens); beamLight.target.position.copy(screenCentre);
  }
  placeRoom();
  function placeButton() {
    // the projector's button sits over the projector on the canvas
    box.setFromObject(projector.root);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v3.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      const x = (v3.x * 0.5 + 0.5) * width, y = (0.5 - v3.y * 0.5) * height;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width, x1); y1 = Math.min(height, y1);      // the part in the picture
    const w = Math.max(44, x1 - x0), h = Math.max(44, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    stage.style.setProperty('--proj-x', (cx - w / 2).toFixed(1) + 'px');
    stage.style.setProperty('--proj-y', Math.min(height - h, cy - h / 2).toFixed(1) + 'px');
    stage.style.setProperty('--proj-w', w.toFixed(1) + 'px');
    stage.style.setProperty('--proj-h', h.toFixed(1) + 'px');
  }
  function resize(force) {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h || (!force && w === width && h === height)) return;
    width = w; height = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.performance.maxDpr));
    renderer.setSize(w, h, false);
    const L = layoutFor(w / h);
    camera.fov = L.fov; camera.aspect = w / h;
    camera.position.fromArray(L.eye); camera.lookAt(new THREE.Vector3().fromArray(L.look));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const pixels = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(L.fov / 2)));
    dust.uniforms.uScale.value = pixels * 0.012;
    placeButton();
  }

  // ---------- one frame ----------
  let last = 0, raf = 0, visible = false, clock = 0, held = false, lastPlace = null, beamLevel = 0, reelSpeed = 0, lamp = 0;
  const stats = { frames: 0, fps: 0, acc: 0, n: 0 };
  function flickerLamp(t) {
    if (reduce.matches) return 1;
    if (t < CONFIG.lamp) return [1, 0, 1, 0.3, 1][Math.floor(t / CONFIG.lamp * 5)];
    return 1;
  }
  function frame(dt) {
    if (!paused && !held) seqT += dt;
    clock += reduce.matches ? 0 : dt;
    let bright = 0, mode = 0;
    if (state === 'warm') {
      lamp = flickerLamp(seqT);
      reelSpeed = smooth(0, CONFIG.reelSpinUp, seqT);
      beamLevel = smooth(CONFIG.lamp, CONFIG.lamp + CONFIG.beamRise, seqT) * lamp;
      bright = beamLevel; mode = 2;
      if (seqT >= CONFIG.lamp + CONFIG.beamRise) go('count');
    } else if (state === 'count') {
      lamp = 1; reelSpeed = 1; beamLevel = 1; bright = 1;
      leader.draw(Math.min(seqT, CONFIG.countdown - 0.001));
      if (seqT >= CONFIG.countdown) go('play');
    } else if (state === 'play') {
      lamp = 1; reelSpeed = paused ? 0 : 1; beamLevel = 1; bright = 1; mode = 1;
      if (card) card.draw();
    } else if (state === 'cool') {
      const k = 1 - smooth(0, CONFIG.fadeOut, seqT);
      lamp = k; reelSpeed = k; beamLevel = k; bright = k; mode = 1;
      if (seqT >= CONFIG.fadeOut) { go('off'); if (ended) setStatus('ended'); }
    } else {
      lamp = 0; reelSpeed = 0; beamLevel = 0; bright = 0;
    }
    if (paused && state !== 'play') reelSpeed = 0;
    if (state !== 'off' && !paused) sound.run(reelSpeed); else sound.run(0);
    projector.update(dt, reelSpeed, lamp);
    beam.uniforms.uIntensity.value = beamLevel;
    beam.uniforms.uTime.value = clock;
    dust.uniforms.uIntensity.value = beamLevel;
    dust.uniforms.uTime.value = clock;
    scr.uniforms.uBright.value = bright;
    scr.uniforms.uMode.value = mode;
    scr.uniforms.uTime.value = clock;
    scr.uniforms.uFlicker.value = reduce.matches ? 0 : 1;
    screenLight.intensity = 9 * bright;
    beamLight.intensity = 2.2 * beamLevel;
    keyLight.intensity = 30 * (1 - 0.5 * beamLevel);
    // the player follows the film's own clock
    const c = clip(), p = player[c.member];
    const t = media.currentTime || 0;
    const place = placeAt(state === 'play' || state === 'cool' ? t : -1, c, p || { height: 1.75, durations: { emerge: 1, solo: 3, return: 1 } },
      { centre: screenCentre, width: S.width, height: S.height }, !reduce.matches && !!p);
    for (const q of players) if (q) q.holder.visible = false;
    if (p) applyPlace(p, place, 0.55 * beamLevel);
    if (place.ripple >= 0) {
      const sp = c.screenPos;
      scr.uniforms.uRipple.value.set(0.5 + sp[0], 0.5 + sp[1] + c.screenScale * 0.45, reduce.matches ? -1 : place.ripple);
    } else scr.uniforms.uRipple.value.z = -1;
    lastPlace = place;
    renderer.clear();
    renderer.render(scene, camera);
    if (grain && state !== 'off') {
      grain.uniforms.uTime.value = reduce.matches ? 0 : Math.floor(clock * 24) / 24;
      grain.uniforms.uAmount.value = 0.05 + 0.03 * beamLevel;
      renderer.render(grain.scene, grain.camera);
    }
    stats.frames++;
  }
  function needsLoop() { return alive && visible && !document.hidden && (state !== 'off' || dust.uniforms.uIntensity.value > 0); }
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
  wake = function () {
    if (!alive || raf) return;
    if (!visible || document.hidden) return;
    raf = requestAnimationFrame(tick);
  };
  function drawOnce() { if (alive && visible && !document.hidden) { resize(); frame(0); } }

  // ---------- page wiring ----------
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) wake(); }, { threshold: 0.01 });
  const ro = new ResizeObserver(() => { if (!raf) drawOnce(); });
  const onVisibility = () => { if (!document.hidden) wake(); };
  const onMotion = () => wake();
  document.addEventListener('visibilitychange', onVisibility);
  reduce.addEventListener('change', onMotion);
  const onLost = (e) => { e.preventDefault(); destroy(); showPoster(); stage.dataset.scene = 'plain'; plain = true; };
  canvas.addEventListener('webglcontextlost', onLost);

  function destroy() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    reduce.removeEventListener('change', onMotion);
    sound.dispose();
    projector.dispose();
    players.forEach((p) => p && p.dispose());
    disposables.forEach((d) => d && d.dispose && d.dispose());
    if (filmTexture && filmTexture.dispose) filmTexture.dispose();
    if (grain) grain.dispose();
    seats.dispose();
    envMap.dispose();
    renderer.dispose();
    canvas.remove();
  }

  const api = {
    destroy, press, setPaused,
    clip, media: () => media, phase: () => (lastPlace ? lastPlace.phase : 'screen'),
    seek(t) { media.currentTime = Math.max(0, t); drawOnce(); },
    changed() { drawOnce(); },
    state: () => ({
      state, paused, seqT: +seqT.toFixed(3), time: +(media.currentTime || 0).toFixed(3), muted: media.muted, film: card ? 'stand-in' : 'video',
      reduced: reduce.matches, mobile, dpr: renderer.getPixelRatio(), size: [width, height], fps: Math.round(stats.fps), frames: stats.frames,
      grain: !!grain, dust: dust.points.geometry.attributes.seed.count, running: !!raf, visible,
      player: lastPlace ? { visible: lastPlace.visible, phase: lastPlace.phase, ripple: lastPlace.ripple,
        position: lastPlace.position ? lastPlace.position.toArray().map((x) => +x.toFixed(3)) : null, scale: lastPlace.scale ? +lastPlace.scale.toFixed(3) : null } : null,
      models: Object.fromEntries(members.map((m) => [m, !!player[m]])),
      beam: +beamLevel.toFixed(3), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    }),
    // for the checks: hold the sequence clock still (captures), and put the scene in a given state without waiting
    hold(on) { held = !!on; },
    jump(next, at = 0) { paused = false; if (next === 'play') { state = 'play'; seqT = 0; media.currentTime = at; } else { go(next); seqT = at; } setPressed(); drawOnce(); },
    // screen position of the 3D player's head (for the checks)
    playerScreen() {
      const p = player[clip().member];
      if (!p || !p.holder.visible) return null;
      box.setFromObject(p.holder);
      const c = box.getCenter(new THREE.Vector3()).project(camera);
      return [(c.x * 0.5 + 0.5) * width, (0.5 - c.y * 0.5) * height];
    },
  };

  // ---------- show it ----------
  stage.insertBefore(canvas, stage.firstChild);
  resize(true);
  await renderer.compileAsync(scene, camera);
  if (!alive) return api;
  visible = true;
  frame(0);
  stage.dataset.scene = '3d';
  const poster = stage.querySelector('.screening-poster');
  if (poster) poster.setAttribute('aria-hidden', 'true');
  io.observe(section);
  ro.observe(stage);
  section.__screening = api;
  bindButtons();
  setPressed();
  if (params.get('debug') === 'cues') import('./debugCues.js').then((m) => m.mountCueDebugger(section, api));
  if (section.dataset.pending === 'play') { delete section.dataset.pending; press(); }
  return api;
}
