// The film projector: PBR model from public/models/projector.glb (brass / painted metal / glass, baked occlusion), with the
// reels turning, the film running and the lens light flickering. A plain stand-in is built if the file cannot be loaded.
import * as THREE from 'three';
import { CONFIG } from './config.js';

function filmTexture() {
  // dark film with a row of sprocket holes on each edge; it repeats along the strip and is slid to make the film run
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0a09'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3a2f22'; g.fillRect(6, 12, 52, 40);
  g.fillStyle = '#c9b48a';
  for (const y of [3, 55]) for (const x of [6, 38]) g.fillRect(x, y, 20, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.rotation = 0;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function standIn() {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: CONFIG.palette.paint || 0x0f3a27, metalness: 0.45, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: CONFIG.palette.brass, metalness: 1, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.27, 0.16), paint);
  body.position.set(-0.03, 0.2, 0);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.2, 24), brass);
  lens.rotation.z = Math.PI / 2; lens.position.set(0.2, 0.212, 0);
  root.add(body, lens);
  const reels = [[0.125, 0.512], [-0.195, 0.5]].map(([x, y], i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 32), paint);
    r.add(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 16).rotateX(Math.PI / 2), brass));
    for (let k = 0; k < 3; k++) r.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.004).translate(0.05, 0, 0).rotateZ(k * Math.PI * 2 / 3), paint));
    r.position.set(x, y, 0.097); r.name = i ? 'reel_rear' : 'reel_front';
    root.add(r);
    return r;
  });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.0375, 20, 10).scale(0.27, 1, 1), new THREE.MeshStandardMaterial());
  glass.position.set(0.291, 0.212, 0); glass.name = 'lens_glass';
  const beam = new THREE.Object3D();
  beam.position.set(0.303, 0.212, 0); beam.name = 'beam_origin';
  root.add(glass, beam);
  return { scene: root, reels, glass, beam, strip: null };
}

export async function loadProjector(loader) {
  let parts, source = 'glb';
  try {
    const gltf = await loader.loadAsync(CONFIG.models.projector);
    const need = (name) => { const o = gltf.scene.getObjectByName(name); if (!o) throw new Error('projector.glb has no "' + name + '"'); return o; };
    need('projector_root');
    parts = { scene: gltf.scene, reels: [need('reel_front'), need('reel_rear')], glass: need('lens_glass'), beam: need('beam_origin'), strip: gltf.scene.getObjectByName('film_strip') };
  } catch (e) {
    console.warn('hologram: projector model not used, stand-in instead —', e && e.message ? e.message : e);
    parts = standIn();
    source = 'primitive';
  }
  const root = parts.scene;
  const disposables = [];
  const amber = new THREE.Color(CONFIG.palette.amber);

  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.aoMap) m.aoMapIntensity = 1.0;
    m.envMapIntensity = 1.0;
    // a theme may repaint the machine (the site theme: dark grey paint, pale metal instead of green and brass)
    if (CONFIG.palette.paint && m.name === 'painted_metal') m.color.set(CONFIG.palette.paint);
    if (CONFIG.palette.metal && m.name === 'brass') m.color.set(CONFIG.palette.metal);
  });

  // the lens: lit glass with a soft glow sprite in front of it (both are in the bloom selection)
  const glassMesh = parts.glass.isMesh ? parts.glass : parts.glass.children.find((c) => c.isMesh);
  const lensMaterial = new THREE.MeshBasicMaterial({ color: amber.clone(), transparent: true, opacity: 0.95 });
  if (glassMesh.material && glassMesh.material.dispose) glassMesh.material.dispose();
  glassMesh.material = lensMaterial;
  const glowMap = glowTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: amber, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
  glow.scale.setScalar(0.26);
  parts.beam.add(glow);
  disposables.push(lensMaterial, glowMap, glow.material);

  // the film strip: perforations sliding along it
  let film = null;
  if (parts.strip) {
    const stripMesh = parts.strip.isMesh ? parts.strip : parts.strip.children.find((c) => c.isMesh);
    film = filmTexture();
    film.repeat.set(0.5, 1);
    if (stripMesh.material && stripMesh.material.dispose) stripMesh.material.dispose();
    stripMesh.material = new THREE.MeshStandardMaterial({ map: film, roughness: 0.4, metalness: 0.0, side: THREE.DoubleSide });
    disposables.push(film, stripMesh.material);
  }

  const lensWorld = new THREE.Vector3();
  return {
    source, root,
    glow: [glassMesh, glow],
    /** world position the beam starts from */
    lens(target = lensWorld) { return parts.beam.getWorldPosition(target); },
    update(time, flicker) {
      parts.reels[0].rotation.z = -time * 1.7;      // the full reel turns slower than the take-up reel
      parts.reels[1].rotation.z = -time * 2.6;
      if (film) film.offset.x = -time * 1.4;
      lensMaterial.color.copy(amber).multiplyScalar(1.5 + 0.9 * flicker);
      glow.material.opacity = 0.45 + 0.35 * flicker;
    },
    dispose() {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        const m = o.material;
        for (const k of ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k] && m[k].dispose) m[k].dispose();
        if (m.dispose) m.dispose();
      });
      disposables.forEach((d) => d.dispose());
      root.removeFromParent();
    },
  };
}
