// Hologram jazz trio: every number the scene shares (rq-20260930-409ebb88, reference/hologram-3d-prompt.md).
// The 2D prototype the brief mentions was never available, so these are the brief's own values.
// The site has no bundler: model URLs are resolved from this file, so they work from any folder the site is served from.
//
// Two themes (rq-20260930-42db6df6), switched with ?theme=site or ?theme=reggae in the address. The default is site.
//   reggae — the brief's look: cyan hologram in a navy room, amber light, red / gold / green accents.
//   site   — the site's own ink, cream paper and poster blue (style.css --ink / --paper / --blue); the three colours stay only on
//            the pedestal rings, toned down, and the scene is calmer: slower carousel, rarer glitch, no camera dolly.

const asset = (path) => new URL('../../public/' + path, import.meta.url).href;

const RASTA = ['#FF5A4E', '#FFD24A', '#3EE07A'];
export const THEMES = {
  reggae: {
    palette: {
      holo: '#5EF0FF', amber: '#FFD27A', brass: '#C9A24A', rasta: RASTA, accent: RASTA, notes: RASTA, motes: ['#5EF0FF', '#5EF0FF', '#5EF0FF', ...RASTA],
      bg: '#0F1326', floor: '#5a3a22', table: '#2a1a10', key: '#ffd8a8', paint: null, metal: null,
    },
    orbitScale: 1, glitchEvery: 4.7, dolly: true,
  },
  site: {
    palette: {
      holo: '#3d8fe0', amber: '#efe6d0', brass: '#b9b09c',
      rasta: ['#bf746f', '#e5d193', '#76bf91'],                       // the three colours, 55% toward grey: pedestal rings only
      accent: ['#efe6d0', '#9cc4ee', '#efe6d0'], notes: ['#efe6d0', '#3d8fe0', '#efe6d0'], motes: ['#3d8fe0', '#3d8fe0', '#efe6d0'],
      bg: '#1d1d1f', floor: '#4a4844', table: '#242426', key: '#efe6d0', paint: '#2b2b2e', metal: '#cfc6b0',
    },
    orbitScale: 1.3, glitchEvery: 9, dolly: false,
  },
};
export const DEFAULT_THEME = 'site';      // the owner's choice (rq-20261001-36f83e25)

function pickTheme() {
  try {
    const asked = new URLSearchParams(window.location.search).get('theme');
    if (asked && THEMES[asked]) return asked;
  } catch (e) { /* no window: the default */ }
  return DEFAULT_THEME;
}
export const THEME = pickTheme();
const T = THEMES[THEME];

export const CONFIG = {
  theme: THEME,
  themes: THEMES,
  palette: T.palette,
  models: { sax: asset('models/sax.glb'), bass: asset('models/bass.glb'), frontman: asset('models/frontman.glb'), projector: asset('models/projector.glb') },
  draco: asset('draco/'),
  orbit: { radius: 1.6, secondsPerMusician: 3.5 * T.orbitScale, order: ['sax', 'bass', 'frontman'] },
  spin: { secondsPerTurn: 5.7 },
  music: { bpm: 80, beatsPerLoop: 4, loopSeconds: 3.0 },   // the `play` action: 4 beats at 80 BPM = 3.0s (90 frames at 30fps)
  hologram: { glitchEvery: T.glitchEvery, glitchDuration: 0.07, flicker: 0.1 },
  camera: { parallaxDeg: 3, dollySeconds: 12, dolly: T.dolly },
  fadeInSeconds: 0.6,
  performance: { maxDpr: 2, mobileBreakpoint: 768, maxDrawCalls: 150 },
  // Quality steps, picked from the measured frame time (scene.js). Phones and narrow windows start at "medium".
  //   dpr: pixel ratio cap · bloom: glow pass + aberration, grain, vignette · mirror: real floor reflection (a second render)
  //   copies: flipped faint copies on the floor instead · smaa · lines: edge outlines · particles: share of motes and dust drawn
  quality: {
    high: { dpr: 2, bloom: true, mirror: true, copies: false, smaa: true, lines: true, particles: 1 },
    medium: { dpr: 1.5, bloom: false, mirror: false, copies: true, smaa: true, lines: true, particles: 0.5 },
    low: { dpr: 1, bloom: false, mirror: false, copies: false, smaa: false, lines: false, particles: 0.25 },
    order: ['high', 'medium', 'low'],
    settleSeconds: 2, settleDown: 25, settleDownTwo: 40,      // first 2s: average frame over 25ms -> one step down, over 40ms -> two
    watchSeconds: 5, watchDown: 25,                           // while running: a 5s average over 25ms -> one step down
  },
};

// Carousel progress in "musicians passed": one step every secondsPerMusician, easing in and out so each player rests at the front.
//   prog = fl + fr - sin(2π·fr) / (2π)      (fl = whole steps, fr = fraction of the current step)
export function orbitProgress(seconds) {
  const s = seconds / CONFIG.orbit.secondsPerMusician;
  const fl = Math.floor(s), fr = s - fl;
  return fl + fr - Math.sin(2 * Math.PI * fr) / (2 * Math.PI);
}

// Same numbers every visit: the first frame of the scene is the still picture the page opened with.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
