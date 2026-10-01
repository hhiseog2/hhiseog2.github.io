// Sound, all made with Web Audio:
//   vintage   the film's own sound through an old theatre speaker: high-pass 250 Hz, low-pass 4.5 kHz, a soft saturation, mono,
//             with a little optical-track crackle and the projector's 24 Hz clatter under it. Off with SCREENING.audio.vintage.
//             If the browser will not route the <video> through Web Audio, the film simply plays as it is — playback never waits.
//   curtain   cloth brushing and curtain rings sliding, quietly, for each opening and closing.
// Everything follows Mute.
import { SCREENING } from './config.js';

export function createVintageAudio(video) {
  let ctx = null, master = null, routed = false, noise = null, noiseGain = null, muted = false;
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    return ctx;
  }
  function buffer(seconds, fill) {
    const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = fill(i / ctx.sampleRate, i);
    return b;
  }
  function route() {
    if (routed || !SCREENING.audio.vintage || !ensure()) return;
    try {
      const src = ctx.createMediaElementSource(video);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250; hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500; lp.Q.value = 0.7;
      const sat = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
      sat.curve = curve;
      const mono = ctx.createGain();
      mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
      src.connect(hp).connect(lp).connect(sat).connect(mono).connect(master);
      // the optical track's crackle and the projector's 24 Hz clatter, very quietly
      noise = ctx.createBufferSource();
      noise.buffer = buffer(2, (t) => {
        const crackle = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : (Math.random() * 2 - 1) * 0.015;
        const tick = Math.exp(-((t * 24) % 1) * 30) * (Math.random() * 2 - 1) * 0.5;
        return crackle + tick * 0.35;
      });
      noise.loop = true;
      noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.6;
      noise.connect(nf).connect(noiseGain).connect(master);
      noise.start();
      routed = true;
    } catch (e) {
      console.warn('screening: vintage sound not available, playing the film as it is —', e && e.message);
      SCREENING.audio.vintage = false;
    }
  }
  return {
    /** call inside the press: browsers only start sound from a gesture */
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); route(); },
    /** while the film plays, the speaker noise sits under it */
    playing(on) { if (noiseGain && ctx) noiseGain.gain.setTargetAtTime(on && !muted ? 0.05 : 0, ctx.currentTime, 0.08); },
    curtain(seconds, opening) {
      if (!ensure() || muted) return;
      const now = ctx.currentTime;
      // cloth: filtered noise swelling and falling over the move
      const cloth = ctx.createBufferSource();
      cloth.buffer = buffer(seconds, () => Math.random() * 2 - 1);
      const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = opening ? 900 : 700; cf.Q.value = 0.5;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0, now); cg.gain.linearRampToValueAtTime(0.035, now + seconds * 0.3); cg.gain.linearRampToValueAtTime(0, now + seconds);
      cloth.connect(cf).connect(cg).connect(master); cloth.start(now);
      // rings: short metallic ticks along the rail, faster in the middle of the move
      const rings = ctx.createBufferSource();
      rings.buffer = buffer(seconds, (t) => {
        const rate = 6 + 14 * Math.sin(Math.PI * t / seconds);
        const ph = (t * rate) % 1;
        return Math.exp(-ph * 40) * Math.sin(t * 2 * Math.PI * 3400) * 0.5;
      });
      const rg = ctx.createGain(); rg.gain.value = 0.02;
      rings.connect(rg).connect(master); rings.start(now);
    },
    set muted(v) { muted = v; if (master && ctx) master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, 0.02); },
    get muted() { return muted; },
    get routed() { return routed; },
    dispose() { try { if (noise) noise.stop(); } catch (e) { /* stopped */ } if (ctx) ctx.close(); ctx = null; },
  };
}
