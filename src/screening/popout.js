// The player who jumps out of the film (public/models/cartoon/<member>.glb, made by blender/cartoon/export_all.py).
//
// Everything here is a function of the film's own clock (video.currentTime): where he is, how big, which action and how far into
// it. Nothing accumulates frame to frame, so pausing, seeking or a tab left in the background can never put him out of step.
//
//   out  .. out + emergeFly        springs from his spot on the screen (same place, same size as the 2D player) on an arc
//                                  into the air between the projector and the screen (action: emerge, entered at emergeFrom)
//   ..   back - returnFly          hangs there playing his solo (action: solo, looping on the beat)
//   ..   back                      dives head first back onto his spot and through the screen (action: return); gone at `back`
//
// Look: MeshToonMaterial in three steps (the models carry toon_white / toon_grey / toon_black), an inverted-hull ink outline,
// a rim of projector light. colorReveal brings the sheet colours (the models' vertex colours) back while he is out.
import * as THREE from 'three';
import { CONFIG, SCREENING } from './config.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;

export function toonGradient() {
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function toonMaterial(name, gradientMap, shared, reveal) {
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(CONFIG.palette.tiers[name] || CONFIG.palette.tiers.toon_grey), gradientMap, vertexColors: reveal });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = shared.uReveal;
    shader.uniforms.uRim = shared.uRim;
    shader.uniforms.uRimColor = shared.uRimColor;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal;\nuniform float uRim;\nuniform vec3 uRimColor;')
      .replace('#include <color_fragment>', reveal
        ? '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n  diffuseColor.rgb = mix( diffuseColor.rgb, vColor.rgb, uReveal );\n#endif'
        : '')
      .replace('#include <opaque_fragment>',
        'outgoingLight += uRimColor * uRim * pow( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 3.0 );\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'screening-toon-' + (reveal ? 1 : 0);
  return m;
}

function outlineMaterial(shared) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(CONFIG.palette.ink), side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = shared.uOutline;
    shader.vertexShader = 'uniform float uOutline;\n' + shader.vertexShader.replace('#include <project_vertex>',
      '#if !defined( USE_SKINNING ) && !defined( USE_ENVMAP )\n  vec3 objectNormal = vec3( normal );\n#endif\n' +
      'transformed += normalize( objectNormal ) * uOutline;\n#include <project_vertex>');
  };
  m.customProgramCacheKey = () => 'screening-outline';
  return m;
}

export async function loadPlayer(member, loader, gradientMap) {
  const gltf = await loader.loadAsync(CONFIG.models[member]);
  const reveal = SCREENING.colorReveal;
  const shared = {
    uReveal: { value: 0 }, uRim: { value: 0 }, uRimColor: { value: new THREE.Color(CONFIG.palette.beam) }, uOutline: { value: 0.011 },
  };
  const materials = {}, outline = outlineMaterial(shared), meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const old = Array.isArray(o.material) ? o.material : [o.material];
    const made = old.map((m) => materials[m.name] || (materials[m.name] = toonMaterial(m.name, gradientMap, shared, reveal && !!o.geometry.attributes.color)));
    old.forEach((m) => m.dispose());
    o.material = Array.isArray(o.material) ? made : made[0];
    o.frustumCulled = false;                          // skinned bounds do not follow the actions
    const hull = o.clone();                           // a SkinnedMesh clone shares the skeleton
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
  const clip = (n) => { const c = gltf.animations.find((a) => a.name === n); if (!c) throw new Error(member + '.glb has no "' + n + '" action'); return c; };
  const actions = {};
  for (const n of ['emerge', 'solo', 'return']) {
    const a = mixer.clipAction(clip(n));
    a.setLoop(n === 'solo' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.play();
    actions[n] = a;
  }
  return {
    member, holder, mixer, actions, shared, height,
    durations: Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, a.getClip().duration])),
    dispose() {
      mixer.stopAllAction();
      holder.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      Object.values(materials).forEach((m) => m.dispose());
      outline.dispose();
      holder.removeFromParent();
    },
  };
}

