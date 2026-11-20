import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { PALETTE, SimpleClock, createLiquidMaterial, reducedMotion } from './common.js';

const CAMERA_Z = 10;
const FOV = 40;

/** Banda de Möbius paramétrica. */
function moebius(u, v, target) {
  const a = u * Math.PI * 2;
  const w = (v - 0.5) * 0.9;
  const r = 1 + w * Math.cos(a / 2);
  target.set(r * Math.cos(a), r * Math.sin(a), w * Math.sin(a / 2));
}

function physical(color, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, metalness: 0.85, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12,
    iridescence: 1, iridescenceIOR: 1.6, envMapIntensity: 1.25, ...extra,
  });
}

function wire(geometry, color, opacity = 0.55) {
  return new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
}

/** Figura central de la cabecera: gota líquida + cascarón facetado + anillos y satélites. */
function buildHero() {
  const group = new THREE.Group();
  const liquid = createLiquidMaterial({ amplitude: 0.34, speed: 1 });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 28), liquid);
  group.add(blob);

  const shell = wire(new THREE.IcosahedronGeometry(1.42, 2), PALETTE.cyan, 0.38);
  group.add(shell);

  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.018, 12, 160), new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.8 }));
  ringA.rotation.set(1.15, 0.2, 0);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.014, 12, 160), new THREE.MeshBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: 0.65 }));
  ringB.rotation.set(0.35, 0.9, 0.4);
  group.add(ringA, ringB);

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.36, 0.1, 140, 18, 2, 3), physical(0x2a2f9e));
  const sat = new THREE.Group();
  sat.add(knot);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), physical(PALETTE.pink, { metalness: 0.4 }));
  gem.position.set(-1.9, 0.4, 0);
  const gem2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), physical(PALETTE.cyan, { metalness: 0.5 }));
  gem2.position.set(0, -1.8, 0.3);
  group.add(sat, gem, gem2);
  sat.position.set(1.85, 0.2, 0.2);

  return { group, liquid, tick(t, dt) {
    blob.rotation.y += dt * 0.12;
    shell.rotation.y -= dt * 0.18; shell.rotation.x += dt * 0.06;
    ringA.rotation.z += dt * 0.35; ringB.rotation.z -= dt * 0.28;
    knot.rotation.x += dt * 0.7; knot.rotation.y += dt * 0.45;
    const a = t * 0.6;
    sat.position.set(Math.cos(a) * 1.85, Math.sin(a * 0.8) * 0.6, Math.sin(a) * 1.2);
    gem.rotation.x += dt; gem.rotation.y += dt * 0.7;
    gem2.rotation.y += dt * 0.9;
    gem.position.set(Math.cos(a + 2.4) * -1.9, 0.5 + Math.sin(a * 1.3) * 0.4, Math.sin(a + 2.4) * 0.8);
    gem2.position.set(Math.sin(a * 0.9) * 0.6, -1.8, Math.cos(a * 0.9) * 0.9);
  } };
}

/** Figuras flotantes del fondo, ancladas a fracciones de la pantalla. */
function buildFloaters(isCompact) {
  const items = [];
  const add = (object, ax, ay, sizePx, opts = {}) => {
    const holder = new THREE.Group();
    holder.add(object);
    items.push({ holder, object, ax, ay, sizePx, drift: opts.drift ?? 0.1, spin: opts.spin ?? [0.2, 0.3, 0.1], phase: Math.random() * 6.28, tick: opts.tick });
  };

  const bigLiquid = createLiquidMaterial({ amplitude: 0.45, speed: 0.7 });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 22), bigLiquid);
  add(blob, 0.9, 0.62, 360, { spin: [0.02, 0.05, 0], drift: 0.12 });

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.32, 220, 28, 3, 5), physical(0x3a2fb8));
  add(knot, 0.07, 0.78, 250, { spin: [0.18, 0.28, 0.05], drift: 0.16 });

  const mob = new THREE.Mesh(new ParametricGeometry(moebius, 120, 14), physical(PALETTE.magenta, { side: THREE.DoubleSide, metalness: 0.7, roughness: 0.22 }));
  add(mob, 0.93, 0.14, 210, { spin: [0.3, 0.15, 0.2], drift: 0.2 });

  const ico = new THREE.Group();
  ico.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 1), physical(0x2438c8, { flatShading: true, metalness: 0.6 })));
  ico.add(wire(new THREE.IcosahedronGeometry(1.05, 1), PALETTE.cyan, 0.5));
  add(ico, 0.42, 0.97, 230, { spin: [0.22, 0.16, 0.08], drift: 0.1 });

  const dodeca = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), physical(PALETTE.pink, { flatShading: true, metalness: 0.55 }));
  add(dodeca, 0.14, 0.3, 120, { spin: [0.35, 0.4, 0.1], drift: 0.22 });

  const oct = new THREE.Group();
  oct.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), physical(PALETTE.cyan, { flatShading: true, metalness: 0.5 })));
  oct.add(wire(new THREE.OctahedronGeometry(1.2, 1), PALETTE.violet, 0.6));
  add(oct, 0.62, 0.34, 130, { spin: [0.3, 0.5, 0.2], drift: 0.18 });

  const torus = new THREE.Mesh(new THREE.TorusGeometry(1, 0.34, 28, 90), physical(PALETTE.violet, { metalness: 0.9 }));
  add(torus, 0.82, 0.93, 150, { spin: [0.4, 0.15, 0.25], drift: 0.15 });

  return { items: isCompact ? items.filter((_, i) => [0, 1, 3].includes(i)) : items, liquids: [bigLiquid] };
}

