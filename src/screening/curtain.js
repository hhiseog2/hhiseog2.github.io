// The red velvet curtain (A · Velvet Noir): two panels, a valance of three curved swags with tails at each end, a thin gold trim,
// an irregular gold fringe, gold rope tiebacks, and a row of footlights. All made here — no model, no image files.
// Each panel is a subdivided plane shaped in the vertex shader:
//   - deep vertical folds, unevenly spaced, that deepen further as the panel gathers (an accordion: the cloth keeps its length)
//   - opened, each panel is cinched at tieback height and flares above and below it — the drape tied back at the side
//   - the hem lags the top in proportion to how fast the panel moves; after it stops, a damped spring sways it for 0.4 s;
//     the hem pools a little on the floor
// Light: crests catch a soft sheen, valleys fall to shadow (MeshPhysicalMaterial velvet with canvas-made pile normals); a warm
// spot from above and footlights from below while it is closed. set(open, velocity, sway) is driven by sequence.js; reduced
// motion swaps the movement for a 0.6 s fade (setFade).
import * as THREE from 'three';
import { CONFIG, SCREENING } from './config.js';

function pileMap(size) {
  // a fine velvet pile (and a faint vertical grain) as a tangent-space normal map
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), h = new Float32Array(size * size);
  let s = 1234567;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < size * size; i++) h[i] = rnd();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    h[i] = (h[i] + h[y * size + ((x + 1) % size)] + h[((y + 1) % size) * size + x]) / 3 * 0.5 + Math.sin(x / size * Math.PI * 2 * 9) * 0.04;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    const nx = -hx * 3, ny = -hy * 3, l = Math.hypot(nx, ny, 1), i = (y * size + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
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
    normalMap, normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide,
  });
  normalMap.repeat.set(repeat[0], repeat[1]);
  return m;
}

const PANEL_VERTEX = /* glsl */`
  attribute vec2 cuv;
  uniform float uOpen, uVel, uSway, uOuter, uInnerClosed, uInnerOpen, uTop, uBottom, uZ, uFolds, uPool, uTie;
  float cuOpen(float v) { return clamp(uOpen - uVel * 0.09 * (1.0 - v) * (1.0 - v) + uSway * (1.0 - v * 0.7), -0.03, 1.0); }
  float foldPhase(float u) { return u * uFolds * 6.2831853 + 0.7 * sin(u * 7.3) + 0.35 * sin(u * 17.1); }
  float foldSlope(float u) { return uFolds * 6.2831853 + 0.7 * 7.3 * cos(u * 7.3) + 0.35 * 17.1 * cos(u * 17.1); }
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
        // tied back: the open drape is drawn in at the tieback and flares above and below it
        float tie = op * 0.62 * exp(-pow(v - uTie, 2.0) / (2.0 * 0.11 * 0.11));
        span *= 1.0 - tie;
        float gather = clamp(1.0 - abs(span) / abs(full), 0.0, 1.0);
        float amp = 0.11 + 0.24 * gather;                         // deep folds even closed, deeper as the cloth bunches
        float ph = foldPhase(u);
        float dzdu = amp * 0.5 * cos(ph) * foldSlope(u);
        float dzdx = dzdu / max(abs(span), 0.05) * sign(span);
        vec3 objectNormal = normalize(vec3(-dzdx, 0.0, 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = vec3(uOuter + span * u, mix(uBottom, uTop, v), uZ + amp * (0.5 + 0.5 * sin(ph)));
        float pool = smoothstep(0.05, 0.0, v);
        transformed.y = max(transformed.y, 0.005);
        transformed.z += pool * uPool;`);
  };
  material.customProgramCacheKey = () => 'curtain-panel-a';
}

const gold = () => new THREE.MeshStandardMaterial({ color: new THREE.Color(SCREENING.curtain.fringe), metalness: 0.85, roughness: 0.38 });

