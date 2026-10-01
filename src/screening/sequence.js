// The show, as one state machine. Everything on screen is read off this state and the film's own clock (video.currentTime).
//
//   IDLE       curtain closed, the projector breathes (a soft lamp glow and a twitch of the reels every 4 s)
//     press -> OPENING     the curtain opens (2.0 s ease-out) while the lamp flickers on (0.3 s), the reels spin up (1.2 s), the beam lights
//     open  -> COUNTDOWN   black-and-white leader, 3 s
//           -> PLAYING     the film; a press pauses / resumes. The pop-out (exitAt .. returnAt) is read from the film time.
//     end   -> RUNOUT      tail leader 1.0 s (white, low flicker, the film flapping), then the beam dies over 1.2 s
//           -> CLOSING     starts 0.6 s into the beam fade: the curtain closes (2.6 s ease-in-out, a small bounce where the panels
//                          meet), the reels slow to a stop
//           -> IDLE
// Presses during OPENING, COUNTDOWN, RUNOUT and CLOSING are ignored and said in the status line.
// Reduced motion: the curtain fades (0.6 s), the lamp does not flicker, and there is no countdown wipe animation beyond the numbers.
import { CONFIG, SCREENING } from './config.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function createSequence({ media, reduce, onState }) {
  const C = SCREENING.curtain;
  let state = 'IDLE', t = 0, paused = false, ended = false;
  let curtain = C.initial === 'open' ? 1 : 0, curtainVel = 0, settleT = 99, settleFrom = 0;
  const openSec = () => (reduce() ? C.fadeSec : C.openSec), closeSec = () => (reduce() ? C.fadeSec : C.closeSec);
  const closesAt = CONFIG.runout + CONFIG.closeAfterRunout;          // RUNOUT time when the curtain starts to close
  function go(next) {
    state = next; t = 0;
    if (next === 'PLAYING') {
      media.currentTime = 0;
      const p = media.play();
      if (p && p.catch) p.catch((e) => onState('play-failed', e));
    }
    if (next === 'IDLE' && C.initial === 'open') curtain = 1;
    onState(next);
  }
  return {
    get state() { return state; }, get t() { return t; }, get paused() { return paused; }, get ended() { return ended; },
    /** returns what happened: 'start' | 'pause' | 'resume' | 'ignored-start' | 'ignored-end' */
    press() {
      if (state === 'IDLE') { paused = false; ended = false; go(C.initial === 'open' && curtain >= 1 ? 'COUNTDOWN' : 'OPENING'); return 'start'; }
      if (state === 'PLAYING') { paused = !paused; if (paused) media.pause(); else media.play().catch(() => {}); return paused ? 'pause' : 'resume'; }
      return state === 'OPENING' || state === 'COUNTDOWN' ? 'ignored-start' : 'ignored-end';
    },
    setPaused(p) { if (state !== 'PLAYING' || p === paused) return false; this.press(); return true; },
    ended_() { if (state === 'PLAYING') { ended = true; paused = false; go('RUNOUT'); } },
    /** advance by dt; returns the levels for this frame */
    update(dt) {
      if (!(state === 'PLAYING' && paused)) t += dt;
      const lv = { lamp: 0, reel: 0, beam: 0, bright: 0, source: 'off', leaderT: 0, runoutT: 0, breathe: 0 };
      const prev = curtain;
      if (state === 'IDLE') {
        // breathe every 4 s: a soft glow and a twitch of the reels
        const ph = (t % CONFIG.breatheEvery) / CONFIG.breatheEvery;
        lv.breathe = reduce() ? 0 : Math.pow(Math.sin(Math.PI * smooth(0.0, 0.5, ph)), 2) * (ph < 0.5 ? 1 : 0);
        lv.lamp = 0.25 * lv.breathe;
        if (C.initial !== 'open') curtain = 0;
      } else if (state === 'OPENING') {
        curtain = reduce() ? clamp01(t / openSec()) : easeOut(clamp01(t / openSec()));
        lv.lamp = reduce() || t > CONFIG.lamp ? 1 : [1, 0, 1, 0.3, 1][Math.min(4, Math.floor(t / CONFIG.lamp * 5))];
        lv.reel = smooth(0, CONFIG.reelSpinUp, t);
        lv.beam = smooth(CONFIG.lamp, openSec(), t) * lv.lamp;
        lv.bright = lv.beam; lv.source = 'light';
        if (t >= openSec()) { settleT = 0; settleFrom = 0.03; go('COUNTDOWN'); }
      } else if (state === 'COUNTDOWN') {
        curtain = 1; lv.lamp = 1; lv.reel = 1; lv.beam = 1; lv.bright = 1; lv.source = 'leader'; lv.leaderT = Math.min(t, CONFIG.countdown - 0.001);
        if (t >= CONFIG.countdown) go('PLAYING');
      } else if (state === 'PLAYING') {
        curtain = 1; lv.lamp = 1; lv.reel = paused ? 0 : 1; lv.beam = 1; lv.bright = 1; lv.source = 'film';
      } else if (state === 'RUNOUT') {
        lv.lamp = 1; lv.reel = 1.25 - 0.25 * smooth(0, CONFIG.runout, t);          // the tail flaps through faster
        const fade = 1 - smooth(CONFIG.runout, CONFIG.runout + CONFIG.beamOff, t);
        lv.beam = fade; lv.bright = fade; lv.source = 'runout'; lv.runoutT = t;
        if (t >= closesAt) go('CLOSING');
      } else if (state === 'CLOSING') {
        const tt = t + closesAt;                                                    // time since the runout began
        const fade = 1 - smooth(CONFIG.runout, CONFIG.runout + CONFIG.beamOff, tt);
        lv.lamp = fade; lv.beam = fade; lv.bright = fade; lv.source = 'runout';
        lv.reel = 1 - smooth(0, closeSec(), t);
        const k = clamp01(t / closeSec());
        curtain = 1 - (reduce() ? k : easeInOut(k));
        if (t >= closeSec()) { curtain = 0; settleT = 0; settleFrom = -0.04; go('IDLE'); }
      }
      curtainVel = dt > 0 ? (curtain - prev) / dt : 0;
      // the spring after the panels meet (0.4 s); they overshoot a little into each other first
      settleT += dt;
      const sway = !reduce() && settleT < 0.4 ? settleFrom * Math.exp(-settleT / 0.11) * Math.cos(settleT * 34) : 0;
      lv.curtain = curtain; lv.curtainVel = curtainVel; lv.sway = sway;
      return lv;
    },
    // for the checks
    jump(next, at = 0) { paused = false; state = next; t = at; if (next === 'PLAYING' || next === 'COUNTDOWN') curtain = 1; if (next === 'IDLE') curtain = C.initial === 'open' ? 1 : 0; onState(next); },
  };
}
