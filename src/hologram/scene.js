// So What: first screen — a vintage projector throws a hologram of a jazz trio (rq-20260930-409ebb88, rq-20260930-42db6df6).
// The page opens on a still picture of this scene at its first frame (.hero-poster). The gate script in index.html imports this
// module (desktop: at idle time after load; phones: after the first input) and the canvas fades in over the still, same frame.
// - Models: public/models/*.glb (Blender, Draco). A player whose file fails is replaced by a stand-in made of primitives.
// - Theme: ?theme=site | reggae (config.js).
// - Quality: high / medium / low, picked from the frame time measured here, stepped down if the machine cannot keep up.
// - Draws only while the first screen is on screen, the tab is visible, the comic book is not being turned and it is not paused.
// - Reduced motion: one still frame, the saxophonist at the front. No parallax, no dolly, no glitch, no loop.
// - No WebGL, a software renderer, a lost context or a machine too slow even for "low": the still picture stays.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '../../vendor/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from '../../vendor/jsm/environments/RoomEnvironment.js';
import { CONFIG, orbitProgress } from './config.js';
import { createHologramClock } from './hologramMaterial.js';
import { loadMusician } from './musicians.js';
import { loadProjector } from './projector.js';
import { createFloor, createWall, createBeam, createMotes, createNotes, createPost } from './effects.js';

const hero = document.querySelector('.hero');
const book = document.querySelector('.book');
const LABEL = 'A vintage film projector casts a hologram of three jazz musicians: a saxophonist, a bassist and a singer, turning on a carousel.';
let activating = false;

export function activate() {
  if (activating || !hero || hero.dataset.scene !== 'static') return Promise.resolve();
  activating = true;
  const gate = hero.__gate || (hero.__gate = {});
  gate.moduleAt = performance.now();
  return start(gate).catch((e) => { console.warn('hologram scene:', e); fallBack('error'); });
}

function remember(why) { try { sessionStorage.setItem('sowhat-hero-gl', why); } catch (e) { /* private mode: ask again next time */ } }

function fallBack(why) {
  if (hero.__scene) hero.__scene.destroy();
  hero.dataset.scene = 'static';
  hero.dataset.sceneWhy = why;
}

// the WebGL context for the scene, and whether it runs on a real GPU. Asked once, on the canvas the renderer will use.
function openContext(canvas, gate) {
  const opts = { antialias: false, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true };
  let gl = null;
  try { gl = canvas.getContext('webgl2', opts); } catch (e) { gl = null; }
  if (!gl) return { gl: null, why: 'no-webgl' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  gate.renderer = name.slice(0, 80);
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) {
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { gl: null, why: 'software' };
  }
  return { gl, why: '' };
}

