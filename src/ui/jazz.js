// Jazz click feedback (rq-20261001-da14ec6d). One delegated listener set for the whole page; an element opts in with data-jazz:
//   snap  (ordinary buttons)      pluck (navigation links, contents)      stab (the main button)      hat (toggles)
// Press: shrink to 0.96 while held, swing back on release (style.css .jz-press / .jz-release, under 220ms).
// Ripple: two or three thin rings, like record grooves, spread from the point pressed in 320ms (keyboard: from the element's centre).
// Sound: made here with the Web Audio API (no audio files), quiet, OFF by default; the header's Sound button turns it on and the
// choice is kept in this browser. Android phones also get a tiny buzz on the main button.
// Reduced motion: no shrink, no rings, no staggered entry, only the colour change (style.css). Sound still follows the visitor's choice.

const KINDS = new Set(['snap', 'pluck', 'stab', 'hat']);
const STORE = 'sowhat-sound';
const RINGS = { snap: 2, pluck: 3, stab: 3, hat: 2 };
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = { sound: false, ctx: null, master: null, noise: null, step: 0, counts: { press: 0, ripple: 0, voice: [] } };

function kindOf(el) {
  const k = el && el.dataset.jazz;
  return KINDS.has(k) ? k : null;
}
function target(e) {
  const el = e.target instanceof Element ? e.target.closest('[data-jazz]') : null;
  if (!el || el.matches('[disabled], [aria-disabled="true"]')) return null;
  return kindOf(el) ? el : null;
}

// ---------- press and swing ----------
function press(el) {
  el.classList.remove('jz-release');
  el.classList.add('jz-press');
  state.counts.press++;
}
function release(el) {
  if (!el.classList.contains('jz-press')) return;
  el.classList.remove('jz-press');
  if (reduce.matches) return;
  void el.offsetWidth;                                       // restart the swing if it is pressed again quickly
  el.classList.add('jz-release');
  el.addEventListener('animationend', () => el.classList.remove('jz-release'), { once: true });
}

// ---------- record-groove rings ----------
let layer = null;
function ripple(el, x, y) {
  if (reduce.matches) return;
  if (!layer) { layer = document.createElement('div'); layer.className = 'jz-layer'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer); }
  const color = getComputedStyle(el).getPropertyValue('--jz-color').trim();
  const n = RINGS[kindOf(el)] || 2;
  for (let i = 0; i < n; i++) {
    const r = document.createElement('span');
    r.className = 'jz-ring';
    r.style.left = `${x}px`; r.style.top = `${y}px`;
    r.style.animationDelay = `${i * 45}ms`;
    r.style.animationDuration = `${320 - i * 45}ms`;         // all rings end together, inside 320ms
    if (color) r.style.setProperty('--jz-color', color);
    r.addEventListener('animationend', () => r.remove(), { once: true });
    layer.appendChild(r);
  }
  state.counts.ripple++;
}

// ---------- synthesised voices ----------
// E blues scale from the low E of an upright bass (E2), climbed one note per pluck
const BLUES = [82.41, 98.0, 110.0, 116.54, 123.47, 146.83, 164.81];

function audio() {
  if (state.ctx) return state.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0.18; master.connect(ctx.destination);
  const len = Math.round(ctx.sampleRate * 0.1), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  Object.assign(state, { ctx, master, noise: buf });
  return ctx;
}
function env(ctx, peak, attack, decay) {
  const g = ctx.createGain(), t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}
function noiseBurst(ctx, type, freq, q, peak, dur) {
  const src = ctx.createBufferSource(); src.buffer = state.noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = env(ctx, peak, 0.002, dur);
  src.connect(f).connect(g).connect(state.master);
  src.start(); src.stop(ctx.currentTime + dur + 0.02);
}
const VOICES = {
  snap(ctx) { noiseBurst(ctx, 'bandpass', 2200, 1.6, 0.9, 0.04); },                     // a finger snap: ~40ms band-passed noise
  hat(ctx) { noiseBurst(ctx, 'highpass', 7500, 0.7, 0.5, 0.03); },                       // closed hi-hat: ~30ms high-passed noise
  pluck(ctx) {                                                                            // upright bass: low, quick decay (~250ms)
    const f0 = BLUES[state.step++ % BLUES.length], t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0 * 1.02, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.04);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const g = env(ctx, 1.0, 0.004, 0.25);
    o.connect(lp).connect(g).connect(state.master); o.start(); o.stop(t + 0.3);
  },
  stab(ctx) {                                                                             // muted trumpet: saws through a low-pass (~120ms)
    const t = ctx.currentTime, lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 6; lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(1800, t + 0.03); lp.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    const g = env(ctx, 0.45, 0.012, 0.11);
    for (const [f, det] of [[233.08, -6], [233.08, 6], [293.66, 0]]) {               // B-flat and D, slightly detuned
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + 0.15);
    }
    lp.connect(g).connect(state.master);
  },
};
function play(kind) {
  if (!state.sound) return;
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  VOICES[kind](ctx);
  state.counts.voice.push(kind);
}

