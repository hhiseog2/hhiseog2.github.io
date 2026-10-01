// How the 3D frontman is drawn so he reads as the same ink drawing as the film:
//   - grey toon shading in four steps (the model's toon_* materials take their grey from SCREENING.popout.greys)
//   - diagonal ink hatching in the shadows, laid in screen space like the 2D's pen hatching: closer lines as it gets darker,
//     cross-hatched in the darkest parts
//   - an inverted-hull outline pushed out in clip space, so it stays 1.5-2.5 px on screen at any distance
//   - the film's own exposure, grain and gate weave, scaled by `filmness` (1 on the screen's surface, 0.25 in the air)
//   - always grey: the picture he comes out of is black and white
//   - a clipping plane at the screen's surface: whatever is behind the screen is not drawn, so he comes out of the picture
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function toonGradient() {
  const data = new Uint8Array([46, 46, 46, 255, 112, 112, 112, 255, 186, 186, 186, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const HASH = 'float tiHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\n';

export function createInk({ film, clipPlane }) {
  const u = {
    uFilmness: { value: 1 }, uRes: { value: new THREE.Vector2(800, 600) }, uOutlinePx: { value: 2 }, uHatchPx: { value: 5 },
    uInk: { value: new THREE.Color(CONFIG.palette.ink) }, uRim: { value: 0 },
    uExposure: film.uExposure, uGrainT: film.uGrainT, uWeave: film.uWeave,
  };
  const gradient = toonGradient();
  const planes = clipPlane ? [clipPlane] : [];
  const weaveVertex = 'gl_Position.xy += uWeave * 2.0 * gl_Position.w * uFilmness;\n';
  function toon(grey) {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color().setRGB(grey, grey, grey, THREE.SRGBColorSpace), gradientMap: gradient, clippingPlanes: planes });   // the grey as seen on screen
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = 'uniform vec2 uWeave; uniform float uFilmness;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + weaveVertex);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFilmness, uHatchPx, uRim, uExposure, uGrainT; uniform vec3 uInk;\n' + HASH)
        .replace('#include <opaque_fragment>', /* glsl */`
          float base = max(dot(diffuseColor.rgb, vec3(0.3333)), 0.03);
          float shade = clamp(dot(outgoingLight, vec3(0.3333)) / base, 0.0, 1.6);
          vec2 fc = gl_FragCoord.xy / uHatchPx;
          float d1 = abs(fract((fc.x + fc.y) * 0.5) - 0.5), d2 = abs(fract((fc.x - fc.y) * 0.5) - 0.5);
          float w1 = smoothstep(0.62, 0.22, shade) * 0.2, w2 = smoothstep(0.34, 0.1, shade) * 0.18;
          float ink = max(1.0 - smoothstep(w1 - 0.04, w1, d1), 1.0 - smoothstep(w2 - 0.04, w2, d2)) * step(0.001, w1);
          outgoingLight = mix(outgoingLight, uInk, ink * 0.85);
          outgoingLight += uRim * pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
          outgoingLight *= mix(1.0, uExposure, uFilmness);
          outgoingLight += (tiHash(floor(gl_FragCoord.xy / 1.6) + uGrainT * 17.0) - 0.5) * 0.14 * uFilmness;
          outgoingLight = vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)));
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'screening-ink-toon';
    return m;
  }
  function outline() {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(CONFIG.palette.ink), side: THREE.BackSide, clippingPlanes: planes });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = 'uniform vec2 uRes, uWeave; uniform float uOutlinePx, uFilmness;\n' + shader.vertexShader.replace('#include <project_vertex>', /* glsl */`
        #include <project_vertex>
        #if !defined( USE_SKINNING ) && !defined( USE_ENVMAP )
          vec3 objectNormal = vec3( normal );
        #endif
        vec4 clipN = projectionMatrix * modelViewMatrix * vec4(objectNormal, 0.0);
        gl_Position.xy += normalize(clipN.xy + 1e-6) * uOutlinePx * 2.0 / uRes * gl_Position.w;
        ${weaveVertex}`);
    };
    m.customProgramCacheKey = () => 'screening-ink-outline';
    return m;
  }
  return { uniforms: u, gradient, toon, outline, dispose() { gradient.dispose(); } };
}