/** three swags with tails; returns meshes and the swags' hem curves (for the trim and the fringe) */
function swagValance(S, top, mat) {
  const span = S.W + 2.6 + 0.8, x0 = -span / 2, n = 3, w = span / n;
  const depth = 0.38, sag = 0.34, cols = 36, rows = 10;
  const pos = [], uv = [], idx = [], hems = [];
  for (let k = 0; k < n; k++) {
    const base = pos.length / 3, hem = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const t = i / cols, jv = j / rows, x = x0 + k * w + t * w;
        const yb = top - depth - sag * 4 * t * (1 - t);
        const y = THREE.MathUtils.lerp(top, yb, jv);
        const z = 0.46 + 0.12 * Math.sin(Math.PI * jv) * 4 * t * (1 - t) + 0.018 * Math.sin(jv * Math.PI * 6) * 4 * t * (1 - t);
        pos.push(x, y, z); uv.push(t * 3, jv);
        if (j === rows) hem.push(new THREE.Vector3(x, y, z + 0.01));
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    hems.push(hem);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const swags = new THREE.Mesh(geo, mat);
  // tails at the ends: narrow folded panels with a zigzag hem
  const tails = [-1, 1].map((side) => {
    const g = new THREE.PlaneGeometry(0.42, 1.5, 12, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), t = (x + 0.21) / 0.42;
      p.setZ(i, 0.05 * Math.sin(t * Math.PI * 5));
      if (y < -0.74) p.setY(i, y + 0.22 * Math.abs(Math.sin(t * Math.PI * 1.5)));
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.set(side * (span / 2 - 0.21), top - 0.75, 0.5);
    return m;
  });
  return { swags, tails, hems, span, top };
}

export function createCurtain(stageSize, mobile) {
  const S = stageSize, C = SCREENING.curtain;
  const group = new THREE.Group();
  const [sx, sy] = mobile ? CONFIG.performance.curtainSeg.mobile : CONFIG.performance.curtainSeg.desktop;
  const disposables = [];
  const nm = pileMap(256);
  disposables.push(nm);
  const margin = 1.3;
  const top = S.top + 0.75;
  const tieV = 0.42;
  const panels = [-1, 1].map((side) => {
    const geo = new THREE.PlaneGeometry(1, 1, sx, sy);
    const uv = geo.attributes.uv, cuv = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { cuv[i * 2] = side < 0 ? uv.getX(i) : 1 - uv.getX(i); cuv[i * 2 + 1] = uv.getY(i); }
    geo.setAttribute('cuv', new THREE.BufferAttribute(cuv, 2));
    const uniforms = {
      uOpen: { value: 0 }, uVel: { value: 0 }, uSway: { value: 0 },
      uOuter: { value: side * (S.W / 2 + margin) }, uInnerClosed: { value: -side * 0.06 }, uInnerOpen: { value: side * (S.W / 2 + 0.12) },
      uTop: { value: top }, uBottom: { value: -0.02 }, uZ: { value: 0.2 }, uFolds: { value: 13 }, uPool: { value: 0.12 }, uTie: { value: tieV },
    };
    const mat = velvet(nm, [4, 3]);
    shapePanel(mat, uniforms);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    disposables.push(geo, mat);
    group.add(mesh);
    return { mesh, uniforms, mat };
  });

  // valance: swags + tails, a gold trim along each swag and along the top, an irregular fringe
  const valMat = velvet(nm, [6, 1]);
  const val = swagValance(S, top + 0.12, valMat);
  group.add(val.swags, ...val.tails);
  disposables.push(valMat, val.swags.geometry, ...val.tails.map((t) => t.geometry));
  const goldMat = gold();
  disposables.push(goldMat);
  for (const hem of val.hems) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hem), 48, 0.014, 6), goldMat);
    group.add(tube); disposables.push(tube.geometry);
  }
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(val.span, 0.05, 0.06), goldMat);
  cornice.position.set(0, val.top + 0.02, 0.5);
  group.add(cornice); disposables.push(cornice.geometry);
  // fringe: thin strands of uneven length along each swag's hem, now and then a heavier tassel
  let seed = 77;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const strands = [], tassels = [];
  for (const hem of val.hems) {
    const curve = new THREE.CatmullRomCurve3(hem), len = curve.getLength();
    for (let d = 0; d < len; d += 0.028 + rnd() * 0.012) {
      const p = curve.getPointAt(d / len);
      strands.push({ p, l: 0.06 + rnd() * 0.07, tilt: (rnd() - 0.5) * 0.15 });
      if (rnd() < 0.06) tassels.push(p.clone());
    }
  }
  const strandGeo = new THREE.CylinderGeometry(0.004, 0.003, 1, 4);
  strandGeo.translate(0, -0.5, 0);
  const fringe = new THREE.InstancedMesh(strandGeo, goldMat, strands.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  strands.forEach((s, i) => { e.set(0, 0, s.tilt); q.setFromEuler(e); sc.set(1, s.l, 1); m4.compose(s.p, q, sc); fringe.setMatrixAt(i, m4); });
  const tasselGeo = new THREE.ConeGeometry(0.018, 0.1, 6);
  tasselGeo.translate(0, -0.11, 0);
  const tasselMesh = new THREE.InstancedMesh(tasselGeo, goldMat, Math.max(1, tassels.length));
  tassels.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); tasselMesh.setMatrixAt(i, m4); });
  group.add(fringe, tasselMesh);
  disposables.push(strandGeo, tasselGeo);

  // tiebacks: a gold rope loop and a tassel at each side, shown once the drape is tied back
  const tieY = -0.02 + tieV * (top + 0.02);
  const tiebacks = [-1, 1].map((side) => {
    const g = new THREE.Group();
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 24, Math.PI * 1.25), goldMat);
    rope.rotation.set(0.2, 0, side > 0 ? Math.PI * 1.37 : -Math.PI * 0.37);
    rope.scale.set(1, 0.55, 1);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 5), goldMat);
    cord.position.set(side * 0.1, -0.16, 0.05);
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 8), goldMat);
    tassel.position.set(side * 0.1, -0.33, 0.05); tassel.rotation.x = Math.PI;
    g.add(rope, cord, tassel);
    disposables.push(rope.geometry, cord.geometry, tassel.geometry);
    g.userData.side = side;
    group.add(g);
    return g;
  });

  // footlights: a row of warm bulbs along the stage's front edge, and their light thrown up the curtain
  const bulbGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0') });
  const nb = 11, bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, nb);
  for (let i = 0; i < nb; i++) { m4.makeTranslation(-S.W / 2 - 1.0 + (S.W + 2.0) * i / (nb - 1), 0.04, 0.85); bulbs.setMatrixAt(i, m4); }
  group.add(bulbs);
  disposables.push(bulbGeo, bulbMat);
  const foot = new THREE.SpotLight(0xffb870, 0, 9, 0.9, 0.9, 1.2);
  foot.position.set(0, 0.1, 1.6); foot.target.position.set(0, S.bottom + S.H * 0.5, 0.2);
  // a warm spot from above on the closed curtain
  const spot = new THREE.SpotLight(0xffd0a0, 0, 18, 0.42, 0.65, 1.2);
  spot.position.set(0, S.top + 5.5, 6.5);
  spot.target.position.set(0, S.bottom + S.H * 0.45, 0.2);
  group.add(spot, spot.target, foot, foot.target);

  let fade = false;
  return {
    group, panels, spot, foot, bulbs, margin,
    /** open 0 (closed) .. 1 (tied back at the sides); velocity in open-units per second; sway: the settling spring offset */
    set(open, velocity = 0, sway = 0) {
      for (const p of panels) { p.uniforms.uOpen.value = fade ? 0 : open; p.uniforms.uVel.value = fade ? 0 : velocity; p.uniforms.uSway.value = fade ? 0 : sway; }
      if (fade) {
        for (const p of panels) { p.mat.transparent = true; p.mat.opacity = 1 - open; p.mat.depthWrite = open < 0.5; p.mesh.visible = open < 0.999; }
      }
      // the tiebacks sit where the drape is drawn in
      const show = fade ? 0 : THREE.MathUtils.smoothstep(open, 0.75, 1);
      for (const g of tiebacks) {
        const side = g.userData.side, outer = side * (S.W / 2 + margin), inner = side * (S.W / 2 + 0.12);
        const span = (inner - outer) * (1 - 0.62 * open);
        g.position.set(outer + span * 0.55, tieY, 0.2 + 0.2);
        g.scale.setScalar(Math.max(0.001, show));
        g.visible = show > 0.01;
      }
      spot.intensity = 150 * (1 - Math.min(1, open * 1.4));
      foot.intensity = 40 * (1 - 0.6 * open);
    },
    setFade(on) {
      fade = on;
      for (const p of panels) { p.mat.transparent = on; if (!on) { p.mat.opacity = 1; p.mat.depthWrite = true; p.mesh.visible = true; } p.mat.needsUpdate = true; }
    },
    dispose() { disposables.forEach((d) => d.dispose()); fringe.dispose(); tasselMesh.dispose(); bulbs.dispose(); group.removeFromParent(); },
  };
}
