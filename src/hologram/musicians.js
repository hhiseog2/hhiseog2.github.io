// The three players. Each comes from its GLB (public/models, built by blender/export_all.py); if that file cannot be loaded or
// does not match the model contract, a stand-in made of primitives takes its place. Both answer to the same interface:
//   { key, source, root, state, update(time, beat), emitPoint(target), addReflection(scene, mirror), dispose() }
import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { createHologramMaterial, createMusicianState, paint } from './hologramMaterial.js';

// material name in the GLB -> colour. Bodies and instruments take the theme's accents; the pedestal ring keeps the three colours.
const tints = (three) => ({ holo_base: CONFIG.palette.holo, accent_red: three[0], accent_gold: three[1], accent_green: three[2] });
const TINT = tints(CONFIG.palette.accent);
const RING_TINT = tints(CONFIG.palette.rasta);
const INSTRUMENT = { sax: 'sax_instrument', bass: 'bass_instrument', frontman: 'frontman_mic' };
const KEEP = new Set(['position', 'normal', 'skinIndex', 'skinWeight', 'tint']);
const EDGE_ANGLE = 30;

const primitivesOf = (node) => (node.isMesh ? [node] : node.children.filter((c) => c.isMesh));

// One geometry per Blender object: its material slots become a per-vertex colour, so the object is one draw call.
function mergedGeometry(node, tint = TINT) {
  const parts = primitivesOf(node).map((m) => {
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    return paint(g, tint[m.material.name] || CONFIG.palette.holo);
  });
  if (!parts.length) throw new Error('no mesh in ' + node.name);
  const merged = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
  if (!merged) throw new Error('could not merge ' + node.name);
  if (parts.length > 1) parts.forEach((g) => g.dispose());
  return merged;
}

function swapIn(node, mesh) {
  const old = primitivesOf(node);
  old.forEach((m) => m.geometry.dispose());
  if (node.isMesh) {
    mesh.position.copy(node.position); mesh.quaternion.copy(node.quaternion); mesh.scale.copy(node.scale);
    mesh.name = node.name;
    node.parent.add(mesh);
    node.parent.remove(node);
  } else {
    old.forEach((m) => node.remove(m));
    node.add(mesh);
  }
  return mesh;
}

// Thin outline over the hologram: only the creases (30 degrees and up), see creaseEdges below.
// The models are low-poly, so on tight curves two neighbouring faces can differ by 31-44 degrees without there being a crease:
// those come out as lone line fragments (they read as spikes around the hips). A real crease is a run of edges, so lone
// fragments — fewer than MIN_RUN joined segments and shorter than MIN_LENGTH in all — are dropped.
const MIN_RUN = 3, MIN_LENGTH = 0.16;
function dropLoneFragments(edges) {
  const p = edges.attributes.position, n = p.count / 2;
  const key = (i) => Math.round(p.getX(i) * 2e4) + ',' + Math.round(p.getY(i) * 2e4) + ',' + Math.round(p.getZ(i) * 2e4);
  const at = new Map(), parent = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let s = 0; s < n; s++) for (const end of [s * 2, s * 2 + 1]) {
    const k = key(end), other = at.get(k);
    if (other === undefined) at.set(k, s); else parent[find(s)] = find(other);
  }
  const count = new Map(), length = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let s = 0; s < n; s++) {
    const r = find(s);
    count.set(r, (count.get(r) || 0) + 1);
    length.set(r, (length.get(r) || 0) + a.fromBufferAttribute(p, s * 2).distanceTo(b.fromBufferAttribute(p, s * 2 + 1)));
  }
  const kept = [];
  for (let s = 0; s < n; s++) {
    const r = find(s);
    if (count.get(r) >= MIN_RUN || length.get(r) >= MIN_LENGTH) for (const end of [s * 2, s * 2 + 1]) kept.push(p.getX(end), p.getY(end), p.getZ(end));
  }
  edges.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  edges.userData.dropped = n - kept.length / 6;
  return edges;
}

