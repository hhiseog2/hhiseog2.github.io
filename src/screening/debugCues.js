// ?debug=cues — a panel under the screen for lining the 3D player up with a film:
//   the film time, a timeline with the OUT / BACK markers (click it to seek),
//   O / B: set this clip's out / back to the current time, [ / ]: step 1/30 s, C: copy the cues as JSON for src/screening/config.js.
// Changes apply at once (the scene reads the same clip object). Only for the owner; the panel's text is in English like the site.
export function mountCueDebugger(section, api) {
  const panel = document.createElement('div');
  panel.className = 'cue-debug';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Cue debugger');
  panel.innerHTML = '<p class="cue-time" aria-live="off"></p><div class="cue-line" tabindex="0" aria-label="Film timeline, press to seek"><span class="cue-head"></span></div>' +
    '<p class="cue-help">O sets exitAt, B sets returnAt, [ and ] step a frame, C copies the cues.</p><p class="cue-note" role="status"></p>';
  section.querySelector('.screening-controls').after(panel);
  const time = panel.querySelector('.cue-time'), line = panel.querySelector('.cue-line'), head = panel.querySelector('.cue-head'), note = panel.querySelector('.cue-note');
  const marks = {};
  for (const k of ['out', 'back']) {
    const m = document.createElement('span');
    m.className = 'cue-mark cue-' + k;
    m.textContent = k.toUpperCase();
    line.appendChild(m);
    marks[k] = m;
  }
  function draw() {
    const clip = api.clip(), media = api.media(), d = media.duration || 15, t = media.currentTime || 0;
    time.textContent = 't = ' + t.toFixed(3) + ' s   exitAt ' + clip.exitAt.toFixed(3) + '   returnAt ' + clip.returnAt.toFixed(3) + '   ' + api.phase();
    head.style.left = (100 * t / d) + '%';
    marks.out.style.left = (100 * clip.exitAt / d) + '%';
    marks.back.style.left = (100 * clip.returnAt / d) + '%';
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  line.addEventListener('click', (e) => {
    const r = line.getBoundingClientRect(), media = api.media();
    api.seek(((e.clientX - r.left) / r.width) * (media.duration || 15));
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const clip = api.clip(), media = api.media(), k = e.key.toLowerCase();
    if (k === 'o') { clip.exitAt = +media.currentTime.toFixed(3); note.textContent = 'exitAt set to ' + clip.exitAt; api.changed(); }
    else if (k === 'b') { clip.returnAt = +media.currentTime.toFixed(3); note.textContent = 'returnAt set to ' + clip.returnAt; api.changed(); }
    else if (k === '[' || k === ']') { api.seek(media.currentTime + (k === ']' ? 1 : -1) / 24); }
    else if (k === 'c') {
      const json = JSON.stringify({ exitAt: clip.exitAt, exitX: clip.exitX, exitScale: clip.exitScale, returnAt: clip.returnAt, returnX: clip.returnX, landAt: clip.landAt });
      const done = () => { note.textContent = 'Cues copied: ' + json; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, () => { note.textContent = json; });
      else note.textContent = json;
    }
  });
  return panel;
}
