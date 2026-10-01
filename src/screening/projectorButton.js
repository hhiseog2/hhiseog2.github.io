// The projector is the button: a transparent native <button> laid over the projector's on-screen box (16 px of slack on every
// side for fingers, never under 44 x 44 px). No visible text; the name follows the show: "Play the screening" /
// "Pause the screening" / "Resume the screening". A focus ring is drawn round the projector only for keyboard focus.
import * as THREE from 'three';

const PAD = 16, MIN = 44;

export function createProjectorButton(stage, button) {
  const box = new THREE.Box3(), v = new THREE.Vector3();
  let hover = false, pressedAt = -1;
  const onEnter = () => { hover = true; };
  const onLeave = () => { hover = false; };
  const onDown = () => { pressedAt = performance.now(); };
  button.addEventListener('pointerenter', onEnter);
  button.addEventListener('pointerleave', onLeave);
  button.addEventListener('pointerdown', onDown);
  button.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onDown(); });
  return {
    get hover() { return hover; },
    /** 0..1 press bounce envelope (a quick dip and a springy return) */
    press(now = performance.now()) {
      const t = (now - pressedAt) / 1000;
      if (pressedAt < 0 || t > 0.45) return 0;
      return t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) / 0.09) * Math.cos((t - 0.08) * 30);
    },
    /** lay the button over the object's box, as the camera sees it on a canvas of width x height */
    place(object, camera, width, height) {
      box.setFromObject(object, true);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        const x = (v.x * 0.5 + 0.5) * width, y = (0.5 - v.y * 0.5) * height;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
      y1 = Math.min(height, y1);                                   // the plinth may run off the bottom of the canvas
      let w = x1 - x0, h = y1 - y0;
      if (w < MIN) { x0 -= (MIN - w) / 2; w = MIN; }
      if (h < MIN) { y0 = Math.min(y0, height - MIN); h = MIN; }
      stage.style.setProperty('--proj-x', x0.toFixed(1) + 'px');
      stage.style.setProperty('--proj-y', y0.toFixed(1) + 'px');
      stage.style.setProperty('--proj-w', w.toFixed(1) + 'px');
      stage.style.setProperty('--proj-h', h.toFixed(1) + 'px');
      return [x0, y0, w, h];
    },
    label(state, paused) {
      const name = state === 'PLAYING' ? (paused ? 'Resume the screening' : 'Pause the screening') : 'Play the screening';
      if (button.getAttribute('aria-label') !== name) button.setAttribute('aria-label', name);
      const busy = state === 'OPENING' || state === 'COUNTDOWN' || state === 'RUNOUT' || state === 'CLOSING';
      button.setAttribute('aria-disabled', busy ? 'true' : 'false');
    },
  };
}
