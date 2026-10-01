// The stage: no seats, a big screen at the clip's own shape, a dark wall and proscenium round it, a plain floor that fades to
// black toward the audience, and the projector on a low plinth in the middle. fit() places the camera for the canvas's shape
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
  // the projector's plinth (height set in fit)
  const plinth = new THREE.Mesh(keep(new THREE.BoxGeometry(0.7, 1, 0.7)), keep(new THREE.MeshLambertMaterial({ color: new THREE.Color('#1c1c1e') })));
  group.add(wall, floor, frame, border, plinth);

  const lookDir = new THREE.Vector3(0, 0, -1);
  return {
    group, S, wall, floor, frame, border, plinth,
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
      const below = mobile ? 0.2 : 0.2;                                      // canvas share kept under the screen for the projector
      const maxShare = (1 - headroom - below) * SCREENING.clip.aspect / aspect;
      const share = Math.min(mobile ? st.screenWidthOfCanvas.mobile : st.screenWidthOfCanvas.desktop, maxShare);
      const D = S.W / (2 * share * th);                                      // camera distance to the screen plane
      const camY = S.top - (1 - 2 * headroom) * D * tv;                      // screen top at `headroom` from the canvas top
      camera.fov = vfov; camera.aspect = aspect; camera.near = 0.1; camera.far = D + 40;
      camera.position.set(0, camY, D);
      camera.lookAt(camera.position.clone().add(lookDir));
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      // projector: part way from the camera to the screen, its reels just under the screen's bottom edge on the canvas, and sized
      // so all of it (reels to base) fits in the band left under the screen
      const dc = D * (mobile ? 0.42 : 0.5);
      const screenBottomNdc = (S.bottom - camY) / (D * tv);
      const reelsNdc = screenBottomNdc - (mobile ? 0.1 : 0.05);
      const reelsY = camY + reelsNdc * dc * tv;
      const band = (reelsNdc + 1) * dc * tv;                                 // world height from the canvas bottom up to the reels
      const size = Math.min(CONFIG.projectorSize, band / 0.66);
      const baseY = Math.max(0.05, reelsY - 0.62 * size);
      const projectorAt = new THREE.Vector3(0, baseY, D - dc);
      this.plinth.scale.set(1, baseY, 1);
      this.plinth.position.set(0, baseY / 2, D - dc);
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