// The creases of a mesh as line segments, like THREE.EdgesGeometry(geometry, 30): an edge is drawn where its two faces differ by
// more than the threshold, or where it has only one face. One difference: valleys are left out. Where two limbs meet (between the
// thighs, in the armpits, under the chin) the surface folds inward by 60-80 degrees; EdgesGeometry drew those folds as a fan of
// lines around the hips. An outline is there to show the form's ridges and borders, so only convex creases are kept.
function creaseEdges(geometry, degrees) {
  const pos = geometry.attributes.position, index = geometry.index, tris = (index ? index.count : pos.count) / 3;
  const limit = Math.cos(THREE.MathUtils.degToRad(degrees));
  const key = (v) => Math.round(v.x * 1e4) + ',' + Math.round(v.y * 1e4) + ',' + Math.round(v.z * 1e4);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const open = new Map(), out = [];
  for (let t = 0; t < tris; t++) {
    for (let c = 0; c < 3; c++) v[c].fromBufferAttribute(pos, index ? index.getX(t * 3 + c) : t * 3 + c);
    const n = ab.subVectors(v[1], v[0]).cross(ac.subVectors(v[2], v[0])).clone();
    if (n.lengthSq() < 1e-16) continue;                       // a degenerate triangle has no side to fold to
    n.normalize();
    const k = v.map(key);
    for (let c = 0; c < 3; c++) {
      const a = v[c], b = v[(c + 1) % 3], apex = v[(c + 2) % 3];
      const id = k[c] < k[(c + 1) % 3] ? k[c] + '|' + k[(c + 1) % 3] : k[(c + 1) % 3] + '|' + k[c];
      const first = open.get(id);
      if (first === undefined) { open.set(id, { n, a: a.clone(), b: b.clone() }); continue; }
      if (first === null) continue;                           // a third face on this edge: already decided
      open.set(id, null);
      if (first.n.dot(n) > limit) continue;                   // nearly flat: no crease
      if (ab.subVectors(apex, first.a).dot(first.n) > 1e-6) continue;   // the second face rises toward the first one's front: a valley
      out.push(first.a.x, first.a.y, first.a.z, first.b.x, first.b.y, first.b.z);
    }
  }
  for (const e of open.values()) if (e) out.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);     // borders
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return edges;
}

function edgeGeometry(source) {
  const edges = dropLoneFragments(creaseEdges(source, EDGE_ANGLE));
  paint(edges, CONFIG.palette.holo);
  if (!source.attributes.skinIndex) return edges;
  // EdgesGeometry drops the skin weights: look each line end up among the mesh's own vertices
  const pos = source.attributes.position, si = source.attributes.skinIndex, sw = source.attributes.skinWeight;
  const key = (x, y, z) => Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4);
  const at = new Map();
  for (let i = 0; i < pos.count; i++) at.set(key(pos.getX(i), pos.getY(i), pos.getZ(i)), i);
  const ep = edges.attributes.position, index = new Uint16Array(ep.count * 4), weight = new Float32Array(ep.count * 4);
  for (let i = 0; i < ep.count; i++) {
    const j = at.get(key(ep.getX(i), ep.getY(i), ep.getZ(i))) || 0;
    for (let c = 0; c < 4; c++) { index[i * 4 + c] = si.getComponent(j, c); weight[i * 4 + c] = sw.getComponent(j, c); }
  }
  edges.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  edges.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
  return edges;
}

// Lines that follow the skeleton: a SkinnedMesh (so the renderer feeds it the bones) drawn as line segments.
function skinnedLines(geometry, material, like) {
  const lines = new THREE.SkinnedMesh(geometry, material);
  lines.bind(like.skeleton, like.bindMatrix);
  lines.isMesh = false; lines.isLine = true; lines.isLineSegments = true;
  lines.frustumCulled = false;
  return lines;
}

