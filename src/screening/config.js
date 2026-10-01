// The screening room (#screening): every number the section shares. The site has no bundler, so file URLs are resolved from here.
//
// Cue data (one entry per film clip). When a real clip arrives or a clip is re-cut, only these numbers change:
//   out          the moment the 2D player has sprung and is about to leave the picture (seconds into the clip)
//   back         the moment he starts coming back into the picture
//   screenPos    where his feet were in the picture at `out`: x and y from the centre of the screen, -0.5 .. 0.5 (y up)
//   screenScale  his standing height as a share of the screen's height
// The 3D player takes over at that spot and size, and is back on that spot, inside the screen, exactly at `back`.
// Find the numbers with ?debug=cues (O / B set out / back at the current time, C copies the cues as JSON).
//
// The clip in use is the owner's Seedance film (media/seedance.mp4, used as is: the frontman's jump). The saxophone and bass
// clips are left out until their films exist; their models are ready in public/models/cartoon/.

const site = (path) => new URL('../../' + path, import.meta.url).href;

export const SCREENING = {
  sectionAfter: null,          // a selector to move the section after (null: where index.html puts it — the first screen)
  colorReveal: false,          // true: a player who leaves the screen slowly gets his sheet colours back while he is out
  bpm: 160,
  clips: [
    { src: 'media/seedance', formats: ['mp4'], member: 'frontman', out: 3.33, back: 10.35, screenPos: [0.0, -0.355], screenScale: 0.70 },
  ],
};

export const CONFIG = {
  models: {
    projector: site('public/models/projector.glb'),
    sax: site('public/models/cartoon/sax.glb'),
    bass: site('public/models/cartoon/bass.glb'),
    frontman: site('public/models/cartoon/frontman.glb'),
  },
  draco: site('public/draco/'),
  media: (clip, format) => site(clip.src + '.' + format),
  // sequence (seconds)
  lamp: 0.3,                   // the lamp flickers on
  reelSpinUp: 1.2,             // the reels come up to speed
  beamRise: 2.0,               // the beam and the screen brighten
  countdown: 3.0,              // 3, 2, 1 leader
  fadeOut: 1.6,                // after the film, the beam dies away
  // pop-out (seconds; the actions in the models are 1.0 / 3.0 / 1.0)
  emergeFrom: 0.25,            // the emerge action is entered here: the 2D player has already crouched in the film
  emergeFly: 0.8,              // from the screen to the place in the air
  returnFly: 1.0,              // from the air back onto the screen, ends exactly at `back`
  blend: 0.15,                 // cross-fade between actions
  ripple: 0.9,                 // rings on the screen where he went back in
  // room (metres)
  screen: { width: 4.0, height: 3.0, centre: [0, 2.15, -6.0] },
  projectorAt: [0, 0.75, 1.9],
  projectorSize: 1.6,
  air: [0.0, 1.05, 0.0],       // where the player hangs (his feet) while he plays his solo: over the seats, in the beam, in front of the projector's light
  airScale: 0.6,               // his size there, as a share of his size on the screen (he is much nearer, so he still looks bigger)
  palette: {
    ink: '#1d1d1f', paper: '#efe6d0', grey: '#8a857a', wall: '#141416', floor: '#1a1a1c', seat: '#151517', screenOff: '#2b2b2d',
    beam: '#efe6d0', metal: '#cfc6b0', paint: '#2b2b2e',   // beam = the site's paper; metal and paint as the first screen's site theme
    tiers: { toon_white: '#efe6d0', toon_grey: '#8f897d', toon_black: '#1d1d1f' },
  },
  performance: { maxDpr: 2, mobileBreakpoint: 768, dust: 420 },
};

export const LABEL = 'An old cinema. A film projector faces the screen; press it to roll a black-and-white cartoon of a jazz trio, ' +
  'in which the singer jumps out of the screen, sings in the air above the seats and dives back in.';
