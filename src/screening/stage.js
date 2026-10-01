// The stage: no seats, a big screen at the clip's own shape, a dark wall and proscenium round it, a plain floor that fades to
// black toward the audience, and the projector on a small wooden slab in the middle. fit() places the camera for the canvas's shape
// so the screen takes its share of the canvas width with room above it for the frontman, and the projector shows below it.
//
// World: the screen's plane is z = 0 (the pop-out's clipping plane), the floor y = 0, the camera looks straight down -z.
import * as THREE from 'three';
import { CONFIG, SCREENING } from './config.js';

export function screenSize() {
  const W = CONFIG.screen.width, H = W / SCREENING.clip.aspect;
  const bottom = CONFIG.screen.bottom;
  return { W, H, bottom, top: bottom + H, centre: new THREE.Vector3(0, bottom + H / 2, 0) };
}

function floorMaterial() {
  // a plain dark floor; vertex colours take it to black toward the audience. Lambert, so the screen and the curtain light it.
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(CONFIG.palette.floor), vertexColors: true });
}

export function createStage() {
  const S = screenSize();
  const P = CONFIG.palette;
  const group = new THREE.Group();
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(40, 20)), keep(new THREE.MeshLambertMaterial({ color: new THREE.Color(P.wall) })));
  wall.position.set(0, 10, -0.6);
  // floor: 40 x 30 m from the wall toward the camera, black at the near end
  const floorGeo = keep(new THREE.PlaneGeometry(40, 30, 1, 30));
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, 0, 14.4);
  const colors = [], pos = floorGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), k = Math.max(0, 1 - Math.max(0, z - 0.5) / 9);       // full colour at the stage, black 9 m out
    colors.push(k, k, k);
  }
  floorGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const floor = new THREE.Mesh(floorGeo, keep(floorMaterial()));
  // the proscenium: a plain dark frame a little outside the curtain's reach
  const frameMat = keep(new THREE.MeshLambertMaterial({ color: new THREE.Color(P.frame) }));
  const ow = S.W + 3.2, top = S.top + 1.25;
  const frame = new THREE.Group();
  const bar = (w, h, x, y) => { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.4)), frameMat); m.position.set(x, y, 0.55); frame.add(m); };
  bar(ow + 1.2, 1.6, 0, top + 0.8);                         // header
  bar(0.6, top, -ow / 2 - 0.3, top / 2);                    // sides
  bar(0.6, top, ow / 2 + 0.3, top / 2);
  // the screen's own black border
  const border = new THREE.Group();
  const fw = 0.08;
  const edge = (w, h, x, y) => { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.04)), frameMat); m.position.set(x, y, -0.02); border.add(m); };
  edge(S.W + fw * 2, fw, 0, S.H / 2 + fw / 2); edge(S.W + fw * 2, fw, 0, -S.H / 2 - fw / 2);
  edge(fw, S.H, S.W / 2 + fw / 2, 0); edge(fw, S.H, -S.W / 2 - fw / 2, 0);
  border.position.copy(S.centre);
  // a thin antique-brass line inside the proscenium
  const brassMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(P.brass), metalness: 0.9, roughness: 0.4 }));
  const line = (w, h, x, y) => { const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.02)), brassMat); m.position.set(x, y, 0.76); frame.add(m); };
  line(ow + 0.02, 0.025, 0, top + 0.02); line(0.025, top, -ow / 2 - 0.01, top / 2); line(0.025, top, ow / 2 + 0.01, top / 2);
  // smoke: two large, faint, warm drifts in front of the wall
  const smokeCanvas = document.createElement('canvas'); smokeCanvas.width = smokeCanvas.height = 128;
  const sg = smokeCanvas.getContext('2d'), sgr = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
  sgr.addColorStop(0, 'rgba(255,210,170,0.55)'); sgr.addColorStop(1, 'rgba(255,210,170,0)');
  sg.fillStyle = sgr; sg.fillRect(0, 0, 128, 128);
  const smokeMap = keep(new THREE.CanvasTexture(smokeCanvas)); smokeMap.colorSpace = THREE.SRGBColorSpace;
  const smokeMat = keep(new THREE.SpriteMaterial({ map: smokeMap, transparent: true, depthWrite: false, opacity: 0.1 }));
  const smoke = [[-1.4, S.centre.y + 0.6, 1.2, 5.5], [1.8, S.centre.y - 0.4, 1.6, 6.5]].map(([x, y, z, sc]) => { const sp = new THREE.Sprite(smokeMat); sp.position.set(x, y, z); sp.scale.set(sc, sc * 0.6, 1); return sp; });
  // a small, low wooden slab the projector stands on (stained wood, slightly bevelled by its own lighting)
  const slab = new THREE.Mesh(keep(new THREE.BoxGeometry(1, 1, 1)), keep(new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e180c'), roughness: 0.55, metalness: 0.05 })));
  group.add(wall, floor, frame, border, slab, ...smoke);

  const lookDir = new THREE.Vector3(0, 0, -1);
  return {
    group, S, wall, floor, frame, border, smoke, slab,
    /**
     * Camera and projector for a canvas of this shape.
     *   share     screen width as a share of the canvas width (clamped so the screen, the room above it and the projector fit)
     *   headroom  free share of the canvas height above the screen
     * Returns the numbers the rest of the scene uses (projector place, the hover place for the frontman, the share achieved).
     */
    fit(camera, width, height, mobile) {
      const st = SCREENING.stage, aspect = width / height;
      const vfov = mobile ? 46 : 34;
      const tv = Math.tan(THREE.MathUtils.degToRad(vfov / 2)), th = tv * aspect;
      const headroom = st.headroomAbove;
      const below = mobile ? 0.3 : 0.26;                                     // canvas share kept under the screen for the projector
      const maxShare = (1 - headroom - below) * SCREENING.clip.aspect / aspect;
      const share = Math.min(mobile ? st.screenWidthOfCanvas.mobile : st.screenWidthOfCanvas.desktop, maxShare);
      const D = S.W / (2 * share * th);                                      // camera distance to the screen plane
      const camY = S.top - (1 - 2 * headroom) * D * tv;                      // screen top at `headroom` from the canvas top
      camera.fov = vfov; camera.aspect = aspect; camera.near = 0.1; camera.far = D + 40;
      camera.position.set(0, camY, D);
      camera.lookAt(camera.position.clone().add(lookDir));
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      // projector: near the camera on a small, low wooden slab, whole and centred at the bottom of the canvas, sized so its reels
      // stay under the screen's bottom edge
      const screenBottomNdc = (S.bottom - camY) / (D * tv);
      const reelsNdc = screenBottomNdc - (mobile ? 0.05 : 0.03);
      const baseNdc = mobile ? -0.82 : -0.84;
      const dc = D * (mobile ? 0.42 : 0.4);
      const band = (reelsNdc - baseNdc) * dc * tv;                         // world height from its base up to its reels
      const size = Math.min(CONFIG.projectorSize, band / 0.7);
      const baseY = camY + baseNdc * dc * tv;
      const projectorAt = new THREE.Vector3(0, baseY, D - dc);
      this.slab.scale.set(size * 0.62, 0.06, size * 0.36);
      this.slab.position.set(0, baseY - 0.03, D - dc);
      // where the frontman floats for his solo: about 65% up the screen's height, halfway between the screen and the projector,
      // never taller than maxCanvasHeight of the canvas, with his feet above the projector and his head inside the canvas
      const h = SCREENING.popout.hover;
      const hz = projectorAt.z * h.depthBetween, dist = D - hz;
      const ndcY = (y) => (y - camY) / (dist * tv), yAt = (ndc) => camY + ndc * dist * tv;
      const hoverHeight = Math.min(h.maxCanvasHeight * 2 * dist * tv, SCREENING.popout.exitScale * S.H);
      let feet = S.bottom + S.H * h.heightOfScreen - hoverHeight / 2;
      feet = Math.max(feet, yAt(reelsNdc + 0.08));                          // clear of the projector
      feet = Math.min(feet, yAt(0.94) - hoverHeight * 1.05);                // head inside the canvas
      const hover = new THREE.Vector3(0, feet, hz);
      // yAt(ndc, z): the world height that shows at canvas height ndc (-1 bottom .. 1 top) for a point at depth z
      const yAtNdc = (ndc, z) => camY + ndc * (D - z) * tv;
      return { D, camY, vfov, share, headroom, aspect, projectorAt, projectorSize: size, hover, hoverHeight, tv, reelsNdc, screenBottomNdc, yAt: yAtNdc };
    },
    dispose() { disposables.forEach((d) => d.dispose()); group.removeFromParent(); },
  };
}