/**
 * Where the player is at film time t. screen = { centre: Vector3, width, height }.
 * Returns { visible, phase, position, scale, pitch, yaw, weights, times, reveal, ripple } — a plain description the scene applies.
 */
export function placeAt(t, clip, player, screen, motion = true) {
  const out = clip.out, back = clip.back;
  const res = { visible: false, phase: 'screen', ripple: -1 };
  if (t >= back && t < back + CONFIG.ripple) res.ripple = (t - back) / CONFIG.ripple;
  if (!motion || t < out || t >= back) return res;
  const H = screen.height, W = screen.width, k0 = clip.screenScale * H / player.height;
  const spot = new THREE.Vector3(screen.centre.x + clip.screenPos[0] * W, screen.centre.y + clip.screenPos[1] * H, screen.centre.z);
  const air = new THREE.Vector3().fromArray(CONFIG.air);
  const flyEnd = out + CONFIG.emergeFly, retStart = back - CONFIG.returnFly;
  const soloStart = out + (player.durations.emerge - CONFIG.emergeFrom);
  const position = new THREE.Vector3();
  let scale, pitch = 0, yaw = 0, phase;
  if (t < flyEnd) {
    const u = (t - out) / CONFIG.emergeFly, e = easeOut(u);
    position.lerpVectors(spot, air, e);
    position.z += 0.25 * (1 - e);                      // starts just in front of the screen cloth
    position.y += Math.sin(Math.PI * u) * 0.45;
    scale = k0 * (1 - (1 - CONFIG.airScale) * e);
    phase = 'emerge';
  } else if (t < retStart) {
    const beat = (t - flyEnd) * SCREENING.bpm / 60;
    position.copy(air);
    position.y += 0.06 * Math.sin(Math.PI * beat / 2);
    yaw = 0.18 * Math.sin(Math.PI * beat / 4);
    scale = k0 * CONFIG.airScale;
    phase = 'solo';
  } else {
    const u = (t - retStart) / CONFIG.returnFly, e = easeIn(u);
    const dive = smooth(0.15, 0.7, u);
    const target = spot.clone();
    target.y += player.height * k0 * 0.45;             // he goes in at the middle of his figure, head first
    target.z += player.height * k0 * 0.5 * dive;
    position.lerpVectors(air, target, e);
    position.y += Math.sin(Math.PI * u) * 0.35;
    pitch = -Math.PI / 2 * dive;
    scale = k0 * (CONFIG.airScale + (1 - CONFIG.airScale) * e);
    phase = 'return';
  }
  const b = CONFIG.blend;
  let wR = smooth(retStart, retStart + b, t), wE = (1 - smooth(soloStart - b, soloStart, t)) * (1 - wR);
  const wS = Math.max(0, 1 - wE - wR);
  res.visible = true;
  res.phase = phase;
  res.position = position;
  res.scale = scale;
  res.pitch = pitch;
  res.yaw = yaw;
  res.weights = { emerge: wE, solo: wS, return: wR };
  res.times = {
    emerge: Math.min(player.durations.emerge - 1e-4, CONFIG.emergeFrom + (t - out)),
    solo: ((Math.max(0, t - soloStart) % player.durations.solo) + player.durations.solo) % player.durations.solo,
    return: Math.min(player.durations.return - 1e-4, Math.max(0, t - retStart)),
  };
  res.reveal = smooth(out, out + 1.5, t) * (1 - smooth(back - 1.4, back - 0.4, t));
  res.spot = spot;
  return res;
}

/** Apply a placeAt() result to the player. */
export function applyPlace(player, place, rim) {
  const h = player.holder;
  h.visible = place.visible;
  if (!place.visible) return;
  h.position.copy(place.position);
  h.scale.setScalar(place.scale);
  h.rotation.set(place.pitch, place.yaw, 0, 'YXZ');
  for (const [n, a] of Object.entries(player.actions)) {
    a.enabled = true;
    a.paused = false;
    a.setEffectiveWeight(place.weights[n]);
    a.time = place.times[n];
  }
  player.mixer.update(0);
  player.shared.uReveal.value = SCREENING.colorReveal ? place.reveal : 0;
  player.shared.uRim.value = rim;
}