// ---------- haptics: Android phones, main button only ----------
const ANDROID = /Android/i.test(navigator.userAgent);
function buzz(kind) {
  if (kind === 'stab' && ANDROID && typeof navigator.vibrate === 'function') { try { navigator.vibrate(8); } catch (err) { /* not allowed here */ } }
}

// ---------- one delegated listener set ----------
let held = null;
function onPointerDown(e) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const el = target(e);
  if (!el) return;
  held = el;
  press(el);
  ripple(el, e.clientX, e.clientY);
  const k = kindOf(el);
  play(k); buzz(k);
}
function onPointerEnd() { if (held) { release(held); held = null; } }
function onKeyDown(e) {
  if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
  const el = target(e);
  if (!el) return;
  if (e.key === ' ' && el.tagName === 'A') return;          // Space scrolls the page on a link; it does not activate it
  press(el);
  const r = el.getBoundingClientRect();
  ripple(el, r.left + r.width / 2, r.top + r.height / 2);
  const k = kindOf(el);
  play(k); buzz(k);
  if (e.key === 'Enter') setTimeout(() => release(el), 90);  // Enter acts on keydown, so release right after
}
function onKeyUp(e) {
  if (e.key !== ' ') return;
  const el = target(e);
  if (el) release(el);
}

// ---------- staggered entry: long-short (2:1), like swung eighths ----------
function swingDelays(n, step) {
  const out = []; let t = 0;
  for (let i = 0; i < n; i++) { out.push(t); t += (i % 2 === 0 ? 2 : 1) * step; }
  return out;
}
function stagger(list) {
  if (!list || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.isIntersecting)) return;
    io.disconnect();
    if (reduce.matches) return;
    const items = [...list.children], step = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--swing-step')) || 40;
    swingDelays(items.length, step).forEach((d, i) => {
      items[i].style.setProperty('--jz-delay', `${d}ms`);
      items[i].classList.add('jz-in');
      items[i].addEventListener('animationend', () => items[i].classList.remove('jz-in'), { once: true });
    });
  }, { threshold: 0.15 });
  io.observe(list);
}

// ---------- sound toggle ----------
function readChoice() { try { return localStorage.getItem(STORE) === 'on'; } catch (err) { return false; } }
function saveChoice(on) { try { localStorage.setItem(STORE, on ? 'on' : 'off'); } catch (err) { /* private mode: this visit only */ } }
function setSound(on, toggle) {
  state.sound = on;
  if (toggle) toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function initJazz({ soundDefault = false } = {}) {
  const toggle = document.querySelector('.sound-toggle');
  let stored = null;
  try { stored = localStorage.getItem(STORE); } catch (err) { /* no storage */ }
  setSound(stored === null ? soundDefault : readChoice(), toggle);
  if (toggle) toggle.addEventListener('click', () => {
    setSound(!state.sound, toggle);
    saveChoice(state.sound);
    if (state.sound) play('hat');                             // a quiet hat says "sound is on"
  });
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  for (const n of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(n, onPointerEnd, { passive: true });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onPointerEnd);
  stagger(document.querySelector('.panels'));
  // the book's contents list: stagger its rows each time it opens
  const toc = document.querySelector('.book-toc');
  if (toc && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (toc.hidden || reduce.matches) return;
      const rows = [...toc.querySelectorAll('li')];
      swingDelays(rows.length, 40).forEach((d, i) => {
        rows[i].style.setProperty('--jz-delay', `${d}ms`);
        rows[i].classList.remove('jz-in'); void rows[i].offsetWidth; rows[i].classList.add('jz-in');
      });
    }).observe(toc, { attributes: true, attributeFilter: ['hidden'] });
  }
  // for tests and debugging
  window.__jazz = { get sound() { return state.sound; }, counts: state.counts, swingDelays, get audio() { return state.ctx ? state.ctx.state : 'none'; } };
}

initJazz();