// Where things stand, for the three shapes of the first screen (16:9, 4:3, 4:5 — style.css).
function layoutFor(aspect) {
  if (aspect >= 1.55) return { fov: 28, eye: [0.15, 1.5, 8.4], look: [0.15, 1.25, 0], centre: [1.95, 0.5, 0], radius: CONFIG.orbit.radius, size: 1.0,
    projector: [-2.35, 0.72, 0.8], projectorSize: 2.1, table: [1.5, 0.72, 1.05] };
  if (aspect >= 1.0) return { fov: 32, eye: [0.0, 1.55, 9.6], look: [0.0, 1.3, 0], centre: [1.5, 0.5, 0], radius: CONFIG.orbit.radius * 0.9, size: 1.0,
    projector: [-2.2, 0.72, 0.8], projectorSize: 1.9, table: [1.4, 0.72, 1.0] };
  return { fov: 36, eye: [0.0, 1.75, 9.2], look: [0.0, 1.6, 0], centre: [0.42, 1.0, 0], radius: CONFIG.orbit.radius * 0.72, size: 0.95,
    projector: [-1.05, 0.5, 2.0], projectorSize: 1.5, table: [1.1, 0.5, 0.8] };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const nextTask = () => new Promise((r) => setTimeout(r, 0));

async function start(gate) {
  await nextTask();
  const canvas = document.createElement('canvas');
  const ctx = openContext(canvas, gate);
  if (!ctx.gl) { remember(ctx.why); fallBack(ctx.why); return; }

  const Q = CONFIG.quality;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const mobile = window.matchMedia('(max-width: ' + CONFIG.performance.mobileBreakpoint + 'px)').matches;
  const best = mobile ? 'medium' : 'high';       // phones and narrow windows never get the bloom or the mirror pass
  let tier = best, tierWhy = 'start';

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, context: ctx.gl, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false;
  renderer.setClearColor(new THREE.Color(CONFIG.palette.bg), 1);
  canvas.className = 'hero-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', LABEL);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.palette.bg);
  const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 60);

  // ---------- light: a dim room. The metal picks up a studio-like environment, a key light falls on the projector,
  // and the hologram itself lights the floor and the projector a little (it flickers with the hologram) ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  scene.environment = envMap;
  scene.environmentIntensity = 0.5;
  const key = new THREE.SpotLight(new THREE.Color(CONFIG.palette.key), 90, 14, 0.5, 0.7, 2);
  const holoLight = new THREE.PointLight(new THREE.Color(CONFIG.palette.holo), 10, 12, 2);
  const sky = new THREE.Color(CONFIG.palette.bg).multiplyScalar(2.2), ground = new THREE.Color(CONFIG.palette.table).multiplyScalar(0.5);
  scene.add(key, key.target, holoLight, new THREE.HemisphereLight(sky, ground, 0.6));

  // ---------- models ----------
  const draco = new DRACOLoader().setDecoderPath(CONFIG.draco);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const clock = createHologramClock();
  const [projector, ...musicians] = await Promise.all([loadProjector(loader), ...CONFIG.orbit.order.map((k) => loadMusician(k, loader, clock))]);
  draco.dispose();
  gate.modelsAt = performance.now();

  const stage = new THREE.Group();            // the carousel
  musicians.forEach((m) => stage.add(m.root));
  const rig = new THREE.Group();              // projector on its table
  rig.add(projector.root);
  const tableMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.palette.table), roughness: 0.62, metalness: 0.05 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tableMat);
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tableMat);
  scene.add(stage, rig, table, tableTop);

  // ---------- room and effects ----------
  const wall = createWall();
  const beam = createBeam(clock);
  const motes = createMotes(clock);
  const notes = createNotes(clock, 30);
  scene.add(wall.mesh, beam.mesh, motes.points, notes.points);
  const mirror = new THREE.Matrix4().makeScale(1, -1, 1);      // the floor is y = 0
  let floor = null, post = null, copies = null;

  // ---------- layout ----------
  let L = layoutFor(16 / 9), width = 0, height = 0;
  const centre = new THREE.Vector3(), look = new THREE.Vector3(), eye = new THREE.Vector3(), lens = new THREE.Vector3(), aim = new THREE.Vector3();
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, CONFIG.performance.maxDpr, Q[tier].dpr);
  function resize(force) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (!force && w === width && h === height)) return false;
    width = w; height = h;
    const dpr = pixelRatio();
    renderer.setPixelRatio(dpr);
    post.setSize(w, h);
    L = layoutFor(w / h);
    camera.fov = L.fov; camera.aspect = w / h; camera.updateProjectionMatrix();
    centre.fromArray(L.centre); look.fromArray(L.look); eye.fromArray(L.eye);
    // projector on its table, turned (and tipped up a little) toward the middle of the hologram
    const [px, py, pz] = L.projector;
    rig.position.set(px, py, pz);
    rig.scale.setScalar(L.projectorSize);
    aim.set(centre.x, centre.y + 1.0 * L.size, centre.z);
    const dx = aim.x - px, dy = aim.y - (py + 0.212 * L.projectorSize), dz = aim.z - pz;
    rig.rotation.set(0, Math.atan2(-dz, dx), Math.min(0.16, Math.atan2(dy, Math.hypot(dx, dz))), 'YZX');
    const [tw, th, td] = L.table;
    table.scale.set(tw * 0.9, th - 0.05, td * 0.9); table.position.set(px - 0.1, (th - 0.05) / 2, pz);
    tableTop.scale.set(tw, 0.05, td); tableTop.position.set(px - 0.1, th - 0.025, pz);
    table.rotation.y = tableTop.rotation.y = rig.rotation.y;
    scene.updateMatrixWorld(true);
    projector.lens(lens);
    beam.aim(lens, aim, L.radius * 1.12 * L.size);
    key.position.set(px - 0.6, py + 3.2, pz + 2.4); key.target.position.set(px, py + 0.5, pz);
    holoLight.position.set(centre.x, centre.y + 1.1, centre.z + 0.4);
    motes.points.position.set(centre.x, centre.y - 0.1, centre.z);
    const pixels = h * dpr / (2 * Math.tan(THREE.MathUtils.degToRad(L.fov / 2)));   // world size -> point size in pixels
    beam.resize(pixels / Math.max(L.radius * L.size, 0.5)); motes.resize(pixels, L.radius * L.size); notes.resize(pixels);
    floor.resize(w * dpr, h * dpr);
    floor.set({ glowAt: centre, lampAt: rig.position }); wall.set({ glowAt: aim, lampAt: rig.position });
    return true;
  }

  // ---------- quality: what a step switches on and off. Rebuilt in place, the scene keeps running ----------
  function applyTier(name, why) {
    tier = name; tierWhy = why;
    const q = Q[tier];
    if (floor) floor.dispose();
    floor = createFloor({ reflect: q.mirror, renderer });
    scene.add(floor.mesh);
    if (q.copies && !copies) copies = musicians.flatMap((m) => m.addReflection(scene, mirror));
    musicians.forEach((m) => { m.setReflection(q.copies); m.setLines(q.lines); });
    beam.setShare(q.particles); motes.setShare(q.particles);
    if (post) post.dispose();
    post = createPost(renderer, scene, camera, { bloom: q.bloom, smaa: q.smaa });
    post.select([...musicians.flatMap((m) => m.glow()), ...projector.glow, motes.points, notes.points]);
    hero.dataset.quality = tier;
    width = height = 0;                     // sizes depend on the step's pixel ratio
  }
  function stepDown(count, why) {
    const i = Q.order.indexOf(tier), j = Math.min(Q.order.length - 1, i + count);
    if (j === i) return false;
    applyTier(Q.order[j], why);
    resize(true);
    measure.reset();
    return true;
  }
  // frame time: the first seconds decide the starting step; after that a rolling average keeps watch
  const measure = {
    since: 0, sum: 0, n: 0, settled: false, last: 0,
    reset() { this.since = 0; this.sum = 0; this.n = 0; },
    add(dt) {
      if (dt <= 0 || dt > 0.25) return;                     // a pause, a hidden tab: not a frame time
      this.since += dt; this.sum += dt; this.n++;
      const window = this.settled ? Q.watchSeconds : Q.settleSeconds;
      if (this.since < window) return;
      const ms = this.sum / this.n * 1000;
      this.last = ms;
      if (!this.settled) {
        this.settled = true;
        if (ms > Q.settleDownTwo) stepDown(2, 'settle ' + ms.toFixed(1) + 'ms');
        else if (ms > Q.settleDown) stepDown(1, 'settle ' + ms.toFixed(1) + 'ms');
      } else if (ms > Q.watchDown) {
        if (!stepDown(1, 'watch ' + ms.toFixed(1) + 'ms') && ms > 66) { remember('slow'); fallBack('slow'); return; }   // already on "low" and under 15fps
      }
      this.reset();
    },
  };

  // ---------- one frame ----------
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const stats = { fps: 0, calls: 0, triangles: 0, frames: 0 };
  const emitted = musicians.map(() => -1);
  const tmp = new THREE.Vector3();
  let time = 0, last = 0, paused = false, front = CONFIG.orbit.order[0], view = null;

  function frame(dt) {
    const still = reduce.matches;
    const t = still ? 0 : time;
    const beatNow = t * CONFIG.music.bpm / 60;
    const flick = still ? 1 : 1 - CONFIG.hologram.flicker * (0.5 + 0.5 * Math.sin(t * 37.0) * Math.sin(t * 11.3 + 1.7));
    const glitch = !still && t > 1 && (t % CONFIG.hologram.glitchEvery) < CONFIG.hologram.glitchDuration ? 1 : 0;
    clock.uTime.value = t; clock.uFlicker.value = flick * (glitch ? 0.72 : 1); clock.uGlitch.value = glitch;

    // carousel: one player comes to the front every few seconds and rests there for a moment
    const prog = orbitProgress(t), n = musicians.length;
    let nearest = -1;
    musicians.forEach((m, i) => {
      const a = (i - prog) * Math.PI * 2 / n, depth = 0.5 + 0.5 * Math.cos(a);
      const s = (0.6 + 0.4 * Math.pow(depth, 1.3)) * L.size;
      const y = centre.y + Math.sin(t * 0.9 + i * 2.1) * 0.025;
      m.root.position.set(centre.x + Math.sin(a) * L.radius, y, centre.z + Math.cos(a) * L.radius);
      m.root.scale.setScalar(s);
      m.root.rotation.y = t * Math.PI * 2 / CONFIG.spin.secondsPerTurn + i * 2.1;
      const presence = smooth(0.5, 1.0, depth);
      m.state.uOpacity.value = 0.16 + 0.84 * presence;      // behind: small and almost gone
      m.state.uReveal.value = smooth(0.62, 0.985, depth);    // arriving: drawn in from the feet up; leaving: undone from the head down
      m.state.uBase.value = y; m.state.uBaseMirror.value = -y; m.state.uHeight.value = 1.98 * s;
      m.update(t, beatNow);
      if (depth > nearest) { nearest = depth; front = m.key; }
      // a note on every beat, louder from whoever is at the front
      const b = Math.floor(beatNow + i / n);
      if (!still && b !== emitted[i]) {
        emitted[i] = b;
        if (presence > 0.25 && t > 0.05) { stage.updateMatrixWorld(true); notes.emit(m.emitPoint(tmp), t, presence); }
      }
    });
    notes.update(t, L.size);
    projector.update(t, flick);
    holoLight.intensity = 10 * flick * (glitch ? 1.5 : 1);
    floor.set({ glow: flick * (glitch ? 1.4 : 1) }); wall.set({ glow: flick });
    post.glitch(glitch);

    // camera: a slow breath in and out (if the theme has it), and a small lean after the mouse
    if (view) {
      camera.position.fromArray(view.eye); camera.lookAt(tmp.fromArray(view.look));
    } else {
      pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3.5); pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3.5);
      const limit = THREE.MathUtils.degToRad(CONFIG.camera.parallaxDeg);
      const yaw = still ? 0 : -pointer.sx * limit, pitch = still ? 0 : pointer.sy * limit;
      const dolly = still || !CONFIG.camera.dolly ? 1 : 1 + 0.028 * Math.sin(t * Math.PI * 2 / CONFIG.camera.dollySeconds);
      tmp.copy(eye).sub(look).multiplyScalar(dolly).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      tmp.y += Math.sin(pitch) * tmp.length();
      camera.position.copy(look).add(tmp);
      camera.lookAt(look);
    }

    renderer.info.reset();
    floor.newFrame();
    post.render(dt);
    stats.calls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles;
  }

  // ---------- loop: only while there is something to see ----------
  let raf = 0, visible = false, alive = true;
  const bookBusy = () => !!(book && book.dataset.state && book.dataset.state !== 'idle');
  function tick(now) {
    raf = 0;
    if (!alive) return;
    const real = last ? (now - last) / 1000 : 0;
    const dt = Math.min(0.1, real || 1 / 60);
    last = now;
    if (!bookBusy()) {
      if (!paused) time += dt;
      resize();
      frame(dt);
      stats.frames++;
      stats.fps += ((1 / Math.max(real || dt, 1e-3)) - stats.fps) * (stats.frames < 10 ? 0.5 : 0.06);
      if (stats.frames > 3) measure.add(real);
      if (!alive) return;
    } else {
      last = 0;
    }
    schedule();
  }
  function running() { return alive && visible && !document.hidden && !paused && !reduce.matches; }
  function schedule() { if (!raf && running()) raf = requestAnimationFrame(tick); }
  function drawOnce() { if (alive && visible && !document.hidden) { last = 0; resize(); frame(0); } }
  function wake() { last = 0; if (running()) schedule(); else drawOnce(); }

  // ---------- page wiring ----------
  const toggle = hero.querySelector('.scene-toggle');
  function setPaused(p) {
    paused = p;
    if (toggle) { toggle.textContent = paused ? 'Play animation' : 'Pause animation'; toggle.setAttribute('aria-pressed', paused ? 'true' : 'false'); }
    hero.dataset.motion = paused ? 'paused' : 'playing';
    wake();
  }
  const onToggle = () => setPaused(!paused);
  const onHeroClick = (e) => { if (!e.target.closest('a,button')) setPaused(!paused); };
  const onMove = (e) => {
    if (e.pointerType !== 'mouse' || !finePointer.matches) return;
    const r = canvas.getBoundingClientRect();
    pointer.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    pointer.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const onLost = (e) => { e.preventDefault(); fallBack('context-lost'); };
  const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; wake(); }, { threshold: 0.02 });
  const ro = new ResizeObserver(() => { if (!running()) drawOnce(); });
  const onVisibility = () => wake();
  const onMotion = () => wake();
  const onLeave = () => destroy();

  function destroy() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    if (toggle) { toggle.removeEventListener('click', onToggle); toggle.hidden = true; }
    hero.removeEventListener('click', onHeroClick);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', onVisibility);
    reduce.removeEventListener('change', onMotion);
    window.removeEventListener('pagehide', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    // free the GPU: geometries, materials, textures, render targets, then the context itself
    musicians.forEach((m) => m.dispose());
    projector.dispose();
    [floor, wall, beam, motes, notes, post].forEach((x) => x && x.dispose());
    table.geometry.dispose(); tableTop.geometry.dispose(); tableMat.dispose();
    envMap.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    hero.__scene = null;
    delete hero.dataset.quality;
    const poster = hero.querySelector('.hero-poster');
    if (poster) poster.removeAttribute('aria-hidden');
  }

  hero.__scene = {
    destroy,
    state: () => ({
      scene: hero.dataset.scene, theme: CONFIG.theme, time, paused, front, mobile, reduced: reduce.matches, running: running(),
      fps: Math.round(stats.fps), calls: stats.calls, triangles: stats.triangles, frames: stats.frames,
      quality: tier, qualityWhy: tierWhy, best, settled: measure.settled, frameMs: +measure.last.toFixed(1),
      dpr: renderer.getPixelRatio(), size: [width, height], sources: Object.fromEntries(musicians.map((m) => [m.key, m.source]).concat([['projector', projector.source]])),
      reveal: Object.fromEntries(musicians.map((m) => [m.key, +m.state.uReveal.value.toFixed(3)])),
      opacity: Object.fromEntries(musicians.map((m) => [m.key, +m.state.uOpacity.value.toFixed(3)])),
      step: CONFIG.orbit.secondsPerMusician, glitchEvery: CONFIG.hologram.glitchEvery, dolly: CONFIG.camera.dolly,
      palette: { holo: CONFIG.palette.holo, bg: CONFIG.palette.bg, rasta: CONFIG.palette.rasta },
      glitch: clock.uGlitch.value, gate,
    }),
    // for the checks and the close-up captures
    seek: (seconds) => { time = seconds; emitted.fill(-1); drawOnce(); },
    setQuality: (name) => { applyTier(name, 'forced'); resize(true); measure.reset(); measure.settled = true; drawOnce(); },
    // pretend frames took this long (fresh = as if the scene had only just started, before it has settled on a step)
    feed: (ms, seconds, fresh) => { if (fresh) { measure.settled = false; measure.reset(); } for (let s = 0; s < seconds && alive; s += ms / 1000) measure.add(ms / 1000); if (alive) drawOnce(); },
    lines: (on) => { musicians.forEach((m) => m.setLines(on)); drawOnce(); },
    view: (eyeAt, lookAt) => { view = eyeAt ? { eye: eyeAt, look: lookAt } : null; drawOnce(); },
    // the outline segments of a player's body between two heights (model space, metres), for diagnosing stray lines
    edges: (key, y0, y1) => {
      const m = musicians.find((x) => x.key === key), p = m.lines[0].geometry.attributes.position, out = [];
      for (let i = 0; i < p.count; i += 2) {
        const ya = p.getY(i), yb = p.getY(i + 1);
        if (Math.min(ya, yb) >= y0 && Math.max(ya, yb) <= y1) out.push([p.getX(i), ya, p.getZ(i), p.getX(i + 1), yb, p.getZ(i + 1)].map((v) => +v.toFixed(3)));
      }
      return { total: p.count / 2, dropped: m.lines[0].geometry.userData.dropped, inRange: out };
    },
    front: (key) => { const m = musicians.find((x) => x.key === key); return m ? m.root.position.toArray().concat(m.root.scale.x) : null; },
  };

  // ---------- show it: the canvas is put in empty, everything is compiled, then it fades in over the still picture ----------
  const picture = hero.querySelector('picture');
  hero.insertBefore(canvas, picture ? picture.nextSibling : hero.firstChild);
  applyTier(best, 'start');
  resize(true);
  await renderer.compileAsync(scene, camera);
  if (!alive) return;
  frame(0);                                      // t = 0: the frame the still picture was taken from
  gate.shownAt = performance.now();
  hero.dataset.scene = '3d';                     // style.css: .hero[data-scene="3d"] .hero-canvas fades in over 0.6s
  const poster = hero.querySelector('.hero-poster');
  if (poster) poster.setAttribute('aria-hidden', 'true');   // the canvas carries the description now
  if (toggle) { toggle.hidden = false; toggle.addEventListener('click', onToggle); }
  hero.addEventListener('click', onHeroClick);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reduce.addEventListener('change', onMotion);
  window.addEventListener('pagehide', onLeave);
  canvas.addEventListener('webglcontextlost', onLost);
  io.observe(hero);
  ro.observe(hero);
  setPaused(false);
}
