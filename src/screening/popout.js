// The frontman leaves the film through its top edge and comes back the same way (public/models/cartoon/frontman.glb,
// blender/cartoon/build_frontman.py). Everything here is a function of the film's clock — the same time gives the same picture,
// whether it got there by playing, pausing, seeking or a tab coming back.
//
//   exitAt .. +0.6 s        exit_leap: from just behind the screen at exitX, head at the top edge, at the 2D size (exitScale),
//                           he springs up and out (+y, +z) into the room left above the screen; an ink puff hides the swap
//   .. +0.7 s               an arc down toward the audience to the hover place (65% of the screen's height, halfway to the
//                           projector, in the beam), turning to the camera
//   .. returnAt - 1.1 s     solo, floating and bobbing
//   .. returnAt             return_dive: a crouch, a leap up over the top edge at returnX, then feet first down and back
//                           through the screen's surface — the clipping plane takes him from the feet up, and at returnAt the
//                           2D feet appear at the same place. An ink puff and rings on the screen at that spot.
// He is drawn only in [exitAt, returnAt + 0.15]; the 2D frontman is out of the picture for all of that time, so the two are
// never both whole on screen. `filmness` (1 at the screen, 0.25 in the air) sets how much film look he carries and steps his
// pose on twos (12 fps) near the screen; the path itself is always smooth.
import * as THREE from 'three';
import { CONFIG, SCREENING } from './config.js';

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const BPM = 160;

// ---------------------------------------------------------------- ink puff (drawn like the film's own smoke)
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.lineWidth = 5; g.strokeStyle = '#1d1d1f'; g.fillStyle = '#e8e4da';
  const blobs = [[128, 92, 46], [84, 104, 34], [172, 104, 36], [104, 70, 30], [154, 66, 32], [128, 124, 30]];
  for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  for (const [x, y, r] of blobs) { g.beginPath(); g.arc(x, y, r, Math.PI * 0.9, Math.PI * 2.1); g.stroke(); }
  g.lineWidth = 3.5;                                                   // wavy stems under the cloud
  for (const x0 of [108, 132, 154]) {
    g.beginPath();
    for (let y = 140; y < 240; y += 4) { const x = x0 + Math.sin(y / 9 + x0) * 7; if (y === 140) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPuffs() {
  const map = puffTexture();
  const mats = [0, 1].map(() => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  const sprites = mats.map((m) => { const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 4; return s; });
  return {
    sprites,
    /** i: which puff, at: world position, age: 0..1 (else hidden), size: metres */
    set(i, at, age, size) {
      const s = sprites[i];
      s.visible = age >= 0 && age < 1;
      if (!s.visible) return;
      s.position.copy(at);
      s.scale.setScalar(size * (0.6 + 0.7 * easeOut(age)));
      mats[i].opacity = age < 0.15 ? 1 : 1 - smooth(0.15, 1, age);
    },
    dispose() { map.dispose(); mats.forEach((m) => m.dispose()); },
  };
}

// ---------------------------------------------------------------- the model
export async function loadFrontman(loader, ink) {
  const gltf = await loader.loadAsync(CONFIG.models.frontman);
  const greys = SCREENING.popout.greys;
  const made = {}, outline = ink.outline(), meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const old = Array.isArray(o.material) ? o.material : [o.material];
    const mats = old.map((m) => made[m.name] || (made[m.name] = ink.toon(greys[m.name] !== undefined ? greys[m.name] : 0.6)));
    old.forEach((m) => m.dispose());
    o.material = Array.isArray(o.material) ? mats : mats[0];
    o.frustumCulled = false;
    const hull = o.clone();
    hull.material = outline;
    hull.renderOrder = -1;
    o.parent.add(hull);
  }
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const height = box.max.y - box.min.y;
  const holder = new THREE.Group();
  holder.add(gltf.scene);
  holder.visible = false;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = {};
  for (const n of ['exit_leap', 'solo', 'return_dive']) {
    const clip = gltf.animations.find((a) => a.name === n);
    if (!clip) throw new Error('frontman.glb has no "' + n + '" action');
    const a = mixer.clipAction(clip);
    a.setLoop(n === 'solo' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.play();
    actions[n] = a;
  }
  return {
    holder, mixer, actions, height, materials: Object.values(made).concat(outline),
    durations: Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, a.getClip().duration])),
    dispose() { mixer.stopAllAction(); holder.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); Object.values(made).forEach((m) => m.dispose()); outline.dispose(); holder.removeFromParent(); },
  };
}

/**
 * Where he is at film time t. fit: stage.fit() (camera distance, hover place), S: screen size, model: { height, durations }.
 * Returns { visible, phase, position, scale, rot, weights, times, filmness, puffs: [exit age, return age], ripple, exitPt, retPt }.
 */
