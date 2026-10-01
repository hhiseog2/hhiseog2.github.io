// The red velvet curtain: two panels and a valance with a thin gold fringe, all made here (no model, no image files).
// Each panel is a subdivided plane shaped in the vertex shader:
//   - vertical folds that deepen as the panel gathers (an accordion: the cloth keeps its length, so it bunches)
//   - the hem lags the top in proportion to how fast the panel moves
//   - after it stops, a damped spring sways it for 0.4 s; the hem pools a little on the floor
// Material: MeshPhysicalMaterial velvet (roughness 0.85, sheen 1.0) with fold and pile normal maps drawn on a canvas.
// set(open, velocity, sway) is driven by sequence.js; reduced motion swaps the movement for a 0.6 s fade (setFade).
import * as THREE from 'three';
import { CONFIG, SCREENING } from './config.js';

function normalMapCanvas(size, folds, pile) {
  // a height field (vertical folds + a fine velvet pile) turned into a tangent-space normal map
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), h = new Float32Array(size * size);
  let s = 1234567;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const noise = new Float32Array(size * size).map(() => rnd());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fold = folds ? Math.sin((x / size) * Math.PI * 2 * folds) * 0.5 : 0;
    const n = (noise[y * size + x] + noise[y * size + ((x + 1) % size)] + noise[((y + 1) % size) * size + x]) / 3;
    h[y * size + x] = fold + (n - 0.5) * pile + Math.sin(y / size * Math.PI * 2 * 3 + x * 0.02) * 0.02;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    const nx = -hx * 4, ny = -hy * 4, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * size + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function velvet(normalMap, repeat) {
  const C = SCREENING.curtain;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(C.color), roughness: 0.85, sheen: 1.0, sheenColor: new THREE.Color(C.sheen), sheenRoughness: 0.35,
    normalMap, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide, transparent: false,
  });
  normalMap.repeat.set(repeat[0], repeat[1]);
  return m;
}

const PANEL_VERTEX = /* glsl */`
  attribute vec2 cuv;
  uniform float uOpen, uVel, uSway, uOuter, uInnerClosed, uInnerOpen, uTop, uBottom, uZ, uFolds, uPool;
  float cuOpen(float v) { return clamp(uOpen - uVel * 0.09 * (1.0 - v) * (1.0 - v) + uSway * (1.0 - v * 0.7), -0.03, 1.0); }
`;