function buildParticles(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
    positions[i * 3 + 2] = -3 - Math.random() * 7;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }));
}

export function initBackground(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.z = CAMERA_Z;

  const key = new THREE.DirectionalLight(0x7fe9ff, 1.4); key.position.set(4, 5, 6);
  const rim = new THREE.DirectionalLight(0xff5fa8, 1.1); rim.position.set(-6, -2, 3);
  scene.add(key, rim, new THREE.AmbientLight(0x4a4fb0, 0.5));

  const compact = window.innerWidth < 900;
  const hero = buildHero();
  const floaters = buildFloaters(compact);
  const particles = buildParticles(compact ? 160 : 380);
  scene.add(hero.group, particles);
  floaters.items.forEach((item) => scene.add(item.holder));

  let width = 1; let height = 1;
  const state = { mx: 0, my: 0, tx: 0, ty: 0, scroll: 0, scrollSmooth: 0, running: false, raf: 0 };
  const halfH = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z;
  const unitsPerPx = () => (halfH * 2) / height;
  const toWorld = (px, py) => new THREE.Vector3((px / width - 0.5) * 2 * halfH * (width / height), -(py / height - 0.5) * 2 * halfH, 0);

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const heroAnchor = document.querySelector('.intro-orb');
  const clock = new SimpleClock();
  let elapsed = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    state.mx += (state.tx - state.mx) * 0.05;
    state.my += (state.ty - state.my) * 0.05;
    state.scrollSmooth += (state.scroll - state.scrollSmooth) * 0.08;
    const upp = unitsPerPx();

    // La figura principal sigue la posición real del orbe del encabezado.
    if (heroAnchor) {
      const rect = heroAnchor.getBoundingClientRect();
      const visible = rect.bottom > -50 && rect.top < height + 50 && rect.width > 0;
      hero.group.visible = visible;
      if (visible) {
        hero.group.position.copy(toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2));
        hero.group.scale.setScalar((Math.max(rect.width, 160) * upp) / 3.6 * 1.25);
        hero.group.rotation.y += (state.mx * 0.5 - hero.group.rotation.y) * 0.04;
        hero.group.rotation.x += (state.my * 0.3 - hero.group.rotation.x) * 0.04;
      }
    }
    hero.liquid.uniforms.uTime.value = elapsed;
    hero.tick(elapsed, dt);

    floaters.liquids.forEach((m) => { m.uniforms.uTime.value = elapsed; });
    for (const item of floaters.items) {
      const bob = Math.sin(elapsed * 0.5 + item.phase) * 0.02;
      const scrollDrift = Math.sin(state.scrollSmooth * 0.0016 + item.phase) * height * item.drift;
      const pos = toWorld(item.ax * width + state.mx * -18 * (item.drift * 8), item.ay * height + scrollDrift + bob * height);
      item.holder.position.copy(pos);
      item.holder.scale.setScalar(item.sizePx * upp * 0.5);
      const boost = 1 + Math.abs(state.scroll - state.scrollSmooth) * 0.01;
      item.object.rotation.x += dt * item.spin[0] * boost;
      item.object.rotation.y += dt * item.spin[1] * boost;
      item.object.rotation.z += dt * item.spin[2] * boost;
    }
    particles.rotation.y = elapsed * 0.01 + state.mx * 0.05;
    particles.position.y = state.scrollSmooth * 0.0009;

    camera.position.x += (state.mx * 0.5 - camera.position.x) * 0.04;
    camera.position.y += (-state.my * 0.35 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  function loop() {
    if (!state.running) return;
    frame();
    state.raf = requestAnimationFrame(loop);
  }
  function start() {
    if (state.running || reducedMotion) return;
    state.running = true; clock.getDelta(); state.raf = requestAnimationFrame(loop);
  }
  function stop() { state.running = false; cancelAnimationFrame(state.raf); }

  window.addEventListener('pointermove', (e) => {
    state.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    state.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });
  window.addEventListener('scroll', () => { state.scroll = window.scrollY; if (reducedMotion) frame(); }, { passive: true });
  window.addEventListener('resize', () => { resize(); if (!state.running) frame(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
  canvas.addEventListener('webglcontextrestored', () => start());

  resize();
  frame();
  start();
  return { renderer, scene };
}