function finish(m) {
  m.meshes = m.meshes.filter(Boolean);
  m.lines = m.lines.filter(Boolean);
  m.meshes.concat(m.lines).forEach((o) => { o.frustumCulled = false; });
  // everything that glows (for the bloom selection)
  m.glow = () => m.meshes.concat(m.lines, m.reflections || []);
  m.setLines = (on) => m.lines.forEach((o) => { o.visible = on; });
  m.setReflection = (on) => (m.reflections || []).forEach((o) => { o.visible = on; });
  m.addReflection = (scene, mirror) => {
    // phones: a flipped, faint copy under the floor line instead of a second render of the scene.
    // Each copy reads its source's world matrix (or its bones) and mirrors it; nothing is animated twice.
    const material = createHologramMaterial(m.clock, m.state, { mirror: true });
    material.depthTest = false;                  // the copy lies under the floor plane: it is drawn onto the floor, not hidden by it
    m.materials.push(material);
    m.reflections = m.meshes.map((src) => {
      let copy;
      if (src.isSkinnedMesh) {
        copy = new THREE.SkinnedMesh(src.geometry, material);
        copy.bind(src.skeleton, src.bindMatrix);
        copy.updateMatrixWorld = function () { this.matrixWorld.copy(mirror); this.bindMatrixInverse.identity(); };
      } else {
        copy = new THREE.Mesh(src.geometry, material);
        copy.updateMatrixWorld = function () { this.matrixWorld.multiplyMatrices(mirror, src.matrixWorld); };
      }
      copy.matrixAutoUpdate = false;
      copy.frustumCulled = false;
      copy.renderOrder = 1;
      scene.add(copy);
      return copy;
    });
    return m.reflections;
  };
  m.dispose = () => {
    const seen = new Set();
    m.meshes.concat(m.lines).forEach((o) => { if (!seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
    m.materials.forEach((x) => x.dispose());
    (m.reflections || []).forEach((o) => o.removeFromParent());
    m.root.removeFromParent();
  };
  return m;
}

// ---------------------------------------------------------------- GLB

async function fromGLB(key, loader, clock) {
  const gltf = await loader.loadAsync(CONFIG.models[key]);
  const root = gltf.scene;
  const need = (name) => { const o = root.getObjectByName(name); if (!o) throw new Error(key + '.glb has no "' + name + '"'); return o; };
  const clip = THREE.AnimationClip.findByName(gltf.animations, 'play');
  if (!clip) throw new Error(key + '.glb has no "play" action');

  const state = createMusicianState();
  const surface = createHologramMaterial(clock, state);
  const outline = createHologramMaterial(clock, state, { edge: true });
  root.updateMatrixWorld(true);

  // body: skinned
  const bodyNode = need(key + '_body');
  const like = primitivesOf(bodyNode)[0];
  const bodyGeo = mergedGeometry(bodyNode);
  const body = new THREE.SkinnedMesh(bodyGeo, surface);
  body.bind(like.skeleton, like.bindMatrix);
  swapIn(bodyNode, body);
  const bodyLines = skinnedLines(edgeGeometry(bodyGeo), outline, body);
  body.parent.add(bodyLines);

  // instrument: rigid, rides on a bone
  const instNode = need(INSTRUMENT[key]);
  const instGeo = mergedGeometry(instNode);
  const instrument = swapIn(instNode, new THREE.Mesh(instGeo, surface));
  instrument.add(new THREE.LineSegments(edgeGeometry(instGeo), outline));

  // pedestal + the ring (three coloured pieces, one mesh, turning as one)
  const pedNode = need('pedestal');
  const pedGeo = mergedGeometry(pedNode);
  const pedestal = swapIn(pedNode, new THREE.Mesh(pedGeo, surface));
  pedestal.add(new THREE.LineSegments(edgeGeometry(pedGeo), outline));
  const ringNodes = ['ring_red', 'ring_gold', 'ring_green'].map(need);
  const ringGeos = ringNodes.map((n) => mergedGeometry(n, RING_TINT).applyMatrix4(n.matrix));
  const rings = new THREE.Mesh(mergeGeometries(ringGeos, false), surface);
  rings.name = 'rings';
  ringNodes[0].parent.add(rings);
  ringNodes.forEach((n) => { primitivesOf(n).forEach((p) => p.geometry.dispose()); n.removeFromParent(); });
  ringGeos.forEach((g) => g.dispose());

  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const box = new THREE.Box3().setFromBufferAttribute(instGeo.attributes.position);
  const anchor = box.getCenter(new THREE.Vector3());
  if (key === 'bass') anchor.y = box.max.y;                  // notes leave the bass from the scroll, the others from the middle

  return finish({
    key, source: 'glb', root, state, clock,
    meshes: [body, instrument, pedestal, rings], lines: [bodyLines, instrument.children[0], pedestal.children[0]],
    materials: [surface, outline],
    update(time) {
      mixer.setTime((time * CONFIG.music.bpm / 80) % clip.duration);
      rings.rotation.y = -time * 0.9;
    },
    emitPoint(target) { return instrument.localToWorld(target.copy(anchor)); },
  });
}

// ---------------------------------------------------------------- stand-ins made of primitives

const at = (geometry, x, y, z, rx = 0, ry = 0, rz = 0) =>
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));

function lump(pieces) {
  const geos = pieces.map(([g, color]) => { g.deleteAttribute('uv'); return paint(g, color || CONFIG.palette.holo); });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

function pedestalParts() {
  const [red, gold, green] = CONFIG.palette.rasta;
  const ped = lump([[at(new THREE.CylinderGeometry(0.55, 0.56, 0.045, 40), 0, -0.0225, 0)]]);
  const arc = (i, color) => [at(new THREE.TorusGeometry(0.62, 0.018, 6, 18, Math.PI * 2 / 3 - 0.14), 0, -0.025, 0, Math.PI / 2, 0, i * Math.PI * 2 / 3), color];
  return { ped, rings: lump([arc(0, red), arc(1, gold), arc(2, green)]) };
}

function primitive(key, clock, build) {
  const state = createMusicianState();
  const surface = createHologramMaterial(clock, state);
  const outline = createHologramMaterial(clock, state, { edge: true });
  const root = new THREE.Group();
  root.name = key + '_root';
  const figure = new THREE.Group();          // everything that bounces with the knees
  root.add(figure);
  const meshes = [], lines = [];
  const add = (parent, pieces, name) => {
    const geo = lump(pieces), mesh = new THREE.Mesh(geo, surface), edge = new THREE.LineSegments(edgeGeometry(geo), outline);
    mesh.name = name;
    mesh.add(edge);
    parent.add(mesh);
    meshes.push(mesh); lines.push(edge);
    return mesh;
  };
  const { ped, rings: ringGeo } = pedestalParts();
  const pedestal = new THREE.Mesh(ped, surface);
  pedestal.name = 'pedestal';
  const rings = new THREE.Mesh(ringGeo, surface);
  rings.name = 'rings';
  root.add(pedestal, rings);
  meshes.push(pedestal, rings);
  const parts = build({ figure, add });
  return finish({
    key, source: 'primitive', root, state, clock, meshes, lines, materials: [surface, outline],
    update(time, beat) {
      const off = 0.5 - 0.5 * Math.cos(Math.PI * 2 * beat), on = 1 - off;
      figure.position.y = -0.03 * on;
      rings.rotation.y = -time * 0.9;
      parts.animate(time, beat, off, on);
    },
    emitPoint(target) { return parts.instrument.localToWorld(target.copy(parts.anchor)); },
  });
}

const LEGS = () => [
  [at(new THREE.CapsuleGeometry(0.075, 0.74, 4, 10), 0.11, 0.47, 0)], [at(new THREE.CapsuleGeometry(0.075, 0.74, 4, 10), -0.11, 0.47, 0)],
  [at(new THREE.BoxGeometry(0.11, 0.07, 0.26), 0.12, 0.035, 0.06)], [at(new THREE.BoxGeometry(0.11, 0.07, 0.26), -0.12, 0.035, 0.06)],
];
const TORSO = (wide = 1) => [
  [at(new THREE.CapsuleGeometry(0.16 * wide, 0.34, 4, 12), 0, 0.30, 0)],
  [at(new THREE.SphereGeometry(0.115, 16, 12), 0, 0.72, 0)],
  [at(new THREE.ConeGeometry(0.02, 0.05, 8), 0, 0.71, 0.12, Math.PI / 2)],
];
const LIMB = (from, to, r = 0.045) => {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), g = new THREE.CapsuleGeometry(r, a.distanceTo(b), 4, 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return [g];
};

export function createSaxophonist(clock) {
  const [red, gold, green] = CONFIG.palette.accent;
  return primitive('sax', clock, ({ figure, add }) => {
    add(figure, LEGS(), 'legs');
    const upper = new THREE.Group();
    upper.position.y = 0.96;
    figure.add(upper);
    add(upper, TORSO(1.05).concat([
      [at(new THREE.CylinderGeometry(0.19, 0.125, 0.06, 20), 0, 0.84, -0.03), red],
      [at(new THREE.CylinderGeometry(0.2, 0.19, 0.05, 20), 0, 0.895, -0.05), gold],
      [at(new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.92, -0.06), green],
      LIMB([0.2, 0.46, 0], [0.16, 0.22, 0.2]), LIMB([0.16, 0.22, 0.2], [0.04, 0.34, 0.25], 0.04),
      LIMB([-0.2, 0.46, 0], [-0.24, 0.16, 0.14]), LIMB([-0.24, 0.16, 0.14], [-0.13, 0.05, 0.26], 0.04),
    ]), 'sax_body');
    const instrument = add(upper, [
      LIMB([0, 0.62, 0.13], [-0.03, 0.5, 0.26], 0.014), LIMB([-0.03, 0.5, 0.26], [-0.17, -0.2, 0.27], 0.03),
      LIMB([-0.17, -0.2, 0.27], [-0.2, -0.23, 0.36], 0.042),
      [at(new THREE.CylinderGeometry(0.1, 0.05, 0.2, 18, 1, true), -0.2, -0.1, 0.4, 0.25), gold],
    ], 'sax_instrument');
    return {
      instrument, anchor: new THREE.Vector3(-0.2, 0.02, 0.42),
      animate(time, beat, off) { upper.rotation.x = -0.13 * Math.pow(off, 1.3); upper.rotation.z = 0.035 * Math.sin(Math.PI * beat / 2); },
    };
  });
}

export function createBassist(clock) {
  const gold = CONFIG.palette.accent[1];
  return primitive('bass', clock, ({ figure, add }) => {
    add(figure, LEGS(), 'legs');
    const upper = new THREE.Group();
    upper.position.y = 1.0;
    figure.add(upper);
    add(upper, [TORSO(0.9)[0], LIMB([0.19, 0.48, 0], [0.26, 0.34, 0.16]), LIMB([0.26, 0.34, 0.16], [0.2, 0.5, 0.24], 0.04)], 'bass_body');
    const head = new THREE.Group();
    head.position.y = 0.62;
    upper.add(head);
    add(head, [
      [at(new THREE.SphereGeometry(0.11, 16, 12), 0, 0.12, 0)],
      [at(new THREE.CylinderGeometry(0.095, 0.115, 0.1, 20), 0, 0.22, 0)], [at(new THREE.CylinderGeometry(0.115, 0.18, 0.05, 20, 1, true), 0, 0.16, 0), gold],
      [at(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 14), 0.04, 0.13, 0.105, Math.PI / 2), gold],
      [at(new THREE.CylinderGeometry(0.032, 0.032, 0.008, 14), -0.04, 0.13, 0.105, Math.PI / 2), gold],
    ], 'bass_head');
    const arm = new THREE.Group();
    arm.position.set(-0.19, 0.48, 0);
    upper.add(arm);
    add(arm, [LIMB([0, 0, 0], [0.06, -0.26, 0.12]), LIMB([0.06, -0.26, 0.12], [0.24, -0.4, 0.26], 0.04)], 'bass_arm');
    const instrument = add(figure, [
      [at(new THREE.SphereGeometry(0.3, 18, 12).scale(1, 1.05, 0.34), 0.25, 0.5, 0.29)],
      [at(new THREE.SphereGeometry(0.23, 18, 12).scale(1, 1.0, 0.34), 0.25, 0.92, 0.27)],
      LIMB([0.25, 1.1, 0.25], [0.24, 1.62, 0.2], 0.026), [at(new THREE.TorusGeometry(0.04, 0.018, 6, 12), 0.24, 1.7, 0.19, 0, Math.PI / 2)],
      [at(new THREE.CylinderGeometry(0.004, 0.004, 1.2, 5), 0.23, 1.0, 0.36, -0.06), gold], [at(new THREE.CylinderGeometry(0.004, 0.004, 1.2, 5), 0.27, 1.0, 0.36, -0.06), gold],
      [at(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), 0.25, 0.09, 0.29), gold],
    ], 'bass_instrument');
    return {
      instrument, anchor: new THREE.Vector3(0.24, 1.72, 0.19),
      animate(time, beat, off, on) {
        const fr = beat % 1, pluck = Math.pow(Math.sin(Math.PI * Math.min(fr / 0.34, 1)), 2);
        arm.rotation.x = -0.22 * pluck;
        head.rotation.x = 0.16 * on * on;
        upper.rotation.x = 0.06;
      },
    };
  });
}

