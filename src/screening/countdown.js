// Two pictures drawn on a canvas for the screen:
//   createLeader()    the old film countdown: a wipe sweeping round the circle, 3, 2, 1
//   createTestCard()  the stand-in film for a clip that has no video yet (or ?fallback=1): a black-and-white test card with a large
//                     timecode and OUT / BACK marked at the cue times. It behaves like a <video> (currentTime, play, pause, ended),
//                     so the rest of the scene cannot tell the two apart.
import * as THREE from 'three';

const W = 640, H = 480;            // 4:3, the screen's shape

function canvasTexture() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return { canvas: c, g: c.getContext('2d'), texture: t };
}

function scratches(g, seed) {
  // a few film scratches and dust specks, different every frame
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  g.strokeStyle = 'rgba(20,20,20,.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 2; i++) { const x = rnd() * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 8, H); g.stroke(); }
  g.fillStyle = 'rgba(20,20,20,.5)';
  for (let i = 0; i < 6; i++) g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
}

export function createLeader() {
  const { g, texture } = canvasTexture();
  let lastKey = '';
  return {
    texture,
    /** t: seconds into the countdown (0 .. 3) */
    draw(t) {
      const n = Math.max(1, 3 - Math.floor(t)), f = t - Math.floor(t), frame = Math.floor(t * 24);
      const key = n + ':' + frame;
      if (key === lastKey) return;
      lastKey = key;
      const cx = W / 2, cy = H / 2, r = H * 0.42;
      g.fillStyle = '#d9d4c7'; g.fillRect(0, 0, W, H);
      // the wipe: a darker wedge from twelve o'clock, clockwise, over each second
      g.fillStyle = '#9c978b';
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); g.closePath(); g.fill();
      g.strokeStyle = '#1d1d1f'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, cy); g.lineTo(W, cy); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke();
      g.lineWidth = 6;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, r * 0.82, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#1d1d1f';
      g.font = '700 ' + Math.round(H * 0.56) + 'px "So What Franklin", "Franklin Gothic Medium", "Arial Narrow", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), cx, cy + H * 0.03);
      scratches(g, frame);
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); },
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function createTestCard(clip, duration = 15) {
  const { g, texture } = canvasTexture();
  let time = 0, playing = false, started = 0, ended = false, lastFrame = -1;
  const listeners = { ended: [], play: [], pause: [], seeked: [] };
  const emit = (type) => listeners[type].forEach((fn) => fn());
  const now = () => performance.now() / 1000;
  function current() {
    if (!playing) return time;
    const t = time + (now() - started);
    if (t >= duration) { time = duration; playing = false; ended = true; emit('ended'); return time; }
    return t;
  }
  function draw() {
    const t = current(), frame = Math.floor(t * 24);
    if (frame === lastFrame) return;
    lastFrame = frame;
    g.fillStyle = '#efe6d0'; g.fillRect(0, 0, W, H);
    // a test card: grey steps along the top, a grid, a circle
    for (let i = 0; i < 8; i++) { const v = Math.round(29 + i * 30); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(i * W / 8, 0, W / 8, H * 0.12); }
    g.strokeStyle = 'rgba(29,29,31,.35)'; g.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, H * 0.12); g.lineTo(x, H); g.stroke(); }
    for (let y = H * 0.12; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = '#1d1d1f'; g.lineWidth = 4;
    g.beginPath(); g.arc(W / 2, H * 0.56, H * 0.3, 0, Math.PI * 2); g.stroke();
    // the player's spot at `out`: a figure-sized frame where the screenPos and screenScale say
    const [px, py] = clip.screenPos, h = clip.screenScale * H, fx = W / 2 + px * W, fy = H / 2 - py * H;
    const out = t >= clip.out && t < clip.back;
    g.setLineDash([8, 6]); g.lineWidth = 3; g.strokeStyle = out ? 'rgba(29,29,31,.35)' : '#1d1d1f';
    g.strokeRect(fx - h * 0.18, fy - h, h * 0.36, h);
    g.setLineDash([]);
    // timecode
    g.fillStyle = '#1d1d1f';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 ' + Math.round(H * 0.17) + 'px "So What Franklin", "Franklin Gothic Medium", "Arial Narrow", sans-serif';
    g.fillText(pad(Math.floor(t)) + ':' + pad(Math.floor((t % 1) * 100)), W / 2, H * 0.56);
    g.font = '400 ' + Math.round(H * 0.05) + 'px "So What Franklin", "Franklin Gothic Medium", "Arial Narrow", sans-serif';
    g.fillText('STAND-IN FILM / ' + clip.member.toUpperCase(), W / 2, H * 0.94);
    // OUT / BACK marked for half a second at the cues
    const mark = Math.abs(t - clip.out) < 0.5 ? 'OUT' : Math.abs(t - clip.back) < 0.5 ? 'BACK' : '';
    if (mark) {
      g.fillStyle = '#1d1d1f'; g.fillRect(W * 0.3, H * 0.16, W * 0.4, H * 0.14);
      g.fillStyle = '#efe6d0'; g.font = '700 ' + Math.round(H * 0.1) + 'px "So What Franklin", "Franklin Gothic Medium", sans-serif';
      g.fillText(mark, W / 2, H * 0.235);
    }
    scratches(g, frame);
    texture.needsUpdate = true;
  }
  draw();
  return {
    texture,
    draw,
    get currentTime() { return current(); },
    set currentTime(v) { time = Math.max(0, Math.min(duration, v)); started = now(); ended = time >= duration; lastFrame = -1; emit('seeked'); },
    get duration() { return duration; },
    get paused() { return !playing; },
    get ended() { return ended; },
    muted: false,
    readyState: 4,
    play() { if (ended) { time = 0; ended = false; } if (!playing) { started = now(); playing = true; emit('play'); } return Promise.resolve(); },
    pause() { if (playing) { time = current(); playing = false; emit('pause'); } },
    load() {},
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { const l = listeners[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    dispose() { texture.dispose(); },
  };
}