export function placeAt(t, fit, S, model, motion = true) {
  const P = SCREENING.popout;
  const res = { visible: false, phase: 'screen', ripple: -1, puffs: [-1, -1], filmness: 1 };
  const headroom = fit.headroom * 2 * fit.D * fit.tv;                 // metres of room above the screen top, at the screen
  const exitPt = new THREE.Vector3(P.exitX * S.W, S.top, 0.04), retPt = new THREE.Vector3(P.returnX * S.W, S.top, 0.04);
  res.exitPt = exitPt; res.retPt = retPt;
  if (!motion) return res;
  res.puffs = [(t - P.exitAt) / CONFIG.puff, (t - (P.returnAt - 0.12)) / CONFIG.puff];
  if (t >= P.returnAt - 0.1 && t < P.returnAt - 0.1 + CONFIG.ripple) res.ripple = (t - (P.returnAt - 0.1)) / CONFIG.ripple;
  if (t < P.exitAt || t >= P.returnAt + CONFIG.visibleAfterReturn) return res;

  const h0 = P.exitScale * S.H, k0 = h0 / model.height;
  const kH = Math.min(h0, fit.hoverHeight) / model.height;
  const hover = fit.hover;
  const tExitEnd = P.exitAt + CONFIG.exitLeap, tHover = tExitEnd + CONFIG.toHover, tRet = P.returnAt - CONFIG.returnDive;
  const pos = new THREE.Vector3(), rot = [0, 0, 0];
  let k, phase;
  // the apex over the screen, a little toward the audience — as high as he can go with his head still inside the canvas
  // (he is taller than the room above the screen, so he also shrinks toward his hover size on the way)
  const apexZ = hover.z * 0.3, kApex = Math.min(kH, k0);
  const apex = new THREE.Vector3(THREE.MathUtils.lerp(exitPt.x, hover.x, 0.3), 0, apexZ);
  apex.y = Math.min(S.top + headroom * 0.45, fit.yAt(0.94, apexZ) - model.height * kApex);
  // over the top edge on the way back: feet just under the edge, and small enough that his head stays in the canvas
  const overZ = hover.z * 0.3;
  const overFeet = S.top - 0.04 * S.H;
  const kOver = Math.min(kH, (fit.yAt(0.94, overZ) - overFeet) / model.height);
  if (t < tExitEnd) {
    const s = (t - P.exitAt) / CONFIG.exitLeap;
    const start = new THREE.Vector3(exitPt.x, S.top - h0, -0.2);
    pos.set(THREE.MathUtils.lerp(start.x, apex.x, easeOut(s)), THREE.MathUtils.lerp(start.y, apex.y, 1 - Math.pow(1 - s, 2.2)), THREE.MathUtils.lerp(start.z, apex.z, easeOut(s)));
    k = THREE.MathUtils.lerp(k0, kApex, smooth(0.1, 0.8, s));
    phase = 'exit';
  } else if (t < tHover) {
    const s = easeInOut((t - tExitEnd) / CONFIG.toHover);
    pos.lerpVectors(apex, hover, s);
    pos.y += Math.sin(Math.PI * s) * headroom * 0.25;                  // the arc toward the audience
    k = kH;
    phase = 'air';
  } else if (t < tRet) {
    const beat = (t - tHover) * BPM / 60;
    pos.copy(hover);
    pos.y += 0.035 * S.H * Math.sin(Math.PI * beat / 2);
    rot[1] = 0.16 * Math.sin(Math.PI * beat / 4);
    k = kH;
    phase = 'solo';
  } else {
    const s = (t - tRet) / CONFIG.returnDive;
    const over = new THREE.Vector3(retPt.x, overFeet, overZ);
    const end = new THREE.Vector3(retPt.x, S.top - 0.3 * S.H, -0.9);
    if (s < 0.18) { pos.copy(hover); k = kH; }                         // the crouch, in place
    else if (s < 0.62) {
      const q = easeInOut((s - 0.18) / 0.44);
      pos.lerpVectors(hover, over, q);
      pos.y += Math.sin(Math.PI * q) * headroom * 0.2;
      k = THREE.MathUtils.lerp(kH, kOver, q);
    } else {
      const q = (s - 0.62) / 0.38;
      pos.lerpVectors(over, end, q * q);
      k = kOver;
      rot[0] = 0.6 * smooth(0, 0.4, q);                                // feet lead into the screen
    }
    phase = 'return';
  }
  res.visible = true;
  res.phase = phase;
  res.position = pos;
  res.scale = k;
  res.rot = rot;
  res.filmness = THREE.MathUtils.lerp(P.filmness.atScreen, P.filmness.inAir, smooth(0.05, Math.max(0.4, hover.z * 0.6), Math.abs(pos.z)));
  const d = model.durations;
  const wR = smooth(tRet, tRet + 0.15, t), wE = (1 - smooth(tExitEnd - 0.05, tExitEnd + 0.2, t)) * (1 - wR);
  res.weights = { exit_leap: wE, solo: Math.max(0, 1 - wE - wR), return_dive: wR };
  const step = (x) => (res.filmness > 0.6 ? Math.floor(x * 12) / 12 : x);   // on twos near the screen
  res.times = {
    exit_leap: Math.min(d.exit_leap - 1e-4, step(t - P.exitAt)),
    solo: ((step(Math.max(0, t - tExitEnd)) % d.solo) + d.solo) % d.solo,
    return_dive: Math.min(d.return_dive - 1e-4, step(Math.max(0, t - tRet))),
  };
  return res;
}

export function applyPlace(fm, place) {
  const h = fm.holder;
  h.visible = place.visible;
  if (!place.visible) return;
  h.position.copy(place.position);
  h.scale.setScalar(place.scale);
  h.rotation.set(place.rot[0], place.rot[1], place.rot[2], 'YXZ');
  for (const [n, a] of Object.entries(fm.actions)) {
    a.enabled = true; a.paused = false;
    a.setEffectiveWeight(place.weights[n]);
    a.time = place.times[n];
  }
  fm.mixer.update(0);
}
