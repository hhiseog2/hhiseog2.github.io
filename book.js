// So What: 3D comic book.
// Reads the works list already in the page (.panels: order, title, artwork, #work-NN target — the one place that holds them),
// paints each work to a page texture and binds cover + contents page + works + back cover into one book. Pages bend on the CPU:
// every row of the sheet is integrated from the spine with a varying angle, so the paper keeps its length while it curls.
// The Contents button lists the same works and opens the chosen one at once (no page-by-page turning on the way).
// If WebGL or this script is missing, the original panel grid stays as it is.

const book = document.querySelector('.book');
const stage = book && book.querySelector('.book-stage');

if (book && stage && hasWebGL()) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    init().catch(() => { /* keep the static grid */ });
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: '400px 0px' });
    io.observe(document.getElementById('work'));
  } else {
    start();
  }
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

async function init() {
  const THREE = await import('./vendor/three.module.min.js');
  await Promise.all([
    document.fonts.load('100px "So What Franklin"'),
    document.fonts.ready,
  ]);

  const INK = '#1d1d1f', BLUE = '#3d8fe0', PAPER = '#efe6d0';   // style.css --ink / --blue / --paper
  const FONT = '"So What Franklin", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';   // Franklin for Latin, the guide's Korean fonts for 한글
  const W = 1, H = 1.25;              // one page, 4:5 like the panels
  const NX = 48, NZ = 24;             // subdivisions (spine -> edge, top -> bottom)
  const T = 0.0025;                   // one sheet's thickness
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- pages from the works list ----------
  const works = [...document.querySelectorAll('.panels .panel')].map((el) => {
    const label = el.querySelector('.cap').textContent.trim();          // "01. Bill Evans — 빌 에반스"
    const m = label.match(/^(\d+)\.\s*(.+?)\s*—\s*(.+)$/) || [null, '', label, ''];
    return {
      kind: 'panel', id: el.id, label, no: m[1], name: m[2], nameKo: m[3],
      tone: [...el.classList].find((c) => c.startsWith('tone-')),
      capBottom: el.classList.contains('cap-bottom'),
      art: el.querySelector('img') ? el.querySelector('img').currentSrc || el.querySelector('img').src : '',
    };
  });
  // the user's artwork: load it before any page is painted (the grid's own <img> is lazy and hidden once the book is up)
  await Promise.all(works.filter((p) => p.art).map((p) => {
    const img = new Image();
    img.src = p.art;
    return img.decode().then(() => { p.img = img; }, () => {});   // failed to load: the panel keeps its screen tone
  }));
  // cover, contents page, one page per work, back cover. Only pages with a job are in the book (no decorative or blank pages).
  const pages = [{ kind: 'cover', label: 'Cover' }, { kind: 'contents', label: 'Contents' }, ...works, { kind: 'back', label: 'Back cover' }];
  if (pages.length % 2) pages.splice(pages.length - 1, 0, { kind: 'blank', label: 'Blank page' });   // only if the number of works turns odd one day
  const N = pages.length / 2;         // sheets
  works.forEach((w) => { w.page = pages.indexOf(w); });

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;   // shadows are redrawn only when the paper moves
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, 1.6, 0.1, 50);
  let TILT = THREE.MathUtils.degToRad(18);   // how far the camera leans back from straight down (less on phones)

  // Lambert: flat page = albedo * (ambient + sun * cos) / PI  ->  1.0, so page colours stay true.
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-1.2, 3.2, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 2;
  Object.assign(sun.shadow.camera, { left: -1.8, right: 1.8, top: 1.6, bottom: -1.6, near: 0.5, far: 8 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.004;
  scene.add(sun, sun.target);

  const bookGroup = new THREE.Group();
  scene.add(bookGroup);

  // soft contact shadow under the book + a table that only shows cast shadows
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, opacity: 0.2, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = -0.002;
  bookGroup.add(blob);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.07 }));
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.001;
  table.receiveShadow = true;
  bookGroup.add(table);

  // the stacked paper under the top pages, one block per side
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xd6cbb2 });   // paper edges, a shade under the cream
  const blocks = [-1, 1].map((side) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(W, 1, H), edgeMat);
    m.receiveShadow = true;
    m.userData.side = side;
    bookGroup.add(m);
    return m;
  });

  // ---------- textures ----------
  const TEX_W = (window.devicePixelRatio || 1) > 1.5 ? 1024 : 768;
  const TEX_H = Math.round(TEX_W * H / W);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const textures = new Map();

  function pageTexture(i) {
    if (!textures.has(i)) {
      const tex = new THREE.CanvasTexture(paintPage(pages[i], i % 2 === 1));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (i % 2 === 1) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1; tex.offset.x = 1; } // back face is mirrored
      textures.set(i, tex);
    }
    return textures.get(i);
  }

  function paintPage(page, spineOnRight) {
    const c = document.createElement('canvas');
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext('2d');
    const u = TEX_W / 720;             // 1 css px of a 720px panel
    if (page.kind === 'cover' || page.kind === 'back') {
      // printed like the jazz posters in reference/: one blue ink, black type, a line-screen block
      g.fillStyle = BLUE; g.fillRect(0, 0, TEX_W, TEX_H);
      g.fillStyle = INK; g.strokeStyle = INK;
      const m = TEX_W * 0.07;
      if (page.kind === 'cover') {
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        let fs = 200 * u;
        g.font = `${fs}px ${FONT}`;
        fs *= (TEX_W - m * 2) / measureSpaced(g, 'PORTFOLIO', -0.01);   // the title runs the full width
        g.font = `${fs}px ${FONT}`;
        spaced(g, 'PORTFOLIO', m, m + fs * 0.74, -0.01);
        const bx = m, by = m + fs * 0.9, bw = TEX_W - m * 2, bh = TEX_H * 0.5;
        g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
        g.lineWidth = 2.2 * u;
        const cx = bx + bw * 0.5, cy = by + bh * 0.55;
        for (let r = 6 * u; r < Math.hypot(bw, bh); r += 9 * u) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
        g.restore();
        g.lineWidth = 3 * u; g.strokeRect(bx, by, bw, bh);
        g.font = `${Math.round(19 * u)}px ${FONT}`; g.textBaseline = 'top';
        const cols = [['A DESIGNER &', 'DEVELOPER PORTFOLIO'], ['WORKS', `${works[0].no} TO ${works[works.length - 1].no}`]];
        const cw = (TEX_W - m * 2) / 2, ty = by + bh + 26 * u;
        cols.forEach((lines, i) => lines.forEach((t, j) => spaced(g, t, m + cw * i, ty + j * 25 * u, 0.06)));
      } else {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `${Math.round(24 * u)}px ${FONT}`;
        spaced(g, 'DESIGN & CODE', TEX_W / 2, TEX_H * 0.9, 0.12);
      }
    } else {
      g.fillStyle = PAPER; g.fillRect(0, 0, TEX_W, TEX_H);
      if (page.kind === 'panel') paintPanel(g, page, u);
      if (page.kind === 'contents') paintContents(g, u);
    }
    // gutter: a little shade where the paper runs into the spine, and a hint at the outer edge
    const gw = TEX_W * 0.07;
    const sx = spineOnRight ? TEX_W : 0, dir = spineOnRight ? -1 : 1;
    const grad = g.createLinearGradient(sx, 0, sx + dir * gw, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.16)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(spineOnRight ? TEX_W - gw : 0, 0, gw, TEX_H);
    const ox = spineOnRight ? 0 : TEX_W, ew = TEX_W * 0.012;
    const edge = g.createLinearGradient(ox, 0, ox - dir * ew, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0.06)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(spineOnRight ? 0 : TEX_W - ew, 0, ew, TEX_H);
    return c;
  }

  function spaced(g, text, x, y, em) {
    if ('letterSpacing' in g) { g.letterSpacing = `${em}em`; g.fillText(text, x, y); g.letterSpacing = '0px'; return; }
    g.fillText(text, x, y);
  }

  function paintPanel(g, page, u) {
    // the panel keeps its own ratio inside the page margin
    const m = TEX_W * 0.07;
    const iw = TEX_W - m * 2, ih = TEX_H - m * 2;
    const ratio = 5 / 4;
    let pw = iw, ph = iw * ratio;
    if (ph > ih) { ph = ih; pw = ih / ratio; }
    const px = (TEX_W - pw) / 2, py = (TEX_H - ph) / 2;
    const orig = 720;                  // css width of the panel on the site
    const k = pw / orig;               // texture px per css px
    g.save();
    g.beginPath(); g.rect(px, py, pw, ph); g.clip();
    paintTone(g, page.tone, px, py, pw, ph, k);
    if (page.img) {                    // cover the panel like object-fit: cover
      const s = Math.max(pw / page.img.naturalWidth, ph / page.img.naturalHeight);
      const dw = page.img.naturalWidth * s, dh = page.img.naturalHeight * s;
      g.drawImage(page.img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    }
    g.restore();
    const line = Math.max(2, 3 * k * (orig / 720) * 1.2);
    g.lineWidth = line; g.strokeStyle = INK;
    g.strokeRect(px + line / 2, py + line / 2, pw - line, ph - line);
    // caption chip, as on the site: the work's title in its own case (no capitals for names)
    const fs = 14 * u * 1.5;
    g.font = `${fs}px ${FONT}`;
    g.textBaseline = 'middle'; g.textAlign = 'left';
    const text = page.label;
    const tw = measureSpaced(g, text, 0.02);
    const padX = 8 * u * 1.5, chipH = fs * 1.4 + 8 * u * 1.5;
    const cy = page.capBottom ? py + ph - chipH - line : py;   // top-left, or bottom-left (.cap-bottom)
    g.fillStyle = PAPER; g.fillRect(px, cy, tw + padX * 2 + line, chipH + line);
    g.fillStyle = INK;
    g.fillRect(px + tw + padX * 2, cy, line, chipH + line);
    g.fillRect(px, page.capBottom ? cy : cy + chipH, tw + padX * 2 + line, line);
    g.lineWidth = line; g.strokeRect(px + line / 2, py + line / 2, pw - line, ph - line);
    spaced(g, text, px + padX + line / 2, cy + chipH / 2 + (page.capBottom ? line : line / 2), 0.02);
  }

  // the printed contents page: the same works list, with the page each one is on
  function paintContents(g, u) {
    const m = TEX_W * 0.1, right = TEX_W - m;
    g.fillStyle = INK; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    let fs = 120 * u;
    g.font = `${fs}px ${FONT}`;
    fs *= (right - m) / measureSpaced(g, 'CONTENTS', -0.01);   // the title runs the full width, like the cover
    g.font = `${fs}px ${FONT}`;
    const top = m + fs * 0.74;
    spaced(g, 'CONTENTS', m, top, -0.01);
    g.fillStyle = BLUE; g.fillRect(m, top + 18 * u, right - m, 6 * u);   // one blue printed rule
    g.fillStyle = INK;
    const row = (TEX_H - (top + 60 * u) - m) / works.length;
    works.forEach((w, i) => {
      const y = top + 60 * u + row * i;
      g.fillRect(m, y, right - m, Math.max(1, 1.5 * u));                // ink line between entries
      g.textAlign = 'left';
      g.font = `${Math.round(22 * u)}px ${FONT}`; spaced(g, w.no, m, y + 40 * u, 0.04);
      g.font = `${Math.round(38 * u)}px ${FONT}`; spaced(g, w.name, m + 64 * u, y + 44 * u, 0);
      g.font = `${Math.round(22 * u)}px ${FONT}`; spaced(g, w.nameKo, m + 64 * u, y + 78 * u, 0);
      g.textAlign = 'right';
      g.font = `${Math.round(22 * u)}px ${FONT}`; spaced(g, `p. ${w.page + 1}`, right, y + 40 * u, 0.04);
    });
  }

  function measureSpaced(g, text, em) {
    if ('letterSpacing' in g) { g.letterSpacing = `${em}em`; const w = g.measureText(text).width; g.letterSpacing = '0px'; return w; }
    return g.measureText(text).width;
  }

  function paintTone(g, tone, x, y, w, h, k) {
    const dots = (color, cell, r) => {
      g.fillStyle = color;
      const c = cell * k, rr = r * k;
      for (let yy = y + c / 2; yy < y + h + c; yy += c) {
        g.beginPath();
        for (let xx = x + c / 2; xx < x + w + c; xx += c) { g.moveTo(xx + rr, yy); g.arc(xx, yy, rr, 0, Math.PI * 2); }
        g.fill();
      }
    };
    g.fillStyle = PAPER; g.fillRect(x, y, w, h);
    switch (tone) {
      case 'tone-dots': dots(INK, 8, 1.35); break;
      case 'tone-dots-dense': dots(INK, 6, 1.65); break;
      case 'tone-blue': dots(BLUE, 8, 1.85); break;
      case 'tone-key': dots(BLUE, 10, 1.45); break;
      case 'tone-hatch': {
        g.strokeStyle = INK; g.lineWidth = 1 * k * 1.1;
        const step = 9 * k * Math.SQRT2;
        g.beginPath();
        for (let d = -h; d < w + h; d += step) { g.moveTo(x + d, y); g.lineTo(x + d + h, y + h); }
        g.stroke();
        break;
      }
      case 'tone-lines': {
        g.fillStyle = INK;
        const cx = x + w / 2, cy = y + h * 0.55, R = Math.hypot(w, h);
        g.beginPath();
        for (let a = 0; a < 360; a += 5) {
          const a0 = THREE.MathUtils.degToRad(a - 90), a1 = THREE.MathUtils.degToRad(a + 0.6 - 90);
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
          g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
          g.closePath();
        }
        g.fill();
        break;
      }
      default: break;
    }
  }

  function contactTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.shadowColor = 'rgba(0,0,0,1)'; g.shadowBlur = 36; g.shadowOffsetX = 1000;
    g.fillStyle = '#000';
    g.fillRect(40 - 1000, 40, 176, 176);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------- sheets ----------
  function sheetGeometry() {
    const geo = new THREE.BufferGeometry();
    const count = (NX + 1) * (NZ + 1);
    const uv = new Float32Array(count * 2);
    for (let r = 0; r <= NZ; r++) for (let c = 0; c <= NX; c++) {
      const i = r * (NX + 1) + c;
      uv[i * 2] = c / NX; uv[i * 2 + 1] = 1 - r / NZ;
    }
    const index = [];
    for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) {
      const a = r * (NX + 1) + c, b = a + 1, d = a + NX + 1, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
    geo.setIndex(index);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }

  const sheets = [];
  for (let j = 0; j < N; j++) {
    const geo = sheetGeometry();
    const front = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ side: THREE.FrontSide }));
    const back = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ side: THREE.BackSide }));
    front.material.shadowSide = THREE.DoubleSide;
    for (const m of [front, back]) { m.receiveShadow = true; m.visible = false; bookGroup.add(m); }
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2.5);
    sheets.push({ j, geo, front, back, shape: '' });
  }

  // one row of paper: angle grows from the spine towards the edge, length is preserved
  const ds = W / NX;
  function phiAt(theta, lead, w, hov, wh, s) {
    let phi = theta + lead * Math.sin(theta) * w * s * s + hov * wh * wh * s * s * s * s;
    return phi < 0 ? 0 : phi > Math.PI ? Math.PI : phi;
  }

  function deform(sheet, p) {
    const pos = sheet.geo.attributes.position.array;
    for (let r = 0; r <= NZ; r++) {
      const z = -H / 2 + (r / NZ) * H;
      const w = 1 - 0.5 * Math.abs(z - p.gz) / H;
      const wh = Math.max(0, 1 - Math.abs(z - p.hz) / (0.55 * H));
      let x = 0, y = 0;
      let i = r * (NX + 1) * 3;
      pos[i] = 0; pos[i + 1] = p.y; pos[i + 2] = z;
      for (let c = 1; c <= NX; c++) {
        const phi = phiAt(p.theta, p.lead, w, p.hov, wh, (c - 0.5) / NX);
        x += Math.cos(phi) * ds; y += Math.sin(phi) * ds;
        i += 3;
        pos[i] = x; pos[i + 1] = p.y + y; pos[i + 2] = z;
      }
    }
    sheet.geo.attributes.position.needsUpdate = true;
    sheet.geo.computeVertexNormals();
  }

  function tipX(theta, lead, w) {
    let x = 0;
    for (let c = 1; c <= 16; c++) x += Math.cos(phiAt(theta, lead, w, 0, 0, (c - 0.5) / 16)) * (W / 16);
    return x;
  }

  function solveTheta(targetX, lead, w) {
    let lo = 0, hi = Math.PI;
    for (let n = 0; n < 18; n++) {
      const mid = (lo + hi) / 2;
      if (tipX(mid, lead, w) > targetX) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------- state ----------
  let k = Math.min(1, N);    // sheets already on the left; 0 = closed on the cover, N = closed on the back
  let single = false;        // narrow screens show one page at a time and follow the paper
  let focus = -1;            // which page of the spread the one-page view looks at (-1 left, 1 right)
  let camX = 0, camDist = 5, camShift = 0, pan = null, pending = null;
  let flip = null;           // { j, dir, theta, omega, target, mode: 'drag'|'spring' }
  let lead = 0;
  let gz = H / 2, hz = H / 2;
  const hover = { j: -1, side: 0, h: 0, target: 0 };
  let drag = null;           // { id, startX, samples }

  const restY = (j, onLeft) => (onLeft ? (j + 1) * T : (N - j) * T);

  function layout() {
    const fj = flip ? flip.j : -1;
    const kL = flip && fj === k - 1 ? k - 1 : k;           // top of the left stack (exclusive)
    const kR = flip && fj === k ? k + 1 : k;               // top of the right stack
    // only the two open pages, the turning sheet and nothing else carry a mesh
    const want = new Set([kL - 1, kR, fj].filter((j) => j >= 0 && j < N));

    for (const s of sheets) {
      const on = want.has(s.j);
      s.front.visible = s.back.visible = on;
      if (!on) { s.shape = ''; continue; }
      bindTextures(s);
      const moving = s.j === fj;
      s.front.castShadow = moving;
      if (moving) {
        const p = flip.theta / Math.PI;
        const y0 = flip.dir > 0 ? restY(fj, false) : restY(fj, true);
        const y1 = flip.dir > 0 ? restY(fj, true) : restY(fj, false);
        const t = flip.dir > 0 ? p : 1 - p;
        deform(s, { theta: flip.theta, lead, gz, hov: 0, hz, y: y0 + (y1 - y0) * t + Math.sin(flip.theta) * T * 3 });
        s.shape = 'moving';
      } else {
        const onLeft = s.j < kL;
        const hov = hover.j === s.j ? hover.h * (onLeft ? -1 : 1) : 0;
        const key = `${onLeft}|${hov.toFixed(4)}|${hz.toFixed(3)}`;
        if (s.shape !== key) {
          deform(s, { theta: onLeft ? Math.PI : 0, lead: 0, gz: 0, hov, hz, y: restY(s.j, onLeft) });
          s.shape = key;
        }
      }
    }
    // paper blocks
    const hl = kL * T - 0.0004, hr = (N - kR) * T - 0.0004;
    setBlock(blocks[0], hl, -W / 2);
    setBlock(blocks[1], hr, W / 2);
    // closed book sits centred
    let off = 0;
    if (flip && fj === 0) off = -W / 2 * (1 - flip.theta / Math.PI);
    else if (flip && fj === N - 1) off = W / 2 * (flip.theta / Math.PI);
    else if (!flip && k === 0) off = -W / 2;
    else if (!flip && k === N) off = W / 2;
    bookGroup.position.x = off;
    // contact shadow follows what is on the table
    const leftP = kL > 0 ? 1 : flip ? flip.theta / Math.PI : 0;
    const rightP = kR < N ? 1 : flip ? 1 - flip.theta / Math.PI : 0;
    const x0 = -W * leftP, x1 = W * rightP;
    blob.scale.set(Math.max(0.01, x1 - x0) + 0.3, H + 0.3, 1);
    blob.position.x = (x0 + x1) / 2 + 0.03;
    blob.position.z = 0.04;
  }

  function setBlock(m, h, x) {
    m.visible = h > 0.0005;
    if (!m.visible) return;
    m.scale.y = h;
    m.position.set(x, h / 2, 0);
  }

  function bindTextures(s) {
    const f = pageTexture(s.j * 2), b = pageTexture(s.j * 2 + 1);
    if (s.front.material.map !== f) { s.front.material.map = f; s.front.material.needsUpdate = true; }
    if (s.back.material.map !== b) { s.back.material.map = b; s.back.material.needsUpdate = true; }
  }

  // keep only textures around the open spread in GPU memory
  function trimTextures() {
    const keep = new Set();
    for (let j = k - 2; j <= k + 1; j++) if (j >= 0 && j < N) { keep.add(j * 2); keep.add(j * 2 + 1); }
    if (flip) { keep.add(flip.j * 2); keep.add(flip.j * 2 + 1); }
    for (const [i, tex] of textures) {
      if (keep.has(i)) continue;
      for (const s of sheets) {
        if (s.front.material.map === tex) { s.front.material.map = null; s.front.material.needsUpdate = true; }
        if (s.back.material.map === tex) { s.back.material.map = null; s.back.material.needsUpdate = true; }
      }
      tex.dispose();
      textures.delete(i);
    }
    // warm the next spread in both directions
    for (const j of [k - 2, k + 1]) if (j >= 0 && j < N) { pageTexture(j * 2); pageTexture(j * 2 + 1); }
  }

  // ---------- render on demand ----------
  let raf = 0, last = 0, frameMs = 0;
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let busy = false;

    // lead: pulled corner leads while dragging, the free edge trails in the air
    let leadTarget = 0;
    if (flip && flip.mode === 'drag') leadTarget = 0.85 * flip.dir;
    else if (flip) leadTarget = -Math.sign(flip.omega) * Math.min(0.55, Math.abs(flip.omega) * 0.09);
    lead += (leadTarget - lead) * (1 - Math.exp(-dt * 14));
    if (Math.abs(leadTarget - lead) > 0.002) busy = true;

    if (flip && flip.mode === 'drag') {
      flip.theta = solveTheta(drag.tipX, lead, 1);   // the grabbed row's edge sits under the pointer
    } else if (flip) {
      const K = reduce.matches ? 220 : 70, C = 2 * Math.sqrt(K);
      let steps = Math.ceil(dt / (1 / 240));
      const h = dt / steps;
      while (steps--) {
        flip.omega += (K * (flip.target - flip.theta) - C * flip.omega) * h;
        flip.theta += flip.omega * h;
        if (flip.theta < 0) { flip.theta = 0; flip.omega = Math.max(0, flip.omega); }
        if (flip.theta > Math.PI) { flip.theta = Math.PI; flip.omega = Math.min(0, flip.omega); }
      }
      if (Math.abs(flip.theta - flip.target) < 0.003 && Math.abs(flip.omega) < 0.05) settle();
      else busy = true;
    }

    hover.h += (hover.target - hover.h) * (1 - Math.exp(-dt * 12));
    if (Math.abs(hover.target - hover.h) > 0.0005) busy = true;
    else { hover.h = hover.target; if (!hover.target) hover.j = -1; }

    layout();
    if (!pan) {
      const target = camTarget();
      camX += (target - camX) * (reduce.matches ? 1 : 1 - Math.exp(-dt * 9));
      if (Math.abs(target - camX) > 0.0008) busy = true; else camX = target;
    }
    placeCamera();
    renderer.shadowMap.needsUpdate = true;
    const r0 = performance.now();
    renderer.render(scene, camera);
    frameMs = performance.now() - r0;
    book.dataset.state = flip ? flip.mode : 'idle';
    if (busy) wake();
  }

  function camTarget() {
    if (!single) return 0;
    if (!flip && (k === 0 || k === N)) return 0;          // a closed book already sits in the middle
    return bookGroup.position.x + focus * W / 2;
  }

  function placeCamera() {
    camera.position.set(camX, Math.cos(TILT) * camDist, Math.sin(TILT) * camDist - camShift);
    camera.lookAt(camX, 0, -camShift);
  }

  function settle() {
    const f = flip;
    flip = null;
    if (f.dir > 0 && f.target === Math.PI) { k = f.j + 1; focus = -1; }
    if (f.dir < 0 && f.target === 0) { k = f.j; focus = 1; }
    if (k === 0) focus = 1;
    if (k === N) focus = -1;
    lead = 0;
    trimTextures();
    announce();
  }

  function finishNow() {
    if (!flip) return;
    flip.theta = flip.target;
    settle();
  }

  function turn(dir) {
    finishNow();
    if (dir > 0 && k >= N) return;
    if (dir < 0 && k <= 0) return;
    // one-page view: move to the other page of the same spread before turning paper
    if (single && dir > 0 && focus < 0 && k > 0) { focus = 1; announce(); wake(); return; }
    if (single && dir < 0 && focus > 0 && k < N) { focus = -1; announce(); wake(); return; }
    const j = dir > 0 ? k : k - 1;
    if (reduce.matches) {
      k = dir > 0 ? k + 1 : k - 1;
      focus = dir > 0 ? -1 : 1;
      if (k === 0) focus = 1;
      if (k === N) focus = -1;
      trimTextures(); announce(); wake();
      return;
    }
    gz = H * 0.3; // a hand usually lifts a little below the middle
    flip = { j, dir, theta: dir > 0 ? 0 : Math.PI, omega: dir > 0 ? 2.5 : -2.5, target: dir > 0 ? Math.PI : 0, mode: 'spring' };
    wake();
  }

  // open the book straight at page i (no turning through the pages in between). i odd = left page, i even = right page.
  function goToPage(i) {
    finishNow();
    if (i <= 0) { k = 0; focus = 1; }
    else if (i >= pages.length - 1) { k = N; focus = -1; }
    else { k = Math.ceil(i / 2); focus = i % 2 ? -1 : 1; }
    trimTextures(); announce(); wake();
  }

  // pages on screen now: both pages of an open spread, or the one page a phone looks at
  function visiblePages() {
    if (k === 0) return [0];
    if (k === N) return [pages.length - 1];
    if (single) return [focus < 0 ? 2 * k - 1 : 2 * k];
    return [2 * k - 1, 2 * k];
  }

  // ---------- status + buttons ----------
  const status = book.querySelector('.book-status');
  const prev = book.querySelector('.book-prev'), next = book.querySelector('.book-next');
  const total = pages.length;
  function announce() {
    const vis = visiblePages();
    let text;
    if (vis.length === 1) text = `${pages[vis[0]].label}, page ${vis[0] + 1} of ${total}`;
    else text = `Pages ${vis[0] + 1} and ${vis[1] + 1} of ${total}: ${pages[vis[0]].label} / ${pages[vis[1]].label}`;
    status.textContent = text;
    book.dataset.spread = String(k);
    prev.disabled = k === 0;
    next.disabled = k === N;
    markContents(vis);
  }
  prev.addEventListener('click', () => turn(-1));
  next.addEventListener('click', () => turn(1));
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
  });

  // ---------- contents ----------
  // built from the same works list; each entry is a real link (#work-NN) that opens its page at once
  const tocToggle = book.querySelector('.book-toc-toggle');
  const toc = book.querySelector('.book-toc');
  const tocList = toc.querySelector('ol');
  works.forEach((w) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${w.id}`;
    a.dataset.page = String(w.page);
    a.innerHTML = '<span class="toc-now" aria-hidden="true"></span><span class="toc-title"></span><span class="toc-page"></span>';
    a.querySelector('.toc-title').textContent = w.label;
    a.querySelector('.toc-page').textContent = `p. ${w.page + 1}`;
    li.appendChild(a);
    tocList.appendChild(li);
  });
  const tocLinks = [...tocList.querySelectorAll('a')];
  function markContents(vis) {
    for (const a of tocLinks) {
      const on = vis.includes(Number(a.dataset.page));
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      a.querySelector('.toc-now').textContent = on ? 'Open' : '';
    }
  }
  function openContents(open) {
    toc.hidden = !open;
    tocToggle.setAttribute('aria-expanded', String(open));
  }
  tocToggle.addEventListener('click', () => openContents(toc.hidden));
  book.querySelector('.book-bar').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !toc.hidden) { e.preventDefault(); openContents(false); tocToggle.focus(); }
  });
  function openWork(id, scroll) {
    const w = works.find((x) => x.id === id);
    if (!w) return false;
    goToPage(w.page);
    history.replaceState(null, '', `#${id}`);
    if (scroll) book.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'center' });
    return true;
  }
  tocList.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    openWork(a.getAttribute('href').slice(1), false);
    openContents(false);
    tocToggle.focus();
  });
  // any other link to a work (#work-NN) also opens the book there
  document.querySelectorAll('a[href^="#work-"]').forEach((a) => {
    if (tocList.contains(a)) return;
    a.addEventListener('click', (e) => { if (openWork(a.getAttribute('href').slice(1), true)) e.preventDefault(); });
  });
  // the address changed to a work without a reload (typed, pasted or a link elsewhere): follow it
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#work-')) openWork(location.hash.slice(1), true); });

  // ---------- pointer ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  function local(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -N * T;
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x - bookGroup.position.x, z: hit.z };
  }

  // which sheet can be taken from here: outer part of the right page (next) or of the left page (previous)
  function grabbable(p) {
    if (!p || Math.abs(p.z) > H / 2 + 0.03) return null;
    if (p.x > W * 0.03 && p.x < W + 0.04 && k < N && !(single && focus < 0 && k > 0)) return { j: k, dir: 1 };
    if (p.x < -W * 0.03 && p.x > -W - 0.04 && k > 0 && !(single && focus > 0 && k < N)) return { j: k - 1, dir: -1 };
    return null;
  }

  function startFlip(e, p, g) {
    canvas.setPointerCapture(e.pointerId);
    hover.target = 0; hover.h = 0; hover.j = -1;
    gz = Math.max(-H / 2, Math.min(H / 2, p.z));
    flip = { j: g.j, dir: g.dir, theta: g.dir > 0 ? 0 : Math.PI, omega: 0, target: 0, mode: 'drag' };
    drag = { id: e.pointerId, startX: p.x, tipX: g.dir > 0 ? W : -W, samples: [{ t: e.timeStamp, x: p.x }] };
    canvas.style.cursor = 'grabbing';
    wake();
  }

  function unitPx() {
    const a = new THREE.Vector3(camX, 0, 0).project(camera), b = new THREE.Vector3(camX + 1, 0, 0).project(camera);
    return (b.x - a.x) / 2 * canvas.getBoundingClientRect().width;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = local(e);
    if (!p || Math.abs(p.z) > H / 2 + 0.03) return;
    if (single) {
      // wait a few pixels to see whether this is a page turn or a move to the other page
      if (e.pointerType === 'mouse') e.preventDefault();
      finishNow();
      pending = { id: e.pointerId, cx: e.clientX, e, p: local(e) };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const g = grabbable(p);
    if (!g) return;
    e.preventDefault();
    finishNow();
    const again = grabbable(p);  // k may have moved when an earlier flip was finished
    if (!again) return;
    startFlip(e, p, again);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pending && e.pointerId === pending.id) {
      const dx = e.clientX - pending.cx;
      if (Math.abs(dx) < 8) return;
      const g = grabbable(pending.p);
      const start = pending;
      pending = null;
      if (g && Math.sign(dx) === -g.dir) startFlip(start.e, start.p, g);
      else if (k > 0 && k < N && ((dx > 0 && focus > 0) || (dx < 0 && focus < 0))) {
        pan = { id: e.pointerId, cx: start.cx, cam: camX, unit: unitPx(), samples: [{ t: e.timeStamp, x: e.clientX }] };
      }
      if (!pan && !drag) return;
    }
    if (pan && e.pointerId === pan.id) {
      const lo = bookGroup.position.x - W / 2, hi = bookGroup.position.x + W / 2;
      camX = Math.max(lo, Math.min(hi, pan.cam - (e.clientX - pan.cx) / pan.unit));
      pan.samples.push({ t: e.timeStamp, x: e.clientX });
      while (pan.samples.length > 2 && e.timeStamp - pan.samples[0].t > 90) pan.samples.shift();
      wake();
      return;
    }
    const p = local(e);
    if (drag && e.pointerId === drag.id) {
      if (!p) return;
      // the spot you hold (not only the corner) follows the pointer: a grab near the spine turns the page as far
      const base = flip.dir > 0 ? W : -W;
      const reach = W / Math.max(Math.abs(drag.startX), W * 0.3);
      drag.tipX = Math.max(-W, Math.min(W, base + (p.x - drag.startX) * reach));
      gz += (Math.max(-H / 2, Math.min(H / 2, p.z)) - gz) * 0.35;
      drag.samples.push({ t: e.timeStamp, x: p.x });
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
      wake();
      return;
    }
    if (e.pointerType !== 'mouse' || flip) return;
    const g = grabbable(p);
    canvas.style.cursor = g ? 'grab' : '';
    // idle: the outer corner lifts a few pixels under the cursor
    const nearCorner = g && Math.abs(p.x) > W * 0.8 && Math.abs(p.z) > H * 0.3;
    const j = nearCorner ? g.j : -1;
    if (j !== hover.j && hover.h > 0.001 && j !== -1) return; // let the old corner settle first
    if (nearCorner) { hover.j = j; hz = Math.sign(p.z) * H / 2; hover.target = 0.07; }
    else hover.target = 0;
    wake();
  });

  canvas.addEventListener('pointerleave', () => { if (!drag) { hover.target = 0; canvas.style.cursor = ''; wake(); } });

  function release(e) {
    if (pending && e.pointerId === pending.id) { pending = null; return; }
    if (pan && e.pointerId === pan.id) {
      const s = pan.samples, a = s[0], b = s[s.length - 1];
      const v = b.t > a.t ? -(b.x - a.x) / pan.unit / ((b.t - a.t) / 1000) : 0;   // camera speed, pages per second
      const moved = camX - pan.cam;
      if (e.type !== 'pointercancel' && (Math.abs(moved) > W * 0.25 || Math.abs(v) > 0.8)) focus = moved + v * 0.1 > 0 ? 1 : -1;
      pan = null;
      announce(); wake();
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const s = drag.samples, a = s[0], b = s[s.length - 1];
    const vx = b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0;   // pages per second
    const th = flip.theta;
    let commit;
    if (flip.dir > 0) commit = (th > Math.PI / 2 && vx < 0.9) || (vx < -0.9 && th > 0.04);
    else commit = (th < Math.PI / 2 && vx > -0.9) || (vx > 0.9 && th < Math.PI - 0.04);
    if (e.type === 'pointercancel') commit = flip.dir > 0 ? th > Math.PI / 2 : th < Math.PI / 2;
    flip.target = flip.dir > 0 ? (commit ? Math.PI : 0) : (commit ? 0 : Math.PI);
    const omega = -vx / (W * Math.max(Math.sin(th), 0.35));
    flip.omega = Math.max(-14, Math.min(14, omega));
    flip.mode = 'spring';
    drag = null;
    canvas.style.cursor = '';
    wake();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // ---------- size ----------
  function resize() {
    const w = stage.clientWidth;
    if (!w) return;
    single = w < 600;
    TILT = THREE.MathUtils.degToRad(single ? 8 : 18);
    // phones: keep the near (widest) edge of the page at least 16px from the screen edge
    const margin = single ? W * 40 / Math.max(1, w - 40) : 0.1;
    // headroom above the far edge for a page standing near 90 degrees
    const head = single ? W * 0.42 : W * Math.sin(TILT) * 1.2;   // the camera is close on phones, so a standing page rises more
    const needW = (single ? W : 2 * W) + margin, needH = (H + margin) * Math.cos(TILT) + head;
    const h = Math.round(Math.min(w * needH / needW, window.innerHeight * 0.9));
    stage.style.height = `${h}px`;
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camDist = Math.max(needW / (2 * tanV * camera.aspect), needH / (2 * tanV));
    camShift = head / 2 / Math.cos(TILT);   // aim a little beyond the middle so the book sits lower
    camX = camTarget();
    placeCamera();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // the empty room above the far edge of the book slides up behind the section title
    const far = new THREE.Vector3(camX, N * T, -H / 2).project(camera);
    // but never over the content above the title (the hero link stays clickable)
    const credits = document.querySelector('.poster-head');   // the credits line above the book (plain text)
    const room = credits ? credits.offsetHeight : 0;   // up to the top of the section, never over the hero
    book.style.setProperty('--book-head', `${Math.max(0, Math.min(room, Math.round((1 - far.y) / 2 * h)))}px`);
    announce();
    wake();
  }
  new ResizeObserver(resize).observe(stage);

  // debug view for tests: current spread and flip state, read only
  book.bookState = () => ({
    spread: k, sheets: N, flipping: !!flip, frameMs, single, focus, camX, panning: !!pan,
    hoverLift: hover.j >= 0 ? (() => { const a = sheets[hover.j].geo.attributes.position.array; let m = -1, lo = 1; for (let i = 1; i < a.length; i += 3) { m = Math.max(m, a[i]); lo = Math.min(lo, a[i]); } return m - lo; })() : 0, mode: flip ? flip.mode : 'idle',
    theta: flip ? flip.theta : null, lead,
    textures: textures.size,
    tip: flip ? (() => { const a = sheets[flip.j].geo.attributes.position.array; const i = ((NZ / 2) * (NX + 1) + NX) * 3; return { x: a[i], y: a[i + 1] }; })() : null,
    mid: flip ? (() => { const a = sheets[flip.j].geo.attributes.position.array; const i = ((NZ / 2) * (NX + 1) + NX / 2) * 3; return { x: a[i], y: a[i + 1] }; })() : null,
  });

  // page point (x from the spine, z from the middle) -> client pixels, for tests
  book.bookProject = (x, z) => {
    const v = new THREE.Vector3(x + bookGroup.position.x, N * T, z).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  };
  book.bookInfo = () => ({
    geometries: renderer.info.memory.geometries, gpuTextures: renderer.info.memory.textures,
    canvas: [canvas.width, canvas.height], aspect: camera.aspect,
    faces: flip ? [flip.j * 2, flip.j * 2 + 1].map((i) => pages[i].label) : null,
    visibleSheets: sheets.filter((s) => s.front.visible).map((s) => s.j),
  });

  // a phone picks the book up from its cover; wide screens open on the first spread
  book.hidden = false;
  if (stage.clientWidth < 600) { k = 0; focus = 1; }
  const startWork = works.find((w) => `#${w.id}` === location.hash);
  if (startWork) { single = stage.clientWidth < 600; k = Math.ceil(startWork.page / 2); focus = startWork.page % 2 ? -1 : 1; }
  trimTextures();
  announce();
  document.documentElement.classList.add('book-ready');
  resize();
}