function shapePanel(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = PANEL_VERTEX + shader.vertexShader
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float u = cuv.x, v = cuv.y;
        float op = cuOpen(v);
        float inner = mix(uInnerClosed, uInnerOpen, op);
        float span = inner - uOuter, full = uInnerClosed - uOuter;
        float gather = clamp(1.0 - abs(span) / abs(full), 0.0, 1.0);
        float amp = 0.05 + 0.26 * gather;                         // folds deepen as the cloth bunches
        float ph = u * uFolds * 6.2831853;
        float dzdu = amp * 0.5 * cos(ph) * uFolds * 6.2831853;
        float dzdx = dzdu / max(abs(span), 0.05) * sign(span);
        vec3 objectNormal = normalize(vec3(-dzdx, 0.0, 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = vec3(uOuter + span * u, mix(uBottom, uTop, v), uZ + amp * (0.5 + 0.5 * sin(ph)));
        float pool = smoothstep(0.05, 0.0, v);                    // the hem pools on the floor
        transformed.y = max(transformed.y, 0.005);
        transformed.z += pool * uPool;`);
  };
  material.customProgramCacheKey = () => 'curtain-panel';
}

export function createCurtain(stageSize, mobile) {
  const S = stageSize, C = SCREENING.curtain;
  const group = new THREE.Group();
  const [sx, sy] = mobile ? CONFIG.performance.curtainSeg.mobile : CONFIG.performance.curtainSeg.desktop;
  const disposables = [];
  const nmPanel = normalMapCanvas(256, 0, 0.6), nmValance = normalMapCanvas(256, 6, 0.5);
  disposables.push(nmPanel, nmValance);
  const margin = 1.3;                                    // how far each closed panel reaches past the screen's side edge
  const top = S.top + 0.75;
  const panels = [-1, 1].map((side) => {
    const geo = new THREE.PlaneGeometry(1, 1, sx, sy);
    // cuv.x: 0 at the panel's outer edge, 1 at the inner (meeting) edge; cuv.y: 0 at the hem
    const uv = geo.attributes.uv, cuv = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { cuv[i * 2] = side < 0 ? uv.getX(i) : 1 - uv.getX(i); cuv[i * 2 + 1] = uv.getY(i); }
    geo.setAttribute('cuv', new THREE.BufferAttribute(cuv, 2));
    const uniforms = {
      uOpen: { value: 0 }, uVel: { value: 0 }, uSway: { value: 0 },
      uOuter: { value: side * (S.W / 2 + margin) }, uInnerClosed: { value: -side * 0.06 }, uInnerOpen: { value: side * (S.W / 2 + 0.1) },
      uTop: { value: top }, uBottom: { value: -0.02 }, uZ: { value: 0.22 }, uFolds: { value: 11 }, uPool: { value: 0.12 },
    };
    const mat = velvet(nmPanel, [3, 2]);
    shapePanel(mat, uniforms);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    disposables.push(geo, mat);
    group.add(mesh);
    return { mesh, uniforms, mat };
  });
  // valance across the top, with a scalloped hem and a gold fringe under it
  const vw = S.W + margin * 2 + 0.6, vh = 0.8;
  const valGeo = new THREE.PlaneGeometry(vw, vh, 48, 6);
  const vp = valGeo.attributes.position;
  for (let i = 0; i < vp.count; i++) {
    const x = vp.getX(i), y = vp.getY(i);
    vp.setZ(i, 0.05 * Math.sin(x * 9));
    if (y < -vh / 2 + 0.01) vp.setY(i, y + 0.08 * Math.abs(Math.sin(x * Math.PI / 0.9)));      // scallops
  }
  valGeo.computeVertexNormals();
  const valMat = velvet(nmValance, [6, 1]);
  const valance = new THREE.Mesh(valGeo, valMat);
  valance.position.set(0, top - vh / 2 + 0.05, 0.4);
  const fringeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(C.fringe), metalness: 0.7, roughness: 0.45 });
  const fringeBand = new THREE.Mesh(new THREE.BoxGeometry(vw, 0.025, 0.02), fringeMat);
  fringeBand.position.set(0, top - vh + 0.07, 0.46);
  const tasselGeo = new THREE.CylinderGeometry(0.006, 0.012, 0.09, 5);
  const tassels = new THREE.InstancedMesh(tasselGeo, fringeMat, Math.floor(vw / 0.06));
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < tassels.count; i++) { m4.makeTranslation(-vw / 2 + 0.03 + i * 0.06, top - vh + 0.015, 0.46); tassels.setMatrixAt(i, m4); }
  disposables.push(valGeo, valMat, fringeMat, fringeBand.geometry, tasselGeo);
  group.add(valance, fringeBand, tassels);

  // light: a warm spot on the closed curtain from above
  const spot = new THREE.SpotLight(0xffd8a8, 0, 18, 0.5, 0.6, 1.2);
  spot.position.set(0, S.top + 5.5, 6.5);
  spot.target.position.set(0, S.bottom + S.H * 0.4, 0.2);
  group.add(spot, spot.target);

  const all = [...panels.map((p) => p.mat), valMat];
  let fade = false;
  return {
    group, panels, valance, spot, margin,
    /** open 0 (closed) .. 1 (gathered at the sides); velocity in open-units per second; sway: the settling spring offset */
    set(open, velocity = 0, sway = 0) {
      for (const p of panels) { p.uniforms.uOpen.value = fade ? 0 : open; p.uniforms.uVel.value = fade ? 0 : velocity; p.uniforms.uSway.value = fade ? 0 : sway; }
      if (fade) {
        for (const m of panels.map((q) => q.mat)) { m.transparent = true; m.opacity = 1 - open; m.depthWrite = open < 0.5; }
        for (const p of panels) p.mesh.visible = open < 0.999;
      }
      spot.intensity = 160 * (1 - Math.min(1, open * 1.4));
    },
    setFade(on) {
      fade = on;
      for (const p of panels) { p.mat.transparent = on; if (!on) { p.mat.opacity = 1; p.mat.depthWrite = true; p.mesh.visible = true; } p.mat.needsUpdate = true; }
    },
    materials: all,
    dispose() { disposables.forEach((d) => d.dispose()); tassels.dispose(); group.removeFromParent(); },
  };
}
