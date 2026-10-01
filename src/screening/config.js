// The screening room (first screen): every number the section shares. The site has no bundler, so file URLs are resolved here.
// Second version (screening-v2-prompt.md): no seats, a big screen, a red velvet curtain, the projector itself is the button,
// the film runs through a black-and-white projection shader, and the frontman leaves and comes back through the top edge.
//
// Cue data (popout) — measured frame by frame on the owner's film (media/seedance.mp4, 24 fps; decision frames in
// .superloopy/evidence/screening-v2/cues/decided-*.png). Re-measure with ?debug=cues (O / B set exitAt / returnAt, C copies).
//   exitAt     first frame with the 2D frontman gone over the top edge (only the smoke left)
//   exitX      his feet's horizontal place in the frame before, from the screen centre (-0.5 .. 0.5)
//   exitScale  his height as a share of the screen height, in the last frame where all of him is in the picture (3.342 s)
//   returnAt   first frame with his feet showing at the top edge
//   returnX    those feet's horizontal place
//   landAt     the frame his feet touch the stage

const site = (path) => new URL('../../' + path, import.meta.url).href;

export const SCREENING = {
  stage: {
    seats: false,
    // the clip is 4:3: on a 16:9 desktop canvas 72% would leave no room above the screen or for the projector, so the owner chose
    // about half the width there (2026-10-01). Phones keep the brief's 88%.
    screenWidthOfCanvas: { mobile: 0.88, desktop: 0.50 },
    headroomAbove: 0.16,
    canvasAspect: { mobile: [4, 5], desktop: [16, 9] },
    mobileBreakpoint: 768,
  },
  curtain: { initial: 'closed', openSec: 2.0, closeSec: 2.6, fadeSec: 0.6, color: '#6B0C12', sheen: '#c4323c', fringe: '#a8843a' },
  film: {
    fps: 12, grainFps: 24,
    holdEvery: [3, 6], holdFrames: [2, 4],
    weave: [0.0025, 0.004], slipEvery: [9, 14], slipGuardSec: 1.0, slipFrames: 6,
    flicker: [0.94, 1.04], blacks: 0.04, whites: 0.92,
    scratches: [0, 2], dustPerFrame: [0, 4], cueMarks: [7, 1],
    holdMaxWidth: { desktop: 1280, mobile: 1080 },
  },
  audio: { vintage: true },
  clip: { src: 'media/seedance', formats: ['mp4'], aspect: 1112 / 834 },
  popout: {
    member: 'frontman',
    exitAt: 3.717, exitX: -0.04, exitScale: 0.73,
    returnAt: 10.333, returnX: -0.06, landAt: 10.459,
    hover: { heightOfScreen: 0.65, depthBetween: 0.5, maxCanvasHeight: 0.4 },
    filmness: { atScreen: 1.0, inAir: 0.25 },
    // greys after the black-and-white pass, matched to the 2D frontman (material name -> grey)
    greys: { toon_cap: 0.9, toon_shirt: 0.9, toon_suit: 0.72, toon_vest: 0.6, toon_ink: 0.08, toon_skin: 0.78, toon_shoe: 0.3, toon_mic: 0.82 },
  },
};

export const CONFIG = {
  models: { projector: site('public/models/projector.glb'), frontman: site('public/models/cartoon/frontman.glb') },
  draco: site('public/draco/'),
  media: (format) => site(SCREENING.clip.src + '.' + format),
  // sequence (seconds)
  lamp: 0.3, reelSpinUp: 1.2, countdown: 3.0, runout: 1.0, beamOff: 1.2, closeAfterRunout: 0.6, breatheEvery: 4.0,
  // pop-out (seconds; the actions in the model are 0.6 / 3.0 / 1.1)
  exitLeap: 0.6, toHover: 0.7, returnDive: 1.1, visibleAfterReturn: 0.15, puff: 0.6, ripple: 0.9,
  // room (metres). The screen is 4 m wide at the clip's shape, its plane is z = 0, the floor y = 0.
  screen: { width: 4.0, bottom: 1.0 },
  projectorSize: 1.4,
  palette: { ink: '#1d1d1f', paper: '#efe6d0', wall: '#0c0c0d', floor: '#141415', frame: '#0a0a0b', screenOff: '#2b2b2d', metal: '#cfc6b0', paint: '#2b2b2e' },
  performance: { maxDpr: 2, dust: 420, outlinePx: [1.5, 2.5], shadowMap: { desktop: 1024, mobile: 512 }, curtainSeg: { desktop: [96, 48], mobile: [64, 32] } },
};

export const STATUS = {
  idle: 'Press the projector to start the show.',
  opening: 'The curtain is opening.',
  countdown: 'Starting in three, two, one.',
  playing: 'Now playing.',
  paused: 'Paused.',
  ending: 'The show is ending.',
  over: 'The show is over. Press the projector to roll it again.',
  waitStart: 'Please wait, the show is about to start.',
  waitEnd: 'Please wait, the curtain is closing.',
  blocked: 'Your browser held back the sound. Press Mute to turn it on.',
};
