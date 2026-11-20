import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE, reducedMotion, SimpleClock } from './common.js';

const R = 1;
const fmt2 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** lon/lat → punto sobre la esfera, coherente con el mapeo UV de SphereGeometry. */
function latLon(lat, lon, radius = R) {
  const phi = THREE.MathUtils.degToRad(lat);
  const lam = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(Math.cos(phi) * Math.cos(lam), Math.sin(phi), -Math.cos(phi) * Math.sin(lam)).multiplyScalar(radius);
}

/** Dibuja la base cartográfica (SVG de Natural Earth) como textura equirectangular. */
async function buildEarthTexture() {
  const W = 2048; const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#0e1050'); sea.addColorStop(0.5, '#10135f'); sea.addColorStop(1, '#0b0d44');
  ctx.fillStyle = sea; ctx.fillRect(0, 0, W, H);

  // Retícula de meridianos y paralelos.
  ctx.strokeStyle = 'rgba(110, 200, 255, .13)'; ctx.lineWidth = 1.2;
  for (let lon = 0; lon <= 360; lon += 30) { ctx.beginPath(); ctx.moveTo(lon / 360 * W, 0); ctx.lineTo(lon / 360 * W, H); ctx.stroke(); }
  for (let lat = 0; lat <= 180; lat += 30) { ctx.beginPath(); ctx.moveTo(0, lat / 180 * H); ctx.lineTo(W, lat / 180 * H); ctx.stroke(); }

  try {
    const svg = await (await fetch('/world-map.svg')).text();
    const tinted = svg.replace(/fill="#[0-9a-fA-F]{3,6}"/g, 'fill="#4a4fe0"').replace(/stroke="#[0-9a-fA-F]{3,6}"/g, 'stroke="#7de6ff"').replace(/stroke-width="[^"]*"/g, 'stroke-width=".7"');
    const url = URL.createObjectURL(new Blob([tinted], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    // La vista 2D proyecta lon/lat en el rectángulo (22,20)–(878,372) del SVG de 900×390.
    ctx.drawImage(img, 22, 20, 856, 352, 0, 0, W, H);
    URL.revokeObjectURL(url);
  } catch {
    /* sin base cartográfica el globo sigue funcionando con la retícula */
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function atmosphere() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.16, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uInner: { value: new THREE.Color(PALETTE.cyan) }, uOuter: { value: new THREE.Color(PALETTE.magenta) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform vec3 uInner; uniform vec3 uOuter; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(clamp(-dot(normalize(vN), normalize(vV)) * 2.4, 0.0, 1.0), 1.8); gl_FragColor = vec4(mix(uOuter, uInner, f), f * 0.75);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

export async function initGlobe({ canvas, tip, count, geo }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0.5, 0.75, 4.0);

  scene.add(new THREE.AmbientLight(0x6a6fe0, 0.9));
  const l1 = new THREE.DirectionalLight(0x7fe9ff, 2.2); l1.position.set(3, 2, 4);
  const l2 = new THREE.DirectionalLight(0xff5fa8, 1.6); l2.position.set(-4, -1, -2);
  scene.add(l1, l2);

  const earthMap = await buildEarthTexture();
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    new THREE.MeshPhysicalMaterial({ map: earthMap, roughness: 0.5, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.25, emissive: 0x1a2090, emissiveMap: earthMap, emissiveIntensity: 0.55 }),
  );
  const globe = new THREE.Group();
  globe.add(earth);
  scene.add(globe, atmosphere());

  // Anillos orbitales decorativos.
  const orbit = new THREE.Group();
  [[1.38, PALETTE.cyan, 0.55, [1.2, 0.2, 0]], [1.55, PALETTE.pink, 0.4, [0.5, 0.1, 0.9]]].forEach(([radius, color, opacity, rot]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.006, 8, 220), new THREE.MeshBasicMaterial({ color, transparent: true, opacity }));
    ring.rotation.set(...rot); orbit.add(ring);
  });
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), new THREE.MeshPhysicalMaterial({ color: PALETTE.pink, metalness: 0.7, roughness: 0.2, emissive: PALETTE.pink, emissiveIntensity: 0.35, flatShading: true }));
  orbit.add(moon);
  scene.add(orbit);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.minDistance = 2.6; controls.maxDistance = 6.5;
  controls.autoRotate = !reducedMotion; controls.autoRotateSpeed = 0.7;

  const bars = new THREE.Group();
  globe.add(bars);
  const prismGeo = new THREE.CylinderGeometry(0.03, 0.04, 1, 6, 1).translate(0, 0.5, 0);
  const gemGeo = new THREE.IcosahedronGeometry(0.052, 0);
  const baseGeo = new THREE.RingGeometry(0.05, 0.07, 24);
  const up = new THREE.Vector3(0, 1, 0);
  const cyan = new THREE.Color(PALETTE.cyan); const pink = new THREE.Color(PALETTE.pink);
  const pickables = [];
  let grow = 1; let growing = false;

  function clearBars() {
    bars.children.slice().forEach((child) => {
      child.traverse((o) => { if (o.material) o.material.dispose(); });
      bars.remove(child);
    });
    pickables.length = 0;
  }

  function setData(items) {
    clearBars();
    const located = items.filter((item) => Object.hasOwn(geo, item.key));
    const max = Math.max(...located.map((item) => item.sales), 1);
    located.forEach((item) => {
      const [lon, lat] = geo[item.key];
      const frac = Math.sqrt(item.sales / max);
      const color = cyan.clone().lerp(pink, frac);
      const normal = latLon(lat, lon).normalize();
      const holder = new THREE.Group();
      holder.position.copy(normal.clone().multiplyScalar(R * 0.995));
      holder.quaternion.setFromUnitVectors(up, normal);
      holder.userData = { country: item.key, sales: item.sales, units: item.units, height: 0.08 + frac * 0.62 };

      const material = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.55, metalness: 0.35, roughness: 0.22, clearcoat: 1, transparent: true, opacity: 0.94 });
      const prism = new THREE.Mesh(prismGeo, material);
      prism.scale.y = holder.userData.height;
      const gem = new THREE.Mesh(gemGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.15, flatShading: true }));
      gem.position.y = holder.userData.height + 0.06;
      const base = new THREE.Mesh(baseGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      base.rotation.x = -Math.PI / 2; base.position.y = 0.004;
      holder.add(prism, gem, base);
      holder.userData.prism = prism; holder.userData.gem = gem;
      [prism, gem].forEach((m) => { m.userData.holder = holder; pickables.push(m); });
      bars.add(holder);
    });
    count.textContent = `${located.length} PAÍSES · ALTURA = VENTAS`;
    grow = reducedMotion ? 1 : 0; growing = !reducedMotion;
    applyGrow();
  }

  function applyGrow() {
    const eased = 1 - (1 - grow) ** 3;
    bars.children.forEach((holder) => {
      const h = holder.userData.height;
      holder.userData.prism.scale.y = Math.max(0.001, h * eased);
      holder.userData.gem.position.y = h * eased + 0.06;
      holder.userData.gem.visible = eased > 0.05;
    });
  }

  // Interacción: tooltip al pasar y filtro al hacer clic.
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null; let downAt = null;
  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    // Ignora prismas ocultos detrás del planeta.
    if (hit) {
      const earthHit = ray.intersectObject(earth, false)[0];
      if (earthHit && earthHit.distance < hit.distance - 0.02) return null;
    }
    return hit ? hit.object.userData.holder : null;
  }
  canvas.addEventListener('pointermove', (event) => {
    const holder = pick(event);
    if (holder === hovered) { if (holder) positionTip(event); return; }
    hovered = holder;
    canvas.style.cursor = holder ? 'pointer' : 'grab';
    controls.autoRotate = !holder && !reducedMotion;
    if (!holder) { tip.hidden = true; return; }
    tip.innerHTML = `<strong></strong><span></span>`;
    tip.firstChild.textContent = holder.userData.country;
    tip.lastChild.textContent = `${fmt2.format(holder.userData.sales)} en ventas · clic para filtrar`;
    tip.hidden = false; positionTip(event);
  });
  function positionTip(event) {
    const rect = canvas.parentElement.getBoundingClientRect();
    tip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 190)}px`;
    tip.style.top = `${Math.max(event.clientY - rect.top - 10, 6)}px`;
  }
  canvas.addEventListener('pointerleave', () => { hovered = null; tip.hidden = true; controls.autoRotate = !reducedMotion; });
  canvas.addEventListener('pointerdown', (event) => { downAt = [event.clientX, event.clientY]; });
  canvas.addEventListener('pointerup', (event) => {
    if (!downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
    const holder = pick(event);
    if (holder) document.dispatchEvent(new CustomEvent('rf:country', { detail: { country: holder.userData.country } }));
  });

  // Ciclo de render: sólo cuando el panel está visible.
  let visible = false; let raf = 0; const clock = new SimpleClock();
  function resize() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (growing) { grow = Math.min(1, grow + dt * 0.9); applyGrow(); if (grow >= 1) growing = false; }
    const t = clock.elapsedTime;
    orbit.rotation.y += dt * 0.15;
    moon.position.set(Math.cos(t * 0.8) * 1.38, 0, Math.sin(t * 0.8) * 1.38);
    moon.rotation.x += dt; moon.rotation.y += dt * 0.6;
    bars.children.forEach((holder, i) => { holder.userData.gem.rotation.y += dt * (1 + (i % 3) * 0.4); });
    controls.update();
    renderer.render(scene, camera);
  }
  function loop() { if (!visible) return; frame(); raf = requestAnimationFrame(loop); }
  function setVisible(value) {
    if (value === visible) return;
    visible = value && !document.hidden;
    cancelAnimationFrame(raf);
    if (visible) { resize(); clock.getDelta(); loop(); }
  }
  new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 }).observe(canvas);
  new ResizeObserver(() => { resize(); if (!visible) renderer.render(scene, camera); }).observe(canvas);
  document.addEventListener('visibilitychange', () => setVisible(!document.hidden && canvas.isConnected));

  resize();
  return { setData, setVisible };
}