export function createFrontman(clock) {
  const [red, gold, green] = CONFIG.palette.accent;
  return primitive('frontman', clock, ({ figure, add }) => {
    add(figure, LEGS(), 'legs');
    const upper = new THREE.Group();
    upper.position.y = 0.93;
    figure.add(upper);
    const band = (y, color) => [at(new THREE.CylinderGeometry(0.205, 0.205, 0.024, 24, 1, true), 0, y, 0), color];
    add(upper, TORSO(1.12).concat([
      [at(new THREE.CylinderGeometry(0.2, 0.23, 0.5, 24, 1, true), 0, 0.22, 0)],
      band(0.4, red), band(0.37, gold), band(0.34, green),
      [at(new THREE.SphereGeometry(0.118, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.74, 0)],
      [at(new THREE.BoxGeometry(0.15, 0.012, 0.1), 0, 0.75, -0.15, 0.2)],           // the cap's visor, worn backwards
      LIMB([-0.21, 0.46, 0], [-0.24, 0.3, 0.14]), LIMB([-0.24, 0.3, 0.14], [-0.07, 0.5, 0.2], 0.04),
    ]), 'frontman_body');
    const instrument = add(upper, [
      [at(new THREE.SphereGeometry(0.032, 12, 8), -0.02, 0.66, 0.17)], LIMB([-0.03, 0.63, 0.18], [-0.08, 0.48, 0.21], 0.016),
    ], 'frontman_mic');
    const arm = new THREE.Group();
    arm.position.set(0.21, 0.46, 0);
    upper.add(arm);
    add(arm, [LIMB([0, 0, 0], [0.12, 0.26, 0.06]), LIMB([0.12, 0.26, 0.06], [0.1, 0.52, 0.1], 0.04), [at(new THREE.SphereGeometry(0.05, 10, 8), 0.1, 0.58, 0.1)]], 'frontman_arm');
    return {
      instrument, anchor: new THREE.Vector3(-0.02, 0.7, 0.17),
      animate(time, beat, off) {
        const pump = Math.pow(off, 1.4), sway = Math.sin(Math.PI * beat);
        arm.rotation.z = 0.5 - 0.55 * pump;
        upper.rotation.z = 0.05 * sway;
        figure.position.x = 0.02 * sway;
      },
    };
  });
}

const STAND_IN = { sax: createSaxophonist, bass: createBassist, frontman: createFrontman };

/** GLB first; the primitive stand-in if loading or the model contract fails. */
export async function loadMusician(key, loader, clock) {
  try {
    return await fromGLB(key, loader, clock);
  } catch (e) {
    console.warn('hologram: ' + key + ' model not used, primitive stand-in instead —', e && e.message ? e.message : e);
    return STAND_IN[key](clock);
  }
}
